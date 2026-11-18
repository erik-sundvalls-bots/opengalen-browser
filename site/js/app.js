(function () {
  const about = document.getElementById("about");
  const panelEl = document.getElementById("panel");
  const panelToggle = document.getElementById("panel-toggle");
  function openAbout() {
    if (typeof about.showModal === "function" && !about.open) about.showModal();
  }
  function closeAbout() {
    if (about.open) about.close();
    if (model) draw();
  }
  document.getElementById("about-btn").addEventListener("click", openAbout);
  about.addEventListener("close", () => { if (model) draw(); });
  // A permalink or query that already names a concept skips the automatic
  // About dialog. A plain visit still opens it. The About button always can.
  if (!requestedName()) openAbout();

  function setPanelOpen(open) {
    panelEl.classList.toggle("is-collapsed", !open);
    panelToggle.setAttribute("aria-expanded", open ? "true" : "false");
    panelToggle.setAttribute("aria-label", open ? "Hide concept details" : "Show concept details");
    panelToggle.title = open ? "Hide concept details" : "Show concept details";
    try { localStorage.setItem("og-panel", open ? "open" : "collapsed"); } catch (err) { /* private mode */ }
  }
  setPanelOpen(localStorage.getItem("og-panel") !== "collapsed");
  panelToggle.addEventListener("click", () => {
    setPanelOpen(panelEl.classList.contains("is-collapsed"));
    if (model) draw();
  });
  panelEl.addEventListener("transitionend", (event) => {
    if (event.propertyName === "width" && model) draw();
  });

  const status = document.getElementById("status");
  const stage = document.getElementById("stage");
  const q = document.getElementById("q");
  const suggest = document.getElementById("suggest");
  const panel = document.getElementById("panel-body");
  const tip = document.getElementById("tip");
  const state = { showGen: true, siblings: false, children: true, ancestorsOnly: false, labels: true, clustering: true, marking: true, expanded: new Set(), childExtra: 0, focus: 0, rels: new Set(), relEdges: [], relOn: false, relReady: false, quals: new Set(), qualEdges: [], qualOn: false, qualReady: false, incs: new Set(), incEdges: [], incReady: false };
  let model = null;
  let activeSuggest = -1;
  let panelToken = 0;
  let lastView = null;
  let pointerKind = "mouse";
  let previewKey = null;
  let tipTimer = 0;
  const tipBody = document.getElementById("tip-body");
  let focusRels = [];
  let focusQuals = [];
  let focusIncs = [];
  let relToken = 0;
  let incToken = 0;
  // Rows rendered in the incoming list at once. Some fillers are used by
  // thousands of definitions; the filter box narrows the list.
  const INC_LIST_MAX = 300;
  const TOLD_ISSUE = "https://github.com/erik-sundvalls-bots/opengalen-browser/issues/10";
  const toldBanner = document.getElementById("told-banner");

  function setStatus(text) { status.textContent = text || ""; }

  function hashName() {
    const match = /^#concept=(.*)$/.exec(location.hash);
    if (!match || !match[1]) return "";
    try { return decodeURIComponent(match[1]); } catch (err) { return match[1]; }
  }

  function queryName() {
    try {
      const value = new URLSearchParams(location.search).get("concept");
      return value ? String(value).trim() : "";
    } catch (err) {
      return "";
    }
  }

  /* Hash #concept=Name wins; otherwise ?concept=Name. Empty means a plain visit. */
  function requestedName() {
    return hashName() || queryName();
  }

  function go(name, push) {
    const next = "#concept=" + encodeURIComponent(name);
    if (location.hash === next) showFocus(name);
    else if (push === false) history.replaceState(null, "", next);
    else location.hash = next;
  }

  function showFocus(name) {
    const id = model.graph.byName.get(name);
    if (id == null) {
      panel.innerHTML = "<h2>Not in this hierarchy</h2><p class='muted'>No concept is named <code>" + escapeHtml(name) + "</code>.</p>";
      setStatus("Unknown concept");
      return;
    }
    if (state.focus !== id) {
      state.expanded = new Set();
      state.childExtra = 0;
      state.rels = new Set();
      state.quals = new Set();
      state.relOn = false;
      state.qualOn = false;
      state.relReady = false;
      state.qualReady = false;
      state.incs = new Set();
      state.incReady = false;
      focusRels = [];
      focusQuals = [];
      focusIncs = [];
    }
    hideTip();
    hideInfo();
    state.focus = id;
    state.relEdges = [];
    state.qualEdges = [];
    state.incEdges = [];
    if (!state.qualReady) focusQuals = [];
    document.title = OG.groupHeading(model.graph, id) + " · OpenGALEN 8";
    draw();
    fillPanel(id);
    loadFocusRels(id);
    loadFocusIncoming(id);
  }

  async function loadFocusIncoming(id) {
    const token = ++incToken;
    const g = model.graph;
    const members = OG.equivMembers(g, id);
    const group = new Set(members);
    const rows = [];
    const seen = new Set();
    for (const mid of members) {
      let part = [];
      try { part = await OG.loadIncoming(model, mid); } catch (err) { part = []; }
      for (const edge of part) {
        if (group.has(edge.source)) continue;
        const key = edge.prop + ":" + g.canon[edge.source];
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(edge);
      }
    }
    if (token !== incToken || state.focus !== id) return;
    const nameOf = (edge) => g.names[g.canon[edge.source]].toLowerCase();
    rows.sort((a, b) => (a.groupIndex - b.groupIndex) || (a.prop < b.prop ? -1 : a.prop > b.prop ? 1 : 0) || (nameOf(a) < nameOf(b) ? -1 : nameOf(a) > nameOf(b) ? 1 : 0));
    focusIncs = rows;
    if (!state.incReady) {
      // Incoming lists can be large, so nothing is ticked to start with.
      state.incs = new Set();
      state.incReady = true;
    }
    state.incEdges = focusIncs.filter((edge) => state.incs.has(OG.edgeKey(edge)));
    paintIncSection();
    if (state.incEdges.length) draw();
  }

  async function loadFocusRels(id) {
    const token = ++relToken;
    const members = OG.equivMembers(model.graph, id);
    const rows = [];
    const seen = new Set();
    for (const mid of members) {
      let part = [];
      try { part = await OG.loadRels(model, mid); } catch (err) { part = []; }
      for (const edge of part) {
        const key = edge.prop + ":" + model.graph.canon[edge.target];
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(edge);
      }
    }
    if (token !== relToken || state.focus !== id) return;
    focusRels = rows;
    if (!state.relReady) {
      state.rels = new Set(OG.defaultEdgeKeys(rows));
      state.relOn = false;
      state.relReady = true;
    }
    state.relEdges = state.relOn ? rows.filter((edge) => state.rels.has(OG.edgeKey(edge))) : [];
    draw();
    paintRelSection();
    recolorPanel();
  }

  function draw() {
    try {
      hideTip();
      lastView = OG.draw(model.graph, state.focus, state, stage);
      bindGraph(lastView);
      const g = model.graph;
      const hiddenKids = lastView.childHidden;
      setStatus(
        OG.spaced(OG.groupHeading(g, state.focus))
        + " · " + lastView.ancestorCount + " ancestors"
        + (state.ancestorsOnly ? " · ancestors only" : state.children === false ? " · children hidden" : hiddenKids ? " · " + hiddenKids + " generated children hidden" : "")
        + (state.relOn && state.relEdges.length ? " · " + state.relEdges.length + " relationship" + (state.relEdges.length === 1 ? "" : "s") : "")
        + (state.qualOn && state.qualEdges.length ? " · " + state.qualEdges.length + " sanction" + (state.qualEdges.length === 1 ? "" : "s") : "")
        + (state.incEdges.length ? " · " + state.incEdges.length + " incoming" : "")
        + (g.variant === "told" ? " · told hierarchy" : "")
      );
      syncToldBanner(lastView);
      syncVariantLegend(lastView);
    } catch (err) {
      setStatus("Could not lay out this neighbourhood. " + err.message);
    }
  }

  /* Warn when the open concept, or the drawn graph, has a told OWL parent
     link that the classified dump omitted. Those links are drawn in red. */
  function syncToldBanner(view) {
    if (!toldBanner || !model) return;
    const rows = OG.toldRowsFor ? OG.toldRowsFor(model.graph, state.focus) : [];
    const drawn = view && view.toldLinks ? view.toldLinks : 0;
    if (!rows.length && !drawn) {
      toldBanner.hidden = true;
      return;
    }
    toldBanner.hidden = false;
    toldBanner.replaceChildren();
    const icon = document.createElement("b");
    icon.textContent = "⚠ ";
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    if (model.graph.variant === "told") {
      text.append("Red links are told parents that the classified dump does not have above the concept at all; see ");
    } else {
      text.append("Some links here come from the original OWL told axioms, not from the classified dump (shown in red). The published classification omitted them; see ");
    }
    const a = document.createElement("a");
    a.href = TOLD_ISSUE;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "issue #10";
    text.append(a, ".");
    toldBanner.append(icon, text);
  }

  /* Hierarchy variant: the classified dump (default) or the told OWL
     axioms. The told data is fetched on the first click only. */
  const hierButtons = {
    inferred: document.getElementById("hier-inferred"),
    told: document.getElementById("hier-told"),
  };
  const variantLegend = document.getElementById("variant-legend");

  function legendLine(color, dash, width, text) {
    const row = document.createElement("span");
    row.className = "lg";
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "34");
    svg.setAttribute("height", "10");
    svg.setAttribute("aria-hidden", "true");
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", "2");
    line.setAttribute("x2", "32");
    line.setAttribute("y1", "5");
    line.setAttribute("y2", "5");
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", String(width));
    line.setAttribute("stroke-linecap", "round");
    if (dash) line.setAttribute("stroke-dasharray", dash);
    svg.append(line);
    row.append(svg, document.createTextNode(text));
    return row;
  }

  function syncVariantLegend(view) {
    if (!variantLegend || !model) return;
    const told = model.graph.variant === "told";
    variantLegend.hidden = !told;
    if (!told) return;
    variantLegend.replaceChildren();
    const head = document.createElement("b");
    head.textContent = "Told hierarchy (before classification)";
    variantLegend.append(
      head,
      legendLine("#0f6e6b", null, 1.6, "told, also a direct classified link"),
      legendLine(OG.REFINED_COLOR || "#3a5fb0", "10 3 2 3", 1.8, "told, classifier moved it up" + (view && view.refinedLinks ? " (" + view.refinedLinks + " here)" : "")),
      legendLine(OG.TOLD_COLOR || "#d0262d", null, 2.4, "told, not in the classified dump" + (view && view.toldLinks ? " (" + view.toldLinks + " here)" : "")),
    );
  }

  function syncHierButtons(busy) {
    const told = !!(model && model.graph.variant === "told");
    hierButtons.inferred.setAttribute("aria-pressed", told ? "false" : "true");
    hierButtons.told.setAttribute("aria-pressed", told ? "true" : "false");
    if (busy) hierButtons.told.setAttribute("aria-busy", "true");
    else hierButtons.told.removeAttribute("aria-busy");
    document.body.classList.toggle("told-mode", told);
  }

  async function setHierarchy(which) {
    if (!model) return;
    const current = model.graph.variant === "told" ? "told" : "inferred";
    if (which === current) return;
    if (which === "inferred") {
      model.graph = model.inferredGraph || model.graph;
    } else {
      syncHierButtons(true);
      setStatus("Loading the told hierarchy…");
      try {
        const told = await OG.loadToldVariant(model);
        model.inferredGraph = model.inferredGraph || model.graph;
        model.toldMeta = told.meta;
        model.graph = told.graph;
      } catch (err) {
        syncHierButtons(false);
        setStatus("Could not load the told hierarchy. " + (err.message || String(err)));
        return;
      }
    }
    state.expanded = new Set();
    state.childExtra = 0;
    syncHierButtons(false);
    draw();
    fillPanel(state.focus);
  }

  hierButtons.inferred.addEventListener("click", () => setHierarchy("inferred"));
  hierButtons.told.addEventListener("click", () => setHierarchy("told"));

  function bindGraph(view) {
    const svg = d3.select("#g");
    const up = new Map();
    const down = new Map();
    for (const link of view.links) {
      if (!up.has(link.target)) up.set(link.target, []);
      if (!down.has(link.source)) down.set(link.source, []);
      up.get(link.target).push(link.source);
      down.get(link.source).push(link.target);
    }
    svg.on("pointerdown.kind", (event) => {
      pointerKind = event.pointerType || "mouse";
      if (pointerKind !== "mouse" && !(event.target.closest && event.target.closest(".node"))) hideTip();
    });
    svg.selectAll(".cluster-hull").on("click", (event, index) => {
      event.stopPropagation();
      hideTip();
      state.expanded.delete(index);
      draw();
    });
    svg.selectAll(".node")
      .on("click", (event, d) => {
        event.stopPropagation();
        if (event.defaultPrevented) return;
        if (pointerKind !== "mouse") {
          if (previewKey === d.key) {
            hideTip();
            activate(d);
          } else {
            previewKey = d.key;
            showTip(event, d, view, up, down, true);
          }
          return;
        }
        activate(d);
      })
      .on("pointerenter", (event, d) => {
        if (event.pointerType && event.pointerType !== "mouse") return;
        showTip(event, d, view, up, down, false);
      })
      .on("pointermove", (event) => {
        if (!event.pointerType || event.pointerType === "mouse") moveTip(event);
      })
      .on("pointerleave", (event) => {
        if (event.pointerType && event.pointerType !== "mouse") return;
        hideTip();
      });
    svg.selectAll(".rel-edge")
      .on("pointerenter", (event, rel) => {
        if (event.pointerType && event.pointerType !== "mouse") return;
        tip.classList.remove("is-touch");
        const target = model.graph.names[rel.targetId];
        tipBody.innerHTML = rel.kind === "inc"
          ? escapeHtml(OG.spaced(model.graph.names[rel.sourceId])) + " <b>" + escapeHtml(edgeLabel(rel)) + "</b> → " + escapeHtml(OG.spaced(target))
          : "<b>" + escapeHtml(edgeLabel(rel)) + "</b> → " + escapeHtml(OG.spaced(target));
        tip.hidden = false;
        moveTip(event);
      })
      .on("pointermove", (event) => { if (!event.pointerType || event.pointerType === "mouse") moveTip(event); })
      .on("pointerleave", (event) => { if (!event.pointerType || event.pointerType === "mouse") hideTip(); })
      .on("click", (event, rel) => {
        event.stopPropagation();
        if (pointerKind !== "mouse" && previewKey !== "rel:" + rel.prop + ":" + rel.targetId) {
          previewKey = "rel:" + rel.prop + ":" + rel.targetId;
          tip.classList.add("is-touch");
          tipBody.innerHTML = "<b>" + escapeHtml(edgeLabel(rel)) + "</b> → " + escapeHtml(OG.spaced(model.graph.names[rel.targetId]));
          tip.hidden = false;
          moveTip(event);
          clearTimeout(tipTimer);
          tipTimer = setTimeout(hideTip, 6000);
          return;
        }
        hideTip();
        go(model.graph.names[rel.kind === "inc" ? rel.sourceId : rel.targetId]);
      });
  }

  function activate(d) {
    if (d.kind === "cluster") {
      state.expanded.add(d.index);
      draw();
      fillPanel(state.focus);
    } else if (d.kind === "more") {
      state.childExtra += 24;
      draw();
    } else {
      go(model.graph.names[d.concept]);
    }
  }

  function highlight(svg, d, view, up, down) {
    const keys = new Set([d.key]);
    const walk = (start, map) => {
      const acc = new Set([start]);
      const stack = [start];
      while (stack.length) {
        const node = stack.pop();
        for (const next of map.get(node) || []) if (!acc.has(next)) { acc.add(next); stack.push(next); }
      }
      return acc;
    };
    for (const key of walk(d.key, up)) keys.add(key);
    for (const key of walk(d.key, down)) keys.add(key);
    svg.classed("hovering", true);
    svg.selectAll(".node").classed("hi", (node) => keys.has(node.key));
    svg.selectAll("path.lk").classed("hi", (link) => keys.has(link.source.key) && keys.has(link.target.key));
  }

  function drawnName(view, key) {
    const node = view.byKey && view.byKey.get(key);
    if (!node) return "";
    if (node.kind === "cluster") return "+" + node.members.length;
    if (node.kind === "more") return "+" + node.count + " more";
    if (node.kind !== "concept") return "";
    return OG.spaced(OG.nodeLabel(model.graph, node.concept, state.focus));
  }

  function neighbourhood(d, view, up, down) {
    const parents = [];
    const children = [];
    const rels = [];
    const labelKeys = new Set();
    if (!d || d.kind !== "concept") return { parents, children, rels, labelKeys };
    labelKeys.add(d.key);
    for (const key of up.get(d.key) || []) {
      const name = drawnName(view, key);
      if (!name) continue;
      parents.push(name);
      labelKeys.add(key);
    }
    for (const key of down.get(d.key) || []) {
      const name = drawnName(view, key);
      if (!name) continue;
      children.push(name);
      labelKeys.add(key);
    }
    for (const rel of [...(view.relLinks || []), ...(view.qualLinks || []), ...(view.incLinks || [])]) {
      if (rel.source !== d.key) continue;
      const name = drawnName(view, rel.target);
      if (!name) continue;
      rels.push((rel.kind === "qual" ? "sanction " : "") + rel.prop + " → " + name);
      labelKeys.add(rel.target);
    }
    return { parents, children, rels, labelKeys };
  }

  function peekLabels(d, view, up, down) {
    d3.select("#g").selectAll(".peek-label").remove();
    if (state.labels || !d || d.kind !== "concept") return;
    const near = neighbourhood(d, view, up, down);
    d3.select("#g").selectAll(".node").each(function (node) {
      if (!near.labelKeys.has(node.key) || node.kind !== "concept") return;
      if (node.lines && node.lines.length) return;
      const name = OG.spaced(OG.nodeLabel(model.graph, node.concept, state.focus));
      const cut = name.length > 22 ? name.lastIndexOf(" ", 22) : -1;
      const parts = cut > 8 ? [name.slice(0, cut).trim(), name.slice(cut + 1).trim()] : [name];
      const text = d3.select(this).append("text")
        .attr("class", "peek-label")
        .attr("text-anchor", "middle")
        .attr("font-size", 11)
        .attr("font-weight", 650)
        .attr("fill", "#1c2430")
        .attr("paint-order", "stroke")
        .attr("stroke", "#f3efe6")
        .attr("stroke-width", 3);
      parts.forEach((line, i) => {
        const shown = line.length > 28 ? line.slice(0, 27) + "…" : line;
        text.append("tspan").attr("x", 0).attr("y", 16 + i * 12).text(shown);
      });
    });
  }

  function showTip(event, d, view, up, down, touch) {
    clearTimeout(tipTimer);
    highlight(d3.select("#g"), d, view, up, down);
    peekLabels(d, view, up, down);
    tip.classList.toggle("is-touch", !!touch);
    tipBody.innerHTML = tipHtml(d, view, up, down);
    tip.hidden = false;
    moveTip(event);
    if (touch) tipTimer = setTimeout(hideTip, 6000);
  }

  function hideTip() {
    clearTimeout(tipTimer);
    previewKey = null;
    tip.hidden = true;
    tip.classList.remove("is-touch");
    const svg = d3.select("#g");
    svg.classed("hovering", false);
    svg.selectAll(".hi").classed("hi", false);
    svg.selectAll(".peek-label").remove();
  }

  function tipHtml(d, view, up, down) {
    if (d.kind === "cluster") {
      const names = d.members.slice(0, 6).map((id) => escapeHtml(OG.spaced(model.graph.names[id])));
      const more = d.members.length > 6 ? "…" : "";
      return "<b>+" + d.members.length + "</b> " + names.join(", ") + more;
    }
    if (d.kind === "more") return "+" + d.count + " children";
    const title = "<b>" + escapeHtml(OG.spaced(OG.nodeLabel(model.graph, d.concept, state.focus))) + "</b>";
    if (state.labels) return title;
    const near = neighbourhood(d, view, up, down);
    const rows = [title];
    if (near.parents.length) rows.push("<span class='tip-k'>Parents</span> " + near.parents.map(escapeHtml).join(", "));
    if (near.children.length) rows.push("<span class='tip-k'>Children</span> " + near.children.map(escapeHtml).join(", "));
    if (near.rels.length) rows.push("<span class='tip-k'>Relationships</span> " + near.rels.map(escapeHtml).join(", "));
    return rows.join("<br>");
  }

  function moveTip(event) {
    const touch = tip.classList.contains("is-touch");
    const left = Math.max(8, Math.min(innerWidth - 380, (event.clientX || 0) + (touch ? -20 : 14)));
    const top = touch
      ? Math.max(8, (event.clientY || 0) - 64)
      : Math.min(innerHeight - 80, (event.clientY || 0) + 14);
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }

  const infoPop = document.getElementById("info-pop");
  let infoAnchor = null;

  function hideInfo() {
    infoPop.hidden = true;
    infoAnchor = null;
  }

  function showInfo(anchor, text, toggle) {
    if (toggle && infoAnchor === anchor && !infoPop.hidden) {
      hideInfo();
      return;
    }
    infoPop.textContent = text;
    infoAnchor = anchor;
    infoPop.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const width = infoPop.offsetWidth;
    const height = infoPop.offsetHeight;
    let left = rect.left - width - 8;
    if (left < 8) left = Math.min(innerWidth - width - 8, rect.right + 8);
    let top = rect.top;
    if (top + height > innerHeight - 8) top = Math.max(8, innerHeight - height - 8);
    infoPop.style.left = Math.max(8, left) + "px";
    infoPop.style.top = top + "px";
  }

  function infoButton(text) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "info";
    button.setAttribute("aria-label", text);
    button.textContent = "i";
    button.addEventListener("pointerdown", (event) => { pointerKind = event.pointerType || "mouse"; });
    button.addEventListener("pointerenter", (event) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      showInfo(button, text, false);
    });
    button.addEventListener("pointerleave", (event) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      hideInfo();
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if ((event.pointerType || pointerKind) === "mouse") return;
      showInfo(button, text, true);
    });
    return button;
  }

  function relColorMap() {
    const map = new Map();
    for (const edge of focusRels) if (!map.has(edge.prop)) map.set(edge.prop, edge.color);
    return map;
  }

  function paintColored(el, text) {
    const map = relColorMap();
    const names = [...map.keys()].sort((a, b) => b.length - a.length);
    el.replaceChildren();
    if (!names.length) {
      el.textContent = text;
      return;
    }
    const re = new RegExp("(?<![A-Za-z0-9])(?:" + names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?![A-Za-z0-9])", "g");
    let last = 0;
    for (const match of text.matchAll(re)) {
      if (match.index > last) el.append(text.slice(last, match.index));
      const span = document.createElement("span");
      span.className = "rel-word";
      span.style.color = map.get(match[0]);
      span.style.fontWeight = "700";
      span.textContent = match[0];
      el.append(span);
      last = match.index + match[0].length;
    }
    if (last < text.length) el.append(text.slice(last));
  }

  function paintPhrase(li, phrase) {
    const space = phrase.indexOf(" ");
    li.replaceChildren();
    if (space < 0) {
      li.textContent = phrase;
      return;
    }
    const em = document.createElement("em");
    em.textContent = phrase.slice(0, space);
    li.append(em, " ");
    const rest = document.createElement("span");
    paintColored(rest, phrase.slice(space + 1));
    li.append(rest);
  }

  function recolorPanel() {
    const def = document.getElementById("def-text");
    if (def && def.dataset.raw) paintColored(def, def.dataset.raw);
    document.querySelectorAll(".qual-line").forEach((li) => paintPhrase(li, li.dataset.phrase || ""));
    const grail = document.getElementById("grail-text");
    if (grail && grail.dataset.raw) paintColored(grail, grail.dataset.raw);
  }

  function shownCountText(selected, total) {
    return "shown " + selected + " of " + total;
  }

  function pickEdges(kind) {
    return kind === "rel" ? focusRels : kind === "qual" ? focusQuals : focusIncs;
  }
  function pickSelected(kind) {
    return kind === "rel" ? state.rels : kind === "qual" ? state.quals : state.incs;
  }

  function updatePickCount(kind) {
    const edges = pickEdges(kind);
    const selected = pickSelected(kind);
    const el = document.getElementById(kind + "-count");
    if (el) el.textContent = shownCountText(selected.size, edges.length);
  }

  function syncPickChecks(kind) {
    const selected = pickSelected(kind);
    const list = document.getElementById(kind + "-list");
    if (!list) return;
    list.querySelectorAll("input[type=checkbox]").forEach((box) => {
      box.checked = selected.has(box.dataset.key);
    });
    updatePickCount(kind);
  }

  function selectedDrawnEdges(edges, selected, on) {
    if (!on) return [];
    return edges.filter((edge) => selected.has(OG.edgeKey(edge)));
  }

  function makeAllNone(kind) {
    const actions = document.createElement("div");
    actions.className = "rel-actions";
    const all = document.createElement("button");
    all.type = "button";
    all.textContent = "All";
    const none = document.createElement("button");
    none.type = "button";
    none.textContent = "None";
    const count = document.createElement("p");
    count.id = kind + "-count";
    count.className = "rel-count";
    all.addEventListener("click", () => {
      if (kind === "inc") {
        // All ticks the rows currently listed (filtered, at most INC_LIST_MAX).
        const list = document.getElementById("inc-list");
        const keys = new Set(state.incs);
        if (list) list.querySelectorAll("input[type=checkbox]").forEach((box) => keys.add(box.dataset.key));
        state.incs = keys;
        applyIncSelection();
        return;
      }
      const edges = pickEdges(kind);
      const keys = new Set(edges.map((edge) => OG.edgeKey(edge)));
      if (kind === "rel") { state.rels = keys; state.relOn = keys.size > 0; }
      else { state.quals = keys; state.qualOn = keys.size > 0; }
      if (kind === "rel") applyRelSelection();
      else applyQualSelection();
    });
    none.addEventListener("click", () => {
      if (kind === "inc") { state.incs = new Set(); applyIncSelection(); }
      else if (kind === "rel") { state.rels = new Set(); state.relOn = false; applyRelSelection(); }
      else { state.quals = new Set(); state.qualOn = false; applyQualSelection(); }
    });
    actions.append(all, none, count);
    return actions;
  }

  function makePickRow(kind, edge, g) {
    const key = OG.edgeKey(edge);
    const label = document.createElement("label");
    label.className = "edge-pick";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.key = key;
    box.checked = pickSelected(kind).has(key);
    const text = document.createElement("span");
    text.className = "edge-pick-text";
    if (kind === "inc") {
      const sourceName = g ? OG.neighbourLabel(g, edge.source) : "";
      text.append(OG.spaced(sourceName) + " ");
      const prop = document.createElement("span");
      prop.className = "rel-word";
      prop.style.color = edge.color || "";
      prop.style.fontWeight = "700";
      prop.textContent = edge.prop || "";
      text.append(prop, " this");
      text.title = (g ? g.names[edge.source] : "") + " " + (edge.prop || "") + " " + (g ? g.names[state.focus] : "");
    } else if (kind === "qual" && edge.phrase) {
      text.classList.add("qual-line");
      text.dataset.phrase = edge.phrase;
      paintPhrase(text, edge.phrase);
    } else {
      const prop = document.createElement("span");
      prop.className = "rel-word";
      prop.style.color = edge.color || (kind === "qual" ? (OG.QUAL_COLOR || "#9a3d6b") : "");
      prop.style.fontWeight = "700";
      prop.textContent = edge.prop || "";
      text.append(prop);
      const targetName = edge.targetName || (g && g.names[edge.target]) || "";
      if (targetName) text.append(" " + OG.spaced(targetName));
    }
    const id = kind + "-pick-" + key.replace(/[^A-Za-z0-9_-]+/g, "_");
    box.id = id;
    label.setAttribute("for", id);
    // Keep the input inside the label as well, and still set for/id so
    // the control is a real labelled checkbox for keyboard users.
    box.addEventListener("change", () => {
      const selected = pickSelected(kind);
      if (box.checked) {
        selected.add(key);
        if (kind === "rel") state.relOn = true;
        else if (kind === "qual") state.qualOn = true;
      } else {
        selected.delete(key);
      }
      if (kind === "rel") applyRelSelection();
      else if (kind === "qual") applyQualSelection();
      else applyIncSelection();
    });
    label.append(box, text);
    return label;
  }

  function paintRelSection() {
    const box = document.getElementById("rel-box");
    if (!box) return;
    box.replaceChildren();
    if (!focusRels.length) {
      box.textContent = "This concept’s definition has no role to draw.";
      box.className = "muted";
      return;
    }
    box.className = "";
    box.append(makeAllNone("rel"));
    const g = model.graph;
    const groups = new Map();
    const key = document.createElement("div");
    key.className = "rel-key";
    const seenProp = new Set();
    for (const edge of focusRels) {
      if (!groups.has(edge.group)) groups.set(edge.group, []);
      groups.get(edge.group).push(edge);
      if (seenProp.has(edge.prop)) continue;
      seenProp.add(edge.prop);
      const legend = document.createElement("span");
      legend.style.color = edge.color;
      const dash = document.createElement("i");
      dash.className = "rel-swatch";
      legend.append(dash, edge.prop);
      key.append(legend);
    }
    box.append(key);
    const list = document.createElement("div");
    list.id = "rel-list";
    list.className = "edge-list";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "Definition relationships to draw");
    for (const [group, edges] of groups) {
      const heading = document.createElement("div");
      heading.className = "rel-group";
      heading.textContent = group;
      list.append(heading);
      for (const edge of edges) list.append(makePickRow("rel", edge, g));
    }
    box.append(list);
    updatePickCount("rel");
    syncActions();
  }

  function applyRelSelection() {
    state.relEdges = selectedDrawnEdges(focusRels, state.rels, state.relOn);
    syncPickChecks("rel");
    syncActions();
    if (model) draw();
  }

  function applyIncSelection() {
    state.incEdges = focusIncs.filter((edge) => state.incs.has(OG.edgeKey(edge)));
    syncPickChecks("inc");
    if (model) draw();
  }

  function paintIncSection() {
    const box = document.getElementById("inc-box");
    if (!box) return;
    box.replaceChildren();
    if (!focusIncs.length) {
      box.textContent = "No definition uses this concept as a role filler.";
      box.className = "muted";
      return;
    }
    box.className = "";
    box.append(makeAllNone("inc"));
    const g = model.graph;
    const filter = document.createElement("input");
    filter.id = "inc-filter";
    filter.type = "search";
    filter.placeholder = "Filter " + focusIncs.length + " incoming";
    filter.setAttribute("aria-label", "Filter incoming relationships");
    const list = document.createElement("div");
    list.id = "inc-list";
    list.className = "edge-list";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "Incoming relationships to draw");
    const more = document.createElement("p");
    more.className = "muted note-line";
    const paint = () => {
      const needle = filter.value.trim().toLowerCase();
      list.replaceChildren();
      let shown = 0;
      let matched = 0;
      let lastGroup = null;
      for (const edge of focusIncs) {
        if (needle) {
          const hay = (edge.prop + " " + g.names[edge.source] + " " + OG.spaced(OG.neighbourLabel(g, edge.source))).toLowerCase();
          if (!hay.includes(needle)) continue;
        }
        matched++;
        if (shown >= INC_LIST_MAX) continue;
        if (edge.group !== lastGroup) {
          const heading = document.createElement("div");
          heading.className = "rel-group";
          heading.textContent = edge.group;
          list.append(heading);
          lastGroup = edge.group;
        }
        list.append(makePickRow("inc", edge, g));
        shown++;
      }
      more.textContent = matched > shown ? "Listing " + shown + " of " + matched + ". Type in the filter to narrow the list." : "";
      more.hidden = !more.textContent;
    };
    filter.addEventListener("input", paint);
    box.append(filter, list, more);
    paint();
    updatePickCount("inc");
  }

  function applyQualSelection() {
    state.qualEdges = selectedDrawnEdges(focusQuals, state.quals, state.qualOn);
    syncPickChecks("qual");
    syncActions();
    if (model) draw();
  }

  function paintQualSection(container, edges) {
    let box = document.getElementById("qual-box");
    if (box) box.remove();
    if (!edges || !edges.length) return;
    box = document.createElement("div");
    box.id = "qual-box";
    box.append(makeAllNone("qual"));
    const color = OG.QUAL_COLOR || "#9a3d6b";
    const key = document.createElement("div");
    key.className = "rel-key";
    const seenProp = new Set();
    const groups = new Map();
    for (const edge of edges) {
      if (!groups.has(edge.prop)) groups.set(edge.prop, []);
      groups.get(edge.prop).push(edge);
      if (seenProp.has(edge.prop)) continue;
      seenProp.add(edge.prop);
      const legend = document.createElement("span");
      legend.style.color = color;
      const dash = document.createElement("i");
      dash.className = "rel-swatch qual-swatch";
      legend.append(dash, edge.prop);
      key.append(legend);
    }
    box.append(key);
    const list = document.createElement("div");
    list.id = "qual-list";
    list.className = "edge-list";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "Sanctions and qualifiers to draw");
    const g = model.graph;
    for (const [prop, rows] of groups) {
      const heading = document.createElement("div");
      heading.className = "rel-group";
      heading.textContent = prop;
      list.append(heading);
      for (const edge of rows) list.append(makePickRow("qual", edge, g));
    }
    box.append(list);
    const leftover = container.querySelector("ul.quals");
    if (leftover) leftover.remove();
    container.prepend(box);
    updatePickCount("qual");
    syncActions();
  }

  function mergeRecords(members, recs, g) {
    const canon = g.canon[members[0]];
    const order = [canon, ...members.filter((m) => m !== canon)];
    const byId = new Map(members.map((m, i) => [m, recs[i]]));
    function pick(key, pred) {
      let fallback = null;
      for (const m of order) {
        const rec = byId.get(m);
        if (!rec || rec[key] == null || rec[key] === "") continue;
        if (!pred || pred(rec[key])) return rec[key];
        if (fallback == null) fallback = rec[key];
      }
      return fallback;
    }
    const q = [];
    const qSeen = new Set();
    for (const m of order) {
      const rec = byId.get(m);
      if (!rec || !rec.q) continue;
      for (const phrase of rec.q) {
        if (qSeen.has(phrase)) continue;
        qSeen.add(phrase);
        q.push(phrase);
      }
    }
    return {
      d: pick("d", (text) => !/^equivalent to /.test(text)),
      s: pick("s"),
      r: pick("r"),
      l: pick("l"),
      f: pick("f"),
      g: pick("g"),
      q: q.length ? q : null,
    };
  }

  function fillPanel(id) {
    const token = ++panelToken;
    const g = model.graph;
    const name = g.names[id];
    const members = OG.equivMembers(g, id);
    const hier = OG.collapsedHierarchy(g, id);
    const moduleName = model.meta.modules[g.mod[id]] || "Unspecified";
    const label = model.labels[String(id)];
    hideInfo();
    panel.innerHTML = "";
    const kicker = document.createElement("p");
    kicker.className = "kicker";
    kicker.textContent = moduleName;
    const title = document.createElement("h2");
    title.textContent = members.length > 1 ? OG.spaced(OG.groupHeading(g, id)) : (label || OG.spaced(name));
    const official = document.createElement("p");
    official.className = "official";
    official.innerHTML = members.map((mid) => "<code>" + escapeHtml(g.names[mid]) + "</code>").join(" = ");
    panel.append(kicker, title, official);
    if (members.length > 1 && label && label !== title.textContent) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Language note: " + label;
      official.after(p);
    }
    const relSlot = section("Relationships", "Dashed arrows are definition roles, pointing at the filler. Is-a links have no arrowheads. Tick the items you want on the graph. All and None change the whole list. The first 16 are checked to start with; you can check more, or fewer. The count is how many are checked. The Relationships button turns drawing on or off without forgetting the ticks. A new concept resets the list. Ticking a box while drawing is off turns it on.");
    relSlot.el.id = "rel-section";
    relSlot.body.id = "rel-box";
    relSlot.body.textContent = "Loading definition relationships…";
    const incSlot = section("Incoming relationships", "Concepts whose OWL definitions use this concept as a role filler, shown as the source concept and the role, for example Thumb hasOrdinalPosition first. Nothing is ticked to start with, because some concepts are used by thousands of definitions. Tick a row to add that concept and a dashed arrow pointing at this concept to the graph. The filter narrows the list; at most " + INC_LIST_MAX + " rows are listed at once, and All ticks the rows that are listed. The count is how many are ticked. A new concept resets the list.");
    incSlot.el.id = "inc-section";
    incSlot.body.id = "inc-box";
    incSlot.body.textContent = "Loading incoming relationships…";
    if (focusIncs.length && state.focus === id) paintIncSection();
    const defSlot = section("Definition");
    defSlot.body.id = "def-text";
    defSlot.body.textContent = "Loading the definition…";
    const qualSlot = section("Sanctions and qualifiers", "Dotted arrows are sanctions and qualifiers: a role that is allowed for this concept, not a definition link. They use one colour, distinct from is-a and from the dashed definition-role arrows. Tick the items you want on the graph, as with Relationships. The first 16 are checked to start with; you can check more, or fewer. The Sanctions and qualifiers button turns drawing on or off without forgetting the ticks. A new concept resets the list. Ticking a box while drawing is off turns it on.");
    qualSlot.el.id = "qual-section";
    const rubricSlot = section("Dissection rubric");
    const grailSlot = section("GRAIL source");
    qualSlot.el.hidden = rubricSlot.el.hidden = grailSlot.el.hidden = true;

    const parents = hier.parentsOf(id);
    const toldMode = g.variant === "told";
    const parentSlot = section(toldMode ? "Told parents" : "Parents", toldMode ? "Told parents come from the OWL translation of the GRAIL sources, before classification: SubClassOf(A B) and the named base B of a definition A = B which …. A blue “moved up” mark means the classifier kept B as an ancestor but put more specific parents in between; a red “not in dump” mark means the classified dump does not have B above this concept at all." : null);
    const shownParents = parents.filter((pid) => state.showGen || !g.gen[pid]);
    const hiddenParents = parents.length - shownParents.length;
    const markFor = (child, parent) => {
      if (!toldMode) return OG.isToldLink(g, child, parent);
      const v = OG.linkVariant(g, child, parent);
      return v === "missing" ? true : v === "refined" ? "refined" : false;
    };
    fillLinks(parentSlot.body, shownParents, (pid) => markFor(id, pid));
    if (hiddenParents) note(parentSlot.body, hiddenParents + (hiddenParents === 1 ? " generated parent hidden" : " generated parents hidden"), "Turn on “Show generated classes” to list them.");

    if (toldMode && g.base) {
      // Compare with the classifier's parents of the same group.
      const base = g.base;
      const baseParents = OG.collapsedHierarchy(base, id).parentsOf(id).filter((pid) => state.showGen || !base.gen[pid]);
      const toldSet = new Set(parents.map((pid) => base.canon[pid]));
      const clsSlot = section("Classifier parents", "The direct parents of this concept in the classified (inferred) hierarchy, for comparison with the told parents above. “not told” marks a parent the classifier found that no told axiom of this concept states.");
      fillLinks(clsSlot.body, baseParents, (pid) => (toldSet.has(base.canon[pid]) ? false : "inferred"));
      parentSlot.el.after(clsSlot.el);
    }

    const allKids = hier.childrenOf(id);
    const kids = allKids.filter((cid) => state.showGen || !g.gen[cid]);
    const hiddenKids = allKids.length - kids.length;
    const childSlot = section("Children");
    const filter = document.createElement("input");
    filter.id = "child-filter";
    filter.placeholder = "Filter " + allKids.length + " children";
    filter.setAttribute("aria-label", "Filter children");
    const childList = document.createElement("ul");
    childList.className = "links";
    childSlot.body.append(filter, childList);
    const paintKids = () => {
      const needle = filter.value.trim().toLowerCase();
      const matched = kids.filter((cid) => {
        if (!needle) return true;
        const hay = (OG.groupHeading(g, cid) + " " + OG.spaced(OG.groupHeading(g, cid))).toLowerCase();
        return hay.includes(needle);
      }).slice(0, 80);
      fillLinks(childList, matched, (cid) => markFor(cid, id));
      if (kids.length > matched.length) note(childList, "Showing " + matched.length + " of " + kids.length + ".");
    };
    filter.addEventListener("input", paintKids);
    paintKids();
    if (hiddenKids) note(childSlot.body, hiddenKids + (hiddenKids === 1 ? " generated child hidden" : " generated children hidden"), "Turn on “Show generated classes” to list them.");

    const rawNames = OG.rawEquivalents(g, id);
    if (OG.isBannedBag(g, id) && rawNames.length > 1) {
      const namesSlot = section("Ambiguous names", "The classified dump marks these names as equivalent under BannedKnowledgeNames because the GRAIL names are ambiguous (ZootleWordle is the placeholder). They are not one clinical concept, so the browser keeps them as separate nodes.");
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Banned or ambiguous knowledge name. The dump groups it with:";
      const list = document.createElement("ul");
      list.className = "links";
      for (const mid of rawNames) {
        if (mid === id) continue;
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = "#concept=" + encodeURIComponent(g.names[mid]);
        a.textContent = OG.spaced(g.names[mid]);
        a.title = g.names[mid];
        li.append(a);
        list.append(li);
      }
      namesSlot.body.append(p, list);
    } else if (members.length > 1) {
      const namesSlot = section("Names", "These names are one concept in the classified hierarchy. The canonical name prefers a short readable name over a long which-style class, then the member with the most is-a relations, then the shorter official name; ties are broken alphabetically. Opening any name shows this same group; the address keeps the name you opened.");
      const list = document.createElement("ul");
      list.className = "links";
      for (const mid of members) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = "#concept=" + encodeURIComponent(g.names[mid]);
        a.textContent = OG.spaced(g.names[mid]);
        a.title = g.names[mid];
        li.append(a);
        if (mid === g.canon[id]) {
          const mark = document.createElement("span");
          mark.className = "muted";
          mark.textContent = " (canonical)";
          li.append(mark);
        }
        list.append(li);
      }
      namesSlot.body.append(list);
    }

    Promise.all(members.map((mid) => OG.loadRecord(model, mid))).then((recs) => {
      if (token !== panelToken) return;
      const rec = mergeRecords(members, recs, g);
      if (rec && rec.s) kicker.textContent = moduleName + " · " + rec.s;
      if (!rec || !rec.d) {
        defSlot.body.textContent = "None published.";
        defSlot.body.className = "muted";
        defSlot.body.dataset.raw = "";
        const defHeading = defSlot.el.querySelector("h3");
        if (!defHeading.querySelector(".info")) defHeading.append(infoButton("No equivalent-class expression is published for this concept. It is carried by its parents and by any sanctions below."));
      } else {
        defSlot.body.className = "def";
        defSlot.body.dataset.raw = rec.d;
        paintColored(defSlot.body, rec.d);
      }
      if (rec && rec.q && rec.q.length) {
        qualSlot.el.hidden = false;
        const edges = [];
        const seen = new Set();
        for (const phrase of rec.q) {
          const edge = OG.parseQualPhrase(phrase, g.byName);
          if (edge) {
            const key = edge.prop + ":" + edge.target;
            if (!seen.has(key)) {
              seen.add(key);
              edges.push(edge);
            }
          }
        }
        focusQuals = edges;
        if (!state.qualReady) {
          state.quals = new Set(OG.defaultEdgeKeys(edges));
          state.qualOn = false;
          state.qualReady = true;
        }
        state.qualEdges = state.qualOn ? edges.filter((edge) => state.quals.has(OG.edgeKey(edge))) : [];
        paintQualSection(qualSlot.body, edges);
        if (state.qualOn) draw();
      } else {
        focusQuals = [];
        state.qualEdges = [];
      }
      if (rec && rec.r) {
        rubricSlot.el.hidden = false;
        const p = document.createElement("p");
        p.className = "rubric";
        p.textContent = rec.r;
        rubricSlot.body.append(p);
      }
      if (rec && rec.f) {
        const extra = section("Drug feature");
        extra.body.textContent = rec.f;
      }
      if (rec && rec.g) {
        grailSlot.el.hidden = false;
        const pre = document.createElement("pre");
        pre.id = "grail-text";
        pre.className = "grail";
        pre.dataset.raw = rec.g;
        paintColored(pre, rec.g);
        grailSlot.body.append(pre);
      }
      if (rec && rec.l && rec.l !== title.textContent && rec.l !== (model.labels[String(id)] || "")) {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = "Language note: " + rec.l;
        official.after(p);
      }
    }).catch(() => {
      if (token === panelToken) defSlot.body.textContent = "The definition shard could not be loaded.";
    });
  }

  function section(heading, info) {
    const el = document.createElement("section");
    const h = document.createElement("h3");
    h.append(document.createTextNode(heading));
    if (info) h.append(infoButton(info));
    const body = document.createElement("div");
    el.append(h, body);
    panel.append(el);
    return { el, body };
  }

  function fillLinks(container, ids, isTold) {
    container.innerHTML = "";
    if (!ids.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "None in this view.";
      container.append(p);
      return;
    }
    const list = container.tagName === "UL" ? container : document.createElement("ul");
    if (list !== container) {
      list.className = "links";
      container.append(list);
    }
    for (const id of ids) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = "#concept=" + encodeURIComponent(model.graph.names[id]);
      a.textContent = OG.spaced(OG.neighbourLabel(model.graph, id));
      a.title = OG.groupHeading(model.graph, id);
      if (model.graph.gen[id]) a.className = "gen";
      li.append(a);
      const told = isTold ? isTold(id) : false;
      if (told === "refined") {
        const mark = document.createElement("span");
        mark.className = "refined-mark";
        mark.textContent = "moved up";
        mark.title = "Told parent that the classifier kept as an ancestor, with more specific parents in between";
        li.append(" ", mark);
      } else if (told === "inferred") {
        const mark = document.createElement("span");
        mark.className = "refined-mark";
        mark.textContent = "not told";
        mark.title = "Found by the classifier; no told axiom of this concept states it";
        li.append(" ", mark);
      } else if (told) {
        const mark = document.createElement("span");
        mark.className = "told-mark";
        const toldMode = model.graph.variant === "told";
        mark.textContent = toldMode ? "not in dump" : "told";
        mark.title = toldMode ? "Told parent that the classified dump does not have above this concept" : "Told OWL SubClassOf link, not from the classified dump";
        li.append(" ", mark);
      }
      list.append(li);
    }
  }

  function note(container, text, info) {
    const p = document.createElement("p");
    p.className = "muted note-line";
    p.append(document.createTextNode(text));
    if (info) p.append(infoButton(info));
    container.append(p);
  }

  function edgeLabel(rel) {
    if (rel && rel.kind === "qual") {
      const kind = rel.group && rel.group !== "sanction" ? rel.group + " " : "";
      return kind + (rel.prop || "sanction");
    }
    return (rel && rel.prop) || "";
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function childrenShown() { return state.children !== false && !state.ancestorsOnly; }
  function siblingsShown() { return !!state.siblings && !state.ancestorsOnly; }
  function syncActions() {
    document.querySelectorAll("[data-act=children]").forEach((button) => button.setAttribute("aria-pressed", childrenShown() ? "true" : "false"));
    document.querySelectorAll("[data-act=siblings]").forEach((button) => button.setAttribute("aria-pressed", siblingsShown() ? "true" : "false"));
    document.querySelectorAll("[data-act=ancestors]").forEach((button) => button.setAttribute("aria-pressed", state.ancestorsOnly ? "true" : "false"));
    document.querySelectorAll("[data-act=rels]").forEach((button) => button.setAttribute("aria-pressed", state.relOn ? "true" : "false"));
    document.querySelectorAll("[data-act=quals]").forEach((button) => button.setAttribute("aria-pressed", state.qualOn ? "true" : "false"));
  }
  function applyAction(act) {
    if (act === "children") {
      if (childrenShown()) state.children = false;
      else { state.children = true; state.ancestorsOnly = false; }
    } else if (act === "siblings") {
      if (siblingsShown()) state.siblings = false;
      else { state.siblings = true; state.ancestorsOnly = false; }
    } else if (act === "ancestors") {
      state.ancestorsOnly = !state.ancestorsOnly;
    } else if (act === "rels") {
      if (state.relOn) {
        state.relOn = false;
      } else {
        state.relOn = true;
        if (!state.rels.size && focusRels.length) {
          state.rels = new Set(OG.defaultEdgeKeys(focusRels));
        }
      }
      if (panelEl.classList.contains("is-collapsed")) setPanelOpen(true);
      applyRelSelection();
      const section = document.getElementById("rel-section");
      if (section) section.scrollIntoView({ block: "nearest" });
      return;
    } else if (act === "quals") {
      if (state.qualOn) {
        state.qualOn = false;
      } else {
        state.qualOn = true;
        if (!state.quals.size && focusQuals.length) {
          state.quals = new Set(OG.defaultEdgeKeys(focusQuals));
        }
      }
      if (panelEl.classList.contains("is-collapsed")) setPanelOpen(true);
      applyQualSelection();
      const section = document.getElementById("qual-section");
      if (section) section.scrollIntoView({ block: "nearest" });
      return;
    }
    syncActions();
    if (model) draw();
  }
  document.querySelectorAll("[data-act]").forEach((button) => {
    button.addEventListener("click", () => applyAction(button.dataset.act));
  });
  document.getElementById("tip-x").addEventListener("click", (event) => {
    event.stopPropagation();
    hideTip();
  });
  document.addEventListener("pointerdown", (event) => {
    const touch = (event.pointerType || "mouse") !== "mouse";
    if (touch && !(event.target.closest && event.target.closest(".info, #info-pop"))) hideInfo();
    if (!touch) return;
    if (event.target.closest && event.target.closest(".node, #tip")) return;
    hideTip();
  });
  document.getElementById("stage").addEventListener("og-view", hideTip);
  syncActions();

  function wireSwitch(id, key) {
    const button = document.getElementById(id);
    const sync = () => button.setAttribute("aria-checked", state[key] ? "true" : "false");
    sync();
    button.addEventListener("click", () => {
      state[key] = !state[key];
      sync();
      if (key === "showGen") state.childExtra = 0;
      if (key === "clustering") {
        state.expanded = new Set();
        syncMarking();
      }
      draw();
      fillPanel(state.focus);
    });
  }

  function syncMarking() {
    const row = document.getElementById("mark-row");
    const button = document.getElementById("tog-mark");
    const on = state.clustering !== false;
    row.hidden = !on;
    button.disabled = !on;
    button.setAttribute("aria-checked", state.marking !== false ? "true" : "false");
  }

  function paintSuggest(ids) {
    suggest.innerHTML = "";
    activeSuggest = -1;
    if (!ids.length) {
      suggest.hidden = true;
      q.setAttribute("aria-expanded", "false");
      return;
    }
    suggest.hidden = false;
    q.setAttribute("aria-expanded", "true");
    ids.forEach((id, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      const strong = document.createElement("span");
      strong.textContent = OG.spaced(model.graph.names[id]);
      button.append(strong);
      const alias = OG.isBannedBag(model.graph, id) ? [] : model.graph.equiv[id];
      const label = model.labels[String(id)];
      const notes = [];
      if (alias && alias.length) notes.push("= " + alias.map((eid) => model.graph.names[eid]).join(" = "));
      if (label) notes.push(label);
      if (notes.length) {
        const small = document.createElement("small");
        small.textContent = notes.join(" · ");
        button.append(small);
      }
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        choose(id);
      });
      button.dataset.index = String(index);
      suggest.append(button);
    });
  }

  function choose(id) {
    suggest.hidden = true;
    q.value = OG.spaced(model.graph.names[id]);
    go(model.graph.names[id]);
  }

  q.addEventListener("input", () => {
    paintSuggest(OG.searchConcepts(model, q.value, state.showGen, 10));
  });
  q.addEventListener("keydown", (event) => {
    const buttons = [...suggest.querySelectorAll("button")];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!buttons.length) return;
      event.preventDefault();
      activeSuggest = event.key === "ArrowDown" ? Math.min(buttons.length - 1, activeSuggest + 1) : Math.max(0, activeSuggest - 1);
      buttons.forEach((button, i) => button.classList.toggle("active", i === activeSuggest));
      buttons[activeSuggest].scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const ids = OG.searchConcepts(model, q.value, state.showGen, 10);
      const pick = ids[activeSuggest >= 0 ? activeSuggest : 0];
      if (pick != null) choose(pick);
    } else if (event.key === "Escape") {
      suggest.hidden = true;
    }
  });

  document.querySelectorAll("[data-zoom]").forEach((button) => {
    button.addEventListener("click", () => OG.zoomGraph(button.dataset.zoom));
  });

  wireSwitch("tog-gen", "showGen");
  wireSwitch("tog-labels", "labels");
  wireSwitch("tog-cluster", "clustering");
  wireSwitch("tog-mark", "marking");
  syncMarking();

  let resizeTimer = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (model) draw(); }, 150);
  });
  addEventListener("hashchange", () => {
    const name = hashName();
    if (name) showFocus(name);
  });

  OG.loadAll(setStatus).then((loaded) => {
    model = loaded;
    const counts = model.meta.counts;
    const aboutCounts = document.getElementById("about-counts");
    if (aboutCounts) {
      aboutCounts.textContent = counts.concepts.toLocaleString() + " concepts and "
        + counts.uniqueParentLinks.toLocaleString() + " parent links, from the with-property-chains hierarchy.";
    }
    const named = requestedName();
    const start = named && model.graph.byName.has(named) ? named : model.meta.defaultConcept;
    if (!hashName() && start) {
      const url = new URL(location.href);
      url.searchParams.delete("concept");
      const search = url.searchParams.toString();
      history.replaceState(null, "", url.pathname + (search ? "?" + search : "") + "#concept=" + encodeURIComponent(start));
    }
    showFocus(start);
  }).catch((err) => {
    setStatus(err.message || String(err));
    panel.innerHTML = "<h2>The hierarchy did not load</h2><p class='muted'>" + escapeHtml(err.message || String(err)) + "</p>";
  });
})();
