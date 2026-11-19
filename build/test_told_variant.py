#!/usr/bin/env python3
"""Check the lazy told (pre-classification) hierarchy variant.

The variant lives in site/data/told-variant/ and must never be part of the
first load: the default page reads data/meta.json and the files it lists.
"""

import gzip
import json
import re
import shutil
import struct
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
DATA = SITE / "data"
TOLD = DATA / "told-variant"


def load_told():
    raw = gzip.decompress((TOLD / "parents.bin.gz").read_bytes())
    magic, version, n, n_edges = struct.unpack_from("<4sIII", raw, 0)
    off = struct.unpack_from(f"<{n + 1}I", raw, 16)
    ids = struct.unpack_from(f"<{n_edges}I", raw, 16 + 4 * (n + 1))
    kinds = raw[16 + 4 * (n + 1) + 4 * n_edges :]
    return magic, version, n, n_edges, off, ids, kinds


class ToldVariantTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.meta = json.loads((DATA / "meta.json").read_text(encoding="utf-8"))
        cls.tmeta = json.loads((TOLD / "meta.json").read_text(encoding="utf-8"))
        cls.told = load_told()

    def test_manifest_matches_graph_build(self):
        self.assertEqual(self.tmeta["graphBuilt"], self.meta["built"])
        self.assertEqual(self.tmeta["concepts"], self.meta["counts"]["concepts"])
        self.assertTrue(self.tmeta["ok"], [c for c in self.tmeta["checks"] if not c["ok"]])
        self.assertEqual(self.tmeta["bytes"]["parents"], (TOLD / "parents.bin.gz").stat().st_size)

    def test_binary_layout(self):
        magic, version, n, n_edges, off, ids, kinds = self.told
        self.assertEqual((magic, version), (b"OG8T", 1))
        self.assertEqual(n, self.meta["counts"]["concepts"])
        self.assertEqual(off[-1], n_edges)
        self.assertEqual(len(kinds), n_edges)
        self.assertEqual(n_edges, self.tmeta["counts"]["toldLinks"])
        self.assertTrue(all((k & 0x0F) in (0, 1, 2) for k in kinds))
        self.assertFalse(any((k & 0xC0) == 0xC0 for k in kinds), "direct and refined are exclusive")
        self.assertTrue(all(i < n for i in ids))

    def test_counts_add_up(self):
        c = self.tmeta["counts"]
        self.assertEqual(c["owlSubClassOfLines"], self.meta["counts"]["subClassAxioms"])
        self.assertEqual(c["owlEquivalentClassesLines"], self.meta["counts"]["equivalentClassAxioms"])
        self.assertEqual(
            c["alsoDirectInferred"] + c["toldStillInferredAncestor"] + c["toldNotInferredAncestor"],
            c["toldLinks"],
        )
        self.assertEqual(sum(c["toldLinksByKind"]), c["toldLinks"])
        self.assertEqual(len(self.tmeta["notInferred"]), c["toldNotInferredAncestor"])

    def test_restored_red_links_are_not_in_the_dump_set(self):
        # The 103 told parents restored in red by the main extract are told
        # links the dump omitted, so in told mode they stay red ("missing").
        told_doc = json.loads(gzip.decompress((DATA / "told.json.gz").read_bytes()))
        missing = {(c, p) for c, p, _k in self.tmeta["notInferred"]}
        for child, parent, _f, _l in told_doc["edges"]:
            self.assertIn((child, parent), missing)

    def test_not_loaded_on_first_load(self):
        # Nothing on the default path names the told variant.
        self.assertNotIn("told-variant", (DATA / "meta.json").read_text(encoding="utf-8"))
        self.assertNotIn("told-variant", (SITE / "index.html").read_text(encoding="utf-8"))
        data_js = (SITE / "js" / "data.js").read_text(encoding="utf-8")
        load_all = re.search(r"async function loadAll\(onStatus\) \{.*?\n  \}\n", data_js, re.S).group(0)
        self.assertNotIn("told-variant", load_all)
        self.assertNotIn("loadToldVariant", load_all)
        app_js = (SITE / "js" / "app.js").read_text(encoding="utf-8")
        # The only caller is the Told button handler.
        self.assertEqual(app_js.count("OG.loadToldVariant("), 1)
        self.assertIn('hierButtons.told.addEventListener("click", () => setHierarchy("told"))', app_js)

    def test_asset_version_bumped(self):
        html = (SITE / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("?v=17", html)
        self.assertIn("?v=18", html)

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_browser_loader_in_node(self):
        out = subprocess.run(
            ["node", str(ROOT / "build" / "told_variant_check.js")],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        r = json.loads(out)
        self.assertEqual(r["toldEdges"], self.tmeta["counts"]["toldLinks"])
        self.assertTrue(r["sharesNames"])
        self.assertTrue(r["baseUntouched"])
        self.assertIn("built for another graph", r["mismatch"])
        self.assertEqual(r["variants"]["Pollux>Finger"], "direct")
        self.assertEqual(r["variants"]["Hepatitis>InflammationLesion"], "refined")
        self.assertEqual(r["variants"]["first>OrdinalPositionValueType"], "missing")
        self.assertEqual(r["variants"]["AbdominalFistula>Fistula"], "missing")
        self.assertIsNone(r["variants"]["inferredView"])
        self.assertEqual(r["isToldLink"], {"toldMissing": True, "toldRefined": False, "inferredRestored": True})
        self.assertEqual(r["kinds"]["first>OrdinalPositionValueType"], [0])
        self.assertEqual(r["kinds"]["Thumb>Finger"], [1])
        self.assertEqual(r["thumbParentsTold"], ["Finger"])
        self.assertIn("Finger", r["thumbParentsInferred"])
        self.assertGreater(len(r["thumbParentsInferred"]), 1)
        self.assertEqual(r["asthmaParentsTold"], ["NAMEDSystemicDisease"])
        self.assertTrue(r["fingerHasThumbChildTold"])
        self.assertTrue(r["bannedBagStillDetected"])


if __name__ == "__main__":
    unittest.main()
