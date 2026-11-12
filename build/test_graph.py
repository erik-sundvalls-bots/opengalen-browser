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
    _kid_off = take(n + 1)
    _eq_off = take(n + 1)
    par_ids = take(n_edges)
    take(n_edges)
    take(n_eq)
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
