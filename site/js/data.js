/* Load the OpenGALEN graph, search index and definition shards.
   Derived data is GOSL; this loader is MIT. See NOTICE. */
(function () {
  const OG = (window.OG = window.OG || {});

  function db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("opengalen8", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    const base = await db();
    return new Promise((resolve, reject) => {
      const tx = base.transaction("kv", "readonly");
      const req = tx.objectStore("kv").get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, value) {
    const base = await db();
    return new Promise((resolve, reject) => {
      const tx = base.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function url(path) {
    return new URL(path, document.baseURI).href;
  }

  async function gunzip(buf) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("This browser cannot decompress the hierarchy (DecompressionStream).");
    }
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }

  async function cachedBytes(path, version) {
    const key = version + "|" + path;
    try {
      const hit = await idbGet(key);
      if (hit) return hit;
    } catch (err) {
      /* private mode and older browsers still work online */
    }
    const res = await fetch(url(path));
    if (!res.ok) throw new Error(path + " (" + res.status + ")");
    const gz = await res.arrayBuffer();
    const raw = await gunzip(gz);
    try { await idbSet(key, raw); } catch (err) { /* cache is optional */ }
    return raw;
  }

  function u32(view, offset, count) {
    return new Uint32Array(view.buffer, view.byteOffset + offset, count);
  }

  function parseGraph(buf) {
    const view = new DataView(buf);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== "OG8G") throw new Error("Unexpected hierarchy file.");
    const n = view.getUint32(8, true);
    const nEdges = view.getUint32(12, true);
    const nEq = view.getUint32(16, true);
    const nameBytes = view.getUint32(20, true);
    const nRoots = view.getUint32(24, true);
    let o = 32;
    const nameOff = u32(view, o, n + 1); o += (n + 1) * 4;
    const parOff = u32(view, o, n + 1); o += (n + 1) * 4;
    const kidOff = u32(view, o, n + 1); o += (n + 1) * 4;
    const eqOff = u32(view, o, n + 1); o += (n + 1) * 4;
    const parIds = u32(view, o, nEdges); o += nEdges * 4;
    const kidIds = u32(view, o, nEdges); o += nEdges * 4;
    const eqIds = u32(view, o, nEq); o += nEq * 4;
    o += nRoots * 4;
    const mod = new Uint8Array(buf, o, n); o += n;
    const gen = new Uint8Array(buf, o, n); o += n;
    const blob = new Uint8Array(buf, o, nameBytes);
    const dec = new TextDecoder();
    const names = new Array(n);
    const parents = new Array(n);
    const children = new Array(n);
    const equiv = new Array(n);
    const byName = new Map();
    for (let i = 0; i < n; i++) {
      names[i] = dec.decode(blob.subarray(nameOff[i], nameOff[i + 1]));
      parents[i] = Array.from(parIds.subarray(parOff[i], parOff[i + 1]));
      children[i] = Array.from(kidIds.subarray(kidOff[i], kidOff[i + 1]));
      equiv[i] = Array.from(eqIds.subarray(eqOff[i], eqOff[i + 1]));
      byName.set(names[i], i);
    }
    const order = names.map((_, i) => i).sort((a, b) => names[a].toLowerCase() < names[b].toLowerCase() ? -1 : names[a].toLowerCase() > names[b].toLowerCase() ? 1 : a - b);
    return { n, names, parents, children, equiv, mod, gen, byName, order };
  }

  function parseSearch(buf) {
    const view = new DataView(buf);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== "SRCH") throw new Error("Unexpected search index.");
    const nTokens = view.getUint32(8, true);
    const nPosts = view.getUint32(12, true);
    const tokenBytes = view.getUint32(16, true);
    let o = 24;
    const tokenOff = u32(view, o, nTokens + 1); o += (nTokens + 1) * 4;
    const postOff = u32(view, o, nTokens + 1); o += (nTokens + 1) * 4;
    const posts = u32(view, o, nPosts); o += nPosts * 4;
    const blob = new Uint8Array(buf, o, tokenBytes);
    const dec = new TextDecoder();
    const tokens = new Array(nTokens);
    for (let i = 0; i < nTokens; i++) tokens[i] = dec.decode(blob.subarray(tokenOff[i], tokenOff[i + 1]));
    return { tokens, postOff, posts };
  }

  function spaced(name) {
    return name
      .replace(/which/g, " which ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenRange(search, prefix) {
    const tokens = search.tokens;
    let lo = 0;
    let hi = tokens.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tokens[mid] < prefix) lo = mid + 1;
      else hi = mid;
    }
    const start = lo;
    hi = tokens.length;
    const endKey = prefix + "\uffff";
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tokens[mid] < endKey) lo = mid + 1;
      else hi = mid;
    }
    return [start, lo];
  }

  function searchConcepts(model, query, showGen, limit) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const words = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
    const { names, order, gen } = model.graph;
    const out = [];
    const seen = new Set();
    function add(id, rank) {
      if (seen.has(id) || (!showGen && gen[id])) return;
      seen.add(id);
      out.push({ id, rank });
    }
    if (words.length <= 1) {
      const key = words[0] || q;
      let lo = 0;
      let hi = order.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (names[order[mid]].toLowerCase() < key) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < order.length && out.length < limit; i++) {
        const id = order[i];
        if (!names[id].toLowerCase().startsWith(key)) break;
        add(id, 0);
      }
      const [a, b] = tokenRange(model.search, key);
      const span = Math.min(b, a + (key.length < 4 ? 4 : 24));
      for (let t = a; t < span && out.length < limit * 3; t++) {
        const posts = model.search.posts;
        const from = model.search.postOff[t];
        const to = model.search.postOff[t + 1];
        const step = to - from > 800 ? Math.ceil((to - from) / 800) : 1;
        for (let p = from; p < to && out.length < limit * 4; p += step) add(posts[p], 1);
      }
    } else {
      let ids = null;
      for (const word of words) {
        const [a, b] = tokenRange(model.search, word);
        const bag = new Set();
        const span = Math.min(b, a + 12);
        for (let t = a; t < span; t++) {
          const from = model.search.postOff[t];
          const to = model.search.postOff[t + 1];
          for (let p = from; p < to; p++) bag.add(model.search.posts[p]);
        }
        ids = ids ? new Set([...ids].filter((id) => bag.has(id))) : bag;
        if (!ids.size) break;
      }
      for (const id of ids || []) add(id, 1);
    }
    if (model.labels) {
      for (const [id, label] of model.labelEntries) {
        if (label.includes(q)) add(+id, 1);
      }
    }
    out.sort((a, b) => a.rank - b.rank || names[a.id].length - names[b.id].length || names[a.id].localeCompare(names[b.id]));
    return out.slice(0, limit).map((row) => row.id);
  }

  const shardCache = new Map();
  async function loadRecord(model, id) {
    const size = model.meta.shardSize;
    const sid = Math.floor(id / size);
    if (!shardCache.has(sid)) {
      const path = "data/d/" + String(sid).padStart(4, "0") + ".json.gz";
      const key = model.meta.built + "|" + path;
      let obj = null;
      try { obj = await idbGet(key); } catch (err) { obj = null; }
      if (!obj) {
        try {
          const raw = await cachedBytes(path, model.meta.built);
          obj = JSON.parse(new TextDecoder().decode(raw));
        } catch (err) {
          obj = {};
        }
        try { await idbSet(key, obj); } catch (e) { /* ignore */ }
      }
      shardCache.set(sid, obj);
    }
    return shardCache.get(sid)[String(id)] || null;
  }

  async function loadAll(onStatus) {
    onStatus("Reading the catalogue…");
    const meta = await fetch(url("data/meta.json")).then((r) => {
      if (!r.ok) throw new Error("meta.json (" + r.status + ")");
      return r.json();
    });
    onStatus("Loading the hierarchy…");
    const [graphBuf, searchBuf, labelBuf] = await Promise.all([
      cachedBytes("data/" + meta.files.graph, meta.built),
      cachedBytes("data/" + meta.files.search, meta.built),
      cachedBytes("data/" + meta.files.labels, meta.built),
    ]);
    onStatus("Indexing names…");
    const graph = parseGraph(graphBuf);
    const search = parseSearch(searchBuf);
    const labels = JSON.parse(new TextDecoder().decode(labelBuf));
    const labelEntries = Object.entries(labels).map(([id, text]) => [id, String(text).toLowerCase()]);
    return { meta, graph, search, labels, labelEntries };
  }

  OG.loadAll = loadAll;
  OG.loadRecord = loadRecord;
  OG.searchConcepts = searchConcepts;
  OG.spaced = spaced;
})();
