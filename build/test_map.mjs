import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const core = require("../site/js/map-core.js");

test("spelling and normalised keys follow the extractor", () => {
  assert.deepEqual(core.tokens("ACEInhibitorDrug2Type"), ["ace", "inhibitor", "drug", "2", "type"]);
  assert.deepEqual(core.tokens("hasSeverity"), ["has", "severity"]);
  assert.equal(core.spell("haemorrhage"), "hemorrhage");
  assert.equal(core.spell("intermittant"), "intermittent");
  assert.equal(core.normKey("NAMEDElbow"), core.normKey("elbow"));
  assert.equal(core.normKey("Edema"), core.normKey("Oedema"));
  assert.equal(core.normKey("persistant"), core.normKey("persistent"));
});

test("reviewed YAML round-trips the fields loadReviewed reads", () => {
  const doc = {
    mild: {
      opengalen: "MildSeverity",
      confidence: "high",
      rationale: "Value of the severity descriptor.",
      needsHumanReview: false,
    },
    slow: {
      opengalen: null,
      confidence: "medium",
      rationale: 'No counterpart: "slow" is a rate, not a level.',
      needsHumanReview: true,
    },
  };
  const text = core.toYaml(doc, ["Reviewed Clinergy -> OpenGALEN 8 mappings, for map/reviewed.yaml."]);
  const back = core.parseYaml(text);
  assert.equal(back.mild.opengalen, "MildSeverity");
  assert.equal(back.mild.confidence, "high");
  assert.equal(back.mild.needsHumanReview, false);
  assert.equal(back.mild.rationale, "Value of the severity descriptor.");
  assert.equal(back.slow.opengalen, null);
  assert.equal(back.slow.needsHumanReview, true);
  assert.match(back.slow.rationale, /slow/);
  assert.match(text, /^# Reviewed Clinergy/);
});

test("a composed decision records opengalen null and the expression", () => {
  const record = core.decisionRecord(
    { name: "ThumbPainSymptom" },
    {
      mode: "composed",
      confidence: "medium",
      genus: "Pain",
      criteria: [{ role: "hasLocation", filler: "Thumb" }],
      rationale: "No single class was chosen.",
      needsHumanReview: true,
    },
  );
  assert.equal(record.opengalen, null);
  assert.equal(record.confidence, "medium");
  assert.match(record.rationale, /^Composition: Pain which hasLocation Thumb\./);
  assert.equal(core.generatedClassName("Pain", [{ role: "hasLocation", filler: "Thumb" }]), "PainwhichhasLocationThumb");
  const text = core.reviewedDocument([{ name: "ThumbPainSymptom", record }]);
  const back = core.parseYaml(text);
  assert.equal(back.ThumbPainSymptom.opengalen, null);
  assert.match(back.ThumbPainSymptom.rationale, /Pain which hasLocation Thumb/);
});

test("target, none and unsure keep the extractor's four fields", () => {
  const target = core.decisionRecord({}, { mode: "target", opengalen: "Pain", confidence: "high", rationale: "Same meaning.", needsHumanReview: true });
  assert.deepEqual(Object.keys(target).sort(), ["confidence", "needsHumanReview", "opengalen", "rationale"]);
  assert.equal(target.opengalen, "Pain");
  const none = core.decisionRecord({}, { mode: "none", confidence: "high", needsHumanReview: true });
  assert.equal(none.opengalen, null);
  assert.match(none.rationale, /No OpenGALEN equivalent/);
  const unsure = core.decisionRecord({}, { mode: "unsure" });
  assert.equal(unsure.opengalen, null);
  assert.equal(unsure.confidence, "low");
  assert.equal(unsure.needsHumanReview, true);
});

test("issue link uses the mapping template until the snippet is too long", () => {
  const entries = [{
    name: "mild",
    record: core.decisionRecord({}, { mode: "target", opengalen: "MildSeverity", confidence: "high", rationale: "Severity value.", needsHumanReview: true }),
  }];
  const link = core.issueUrl(entries);
  assert.equal(link.tooLong, false);
  const url = new URL(link.url);
  assert.equal(url.origin + url.pathname, "https://github.com/erik-sundvalls-bots/clinergy-extractor/issues/new");
  assert.equal(url.searchParams.get("template"), "mapping.yml");
  assert.equal(url.searchParams.get("labels"), "mapping");
  assert.equal(url.searchParams.get("title"), "Mapping: mild");
  const pasted = core.parseYaml(url.searchParams.get("snippet"));
  assert.equal(pasted.mild.opengalen, "MildSeverity");
  assert.equal(pasted.mild.confidence, "high");
  assert.equal(pasted.mild.needsHumanReview, true);
  const huge = [{
    name: "mild",
    record: core.decisionRecord({}, { mode: "none", confidence: "low", rationale: "x".repeat(core.URL_LIMIT), needsHumanReview: true }),
  }];
  const fallback = core.issueUrl(huge);
  assert.equal(fallback.tooLong, true);
  assert.match(fallback.snippet, /xxxx/);
  assert.match(new URL(fallback.url).searchParams.get("notes"), /downloaded/);
  assert.ok(fallback.url.length < core.URL_LIMIT);
});

test("candidates prefer exact and normalised names over shared tokens", () => {
  const names = ["MildSeverity", "MildSadness", "Severity", "NAMEDElbow", "Pain", "hasSeverity", "persistent"];
  const byNorm = core.buildNormIndex(names);
  const labels = { MildSadness: "mild sadness", Severity: "severity" };
  const index = {
    has: (name) => names.includes(name),
    kind: () => "Class",
    label: (name) => labels[name] || "",
    byNorm: (key) => byNorm.get(key) || [],
    search(text) {
      const q = text.toLowerCase();
      return names
        .filter((name) => name.toLowerCase().includes(q.replace(/[^a-z0-9]/g, "")) || (labels[name] || "").includes(q))
        .map((name) => ({ name, label: labels[name] || "" }));
    },
  };
  const exact = core.rankCandidates({ name: "Pain", display: "pain" }, index);
  assert.equal(exact[0].method, "exact");
  assert.equal(exact[0].name, "Pain");
  const norm = core.rankCandidates({ name: "Elbow", display: "elbow" }, index);
  assert.equal(norm[0].name, "NAMEDElbow");
  assert.equal(norm[0].method, "normalised");
  const spelled = core.rankCandidates({ name: "persistant", display: "persistent" }, index);
  assert.equal(spelled[0].name, "persistent");
  assert.equal(spelled[0].method, "normalised");
  const fuzzy = core.rankCandidates({ name: "mild", display: "mild" }, index);
  assert.ok(fuzzy.some((row) => row.name === "MildSeverity" && row.method === "fuzzy"));
  assert.ok(fuzzy.every((row) => row.method !== "exact"));
});

test("the public thumb-pain worklist parses and keeps Severity and onset context", () => {
  const text = readFileSync(new URL("../site/data/worklist/thumb-pain.yaml", import.meta.url), "utf8");
  const items = core.parseWorklistText(text, "thumb-pain.yaml");
  const byName = new Map(items.map((item) => [item.name, item]));
  assert.ok(byName.has("ThumbPainSymptom"));
  assert.equal(byName.get("ThumbPainSymptom").kind, "formTopic");
  assert.equal(byName.get("ThumbPainSymptom").display, "thumb pain");
  assert.equal(byName.get("AbsoluteSeverity").kind, "descriptor");
  assert.equal(byName.get("AbsoluteSeverity").display, "Severity");
  assert.equal(byName.get("AbsoluteOnset").display, "Onset");
  assert.deepEqual(byName.get("mild").usedAsValueOf[0].siblings, ["moderate", "severe"]);
  assert.equal(byName.get("ConseqPain").kind, "criterialLink");
  assert.equal(byName.get("ThumbExam").kind, "exam");
  const again = core.parseWorklistText(core.toYaml(Object.fromEntries(items.map((item) => [item.name, { kinds: item.kinds, display: item.display }]))), "value.yaml");
  assert.equal(again.find((item) => item.name === "PainSymptom").kind, "concept");
  const fromKindFile = core.parseWorklistText("mild:\n  display: mild\n", "value.yaml");
  assert.equal(fromKindFile[0].kind, "value");
  assert.equal(core.parseMapParam("descriptor/AbsoluteSeverity").name, "AbsoluteSeverity");
  assert.equal(core.parseMapParam("1"), null);
});
