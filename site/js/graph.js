/* Sugiyama neighbourhood of one OpenGALEN concept.
   Clustering follows the CDR Catalyst V7 idea (sct7): keep the focus, the
   root, the root's children and the focus's direct parents; group other
   ancestors that share the same nearest kept descendants into a +n pill.
   With a single focus, V7's multi-code branch test would keep every node,
   so that test is not used here. d3-dag 0.11 has no .gap(); the V7 slack
   [7, 46] is passed through nodeSize. */
(function () {
  const OG = (window.OG = window.OG || {});
  // Vertical slack matches the V7 gap of 46. Horizontal slack is wider than
  // V7's 7 because OpenGALEN names are much longer than the SNOMED labels.
  const GAP = [22, 46];
  const PAL = () => d3.schemeTableau10.filter((c) => c !== "#bab0ac").map((c) => {
    const h = d3.hcl(c);
    h.l = Math.min(h.l, 58);
    h.c = Math.min(h.c, 55);
    return h.formatHex();
  });

  function ancestorSet(parents, focus) {
    const anc = new Set([focus]);
    const stack = [focus];
    while (stack.length) {
      const node = stack.pop();
      for (const parent of parents[node]) {
        if (!anc.has(parent)) {
          anc.add(parent);
          stack.push(parent);
        }
      }
    }
    return anc;
  }

  function upsOf(parents, anc, hidden, id) {
    const out = [];
    const seen = new Set();
    const stack = parents[id].slice();
    while (stack.length) {
      const parent = stack.pop();
      if (seen.has(parent) || !anc.has(parent)) continue;
      seen.add(parent);
      if (hidden.has(parent)) {
        for (const grand of parents[parent]) stack.push(grand);
      } else out.push(parent);
    }
    return out;
  }

  function clusterAncestors(focus, vis, parentOf) {
    const kids = new Map();
    for (const id of vis) kids.set(id, []);
    for (const id of vis) {
      for (const parent of parentOf(id)) kids.get(parent).push(id);
    }
    const roots = [...vis].filter((id) => parentOf(id).length === 0);
    const keep = new Set(roots);
    keep.add(focus);
    for (const root of roots) for (const child of kids.get(root)) keep.add(child);
    for (const parent of parentOf(focus)) keep.add(parent);

    const rest = [...vis].filter((id) => !keep.has(id));
    const restSet = new Set(rest);
    const memo = new Map();
    function nearest(id, stack) {
      if (memo.has(id)) return memo.get(id);
      if (stack.has(id)) return "";
      stack.add(id);
      const acc = [];
      for (const child of kids.get(id)) {
        if (keep.has(child)) acc.push(child);
        else {
          const nested = nearest(child, stack);
          if (nested) acc.push(nested);
        }
      }
      stack.delete(id);
      const sig = [...new Set(acc.flatMap((item) => String(item).split(",").filter(Boolean)))].sort((a, b) => a - b).join(",");
      memo.set(id, sig);
      return sig;
    }
    const sig = new Map(rest.map((id) => [id, nearest(id, new Set())]));
    const seen = new Set();
    const clusters = [];
    for (const start of rest) {
      if (seen.has(start)) continue;
      const members = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const node = stack.pop();
        members.push(node);
        const next = kids.get(node).concat(parentOf(node));
        for (const other of next) {
          if (restSet.has(other) && !seen.has(other) && sig.get(other) === sig.get(start)) {
            seen.add(other);
            stack.push(other);
          }
        }
      }
      if (members.length >= 2) clusters.push(members.sort((a, b) => a - b));
      else keep.add(members[0]);
    }
    return { keep, clusters, kids };
  }

  function buildView(graph, focus, state) {
    const { parents, children, gen, names } = graph;
    const anc = ancestorSet(parents, focus);
    const hidden = new Set();
    if (!state.showGen) {
      for (const id of anc) if (id !== focus && gen[id]) hidden.add(id);
    }
    const vis = new Set([...anc].filter((id) => !hidden.has(id)));
    const parentOf = (id) => upsOf(parents, anc, hidden, id).filter((p) => vis.has(p));
    let { keep, clusters } = clusterAncestors(focus, vis, parentOf);
    if (anc.size > 400 && !state.showGen) {
      /* already hiding generated; nothing further */
    }
    const clusteringOn = state.clustering !== false;
    const expanded = clusteringOn ? state.expanded : new Set();
    const inCollapsed = new Map();
    if (clusteringOn) {
      clusters.forEach((members, index) => {
        if (!expanded.has(index)) members.forEach((id) => inCollapsed.set(id, index));
      });
    }

    function rep(id) {
      if (inCollapsed.has(id)) return "c" + inCollapsed.get(id);
      return "n" + id;
    }

    const nodes = new Map();
    const expandedIndex = new Map();
    if (clusteringOn) {
      clusters.forEach((members, index) => {
        if (expanded.has(index)) members.forEach((id) => expandedIndex.set(id, index));
      });
    }
    function addConcept(id, role, cluster) {
      const key = "n" + id;
      const existing = nodes.get(key);
      if (existing) {
        if (cluster != null) existing.cluster = cluster;
        return;
      }
      nodes.set(key, { key, kind: "concept", concept: id, role, cluster });
    }
    for (const id of vis) {
      if (inCollapsed.has(id)) {
        const index = inCollapsed.get(id);
        const key = "c" + index;
        if (!nodes.has(key)) nodes.set(key, { key, kind: "cluster", index, members: clusters[index] });
      } else if (!clusteringOn || keep.has(id) || expandedIndex.has(id)) {
        addConcept(id, id === focus ? "focus" : "anc", expandedIndex.has(id) ? expandedIndex.get(id) : null);
      }
    }

    const showChildren = state.children !== false && !state.ancestorsOnly;
    const childCap = 16 + (state.childExtra || 0);
    let childIds = showChildren ? children[focus].filter((id) => state.showGen || !gen[id]) : [];
    const childHidden = showChildren ? children[focus].length - childIds.length : 0;
    const more = Math.max(0, childIds.length - childCap);
    childIds = childIds.slice(0, childCap);
    for (const id of childIds) addConcept(id, "child", null);
    if (more) nodes.set("more", { key: "more", kind: "more", count: more });

    const siblings = [];
    if (state.siblings && !state.ancestorsOnly) {
      const seen = new Set([focus, ...childIds]);
      for (const parent of parentOf(focus)) {
        for (const kid of children[parent]) {
          if (seen.has(kid) || (!state.showGen && gen[kid])) continue;
          seen.add(kid);
          siblings.push(kid);
          if (siblings.length >= 14) break;
        }
        if (siblings.length >= 14) break;
      }
      for (const id of siblings) addConcept(id, "sib", null);
    }

    const links = [];
    const seenLink = new Set();
    function link(from, to, kind) {
      if (!from || !to || from === to || !nodes.has(from) || !nodes.has(to)) return;
      const key = from + ">" + to;
      if (seenLink.has(key)) return;
      seenLink.add(key);
      links.push({ source: from, target: to, kind });
    }
    for (const node of nodes.values()) {
      if (node.kind !== "concept") continue;
      const id = node.concept;
      if (node.role === "child") {
        link("n" + focus, node.key, "child");
        continue;
      }
      if (node.role === "sib") {
        const parent = parentOf(focus).find((item) => children[item].includes(id));
        link(parent != null ? rep(parent) : "n" + focus, node.key, "sib");
        continue;
      }
      for (const parent of parentOf(id)) link(rep(parent), node.key, "anc");
    }
    for (const node of nodes.values()) {
      if (node.kind !== "cluster") continue;
      for (const id of node.members) {
        for (const parent of parentOf(id)) link(rep(parent), node.key, "anc");
        for (const child of (clusterKids(parentOf, vis, id))) {
          if (vis.has(child)) link(node.key, rep(child), "anc");
        }
      }
    }
    if (more) link("n" + focus, "more", "child");

    return {
      nodes: [...nodes.values()],
      links,
      clusters,
      childHidden,
      ancestorCount: anc.size,
      visibleCount: vis.size,
      names,
    };
  }

  function clusterKids(parentOf, vis, id) {
    const kids = [];
    for (const other of vis) {
      if (parentOf(other).includes(id)) kids.push(other);
    }
    return kids;
  }

  const measure = document.createElement("canvas").getContext("2d");
  function textWidth(text, px, weight) {
    measure.font = (weight || 500) + " " + px + "px 'Segoe UI', sans-serif";
    return measure.measureText(text || "").width;
  }
  function labelLines(name, max) {
    const text = OG.spaced(name);
    if (text.length <= max) return [text];
    const cut = text.lastIndexOf(" ", max);
    const at = cut > 8 ? cut : max;
    const second = text.slice(at).trim();
    return [text.slice(0, at).trim(), second.length > max ? second.slice(0, max - 1) + "…" : second];
  }

  function draw(graph, focus, state, stage) {
    const view = buildView(graph, focus, state);
    const svg = d3.select("#g");
    svg.selectAll("*").remove();
    svg.classed("hovering", false);
    const width = stage.clientWidth || 800;
    const height = stage.clientHeight || 640;
    svg.attr("width", width).attr("height", height).attr("viewBox", null);

    const pal = PAL();
    const prepared = view.nodes.map((node) => {
      if (node.kind === "cluster") {
        return { ...node, lines: ["+" + node.members.length], w: 36, h: 16 };
      }
      if (node.kind === "more") {
        return { ...node, lines: ["+" + node.count], w: 40, h: 16 };
      }
      const lines = state.labels || node.role === "focus" ? labelLines(graph.names[node.concept], node.role === "focus" ? 28 : 22) : [];
      const w = lines.length ? Math.max(18, d3.max(lines, (line) => textWidth(line, 11, node.role === "focus" ? 700 : 500)) + 8) : 16;
      return { ...node, lines, w, h: lines.length > 1 ? 28 : 16 };
    });
    const byKey = new Map(prepared.map((node) => [node.key, node]));
    const incoming = new Map(prepared.map((node) => [node.key, []]));
    for (const link of view.links) incoming.get(link.target).push(link.source);

    let dag;
    let size;
    const layoutOf = (decross) => d3.sugiyama()
      .layering(d3.layeringLongestPath().topDown(true))
      .decross(decross)
      .coord(d3.coordQuad())
      .nodeSize((node) => (node && node.data ? [node.data.w + GAP[0], node.data.h + GAP[1]] : GAP));
    // decrossOpt is exponential. GALEN neighbourhoods are dense multi-parent DAGs,
    // so the two-layer heuristic is the one that stays interactive.
    dag = d3.dagStratify().id((d) => d.key).parentIds((d) => incoming.get(d.key) || [])(prepared);
    size = layoutOf(d3.decrossTwoLayer())(dag);

    const pad = 36;
    const sc = Math.min(1.05, (width - 16) / (size.width + pad), (height - 16) / (size.height + pad));
    const tx = Math.max(12, (width - size.width * sc) / 2);
    const ty = 20;
    const g = svg.append("g").attr("class", "zoom-layer");
    const zoom = d3.zoom()
      .scaleExtent([0.2, 8])
      .filter((event) => {
        if (event.type === "wheel") return event.ctrlKey || event.metaKey;
        const target = event.target;
        if (typeof target.closest === "function" && target.closest(".node, .cluster-hull, .zoom-controls")) return false;
        return !event.button;
      })
      .on("zoom", (event) => {
        svg.select("g.zoom-layer").attr("transform", event.transform);
        if (event.sourceEvent) svg.node().dispatchEvent(new CustomEvent("og-view", { bubbles: true }));
      });
    svg.on(".zoom", null);
    svg.call(zoom);
    svg.on("wheel.pan", (event) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      svg.call(zoom.translateBy, -event.deltaX, -event.deltaY);
    });
    const fit = d3.zoomIdentity.translate(tx, ty).scale(sc);
    svg.call(zoom.transform, fit);
    svg.node().__ogZoom = zoom;
    svg.node().__ogFit = fit;

    const pos = new Map();
    for (const node of dag) pos.set(node.data.key, [node.x, node.y]);
    const linkGen = d3.line().curve(d3.curveBumpY);

    const hull = g.append("g").attr("class", "hulls");
    const linkG = g.append("g").attr("fill", "none").attr("pointer-events", "none");
    const nodeG = g.append("g");
    const clusterPts = new Map();

    const drawn = [];
    for (const link of dag.links()) {
      const pts = link.points.map((p) => (Array.isArray(p) ? p : [p.x, p.y]));
      const kind = view.links.find((item) => item.source === link.source.data.key && item.target === link.target.data.key);
      const color = kind && kind.kind === "child" ? "#c46b1a" : kind && kind.kind === "sib" ? "#8a8175" : "#0f6e6b";
      drawn.push({ pts, color, source: link.source.data, target: link.target.data });
      linkG.append("path")
        .attr("class", "lk dimmable")
        .attr("d", linkGen(pts))
        .attr("stroke", color)
        .attr("stroke-opacity", .55)
        .attr("stroke-width", 1.3)
        .attr("stroke-linecap", "round")
        .datum({ source: link.source.data, target: link.target.data });
    }

    for (const node of dag) {
      const data = node.data;
      const [x, y] = [node.x, node.y];
      const ng = nodeG.append("g")
        .attr("class", "node dimmable")
        .attr("transform", `translate(${x},${y})`)
        .datum(data);
      if (data.kind === "cluster" || data.kind === "more") {
        const col = data.kind === "more" ? "#c46b1a" : pal[data.index % pal.length];
        ng.append("rect")
          .attr("x", -data.w / 2).attr("y", -9).attr("width", data.w).attr("height", 18).attr("rx", 9)
          .attr("fill", "#fffdf8").attr("stroke", col).attr("stroke-width", 1.6).attr("stroke-dasharray", "3 2");
        ng.append("text").attr("text-anchor", "middle").attr("y", 4).attr("font-size", 11).attr("font-weight", 700).attr("fill", col).text(data.lines[0]);
        continue;
      }
      const id = data.concept;
      const generated = graph.gen[id];
      const color = data.role === "child" ? "#c46b1a" : data.role === "sib" ? "#8a8175" : "#0f6e6b";
      if (data.cluster != null) {
        const col = pal[data.cluster % pal.length];
        ng.append("circle").attr("r", 9).attr("fill", "none").attr("stroke", col).attr("stroke-width", 1.5).attr("stroke-dasharray", "2 2");
        (clusterPts.get(data.cluster) || clusterPts.set(data.cluster, []).get(data.cluster)).push([x, y]);
      }
      const radius = data.role === "focus" ? 7 : data.role === "anc" && parentOfCount(graph, id) === 0 ? 6.5 : generated ? 3.4 : 4.6;
      ng.append("circle")
        .attr("r", radius)
        .attr("fill", data.role === "focus" ? color : "#fffdf8")
        .attr("stroke", color)
        .attr("stroke-width", data.role === "focus" ? 2 : 1.5)
        .attr("stroke-dasharray", generated ? "2 2" : null);
      if (data.lines && data.lines.length) {
        const text = ng.append("text")
          .attr("text-anchor", "middle")
          .attr("font-size", 11)
          .attr("font-weight", data.role === "focus" ? 700 : 500)
          .attr("fill", "#1c2430")
          .attr("paint-order", "stroke")
          .attr("stroke", "#f3efe6")
          .attr("stroke-width", 3);
        data.lines.forEach((line, i) => {
          text.append("tspan").attr("x", 0).attr("y", 16 + i * 12).text(line);
        });
      }
    }
    for (const [index, pts] of clusterPts) {
      const col = pal[index % pal.length];
      const hullPts = pts.length >= 3 ? d3.polygonHull(pts) : null;
      const d = hullPts ? "M" + hullPts.join("L") + "Z" : pts.length === 2 ? `M${pts[0]} L${pts[1]}` : `M${pts[0]} l0.1,0`;
      hull.append("path")
        .attr("class", "cluster-hull")
        .datum(index)
        .attr("d", d)
        .attr("fill", hullPts ? col : "none")
        .attr("fill-opacity", .12)
        .attr("stroke", col)
        .attr("stroke-opacity", .2)
        .attr("stroke-width", pts.length >= 2 ? 28 : 0)
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round");
    }

    view.dagNodes = dag;
    view.byKey = byKey;
    return view;
  }

  function parentOfCount(graph, id) {
    return graph.parents[id].length;
  }

  function zoomGraph(mode) {
    const node = document.getElementById("g");
    const zoom = node && node.__ogZoom;
    if (!zoom) return;
    const svg = d3.select(node);
    const play = (duration, apply) => svg.transition().duration(duration).call(apply);
    if (mode === "in") {
      play(180, (selection) => selection.call(zoom.scaleBy, 1.35));
      return;
    }
    if (mode === "out") {
      play(180, (selection) => selection.call(zoom.scaleBy, 1 / 1.35));
      return;
    }
    if (mode === "one") {
      play(220, (selection) => selection.call(zoom.transform, d3.zoomIdentity));
      return;
    }
    const layer = svg.select("g.zoom-layer").node();
    if (!layer) return;
    const bounds = layer.getBBox();
    const width = node.clientWidth || 0;
    const height = node.clientHeight || 0;
    if (!bounds.width || !bounds.height || !width || !height) {
      if (node.__ogFit) play(280, (selection) => selection.call(zoom.transform, node.__ogFit));
      return;
    }
    const pad = 28;
    const k = Math.max(0.2, Math.min(8, Math.min((width - pad * 2) / bounds.width, (height - pad * 2) / bounds.height)));
    const tx = (width - bounds.width * k) / 2 - bounds.x * k;
    const ty = (height - bounds.height * k) / 2 - bounds.y * k;
    play(280, (selection) => selection.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k)));
  }

  OG.buildView = buildView;
  OG.draw = draw;
  OG.zoomGraph = zoomGraph;
})();
