#!/usr/bin/env python3
"""Check the committed graph against meta.json and the published spot-checks."""

import array
import gzip
import json
import struct
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "site" / "data"


def load_graph():
    raw = gzip.decompress((DATA / "graph.bin.gz").read_bytes())
    magic, version, n, n_edges, n_eq, name_bytes, n_roots, _reserved = struct.unpack_from(
        "<4sIIIIIII", raw, 0
    )
    assert magic == b"OG8G" and version == 1
    offset = 32

    def take(count):
        nonlocal offset
        arr = array.array("I")
        arr.frombytes(raw[offset : offset + 4 * count])
        if sys.byteorder != "little":
            arr.byteswap()
        offset += 4 * count
        return arr

    name_off = take(n + 1)
    par_off = take(n + 1)
    kid_off = take(n + 1)
    eq_off = take(n + 1)
    par_ids = take(n_edges)
    kid_ids = take(n_edges)
    eq_ids = take(n_eq)
    take(n_roots)
    offset += n + n  # module, generated
    blob = raw[offset : offset + name_bytes]
    assert offset + name_bytes == len(raw)

    def name(i):
        return blob[name_off[i] : name_off[i + 1]].decode()

    return {
        "n": n,
        "n_edges": n_edges,
        "name": name,
        "par_off": par_off,
        "par_ids": par_ids,
        "kid_off": kid_off,
        "kid_ids": kid_ids,
        "eq_off": eq_off,
        "eq_ids": eq_ids,
    }


class GraphTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.meta = json.loads((DATA / "meta.json").read_text())
        cls.g = load_graph()

    def test_counts_match_meta(self):
        self.assertEqual(self.g["n"], self.meta["counts"]["concepts"])
        self.assertEqual(self.g["n_edges"], self.meta["counts"]["uniqueParentLinks"])
        self.assertEqual(self.meta["counts"]["declarationLines"], 164626)
        self.assertEqual(self.meta["counts"]["impliesLines"], 246576)
        self.assertEqual(self.meta["counts"]["equivalentLines"], 1664)

    def test_direct_and_inferred_spot_checks(self):
        index = {self.g["name"](i): i for i in range(self.g["n"]) if self.g["name"](i) in {
            "PulmonaryAtresia",
            "CongenitalPathologywhichinvolvesHeartChamber",
            "PulmonaryAtresiaWithVentricularSeptalDefect",
            "PhenomenonwhichinvolvesHeart",
        }}
        child = index["PulmonaryAtresia"]
        parent = index["CongenitalPathologywhichinvolvesHeartChamber"]
        offs, ids = self.g["par_off"], self.g["par_ids"]
        direct = list(ids[offs[child] : offs[child + 1]])
        self.assertIn(parent, direct)

        start = index["PulmonaryAtresiaWithVentricularSeptalDefect"]
        target = index["PhenomenonwhichinvolvesHeart"]
        seen = set()
        stack = list(ids[offs[start] : offs[start + 1]])
        hit = False
        while stack:
            node = stack.pop()
            if node in seen:
                continue
            seen.add(node)
            if node == target:
                hit = True
                break
            stack.extend(ids[offs[node] : offs[node + 1]])
        self.assertTrue(hit)

    def test_search_finds_asthma(self):
        raw = gzip.decompress((DATA / "search.bin.gz").read_bytes())
        magic, version, n_tokens, n_posts, token_bytes, _reserved = struct.unpack_from("<4sIIIII", raw, 0)
        self.assertEqual(magic, b"SRCH")
        self.assertEqual(version, 1)
        offset = 24

        def take(count):
            nonlocal offset
            arr = array.array("I")
            arr.frombytes(raw[offset : offset + 4 * count])
            if sys.byteorder != "little":
                arr.byteswap()
            offset += 4 * count
            return arr

        token_off = take(n_tokens + 1)
        post_off = take(n_tokens + 1)
        posts = take(n_posts)
        blob = raw[offset : offset + token_bytes]
        tokens = [blob[token_off[i] : token_off[i + 1]].decode() for i in range(n_tokens)]
        self.assertIn("asthma", tokens)
        i = tokens.index("asthma")
        ids = list(posts[post_off[i] : post_off[i + 1]])
        names = {self.g["name"](j) for j in ids}
        self.assertIn("Asthma", names)

    def test_bodystructure_is_not_an_adenoma(self):
        self.assertEqual(self.meta["counts"]["classifierArtefactsRemoved"], 2)
        self.assertEqual(self.meta["counts"]["cyclesDropped"], 5)
        wanted = {
            "BodyStructure",
            "OrganicSolidStructure",
            "Adenoma",
            "Heart",
            "Hand",
            "Femur",
            "Thumb",
            "VillousAdenoma",
        }
        index = {}
        for i in range(self.g["n"]):
            name = self.g["name"](i)
            if name in wanted:
                index[name] = i
                if len(index) == len(wanted):
                    break
        offs, ids = self.g["par_off"], self.g["par_ids"]

        def parent_names(i):
            return {self.g["name"](p) for p in ids[offs[i] : offs[i + 1]]}

        self.assertEqual(parent_names(index["BodyStructure"]), {"OrganicSolidStructure"})

        def reaches(child, parent):
            target = index[parent]
            seen = set()
            stack = list(ids[offs[index[child]] : offs[index[child] + 1]])
            while stack:
                node = stack.pop()
                if node in seen:
                    continue
                seen.add(node)
                if node == target:
                    return True
                stack.extend(ids[offs[node] : offs[node + 1]])
            return False

        for name in ("Heart", "Hand", "Femur", "Thumb"):
            self.assertFalse(reaches(name, "Adenoma"), name)
        self.assertTrue(reaches("VillousAdenoma", "Adenoma"))

    def test_thumb_pollux_equivalents_merge(self):
        # The classified dump hangs every implies line on Pollux; Thumb is the
        # second GRAIL name of the same expression and has no is-a links of its
        # own. The browser merges the group. Canonical name: prefer a name
        # without 'which', then most parent+child links, then shorter, then alphabetical.
        wanted = {"Thumb", "Pollux", "Finger", "SupernumeraryThumb"}
        index = {}
        for i in range(self.g["n"]):
            name = self.g["name"](i)
            if name in wanted:
                index[name] = i
                if len(index) == len(wanted):
                    break
        self.assertEqual(set(index), wanted)
        thumb, pollux = index["Thumb"], index["Pollux"]

        def row(off_key, ids_key, i):
            off, ids = self.g[off_key], self.g[ids_key]
            return list(ids[off[i] : off[i + 1]])

        def names_of(ids):
            return {self.g["name"](j) for j in ids}

        self.assertEqual(row("par_off", "par_ids", thumb), [])
        self.assertEqual(row("kid_off", "kid_ids", thumb), [])
        self.assertEqual(names_of(row("eq_off", "eq_ids", thumb)), {"Pollux"})
        self.assertEqual(names_of(row("eq_off", "eq_ids", pollux)), {"Thumb"})
        self.assertIn("Finger", names_of(row("par_off", "par_ids", pollux)))
        self.assertIn("SupernumeraryThumb", names_of(row("kid_off", "kid_ids", pollux)))

        def rel_count(i):
            return (self.g["par_off"][i + 1] - self.g["par_off"][i]) + (
                self.g["kid_off"][i + 1] - self.g["kid_off"][i]
            )

        def members(i):
            return [i] + row("eq_off", "eq_ids", i)

        def canonical(i):
            def key(j):
                name = self.g["name"](j)
                return (
                    1 if "which" in name else 0,
                    -rel_count(j),
                    len(name),
                    name.lower(),
                    name,
                )

            return sorted(members(i), key=key)[0]

        self.assertGreater(rel_count(pollux), rel_count(thumb))
        self.assertEqual(self.g["name"](canonical(thumb)), "Pollux")
        self.assertEqual(canonical(thumb), canonical(pollux))

        def merged(i, off_key, ids_key):
            group = set(members(i))
            out = set()
            for m in group:
                for other in row(off_key, ids_key, m):
                    if other not in group:
                        out.add(canonical(other))
            return {self.g["name"](j) for j in out}

        self.assertIn("Finger", merged(thumb, "par_off", "par_ids"))
        self.assertEqual(merged(thumb, "par_off", "par_ids"), merged(pollux, "par_off", "par_ids"))
        self.assertIn("SupernumeraryThumb", merged(thumb, "kid_off", "kid_ids"))
        self.assertEqual(merged(thumb, "kid_off", "kid_ids"), merged(pollux, "kid_off", "kid_ids"))

    def test_banned_knowledge_names_are_not_merged(self):
        # The dump marks ZootleWordle / Base / BoneMarrow / Clipping / Fornix /
        # Tonsil / Tubercle equivalent under BannedKnowledgeNames because those
        # GRAIL names are ambiguous. The browser must keep them as separate
        # nodes. Only Tubercle has the BannedKnowledgeNames parent.
        bag = {
            "ZootleWordle",
            "Base",
            "BoneMarrow",
            "Clipping",
            "Fornix",
            "Tonsil",
            "Tubercle",
        }
        index = {}
        for i in range(self.g["n"]):
            name = self.g["name"](i)
            if name in bag or name == "BannedKnowledgeNames":
                index[name] = i
                if len(index) == len(bag) + 1:
                    break
        self.assertEqual(set(index), bag | {"BannedKnowledgeNames"})

        def row(off_key, ids_key, i):
            off, ids = self.g[off_key], self.g[ids_key]
            return list(ids[off[i] : off[i + 1]])

        def names_of(ids):
            return {self.g["name"](j) for j in ids}

        def raw_members(i):
            return [i] + row("eq_off", "eq_ids", i)

        def is_banned_bag(i):
            for m in raw_members(i):
                if self.g["name"](m) == "ZootleWordle":
                    return True
                if "BannedKnowledgeNames" in names_of(row("par_off", "par_ids", m)):
                    return True
            return False

        for name in bag:
            self.assertTrue(is_banned_bag(index[name]), name)
            # Dump equivalents are still recorded, but the merge rule uses only self.
            others = names_of(row("eq_off", "eq_ids", index[name]))
            self.assertTrue(others & bag, name)
        self.assertEqual(
            names_of(row("par_off", "par_ids", index["Tubercle"])),
            {"BannedKnowledgeNames"},
        )
        self.assertEqual(row("par_off", "par_ids", index["Tonsil"]), [])
        self.assertEqual(row("par_off", "par_ids", index["Base"]), [])

    def test_mentaldisease_is_preferred_canonical(self):
        wanted = {
            "MentalDisease",
            "MentalDisorder",
            "PathologicalPhenomenonwhichinvolvesMentalSystem",
        }
        index = {}
        for i in range(self.g["n"]):
            name = self.g["name"](i)
            if name in wanted or name.startswith("Mental") or name.startswith("Psychiatric") or name == "PsychologicalDisorder":
                if "which" in name and name != "PathologicalPhenomenonwhichinvolvesMentalSystem":
                    continue
            if name in wanted:
                index[name] = i
                if len(index) == len(wanted):
                    break
        # Also collect the whole raw group from MentalDisease.
        def row(off_key, ids_key, i):
            off, ids = self.g[off_key], self.g[ids_key]
            return list(ids[off[i] : off[i + 1]])

        disease = None
        for i in range(self.g["n"]):
            if self.g["name"](i) == "MentalDisease":
                disease = i
                break
        self.assertIsNotNone(disease)
        members = [disease] + row("eq_off", "eq_ids", disease)
        names = [self.g["name"](j) for j in members]
        self.assertIn("MentalDisease", names)
        self.assertIn("PathologicalPhenomenonwhichinvolvesMentalSystem", names)

        def rel_count(i):
            return (self.g["par_off"][i + 1] - self.g["par_off"][i]) + (
                self.g["kid_off"][i + 1] - self.g["kid_off"][i]
            )

        def key(j):
            name = self.g["name"](j)
            return (1 if "which" in name else 0, -rel_count(j), len(name), name.lower(), name)

        canon = sorted(members, key=key)[0]
        self.assertEqual(self.g["name"](canon), "MentalDisease")
        which = next(j for j in members if self.g["name"](j) == "PathologicalPhenomenonwhichinvolvesMentalSystem")
        self.assertGreater(rel_count(which), rel_count(canon))

    def test_first_has_restored_valuetype_parent(self):
        wanted = {"first", "second", "OrdinalPositionValueType", "SymbolicValueType"}
        index = {}
        for i in range(self.g["n"]):
            name = self.g["name"](i)
            if name in wanted:
                index[name] = i
                if len(index) == len(wanted):
                    break
        self.assertEqual(set(index), wanted)
        self.assertEqual(self.meta["counts"]["valueTypeParentsRestored"], 22)
        offs, ids = self.g["par_off"], self.g["par_ids"]

        def parent_names(i):
            return {self.g["name"](p) for p in ids[offs[i] : offs[i + 1]]}

        self.assertEqual(parent_names(index["first"]), {"OrdinalPositionValueType"})
        self.assertEqual(parent_names(index["second"]), {"OrdinalPositionValueType"})
        self.assertEqual(parent_names(index["OrdinalPositionValueType"]), {"SymbolicValueType"})

        def reaches(child, parent):
            target = index[parent]
            seen = set()
            stack = list(ids[offs[index[child]] : offs[index[child] + 1]])
            while stack:
                node = stack.pop()
                if node in seen:
                    continue
                seen.add(node)
                if node == target:
                    return True
                stack.extend(ids[offs[node] : offs[node + 1]])
            return False

        self.assertTrue(reaches("first", "SymbolicValueType"))

    def test_pollux_qualifiers_parse_to_graph_targets(self):
        # Sanction/qualifier phrases already stored for the panel must parse
        # into role + filler edges the sanctions toggle can draw.
        prefixes = (
            "sensiblyAndTopicNecessarily",
            "grammaticallyAndTopicNecessarily",
            "grammaticallyAndSensibly",
            "topicNecessarily",
            "sensibly",
            "grammatically",
        )
        by_name = {}
        needed = {"Pollux", "PulpOfThumb", "ThumbNail"}
        for i in range(self.g["n"]):
            name = self.g["name"](i)
            if name in needed:
                by_name[name] = i
                if len(by_name) == len(needed):
                    break
        shard = by_name["Pollux"] // self.meta["shardSize"]
        recs = json.loads(gzip.decompress((DATA / "d" / f"{shard:04d}.json.gz").read_bytes()))
        phrases = recs[str(by_name["Pollux"])]["q"]
        self.assertEqual(
            set(phrases),
            {
                "topicNecessarily hasSpecificStructuralComponent PulpOfThumb",
                "topicNecessarily hasSpecificStructuralComponent ThumbNail",
            },
        )

        def parse(phrase):
            rest = phrase
            kind = "sanction"
            for prefix in prefixes:
                if rest.startswith(prefix + " "):
                    kind = prefix
                    rest = rest[len(prefix) + 1 :]
                    break
            role, target = rest.split(" ", 1)
            return kind, role, target

        parsed = [parse(p) for p in phrases]
        self.assertEqual({row[0] for row in parsed}, {"topicNecessarily"})
        self.assertEqual({row[1] for row in parsed}, {"hasSpecificStructuralComponent"})
        self.assertEqual({row[2] for row in parsed}, {"PulpOfThumb", "ThumbNail"})
        for _, _, target in parsed:
            self.assertIn(target, by_name)

    def test_anaemia_definition_is_grail_like(self):
        index = {}
        for i in range(self.g["n"]):
            name = self.g["name"](i)
            if name == "Anaemia":
                index[name] = i
                break
        shard = index["Anaemia"] // self.meta["shardSize"]
        recs = json.loads(gzip.decompress((DATA / "d" / f"{shard:04d}.json.gz").read_bytes()))
        text = recs[str(index["Anaemia"])]["d"]
        self.assertIn("which", text)
        self.assertIn("HaemoglobinConcentration", text)


if __name__ == "__main__":
    unittest.main()
