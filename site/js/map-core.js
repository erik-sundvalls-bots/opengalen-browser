/* Clinergy → OpenGALEN mapping helpers. MIT. See NOTICE.
   The reviewed-file shape matches clinergy-extractor loadReviewed(). */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  const OG = (root.OG = root.OG || {});
  OG.mapCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const KIND_ORDER = ["formTopic", "exam", "descriptor", "criterialLink", "value", "concept"];
  const KIND_LABEL = {
    formTopic: "Topic",
    exam: "Exam",
    descriptor: "Descriptor",
    criterialLink: "Link",
    value: "Value",
    concept: "Concept",
  };
  const ISSUE_NEW = "https://github.com/erik-sundvalls-bots/clinergy-extractor/issues/new";
  const URL_LIMIT = 4500;
  const STOP = new Set(["of", "in", "on", "the", "a", "an", "which", "has", "is", "with", "by", "to", "from", "and", "for", "at"]);
  const WEAK = new Set(["symptom", "sign", "diagnosis", "absolute", "quantity", "named", "finding", "complaint", "exam"]);
  const RESERVED = /^(?:true|false|yes|no|on|off|y|n|null|~|[-+]?(?:\d[\d_]*)?(?:\.\d*)?(?:e[-+]?\d+)?|\.inf|\.nan|0x[0-9a-f]+|0o[0-7]+)$/i;
  const PLAIN = /^[A-Za-z_(][A-Za-z0-9_ .()\/'+&-]*$/;

  function tokens(name) {
    return String(name)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/([A-Za-z])([0-9])/g, "$1 $2")
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((t) => t.toLowerCase());
  }

  function spell(t) {
    return t
      .replace(/ae/g, "e")
      .replace(/oe(?=[a-z])/g, "e")
      .replace(/isation/g, "ization")
      .replace(/yse$/, "yze")
      .replace(/our$/, "or")
      .replace(/tre$/, "ter")
      .replace(/ant$/, "ent")
      .replace(/ies$/, "y")
      .replace(/([^s])s$/, "$1");
  }

  function normKey(name) {
    const t = tokens(name);
    if (t[0] === "named" && t.length > 1) t.shift();
    return t.map(spell).join("");
  }

  function weight(t) {
    return STOP.has(t) ? 0 : WEAK.has(t) ? 0.25 : 1;
  }

  function weighted(name) {
    const m = new Map();
    for (const raw of tokens(name)) {
      const t = spell(raw);
      const w = weight(raw);
      if (w > 0) m.set(t, Math.max(m.get(t) || 0, w));
    }
    return m;
  }

  function dice(a, b) {
    let common = 0;
    let sa = 0;
    let sb = 0;
    for (const [t, w] of a) {
      sa += w;
      if (b.has(t)) common += Math.min(w, b.get(t));
    }
    for (const w of b.values()) sb += w;
    return sa + sb ? (2 * common) / (sa + sb) : 0;
  }

  function yamlScalar(s) {
    if (s !== "" && PLAIN.test(s) && !RESERVED.test(s) && !s.endsWith(" ") && !s.includes(" #") && !s.includes(": ")) return s;
    return JSON.stringify(s);
  }

  function yamlAtom(v) {
    if (v === null || v === undefined) return "null";
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    return yamlScalar(String(v));
  }

  function isAtom(v) {
    return v === null || v === undefined || ["string", "number", "boolean"].includes(typeof v);
  }

  function inline(v) {
    if (isAtom(v)) return yamlAtom(v);
    if (Array.isArray(v)) {
      if (!v.every(isAtom)) return null;
      const s = "[" + v.map(yamlAtom).join(", ") + "]";
      return s.length <= 100 ? s : null;
    }
    if (v && typeof v === "object") {
      const e = Object.entries(v).filter(([, x]) => x !== undefined);
      if (!e.every(([, x]) => isAtom(x))) return null;
      const s = "{" + e.map(([k, x]) => yamlScalar(k) + ": " + yamlAtom(x)).join(", ") + "}";
      return s.length <= 100 && e.length <= 4 ? s : null;
    }
    return null;
  }

  function emit(v, indent, out) {
    if (Array.isArray(v)) {
      if (!v.length) return;
      for (const x of v) {
        const one = inline(x);
        if (one !== null) {
          out.push(indent + "- " + one);
          continue;
        }
        if (x && typeof x === "object") {
          const sub = [];
          emitMap(x, indent + "  ", sub);
          if (!sub.length) out.push(indent + "- {}");
          else out.push(indent + "- " + sub[0].slice(indent.length + 2), ...sub.slice(1));
        } else {
          out.push(indent + "- " + yamlAtom(x));
        }
      }
      return;
    }
    if (v && typeof v === "object") emitMap(v, indent, out);
    else out.push(indent + yamlAtom(v));
  }

  function emitMap(m, indent, out) {
    for (const [k, v] of Object.entries(m)) {
      if (v === undefined) continue;
      const key = yamlScalar(k);
      if (Array.isArray(v) && !v.length) {
        out.push(indent + key + ": []");
        continue;
      }
      if (v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length) {
        out.push(indent + key + ": {}");
        continue;
      }
      const one = inline(v);
      if (one !== null) {
        out.push(indent + key + ": " + one);
        continue;
      }
      out.push(indent + key + ":");
      emit(v, indent + "  ", out);
    }
  }

  function toYaml(doc, comment) {
    const out = (comment || []).map((c) => (c ? "# " + c : "#"));
    emit(doc, "", out);
    return out.join("\n") + "\n";
  }

  function unquote(s) {
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
      try { return JSON.parse(s); } catch (err) { return s.slice(1, -1); }
    }
    if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'");
    return s;
  }

  function parseScalar(raw) {
    const s = raw.trim();
    if (s === "" || s === "null" || s === "~" || s === "Null" || s === "NULL") return null;
    if (s === "true" || s === "True" || s === "TRUE") return true;
    if (s === "false" || s === "False" || s === "FALSE") return false;
    if (/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s)) return Number(s);
    if (s[0] === "[" || s[0] === "{") return parseFlow(s);
    if ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'"))) return unquote(s);
    return s;
  }

  function parseFlow(s) {
    let i = 0;
    function skip() { while (s[i] === " " || s[i] === "\t") i++; }
    function readScalar() {
      skip();
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i++];
        let out = "";
        while (i < s.length && s[i] !== q) {
          if (s[i] === "\\" && q === '"') {
            i++;
            const map = { n: "\n", t: "\t", '"': '"', "\\": "\\" };
            out += map[s[i]] || s[i];
          } else if (s[i] === "'" && s[i + 1] === "'") {
            out += "'";
            i++;
          } else out += s[i];
          i++;
        }
        i++;
        return q === '"' ? out : out;
      }
      const start = i;
      while (i < s.length && s[i] !== "," && s[i] !== "]" && s[i] !== "}" && s[i] !== ":") i++;
      return parseScalar(s.slice(start, i));
    }
    function readValue() {
      skip();
      if (s[i] === "[") return readList();
      if (s[i] === "{") return readMap();
      return readScalar();
    }
    function readList() {
      i++;
      const arr = [];
      skip();
      if (s[i] === "]") { i++; return arr; }
      while (i < s.length) {
        arr.push(readValue());
        skip();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "]") { i++; break; }
        break;
      }
      return arr;
    }
    function readMap() {
      i++;
      const obj = {};
      skip();
      if (s[i] === "}") { i++; return obj; }
      while (i < s.length) {
        const key = String(readScalar());
        skip();
        if (s[i] === ":") i++;
        obj[key] = readValue();
        skip();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "}") { i++; break; }
        break;
      }
      return obj;
    }
    return readValue();
  }

  function parseYaml(text) {
    const lines = String(text).replace(/\r\n/g, "\n").split("\n");
    const rows = [];
    for (let n = 0; n < lines.length; n++) {
      const cut = stripComment(lines[n]).replace(/\s+$/, "");
      if (!cut.trim()) continue;
      const indent = cut.match(/^ */ )[0].length;
      rows.push({ indent, text: cut.trim(), line: n + 1 });
    }
    let i = 0;
    function parseMap(indent) {
      const obj = {};
      while (i < rows.length && rows[i].indent === indent && !rows[i].text.startsWith("- ")) {
        const row = rows[i++];
        const split = splitKey(row.text, row.line);
        if (split.rest === "") {
          if (i < rows.length && rows[i].indent > indent) obj[split.key] = parseNode(rows[i].indent);
          else obj[split.key] = null;
        } else obj[split.key] = parseScalar(split.rest);
      }
      return obj;
    }
    function parseList(indent) {
      const arr = [];
      while (i < rows.length && rows[i].indent === indent && rows[i].text.startsWith("- ")) {
        const row = rows[i++];
        const rest = row.text.slice(1).trim();
        if (!rest) {
          arr.push(i < rows.length && rows[i].indent > indent ? parseNode(rows[i].indent) : null);
        } else if (isMapEntry(rest)) {
          const obj = {};
          const split = splitKey(rest, row.line);
          obj[split.key] = split.rest === "" ? null : parseScalar(split.rest);
          if (i < rows.length && rows[i].indent > indent && !rows[i].text.startsWith("- ")) {
            Object.assign(obj, parseMap(rows[i].indent));
          }
          arr.push(obj);
        } else arr.push(parseScalar(rest));
      }
      return arr;
    }
    function parseNode(indent) {
      if (i >= rows.length || rows[i].indent < indent) return null;
      return rows[i].text.startsWith("- ") ? parseList(rows[i].indent) : parseMap(rows[i].indent);
    }
    if (!rows.length) return {};
    const doc = parseNode(rows[0].indent);
    if (i < rows.length) throw new Error("YAML was not finished at line " + rows[i].line);
    return doc;
  }

  function stripComment(line) {
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === "\\" && q === '"') { i++; continue; }
        if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === "#" && (i === 0 || line[i - 1] === " ")) return line.slice(0, i);
    }
    return line;
  }

  function isMapEntry(text) {
    if (text[0] === "[" || text[0] === "{" || text[0] === '"' || text[0] === "'") return false;
    return /:\s*\S?/.test(text) && text.indexOf(":") > 0;
  }

  function splitKey(text, line) {
    let q = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === "\\" && q === '"') { i++; continue; }
        if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === ":") {
        const rest = text.slice(i + 1).trim();
        return { key: unquote(text.slice(0, i).trim()), rest };
      }
    }
    throw new Error("Expected key: value at line " + line);
  }

  function asList(v) {
    if (Array.isArray(v)) return v.map(String);
    if (v == null || v === "") return [];
    return [String(v)];
  }

  function primaryKind(kinds) {
    for (const kind of KIND_ORDER) if (kinds.includes(kind)) return kind;
    return kinds[0] || "concept";
  }

  function normalizeEntry(name, raw, fallbackKind) {
    const e = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    let kinds = asList(e.kinds && e.kinds.length ? e.kinds : e.kind || fallbackKind || "concept");
    kinds = kinds.filter((k) => KIND_ORDER.includes(k));
    if (!kinds.length) kinds = [KIND_ORDER.includes(fallbackKind) ? fallbackKind : "concept"];
    return {
      name: String(name),
      kinds,
      kind: primaryKind(kinds),
      display: e.display ? String(e.display) : "",
      category: e.category ? String(e.category) : "",
      location: e.location ? String(e.location) : "",
      supers: asList(e.supers),
      usedInForms: e.usedInForms && typeof e.usedInForms === "object" ? e.usedInForms : null,
      valueSets: Array.isArray(e.valueSets) ? e.valueSets : [],
      usedAsValueOf: Array.isArray(e.usedAsValueOf) ? e.usedAsValueOf : [],
      sentenceWords: e.sentenceWords && typeof e.sentenceWords === "object" ? e.sentenceWords : null,
      unverifiedHints: Array.isArray(e.unverifiedHints) ? e.unverifiedHints : [],
      examGroup: e.examGroup ? String(e.examGroup) : "",
    };
  }

  function kindFromFilename(filename) {
    const base = String(filename || "").split(/[/\\]/).pop().replace(/\.(ya?ml|json)$/i, "");
    return KIND_ORDER.includes(base) ? base : "";
  }

  function normalizeWorklist(doc, filename) {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("A worklist file must be a mapping of Clinergy names.");
    const fallback = kindFromFilename(filename);
    return Object.entries(doc)
      .filter(([name]) => name && !name.startsWith("#"))
      .map(([name, raw]) => normalizeEntry(name, raw, fallback))
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
  }

  function parseWorklistText(text, filename) {
    const trimmed = String(text).trim();
    if (!trimmed) return [];
    const doc = trimmed[0] === "{" || trimmed[0] === "[" ? JSON.parse(trimmed) : parseYaml(trimmed);
    return normalizeWorklist(doc, filename);
  }

  function mergeItems(lists) {
    const byName = new Map();
    for (const list of lists) for (const item of list) byName.set(item.name, item);
    return [...byName.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
  }

  function buildNormIndex(names) {
    const byNorm = new Map();
    for (const name of names) {
      const key = normKey(name);
      const list = byNorm.get(key);
      if (list) list.push(name);
      else byNorm.set(key, [name]);
    }
    return byNorm;
  }

  function rankCandidates(query, index, limit) {
    const cap = limit || 8;
    const clinergy = query.name || "";
    const display = (query.display || "").trim();
    const out = [];
    const seen = new Set();
    function add(name, method, reason, score) {
      if (!name || seen.has(name) || !index.has(name)) return;
      seen.add(name);
      out.push({
        name,
        method,
        reason,
        score: Math.round(score * 1000) / 1000,
        kind: index.kind(name) || "",
        label: index.label(name) || "",
      });
    }
    if (index.has(clinergy)) add(clinergy, "exact", "identical name", 1);
    for (const name of index.byNorm(normKey(clinergy))) {
      if (name !== clinergy) add(name, "normalised", "equal after normalisation (case, punctuation, NAMED prefix, spelling)", 1);
    }
    if (display && normKey(display) !== normKey(clinergy)) {
      for (const name of index.byNorm(normKey(display))) {
        add(name, "normalised", "display text matches after normalisation", 0.98);
      }
    }
    const probes = [];
    if (display) probes.push(display);
    const spaced = tokens(clinergy).join(" ");
    if (spaced && spaced !== display.toLowerCase()) probes.push(spaced);
    const hits = [];
    const hitNames = new Set();
    for (const probe of probes) {
      for (const hit of index.search(probe, 24)) {
        if (!hit || !hit.name || hitNames.has(hit.name)) continue;
        hitNames.add(hit.name);
        hits.push(hit);
      }
    }
    const mine = weighted(display || clinergy);
    const scored = hits.map((hit) => {
      const theirs = weighted(hit.name);
      const shared = [...mine.keys()].filter((t) => theirs.has(t));
      const score = dice(mine, theirs);
      const label = (hit.label || index.label(hit.name) || "").toLowerCase();
      const words = tokens(display || clinergy).filter((t) => t.length >= 3 && !STOP.has(t));
      const synonym = words.length > 0 && words.every((w) => label.includes(w)) && score < 0.34;
      return { hit, score, shared, synonym };
    });
    scored.sort((a, b) => b.score - a.score || a.hit.name.length - b.hit.name.length);
    for (const row of scored) {
      if (row.synonym) add(row.hit.name, "synonym", "language label contains the Clinergy words", Math.max(row.score, 0.5));
      else if (row.score >= 0.34 || row.shared.length) {
        add(row.hit.name, "fuzzy", row.shared.length ? "shared tokens: " + row.shared.join(", ") : "search hit", row.score);
      }
    }
    const order = { exact: 0, normalised: 1, synonym: 2, fuzzy: 3 };
    out.sort((a, b) => order[a.method] - order[b.method] || b.score - a.score || a.name.localeCompare(b.name));
    return out.slice(0, cap);
  }

  function compositionText(genus, criteria) {
    let text = genus || "";
    for (const row of criteria || []) {
      if (!row || !row.role || !row.filler) continue;
      text += " which " + row.role + " " + row.filler;
    }
    return text.trim();
  }

  function generatedClassName(genus, criteria) {
    let text = genus || "";
    for (const row of criteria || []) {
      if (!row || !row.role || !row.filler) continue;
      text += "which" + row.role + row.filler;
    }
    return text;
  }

  function decisionRecord(item, decision) {
    const mode = decision.mode || "unsure";
    const confidence = decision.confidence || (mode === "unsure" ? "low" : "medium");
    let rationale = String(decision.rationale || "").trim();
    let opengalen = null;
    if (mode === "target") {
      opengalen = decision.opengalen ? String(decision.opengalen) : null;
      if (!rationale) rationale = "Chosen in the OpenGALEN browser.";
    } else if (mode === "composed") {
      const expression = decision.expression || compositionText(decision.genus, decision.criteria);
      const lead = expression ? "Composition: " + expression + "." : "Needs a composed expression.";
      rationale = rationale.startsWith("Composition:") ? rationale : (lead + (rationale ? " " + rationale : ""));
    } else if (mode === "none") {
      if (!rationale) rationale = "No OpenGALEN equivalent.";
    } else if (!rationale) rationale = "Unsure. Needs another reviewer.";
    return {
      opengalen,
      confidence,
      rationale,
      needsHumanReview: decision.needsHumanReview !== false,
    };
  }

  function reviewedDocument(entries) {
    const doc = {};
    for (const row of entries) doc[row.name] = row.record;
    return toYaml(doc, [
      "Reviewed Clinergy -> OpenGALEN 8 mappings, for map/reviewed.yaml.",
      "opengalen is an OpenGALEN 8 name, or null when no single entity fits.",
      "Checked with: deno task map <extract-dir> <opengalen-source> <map-dir> --reviewed <this-file>",
    ]);
  }

  function issueTitle(entries) {
    if (entries.length === 1) return "Mapping: " + entries[0].name;
    return "Mapping: " + entries.length + " Clinergy names";
  }

  function issueUrl(entries) {
    const snippet = reviewedDocument(entries);
    const params = new URLSearchParams();
    params.set("template", "mapping.yml");
    params.set("labels", "mapping");
    params.set("title", issueTitle(entries));
    params.set("snippet", snippet);
    const url = ISSUE_NEW + "?" + params.toString();
    if (url.length > URL_LIMIT) {
      const note = new URLSearchParams();
      note.set("template", "mapping.yml");
      note.set("labels", "mapping");
      note.set("title", issueTitle(entries));
      note.set("snippet", "# The snippet is longer than a GitHub link can carry.\n# Attach the downloaded reviewed.yaml file.\n");
      note.set("notes", "The reviewed.yaml snippet was downloaded because it did not fit in this link. Attach that file.");
      return { url: ISSUE_NEW + "?" + note.toString(), snippet, tooLong: true };
    }
    return { url, snippet, tooLong: false };
  }

  function parseMapParam(value) {
    const raw = String(value || "").trim();
    if (!raw || raw === "1") return null;
    const slash = raw.indexOf("/");
    if (slash === -1) return { kind: "", name: decodeURIComponent(raw) };
    const kind = raw.slice(0, slash);
    const name = decodeURIComponent(raw.slice(slash + 1));
    return { kind: KIND_ORDER.includes(kind) ? kind : "", name };
  }

  return {
    KIND_ORDER,
    KIND_LABEL,
    URL_LIMIT,
    tokens,
    spell,
    normKey,
    weighted,
    dice,
    yamlScalar,
    toYaml,
    parseYaml,
    parseWorklistText,
    normalizeWorklist,
    mergeItems,
    buildNormIndex,
    rankCandidates,
    compositionText,
    generatedClassName,
    decisionRecord,
    reviewedDocument,
    issueUrl,
    parseMapParam,
  };
});
