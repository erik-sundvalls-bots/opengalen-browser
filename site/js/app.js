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
  openAbout();

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
  const state = { showGen: false, siblings: false, children: true, ancestorsOnly: false, labels: true, clustering: true, expanded: new Set(), childExtra: 0, focus: 0 };
  let model = null;
  let activeSuggest = -1;
  let panelToken = 0;
  let lastView = null;
  let pointerKind = "mouse";
  let previewKey = null;
  let tipTimer = 0;
  const tipBody = document.getElementById("tip-body");

  function setStatus(text) { status.textContent = text || ""; }

  function hashName() {
    const match = /^#concept=(.*)$/.exec(location.hash);
    return match ? decodeURIComponent(match[1]) : "";
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
    state.focus = id;
    document.title = name + " · OpenGALEN 8";
    draw();
    fillPanel(id);
  }

  function draw() {
    try {
      lastView = OG.draw(model.graph, state.focus, state, stage);
      bindGraph(lastView);
      const g = model.graph;
      const hiddenKids = lastView.childHidden;
      setStatus(
        OG.spaced(g.names[state.focus])
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

  function showTip(event, d, view, up, down, touch) {
    clearTimeout(tipTimer);
    highlight(d3.select("#g"), d, view, up, down);
    tip.classList.toggle("is-touch", !!touch);
    tipBody.innerHTML = tipHtml(d);
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
  }

  function tipHtml(d) {
    if (d.kind === "cluster") {
      const names = d.members.slice(0, 6).map((id) => escapeHtml(OG.spaced(model.graph.names[id])));
      const more = d.members.length > 6 ? "…" : "";
      return "<b>+" + d.members.length + "</b> " + names.join(", ") + more;
    }
    if (d.kind === "more") return "+" + d.count + " children";
    return "<b>" + escapeHtml(OG.spaced(model.graph.names[d.concept])) + "</b>";
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

  function fillPanel(id) {
    const token = ++panelToken;
    const g = model.graph;
    const name = g.names[id];
    const moduleName = model.meta.modules[g.mod[id]] || "Unspecified";
    const label = model.labels[String(id)];
    panel.innerHTML = "";
    const kicker = document.createElement("p");
    kicker.className = "kicker";
    kicker.textContent = moduleName;
    const title = document.createElement("h2");
    title.textContent = label || OG.spaced(name);
    const official = document.createElement("p");
    official.className = "official";
    official.innerHTML = "<code>" + escapeHtml(name) + "</code>";
    panel.append(kicker, title, official);
    const defSlot = section("Definition");
    defSlot.body.textContent = "Loading the definition…";
    const qualSlot = section("Sanctions and qualifiers");
    const rubricSlot = section("Dissection rubric");
    const grailSlot = section("GRAIL source");
    qualSlot.el.hidden = rubricSlot.el.hidden = grailSlot.el.hidden = true;

    const parents = g.parents[id];
    const parentSlot = section("Parents");
    const shownParents = parents.filter((pid) => state.showGen || !g.gen[pid]);
    const hiddenParents = parents.length - shownParents.length;
    fillLinks(parentSlot.body, shownParents);
    if (hiddenParents) note(parentSlot.body, hiddenParents + " generated parents are hidden. Turn on “Show generated classes” to list them.");

    const kids = g.children[id].filter((cid) => state.showGen || !g.gen[cid]);
    const hiddenKids = g.children[id].length - kids.length;
    const childSlot = section("Children");
    const filter = document.createElement("input");
    filter.id = "child-filter";
    filter.placeholder = "Filter " + g.children[id].length + " children";
    filter.setAttribute("aria-label", "Filter children");
    const childList = document.createElement("ul");
    childList.className = "links";
    childSlot.body.append(filter, childList);
    const paintKids = () => {
      const needle = filter.value.trim().toLowerCase();
      const matched = kids.filter((cid) => !needle || g.names[cid].toLowerCase().includes(needle) || OG.spaced(g.names[cid]).toLowerCase().includes(needle)).slice(0, 80);
      fillLinks(childList, matched);
      if (kids.length > matched.length) note(childList, "Showing " + matched.length + " of " + kids.length + ".");
    };
    filter.addEventListener("input", paintKids);
    paintKids();
    if (hiddenKids) note(childSlot.body, hiddenKids + " generated children are hidden.");

    const eqSlot = section("Equivalents");
    if (g.equiv[id].length) fillLinks(eqSlot.body, g.equiv[id]);
    else eqSlot.el.hidden = true;

    OG.loadRecord(model, id).then((rec) => {
      if (token !== panelToken) return;
      if (rec && rec.s) kicker.textContent = moduleName + " · " + rec.s;
      if (!rec || !rec.d) {
        defSlot.body.textContent = "No equivalent-class expression is published for this concept. It is carried by its parents and by any sanctions below.";
        defSlot.body.className = "muted";
      } else {
        defSlot.body.textContent = rec.d;
        defSlot.body.className = "def";
      }
      if (rec && rec.q && rec.q.length) {
        qualSlot.el.hidden = false;
        const ul = document.createElement("ul");
        ul.className = "quals";
        for (const phrase of rec.q) {
          const li = document.createElement("li");
          const space = phrase.indexOf(" ");
          if (space > 0) {
            const em = document.createElement("em");
            em.textContent = phrase.slice(0, space);
            li.append(em, " " + phrase.slice(space + 1));
          } else li.textContent = phrase;
          ul.append(li);
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
        pre.className = "grail";
        pre.textContent = rec.g;
        grailSlot.body.append(pre);
      }
      if (rec && rec.l && rec.l !== title.textContent) {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = "Language note: " + rec.l;
        official.after(p);
      }
    }).catch(() => {
      if (token === panelToken) defSlot.body.textContent = "The definition shard could not be loaded.";
    });
  }

  function section(heading) {
    const el = document.createElement("section");
    const h = document.createElement("h3");
    h.textContent = heading;
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
      a.textContent = OG.spaced(model.graph.names[id]);
      a.title = model.graph.names[id];
      if (model.graph.gen[id]) a.className = "gen";
      li.append(a);
      list.append(li);
    }
  }

  function note(container, text) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = text;
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
    const sib = document.getElementById("tog-sib");
    if (sib) sib.setAttribute("aria-checked", siblingsShown() ? "true" : "false");
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
    } else if (act === "fit") {
      hideTip();
      OG.zoomGraph("fit");
      return;
    }
    syncActions();
    if (model) draw();
  }
  document.querySelectorAll("[data-act]").forEach((button) => {
    button.addEventListener("click", () => applyAction(button.dataset.act));
  });
  document.getElementById("tog-sib").addEventListener("click", () => applyAction("siblings"));
  document.getElementById("tip-x").addEventListener("click", (event) => {
    event.stopPropagation();
    hideTip();
  });
  document.addEventListener("pointerdown", (event) => {
    if ((event.pointerType || "mouse") === "mouse") return;
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
      if (key === "clustering") state.expanded = new Set();
      draw();
      fillPanel(state.focus);
    });
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
      const label = model.labels[String(id)];
      if (label) {
        const small = document.createElement("small");
        small.textContent = label;
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
    const named = hashName();
    const start = named && model.graph.byName.has(named) ? named : model.meta.defaultConcept;
    if (!named) history.replaceState(null, "", "#concept=" + encodeURIComponent(start));
    showFocus(start);
  }).catch((err) => {
    setStatus(err.message || String(err));
    panel.innerHTML = "<h2>The hierarchy did not load</h2><p class='muted'>" + escapeHtml(err.message || String(err)) + "</p>";
  });
})();
