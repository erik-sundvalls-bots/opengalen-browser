/* Hash helpers for #concept=Name&lesson=id&step=n.
   MIT. No DOM. Unknown keys are kept and ignored by the browser. */
(function (root) {
  function decodePart(value) {
    try { return decodeURIComponent(String(value).replace(/\+/g, "%20")); }
    catch (err) { return String(value); }
  }

  function parseHash(hash) {
    const raw = hash == null ? "" : String(hash);
    const body = raw.charAt(0) === "#" ? raw.slice(1) : raw;
    const out = { concept: "", params: {} };
    if (!body) return out;
    const parts = body.split("&");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      const eq = part.indexOf("=");
      const key = decodePart(eq < 0 ? part : part.slice(0, eq));
      const value = eq < 0 ? "" : decodePart(part.slice(eq + 1));
      if (!key) continue;
      if (key === "concept") out.concept = value;
      else out.params[key] = value;
    }
    return out;
  }

  function buildHash(concept, params) {
    const parts = [];
    if (concept) parts.push("concept=" + encodeURIComponent(concept));
    const src = params || {};
    const keys = Object.keys(src).filter((key) => key && key !== "concept" && src[key] != null && src[key] !== "");
    keys.sort((a, b) => {
      const rank = { lesson: 0, step: 1 };
      const ra = Object.prototype.hasOwnProperty.call(rank, a) ? rank[a] : 2;
      const rb = Object.prototype.hasOwnProperty.call(rank, b) ? rank[b] : 2;
      if (ra !== rb) return ra - rb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    for (let i = 0; i < keys.length; i++) {
      parts.push(encodeURIComponent(keys[i]) + "=" + encodeURIComponent(String(src[keys[i]])));
    }
    return parts.length ? "#" + parts.join("&") : "";
  }

  /* 1-based step. Missing, zero, and non-integers become 1. Past the end clamps. */
  function stepNumber(value, count) {
    const n = typeof value === "number" ? value : Number(value);
    const max = count == null ? 0 : Number(count);
    if (!Number.isInteger(n) || n < 1) return 1;
    if (Number.isInteger(max) && max >= 1 && n > max) return max;
    return n;
  }

  const api = { parseHash: parseHash, buildHash: buildHash, stepNumber: stepNumber };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    const OG = (root.OG = root.OG || {});
    OG.parseHash = parseHash;
    OG.buildHash = buildHash;
    OG.stepNumber = stepNumber;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
