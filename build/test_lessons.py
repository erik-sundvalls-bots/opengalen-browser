#!/usr/bin/env python3
"""Lesson files name real concepts, and the hash parser keeps #concept= links."""

import array
import gzip
import json
import shutil
import struct
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "site" / "data"
LESSONS = ROOT / "site" / "lessons"
SITE = ROOT / "site"

# Substrings checked against the 17/11/2026 draft PDF. Do not paraphrase them.
DRAFT_QUOTES = [
    "Definitions – Pericarditis = Inflammation of the Pericardium",
    "Universals – (All) Hands are parts of upper extremities, (All) Birds are Vertebrates",
    "Paris is the capital of France",
    "Statements that may be/are generally/… true but are not necessarily true",
    "The classic manifestation confusing meaning and background knowledge is the question “How do I say ‘may’ on OWL?”.",
    "Useful Generalisations – (Most) Gram positive bacteria sensitiveTo (Most) Penicillin.",
    "GALEN represented generic background knowledge as “extrinsics” which were ignored by the classifier but available to applications and inherited by default.",
    "Higher order knowledge was excluded except in comments.",
    "“Gorilla is an endangered species”. This is a statement about the class/species Gorilla, not about “all gorillas”.",
    "They cannot be reasoned over by a DL reasoner.",
    "Excluded from PEN&PAD and GALEN themselves.",
    "The GALEN model was about meaning and knowledge, not data.",
    "Statements about individual patients (data) do not follow DL semantics because they can never be “necessary”.",
    "Sound, Computable, Human comprehensible – i.e. capable of being presented so as to be understood and used by end users and developers.",
    "Useful and Usable systems for health care professionals.",
    "a means to that end",
    "GRAIL writes the hierarchy backwards from OWL, A newSub B rather than B subClassOf A",
    "newSub was convenient check on spelling errors",
]

# Name correspondences that are still with Alan. Not taught in the written chapters.
UNSETTLED = [
    "hasStructuralComponent",
    "hasLeftRightSelector",
    "topicNecessarily",
    "is_part_of",
    "hasLaterality",
    "CardiovascularSystem",
    "RightLaterality",
]


def load_names():
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
    take(n + 1)
    take(n + 1)
    take(n + 1)
    take(n_edges)
    take(n_edges)
    take(n_eq)
    take(n_roots)
    offset += n + n
    blob = raw[offset : offset + name_bytes]
    assert offset + name_bytes == len(raw)
    return {blob[name_off[i] : name_off[i + 1]].decode() for i in range(n)}


def walk_concepts(obj, found):
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key == "concept" and isinstance(value, str) and value.strip():
                found.append(value.strip())
            else:
                walk_concepts(value, found)
    elif isinstance(obj, list):
        for item in obj:
            walk_concepts(item, found)


class LessonTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.names = load_names()
        cls.files = sorted(LESSONS.glob("*.json"))

    def test_lesson_files_present(self):
        ids = {path.name for path in self.files}
        self.assertEqual(
            ids,
            {"index.json", "orientation.json", "layers.json", "sanctions.json", "composition.json"},
        )

    def test_every_concept_is_in_the_graph(self):
        found = []
        for path in self.files:
            walk_concepts(json.loads(path.read_text(encoding="utf-8")), found)
        self.assertIn("Thumb", found)
        self.assertIn("first", found)
        self.assertIn("Pericarditis", found)
        self.assertIn("Bird", found)
        self.assertIn("GramPositiveBacterium", found)
        self.assertIn("Gorilla", found)
        missing = sorted({name for name in found if name not in self.names})
        self.assertEqual(missing, [])
        self.assertNotIn("Paris", self.names)
        self.assertNotIn("France", self.names)

    def test_written_chapters_do_not_teach_unsettled_mappings(self):
        for name in ("orientation.json", "layers.json"):
            text = (LESSONS / name).read_text(encoding="utf-8")
            for token in UNSETTLED:
                self.assertNotIn(token, text, name)

    def test_placeholders_mark_alans_open_questions(self):
        for name in ("sanctions.json", "composition.json"):
            text = (LESSONS / name).read_text(encoding="utf-8")
            self.assertIn("TODO(alan)", text)
            self.assertIn("awaiting-author", text)
            doc = json.loads(text)
            self.assertTrue(doc["todoAlan"])
            self.assertTrue(all("TODO(alan)" in line for line in doc["todoAlan"]))

    def test_draft_quotes_are_exact_and_present(self):
        blob = "\n".join(path.read_text(encoding="utf-8") for path in self.files)
        blob += (SITE / "js" / "tutorial.js").read_text(encoding="utf-8")
        for quote in DRAFT_QUOTES:
            self.assertIn(quote, blob)

    def test_lessons_are_not_on_the_first_load(self):
        html = (SITE / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("tutorial.js", html)
        self.assertNotIn("tutorial.css", html)
        self.assertNotIn("lessons/", html)
        self.assertIn("js/hash.js?v=16", html)
        app = (SITE / "js" / "app.js").read_text(encoding="utf-8")
        self.assertEqual(app.count("js/tutorial.js"), 1)
        self.assertEqual(app.count("css/tutorial.css"), 1)
        self.assertNotIn("lessons/", app)
        load_all = __import__("re").search(
            r"async function loadAll\(onStatus\) \{.*?\n  \}\n",
            (SITE / "js" / "data.js").read_text(encoding="utf-8"),
            __import__("re").S,
        ).group(0)
        self.assertNotIn("lessons/", load_all)
        self.assertNotIn("tutorial", load_all)

    @unittest.skipUnless(shutil.which("node"), "node is not installed")
    def test_hash_parsing(self):
        script = r"""
const h = require("./site/js/hash.js");
const cases = [
  ["", {concept: "", params: {}}],
  ["#", {concept: "", params: {}}],
  ["#concept=Thumb", {concept: "Thumb", params: {}}],
  ["#concept=Hand&lesson=sanctions&step=2", {concept: "Hand", params: {lesson: "sanctions", step: "2"}}],
  ["#lesson=orientation", {concept: "", params: {lesson: "orientation"}}],
  ["#concept=Thumb&foo=1", {concept: "Thumb", params: {foo: "1"}}],
  ["#concept=A%20B&lesson=layers&step=1", {concept: "A B", params: {lesson: "layers", step: "1"}}],
  ["#step=3&lesson=layers&concept=Bird", {concept: "Bird", params: {lesson: "layers", step: "3"}}],
  ["#concept=", {concept: "", params: {}}],
  ["#concept=Thumb&lesson=", {concept: "Thumb", params: {lesson: ""}}]
];
function sameParams(got, expected) {
  const keys = Object.keys(expected);
  if (Object.keys(got).length !== keys.length) return false;
  return keys.every((key) => got[key] === expected[key]);
}
const results = cases.map(([input, expected]) => {
  const got = h.parseHash(input);
  const same = got.concept === expected.concept && sameParams(got.params, expected.params);
  return {input, same, got};
});
const round = h.buildHash("Hand", {step: "2", foo: "1", lesson: "sanctions"});
const plain = h.buildHash("Thumb", {});
const bare = h.buildHash("", {lesson: "orientation"});
const steps = {
  missing: h.stepNumber("", 5),
  zero: h.stepNumber("0", 5),
  ok: h.stepNumber("2", 5),
  far: h.stepNumber("9", 5),
  float: h.stepNumber("2.5", 5),
  word: h.stepNumber("two", 5)
};
if (results.some((row) => !row.same)) {
  console.log(JSON.stringify({ok: false, results, round, plain, bare, steps}));
  process.exit(1);
}
console.log(JSON.stringify({ok: true, round, plain, bare, steps}));
"""
        out = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        got = json.loads(out)
        self.assertTrue(got["ok"])
        self.assertEqual(got["round"], "#concept=Hand&lesson=sanctions&step=2&foo=1")
        self.assertEqual(got["plain"], "#concept=Thumb")
        self.assertEqual(got["bare"], "#lesson=orientation")
        self.assertEqual(got["steps"], {"missing": 1, "zero": 1, "ok": 2, "far": 5, "float": 1, "word": 1})


if __name__ == "__main__":
    unittest.main()
