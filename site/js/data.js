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
    const base = new URL(document.baseURI);
    let pathname = base.pathname;
    if (!pathname.endsWith("/")) {
      const last = pathname.slice(pathname.lastIndexOf("/") + 1);
      pathname = last.includes(".") ? pathname.slice(0, pathname.lastIndexOf("/") + 1) : pathname + "/";
    }
    return new URL(path, base.origin + pathname).href;
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
    const graph = { n, names, parents, children, equiv, mod, gen, byName, order };
    attachCanon(graph);
    return graph;
  }

  /* Canonical name of an equivalence group:
     1. Prefer a name that does not contain "which" (short readable names
        such as MentalDisease beat a long inferred which-class).
     2. Then the member with the most classified is-a relations (parent
        links plus child links).
     3. Then the shorter official name.
     4. Ties broken alphabetically (case-insensitive, then the original
        string).
     The URL hash keeps the name the user opened; the canonical name is
     the representative when the group appears as a neighbour.
     The dump's BannedKnowledgeNames bag (ZootleWordle, Base, Tonsil, …)
     is not merged: those names are marked equivalent because they are
     ambiguous, not because they are one concept. */
  function relationCount(graph, id) {
    return graph.parents[id].length + graph.children[id].length;
  }

  function isWhichStyle(name) {
    return name.indexOf("which") >= 0;
  }

  function compareCanon(graph, a, b) {
    const wa = isWhichStyle(graph.names[a]) ? 1 : 0;
    const wb = isWhichStyle(graph.names[b]) ? 1 : 0;
    if (wa !== wb) return wa - wb;
    const ra = relationCount(graph, a);
    const rb = relationCount(graph, b);
    if (rb !== ra) return rb - ra;
    const la = graph.names[a].length;
    const lb = graph.names[b].length;
    if (la !== lb) return la - lb;
    const na = graph.names[a].toLowerCase();
    const nb = graph.names[b].toLowerCase();
    if (na !== nb) return na < nb ? -1 : 1;
    if (graph.names[a] !== graph.names[b]) return graph.names[a] < graph.names[b] ? -1 : 1;
    return a - b;
  }

  function rawEquivalents(graph, id) {
    const others = graph.equiv[id];
    return others && others.length ? [id].concat(others) : [id];
  }

  function isBannedBag(graph, id) {
    const members = rawEquivalents(graph, id);
    for (const m of members) {
      if (graph.names[m] === "ZootleWordle") return true;
      for (const p of graph.parents[m]) {
        if (graph.names[p] === "BannedKnowledgeNames") return true;
      }
    }
    return false;
  }

  function attachCanon(graph) {
    const { n, equiv } = graph;
    const canon = new Array(n);
    for (let i = 0; i < n; i++) {
      if (canon[i] != null) continue;
      const members = [i].concat(equiv[i]);
      if (isBannedBag(graph, i)) {
        for (const m of members) canon[m] = m;
        continue;
      }
      members.sort((a, b) => compareCanon(graph, a, b));
      const chosen = members[0];
      for (const m of members) canon[m] = chosen;
    }
    graph.canon = canon;
    return graph;
  }

  function equivMembers(graph, id) {
    if (isBannedBag(graph, id)) return [id];
    return rawEquivalents(graph, id);
  }

  const QUAL_PREFIXES = [
    "sensiblyAndTopicNecessarily",
    "grammaticallyAndTopicNecessarily",
    "grammaticallyAndSensibly",
    "topicNecessarily",
    "sensibly",
    "grammatically",
  ];
  const QUAL_COLOR = "#9a3d6b";
  // Default number of relationship or sanction items checked in the panel.
  // Not a hard cap: the user can check more, or all, from the scrollable list.
  const EDGE_CAP = 16;

  function edgeKey(edge) {
    if (!edge) return "";
    const target = edge.target != null ? edge.target : (edge.targetName || "");
    return String(edge.prop || "") + ":" + String(target);
  }

  function defaultEdgeKeys(edges, cap) {
    const limit = cap == null ? EDGE_CAP : cap;
    const keys = [];
    const seen = new Set();
    for (let i = 0; i < (edges || []).length; i++) {
      const key = edgeKey(edges[i]);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
      if (keys.length >= limit) break;
    }
    return keys;
  }

  function parseQualPhrase(phrase, byName) {
    const text = String(phrase || "").trim();
    if (!text) return null;
    let rest = text;
    let kind = "sanction";
    for (let i = 0; i < QUAL_PREFIXES.length; i++) {
      const prefix = QUAL_PREFIXES[i];
      if (rest.startsWith(prefix + " ")) {
        kind = prefix;
        rest = rest.slice(prefix.length + 1);
        break;
      }
    }
    const space = rest.indexOf(" ");
    if (space < 1) return null;
    const role = rest.slice(0, space);
    const targetName = rest.slice(space + 1).trim();
    if (!role || !targetName || !byName) return null;
    const target = byName.get(targetName);
    if (target == null) return null;
    return { kind, role, prop: role, target, targetName, phrase: text, color: QUAL_COLOR };
  }

  function groupHeading(graph, id) {
    return equivMembers(graph, id).map((i) => graph.names[i]).join(" = ");
  }

  function neighbourLabel(graph, id) {
    const members = equivMembers(graph, id);
    if (members.length === 1) return graph.names[id];
    const c = graph.canon[id];
    const names = [graph.names[c]].concat(members.filter((i) => i !== c).map((i) => graph.names[i]));
    const joined = names.join(" = ");
    if (names.length <= 3 && joined.length <= 48) return joined;
    return graph.names[c];
  }

  function nodeLabel(graph, id, focus) {
    return id === focus ? groupHeading(graph, id) : neighbourLabel(graph, id);
  }

  function nameSort(graph, ids) {
    ids.sort((a, b) => {
      const na = graph.names[a].toLowerCase();
      const nb = graph.names[b].toLowerCase();
      if (na !== nb) return na < nb ? -1 : 1;
      return a - b;
    });
    return ids;
  }

  function collapsedHierarchy(graph, focus) {
    const { parents, children, canon } = graph;
    const focusGroup = new Set(equivMembers(graph, focus));
    function rep(id) {
      return focusGroup.has(id) ? focus : canon[id];
    }
    const upCache = new Map();
    const downCache = new Map();
    function parentsOf(id) {
      let out = upCache.get(id);
      if (out) return out;
      const members = equivMembers(graph, id);
      const seen = new Set();
      out = [];
      for (const m of members) {
        for (const p of parents[m]) {
          const r = rep(p);
          if (members.includes(p) || r === rep(id) || seen.has(r)) continue;
          seen.add(r);
          out.push(r);
        }
      }
      nameSort(graph, out);
      upCache.set(id, out);
      return out;
    }
    function childrenOf(id) {
      let out = downCache.get(id);
      if (out) return out;
      const members = equivMembers(graph, id);
      const seen = new Set();
      out = [];
      for (const m of members) {
        for (const child of children[m]) {
          const r = rep(child);
          if (members.includes(child) || r === rep(id) || seen.has(r)) continue;
          seen.add(r);
          out.push(r);
        }
      }
      nameSort(graph, out);
      downCache.set(id, out);
      return out;
    }
    return { rep, parentsOf, childrenOf, focusGroup };
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
    attachTold(graph, null);
    if (meta.files.told) {
      try {
        const toldBuf = await cachedBytes("data/" + meta.files.told, meta.built);
        attachTold(graph, JSON.parse(new TextDecoder().decode(toldBuf)));
      } catch (err) {
        /* the graph still works without the told-edge marks */
      }
    }
    return { meta, graph, search, labels, labelEntries };
  }

  // Told OWL SubClassOf parents that the classified dump omitted. The extract
  // restores them (see told.json.gz); the browser draws them in red and warns.
  const TOLD_COLOR = "#d0262d";
  function attachTold(graph, doc) {
    const up = new Map();
    const down = new Map();
    const rows = [];
    for (const row of (doc && doc.edges) || []) {
      const [child, parent, file, line] = row;
      const item = { child, parent, file: (doc.files || [])[file] || "", line };
      rows.push(item);
      if (!up.has(child)) up.set(child, []);
      up.get(child).push(parent);
      if (!down.has(parent)) down.set(parent, []);
      down.get(parent).push(child);
    }
    graph.told = { up, down, rows, count: rows.length };
  }

  /* True when some member of child's group has a told parent in parent's group. */
  function isToldLink(graph, child, parent) {
    const told = graph.told;
    if (!told || !told.count || child == null || parent == null) return false;
    const parentGroup = equivMembers(graph, parent);
    for (const m of equivMembers(graph, child)) {
      const ups = told.up.get(m);
      if (!ups) continue;
      for (const p of ups) if (parentGroup.includes(p)) return true;
    }
    return false;
  }

  /* Told rows touching this concept's equivalence group, as child or parent. */
  function toldRowsFor(graph, id) {
    const told = graph.told;
    if (!told || !told.count) return [];
    const members = new Set(equivMembers(graph, id));
    return told.rows.filter((row) => members.has(row.child) || members.has(row.parent));
  }

  const REL_COLORS = ["#6b3fa0", "#c45a5a", "#1d6a9a", "#a67c12", "#0e7a62", "#b5485d", "#3d7a4a", "#7a4b8c", "#c46b1a", "#3a4f8c", "#8a4b2f", "#5a6b2f", "#8a3d6b", "#2f5f73", "#6b5420", "#4a3d7a"];
  let propsDoc = null;
  const relShardCache = new Map();

  async function loadProps(model) {
    if (propsDoc && propsDoc.built === model.meta.built) return propsDoc;
    const raw = await cachedBytes("data/" + model.meta.files.properties, model.meta.built);
    const doc = JSON.parse(new TextDecoder().decode(raw));
    doc.built = model.meta.built;
    propsDoc = doc;
    return doc;
  }

  async function loadRels(model, id) {
    const props = await loadProps(model);
    const sid = Math.floor(id / model.meta.shardSize);
    const path = "data/r/" + String(sid).padStart(4, "0") + ".json.gz";
    const key = model.meta.built + "|" + path;
    if (!relShardCache.has(key)) {
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
      relShardCache.set(key, obj);
    }
    const rows = relShardCache.get(key)[String(id)] || [];
    return rows.map(([propIndex, target]) => {
      const prop = props.props[propIndex];
      return {
        prop: prop.n,
        group: props.groups[prop.g],
        groupIndex: prop.g,
        target,
        color: REL_COLORS[prop.g % REL_COLORS.length],
      };
    });
  }

  const incShardCache = new Map();
  /* Concepts whose definitions use id as a role filler: [{prop, source}]. */
  async function loadIncoming(model, id) {
    if (!model.meta.files.incoming) return [];
    const props = await loadProps(model);
    const sid = Math.floor(id / model.meta.shardSize);
    const path = "data/i/" + String(sid).padStart(4, "0") + ".json.gz";
    const key = model.meta.built + "|" + path;
    if (!incShardCache.has(key)) {
      let obj = null;
      try {
        const raw = await cachedBytes(path, model.meta.built);
        obj = JSON.parse(new TextDecoder().decode(raw));
      } catch (err) {
        obj = {};
      }
      incShardCache.set(key, obj);
    }
    const rows = incShardCache.get(key)[String(id)] || [];
    return rows.map(([propIndex, source]) => {
      const prop = props.props[propIndex];
      return {
        prop: prop.n,
        group: props.groups[prop.g],
        groupIndex: prop.g,
        source,
        target: source,
        dir: "in",
        color: REL_COLORS[prop.g % REL_COLORS.length],
      };
    });
  }

  OG.loadAll = loadAll;
  OG.loadIncoming = loadIncoming;
  OG.isToldLink = isToldLink;
  OG.toldRowsFor = toldRowsFor;
  OG.attachTold = attachTold;
  OG.TOLD_COLOR = TOLD_COLOR;
  OG.loadRecord = loadRecord;
  OG.loadRels = loadRels;
  OG.searchConcepts = searchConcepts;
  OG.spaced = spaced;
  OG.equivMembers = equivMembers;
  OG.rawEquivalents = rawEquivalents;
  OG.isBannedBag = isBannedBag;
  OG.groupHeading = groupHeading;
  OG.neighbourLabel = neighbourLabel;
  OG.nodeLabel = nodeLabel;
  OG.collapsedHierarchy = collapsedHierarchy;
  OG.parseQualPhrase = parseQualPhrase;
  OG.edgeKey = edgeKey;
  OG.defaultEdgeKeys = defaultEdgeKeys;
  OG.QUAL_COLOR = QUAL_COLOR;
  OG.EDGE_CAP = EDGE_CAP;
  OG.QUAL_PREFIXES = QUAL_PREFIXES;
})();
