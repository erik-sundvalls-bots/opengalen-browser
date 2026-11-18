// Node check of the told-variant loader in site/js/data.js (no browser).
// Run: node build/told_variant_check.js  -> prints JSON results.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(root, "site/js/data.js"), "utf8"), { window, TextDecoder, URL, console });
const OG = window.OG;
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const base = OG.parseGraph(ab(zlib.gunzipSync(fs.readFileSync(path.join(root, "site/data/graph.bin.gz")))));
const toldDoc = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, "site/data/told.json.gz"))).toString("utf8"));
OG.attachTold(base, toldDoc);
const raw = ab(zlib.gunzipSync(fs.readFileSync(path.join(root, "site/data/told-variant/parents.bin.gz"))));
const told = OG.makeToldGraph(base, OG.parseToldParents(raw, base.n));
const id = (name) => base.byName.get(name);
const names = (g, ids) => ids.map((i) => g.names[i]);
let mismatch = null;
try { OG.parseToldParents(raw, base.n + 1); } catch (err) { mismatch = err.message; }
const thumbTold = OG.collapsedHierarchy(told, id("Thumb"));
const thumbInf = OG.collapsedHierarchy(base, id("Thumb"));
const out = {
  n: base.n,
  toldEdges: told.toldEdges,
  sharesNames: told.names === base.names && told.canon === base.canon && told.equiv === base.equiv,
  baseUntouched: base.variant === undefined && base.parents[id("Asthma")].length > 1,
  mismatch,
  variants: {
    "Pollux>Finger": OG.linkVariant(told, id("Pollux"), id("Finger")),
    "Hepatitis>InflammationLesion": OG.linkVariant(told, id("Hepatitis"), id("InflammationLesion")),
    "first>OrdinalPositionValueType": OG.linkVariant(told, id("first"), id("OrdinalPositionValueType")),
    "AbdominalFistula>Fistula": OG.linkVariant(told, id("AbdominalFistula"), id("Fistula")),
    "inferredView": OG.linkVariant(base, id("Pollux"), id("Finger")),
  },
  isToldLink: {
    toldMissing: OG.isToldLink(told, id("first"), id("OrdinalPositionValueType")),
    toldRefined: OG.isToldLink(told, id("Hepatitis"), id("InflammationLesion")),
    inferredRestored: OG.isToldLink(base, id("first"), id("OrdinalPositionValueType")),
  },
  kinds: {
    "Thumb>Finger": OG.toldStatementKinds(told, id("Thumb"), id("Finger")),
    "first>OrdinalPositionValueType": OG.toldStatementKinds(told, id("first"), id("OrdinalPositionValueType")),
  },
  thumbParentsTold: names(told, thumbTold.parentsOf(id("Thumb"))),
  thumbParentsInferred: names(base, thumbInf.parentsOf(id("Thumb"))),
  asthmaParentsTold: names(told, OG.collapsedHierarchy(told, id("Asthma")).parentsOf(id("Asthma"))),
  fingerHasThumbChildTold: OG.collapsedHierarchy(told, id("Finger")).childrenOf(id("Finger")).some((c) => OG.equivMembers(told, c).includes(id("Thumb"))),
  bannedBagStillDetected: OG.isBannedBag(told, id("ZootleWordle")),
};
process.stdout.write(JSON.stringify(out));
