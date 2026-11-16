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
  const state = { showGen: true, siblings: false, children: true, ancestorsOnly: false, labels: true, clustering: true, marking: true, expanded: new Set(), childExtra: 0, focus: 0, rels: new Set(), relEdges: [] };
  let model = null;
  let activeSuggest = -1;
  let panelToken = 0;
  let lastView = null;
  let pointerKind = "mouse";
  let previewKey = null;
  let tipTimer = 0;
  const tipBody = document.getElementById("tip-body");
  let focusRels = [];
  let relToken = 0;

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
    }
    hideTip();
    hideInfo();
    state.focus = id;
    state.relEdges = [];
    document.title = OG.groupHeading(model.graph, id) + " · OpenGALEN 8";
    draw();
    fillPanel(id);
    loadFocusRels(id);
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
    state.relEdges = rows.filter((edge) => state.rels.has(edge.prop));
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
      );
    } catch (err) {
      setStatus("Could not lay out this neighbourhood. " + err.message);
    }
  }

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
        tipBody.innerHTML = "<b>" + escapeHtml(rel.prop) + "</b> → " + escapeHtml(OG.spaced(target));
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
          tipBody.innerHTML = "<b>" + escapeHtml(rel.prop) + "</b> → " + escapeHtml(OG.spaced(model.graph.names[rel.targetId]));
          tip.hidden = false;
          moveTip(event);
          clearTimeout(tipTimer);
          tipTimer = setTimeout(hideTip, 6000);
          return;
        }
        hideTip();
        go(model.graph.names[rel.targetId]);
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
    for (const rel of view.relLinks || []) {
      if (rel.source !== d.key) continue;
      const name = drawnName(view, rel.target);
      if (!name) continue;
      rels.push(rel.prop + " → " + name);
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
    const actions = document.createElement("div");
    actions.className = "rel-actions";
    const all = document.createElement("button");
    all.type = "button";
    all.textContent = "All";
    const none = document.createElement("button");
    none.type = "button";
    none.textContent = "None";
    all.addEventListener("click", () => { state.rels = new Set(focusRels.map((edge) => edge.prop)); applyRelSelection(); });
    none.addEventListener("click", () => { state.rels = new Set(); applyRelSelection(); });
    actions.append(all, none);
    box.append(actions);
    const groups = new Map();
    for (const edge of focusRels) {
      if (!groups.has(edge.group)) groups.set(edge.group, new Map());
      const kinds = groups.get(edge.group);
      if (!kinds.has(edge.prop)) kinds.set(edge.prop, { color: edge.color, n: 0 });
      kinds.get(edge.prop).n += 1;
    }
    const key = document.createElement("div");
    key.className = "rel-key";
    for (const [group, kinds] of groups) {
      const heading = document.createElement("div");
      heading.className = "rel-group";
      heading.textContent = group;
      box.append(heading);
      for (const [prop, info] of kinds) {
        const row = document.createElement("div");
        row.className = "rel-kind";
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = prop + " (" + info.n + ")";
        button.setAttribute("aria-pressed", state.rels.has(prop) ? "true" : "false");
        button.style.background = state.rels.has(prop) ? info.color : "";
        button.addEventListener("click", () => {
          if (state.rels.has(prop)) state.rels.delete(prop);
          else state.rels.add(prop);
          applyRelSelection();
        });
        const sw = document.createElement("span");
        sw.className = "rel-swatch";
        sw.style.color = info.color;
        row.append(button, sw);
        box.append(row);
        const legend = document.createElement("span");
        legend.style.color = info.color;
        const dash = document.createElement("i");
        dash.className = "rel-swatch";
        legend.append(dash, prop);
        key.append(legend);
      }
    }
    box.append(key);
    syncActions();
  }

  function applyRelSelection() {
    state.relEdges = focusRels.filter((edge) => state.rels.has(edge.prop));
    syncActions();
    if (model) draw();
    paintRelSection();
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
    const relSlot = section("Relationships", "Dashed arrows are definition roles, pointing at the filler. Is-a links have no arrowheads. The same colour on a sanction, or in the GRAIL source, names that role but is not drawn: a sanction says what is allowed, and a definition link says what this concept has. Every selected target is climbed by is-a to the root, and clustering folds the shared ancestors. A nested filler is one edge to its genus; the nesting stays in the definition text.");
    relSlot.el.id = "rel-section";
    relSlot.body.id = "rel-box";
    relSlot.body.textContent = "Loading definition relationships…";
    const defSlot = section("Definition");
    defSlot.body.id = "def-text";
    defSlot.body.textContent = "Loading the definition…";
    const qualSlot = section("Sanctions and qualifiers");
    const rubricSlot = section("Dissection rubric");
    const grailSlot = section("GRAIL source");
    qualSlot.el.hidden = rubricSlot.el.hidden = grailSlot.el.hidden = true;

    const parents = hier.parentsOf(id);
    const parentSlot = section("Parents");
    const shownParents = parents.filter((pid) => state.showGen || !g.gen[pid]);
    const hiddenParents = parents.length - shownParents.length;
    fillLinks(parentSlot.body, shownParents);
    if (hiddenParents) note(parentSlot.body, hiddenParents + (hiddenParents === 1 ? " generated parent hidden" : " generated parents hidden"), "Turn on “Show generated classes” to list them.");

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
      fillLinks(childList, matched);
      if (kids.length > matched.length) note(childList, "Showing " + matched.length + " of " + kids.length + ".");
    };
    filter.addEventListener("input", paintKids);
    paintKids();
    if (hiddenKids) note(childSlot.body, hiddenKids + (hiddenKids === 1 ? " generated child hidden" : " generated children hidden"), "Turn on “Show generated classes” to list them.");

    if (members.length > 1) {
      const namesSlot = section("Names", "These names are one concept in the classified hierarchy. The canonical name is the member with the most is-a relations (parents plus children); ties are broken alphabetically. Opening any name shows this same group; the address keeps the name you opened.");
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
        const ul = document.createElement("ul");
        ul.className = "quals";
        for (const phrase of rec.q) {
          const li = document.createElement("li");
          li.className = "qual-line";
          li.dataset.phrase = phrase;
          ul.append(li);
          paintPhrase(li, phrase);
        }
        qualSlot.body.append(ul);
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

  function fillLinks(container, ids) {
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

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function childrenShown() { return state.children !== false && !state.ancestorsOnly; }
  function siblingsShown() { return !!state.siblings && !state.ancestorsOnly; }
  function syncActions() {
    document.querySelectorAll("[data-act=children]").forEach((button) => button.setAttribute("aria-pressed", childrenShown() ? "true" : "false"));
    document.querySelectorAll("[data-act=siblings]").forEach((button) => button.setAttribute("aria-pressed", siblingsShown() ? "true" : "false"));
    document.querySelectorAll("[data-act=ancestors]").forEach((button) => button.setAttribute("aria-pressed", state.ancestorsOnly ? "true" : "false"));
    document.querySelectorAll("[data-act=rels]").forEach((button) => button.setAttribute("aria-pressed", state.rels.size ? "true" : "false"));
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
      const kinds = [...new Set(focusRels.map((edge) => edge.prop))];
      const allOn = kinds.length > 0 && kinds.every((kind) => state.rels.has(kind));
      state.rels = allOn ? new Set() : new Set(kinds);
      if (panelEl.classList.contains("is-collapsed")) setPanelOpen(true);
      applyRelSelection();
      const section = document.getElementById("rel-section");
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
      const alias = model.graph.equiv[id];
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
