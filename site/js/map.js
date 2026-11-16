/* Clinergy mapping drawer. Stays closed until About or a ?map= link opens it. MIT. */
(function () {
  const core = window.OG.mapCore;
  const mapper = document.getElementById("mapper");
  const body = document.getElementById("map-body");
  const about = document.getElementById("about");
  if (!core || !mapper || !body) return;

  const STORE = "og-map-decisions";
  const state = {
    model: null,
    items: [],
    kind: "all",
    query: "",
    selected: "",
    open: false,
    norm: null,
    props: null,
    drafts: loadDrafts(),
    status: "",
  };

  function loadDrafts() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch (err) {
      return {};
    }
  }
  function saveDrafts() {
    try { localStorage.setItem(STORE, JSON.stringify(state.drafts)); } catch (err) { /* private mode */ }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }
  function focusedName() {
    const match = /^#concept=(.*)$/.exec(location.hash);
    return match ? decodeURIComponent(match[1]) : "";
  }
  function focusConcept(name) {
    if (!name || !state.model || !state.model.graph.byName.has(name)) return false;
    const next = "#concept=" + encodeURIComponent(name);
    if (location.hash !== next) location.hash = next;
    return true;
  }
  function blankDraft() {
    return {
      mode: "target",
      opengalen: "",
      confidence: "medium",
      rationale: "",
      needsHumanReview: true,
      genus: "",
      criteria: [{ role: "hasLocation", filler: "" }],
    };
  }
  function draftFor(name) {
    if (!state.drafts[name]) state.drafts[name] = blankDraft();
    const draft = state.drafts[name];
    if (!Array.isArray(draft.criteria) || !draft.criteria.length) draft.criteria = [{ role: "", filler: "" }];
    return draft;
  }
  function recorded(name) {
    return Boolean(state.drafts[name] && state.drafts[name].saved);
  }

  function setOpen(open) {
    state.open = open;
    mapper.hidden = !open;
    document.body.classList.toggle("is-mapping", open);
    if (open) paint();
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }

  function mapParam() {
    return new URL(location.href).searchParams.get("map");
  }

  let lastSearch = location.search;
  function syncFromUrl() {
    const searchChanged = location.search !== lastSearch;
    lastSearch = location.search;
    const should = !!mapParam();
    if (!should) {
      if (state.open) setOpen(false);
      return;
    }
    if (!state.open) {
      setOpen(true);
      ensureItems();
      return;
    }
    if (!searchChanged) return;
    const parsed = core.parseMapParam(mapParam());
    if (parsed && parsed.name && state.items.some((item) => item.name === parsed.name)) state.selected = parsed.name;
    paint();
  }

  document.getElementById("map-open").addEventListener("click", () => {
    const url = new URL(location.href);
    if (!url.searchParams.get("map")) url.searchParams.set("map", "1");
    history.pushState(null, "", url.pathname + url.search + url.hash);
    if (about.open) about.close();
    setOpen(true);
    ensureItems();
  });
  document.getElementById("map-close").addEventListener("click", () => {
    const url = new URL(location.href);
    ["map", "display", "feature", "siblings", "forms"].forEach((key) => url.searchParams.delete(key));
    history.pushState(null, "", url.pathname + url.search + url.hash);
    setOpen(false);
  });
  window.addEventListener("popstate", syncFromUrl);

  document.addEventListener("og-ready", (event) => {
    state.model = event.detail;
    ensureProps();
    if (mapParam()) {
      setOpen(true);
      ensureItems();
    }
  });
  if (mapParam()) setOpen(true);

  let loading = null;
  function ensureItems() {
    if (state.items.length || loading) return loading;
    loading = fetch(new URL("data/worklist/thumb-pain.yaml", document.baseURI))
      .then((res) => {
        if (!res.ok) throw new Error("thumb-pain.yaml (" + res.status + ")");
        return res.text();
      })
      .then((text) => {
        state.items = applyDeepLink(core.parseWorklistText(text, "thumb-pain.yaml"));
        state.status = "";
        paint();
      })
      .catch((err) => {
        state.items = applyDeepLink([]);
        state.status = err.message || String(err);
        paint();
      });
    return loading;
  }

  function applyDeepLink(items) {
    const params = new URL(location.href).searchParams;
    const parsed = core.parseMapParam(params.get("map"));
    if (!parsed || !parsed.name) return items;
    if (items.some((item) => item.name === parsed.name)) {
      state.selected = parsed.name;
      return items;
    }
    const feature = params.get("feature") || "";
    const siblings = (params.get("siblings") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const forms = (params.get("forms") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const raw = {};
    raw[parsed.name] = {
      kinds: [parsed.kind || "concept"],
      display: params.get("display") || "",
      usedAsValueOf: feature ? [{ feature, siblings, forms: forms.length, example: forms[0] || "" }] : [],
      usedInForms: forms.length ? { count: forms.length, examples: forms } : null,
    };
    const extra = core.normalizeWorklist(raw, "");
    state.selected = parsed.name;
    return extra.concat(items);
  }

  function current() {
    return state.items.find((item) => item.name === state.selected) || null;
  }

  function visibleItems() {
    const q = state.query.trim().toLowerCase();
    return state.items.filter((item) => {
      if (state.kind !== "all" && item.kind !== state.kind) return false;
      if (!q) return true;
      return item.name.toLowerCase().includes(q) || (item.display || "").toLowerCase().includes(q);
    });
  }

  function selectItem(name, updateUrl) {
    state.selected = name;
    const item = current();
    if (item && updateUrl !== false) {
      const url = new URL(location.href);
      url.searchParams.set("map", item.kind + "/" + item.name);
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    paint();
    if (item && state.model) suggestFocus(item);
  }

  function indexApi() {
    const graph = state.model.graph;
    if (!state.norm) state.norm = core.buildNormIndex(graph.names);
    return {
      has: (name) => graph.byName.has(name),
      kind: (name) => {
        const id = graph.byName.get(name);
        return id == null ? "" : "Class";
      },
      label: (name) => {
        const id = graph.byName.get(name);
        return id == null ? "" : (state.model.labels[String(id)] || "");
      },
      byNorm: (key) => state.norm.get(key) || [],
      search: (text) => window.OG.searchConcepts(state.model, text, true, 24).map((id) => ({
        name: graph.names[id],
        label: state.model.labels[String(id)] || "",
      })),
    };
  }

  function suggestFocus(item) {
    const ranked = core.rankCandidates(item, indexApi(), 1);
    const top = ranked[0];
    if (top && (top.method === "exact" || top.method === "normalised")) focusConcept(top.name);
  }

  function contextLines(item) {
    const lines = [];
    if (item.display) lines.push(["Shown as", item.display]);
    if (item.category) lines.push(["Category", item.category]);
    if (item.location) lines.push(["Location", item.location]);
    if (item.supers.length) lines.push(["Supers", item.supers.join(", ")]);
    if (item.examGroup) lines.push(["Exam", item.examGroup]);
    if (item.usedInForms && item.usedInForms.examples) lines.push(["Forms", [].concat(item.usedInForms.examples).join(", ")]);
    if (item.valueSets.length) {
      lines.push(["Values", item.valueSets.map((row) => Array.isArray(row) ? row.join(", ") : String(row)).join(" · ")]);
    }
    for (const row of item.usedAsValueOf) {
      const siblings = Array.isArray(row.siblings) ? row.siblings.filter((s) => typeof s === "string").join(", ") : "";
      lines.push(["Value of", row.feature + (siblings ? " (alongside " + siblings + ")" : "")]);
    }
    if (item.sentenceWords) lines.push(["Sentence", JSON.stringify(item.sentenceWords)]);
    return lines;
  }

  function paint() {
    if (!state.open) return;
    const items = visibleItems();
    if (!state.selected && items.length) state.selected = items[0].name;
    const item = current();
    const counts = new Map();
    for (const row of state.items) counts.set(row.kind, (counts.get(row.kind) || 0) + 1);
    const kinds = ["all"].concat(core.KIND_ORDER.filter((kind) => counts.has(kind)));
    const recordedCount = state.items.filter((row) => recorded(row.name)).length;
    body.innerHTML = shell(items, item, kinds, counts, recordedCount);
    bind(item);
  }

  function shell(items, item, kinds, counts, recordedCount) {
    const chips = kinds.map((kind) => {
      const label = kind === "all" ? "All " + state.items.length : core.KIND_LABEL[kind] + " " + counts.get(kind);
      return '<button type="button" class="map-chip' + (state.kind === kind ? " is-on" : "") + '" data-kind="' + kind + '">' + esc(label) + "</button>";
    }).join("");
    const shown = items.slice(0, 200);
    const rows = shown.map((row) => {
      const on = row.name === state.selected ? " is-on" : "";
      const mark = recorded(row.name) ? " ✓" : "";
      const sub = row.display && row.display.toLowerCase() !== row.name.toLowerCase() ? "<small>" + esc(row.display) + "</small>" : "";
      return '<button type="button" class="map-row' + on + '" data-name="' + esc(row.name) + '"><span>' + esc(row.name) + mark + "</span>" + sub + "</button>";
    }).join("");
    return ''
      + '<div class="map-tools">'
      + '<p class="map-lead">Pick a Clinergy name, choose an OpenGALEN concept in the graph, then contribute a <code>reviewed.yaml</code> snippet.</p>'
      + '<div class="map-file">'
      + '<label class="map-file-btn">Load worklist<input id="map-file" type="file" accept=".yaml,.yml,.json,text/yaml,application/json" multiple></label>'
      + '<button type="button" id="map-demo">Thumb pain list</button>'
      + "</div>"
      + (state.status ? '<p class="map-error">' + esc(state.status) + "</p>" : "")
      + '<div class="map-chips" role="group" aria-label="Kind">' + chips + "</div>"
      + '<input id="map-find" type="search" placeholder="Find a Clinergy name" value="' + esc(state.query) + '" aria-label="Find a Clinergy name">'
      + '<p class="map-count">' + items.length + " shown · " + recordedCount + " recorded on this browser</p>"
      + "</div>"
      + '<div class="map-split">'
      + '<div class="map-list" role="listbox" aria-label="Worklist">' + (rows || '<p class="muted">No names in this list.</p>')
      + (items.length > shown.length ? '<p class="muted">Showing the first 200. Narrow the list to see the rest.</p>' : "")
      + "</div>"
      + '<div class="map-detail">' + (item ? detail(item) : '<p class="muted">Choose a name, or load a worklist file.</p>') + "</div>"
      + "</div>";
  }

  function detail(item) {
    const draft = draftFor(item.name);
    const lines = contextLines(item).map((pair) => "<div><b>" + esc(pair[0]) + "</b> " + esc(pair[1]) + "</div>").join("");
    const ranked = state.model ? core.rankCandidates(item, indexApi(), 8) : [];
    const candidates = ranked.map((row) => (
      '<li><button type="button" class="map-cand" data-og="' + esc(row.name) + '">'
      + "<b>" + esc(row.name) + "</b> <em>" + esc(row.method) + "</em>"
      + "<small>" + esc(row.reason) + (row.label ? " · " + row.label : "") + "</small></button></li>"
    )).join("");
    const hints = (item.unverifiedHints || []).map((hint) => {
      const name = hint && hint.name ? hint.name : String(hint);
      return '<li><button type="button" class="map-hint" data-og="' + esc(name) + '">' + esc(name) + "</button></li>";
    }).join("");
    const modes = [
      ["target", "This concept"],
      ["none", "No equivalent"],
      ["composed", "Composed expression"],
      ["unsure", "Unsure"],
    ].map(([value, label]) => (
      '<label><input type="radio" name="map-mode" value="' + value + '"' + (draft.mode === value ? " checked" : "") + "> " + label + "</label>"
    )).join("");
    const criteria = draft.criteria.map((row, index) => (
      '<div class="map-crit">'
      + '<input data-crit="role" data-i="' + index + '" value="' + esc(row.role) + '" list="map-roles" aria-label="Role" placeholder="role">'
      + '<input data-crit="filler" data-i="' + index + '" value="' + esc(row.filler) + '" aria-label="Filler" placeholder="filler">'
      + '<button type="button" data-fill="' + index + '">Focused</button>'
      + '<button type="button" data-drop="' + index + '" aria-label="Remove criterion">×</button>'
      + "</div>"
    )).join("");
    const expression = core.compositionText(draft.genus, draft.criteria);
    const generated = core.generatedClassName(draft.genus, draft.criteria);
    const named = state.model && generated && state.model.graph.byName.has(generated) ? generated : "";
    return ''
      + '<p class="map-kicker">' + esc(core.KIND_LABEL[item.kind] || item.kind) + (recorded(item.name) ? " · recorded" : "") + "</p>"
      + "<h3>" + esc(item.name) + "</h3>"
      + '<div class="map-context">' + lines + "</div>"
      + "<h4>Candidates</h4>"
      + (candidates ? '<ul class="map-cands">' + candidates + "</ul>" : '<p class="muted">No exact, normalised, fuzzy or label hit yet. Search the hierarchy and use the focused concept.</p>')
      + (hints ? "<h4>Lexical hints</h4><ul class=\"map-cands\">" + hints + "</ul><p class=\"muted\">Hints are spelling look-alikes, not answers.</p>" : "")
      + '<fieldset class="map-modes"><legend>Decision</legend>' + modes + "</fieldset>"
      + '<div id="map-target-row"' + (draft.mode === "target" ? "" : " hidden") + ">"
      + '<label>OpenGALEN name <input id="map-target" value="' + esc(draft.opengalen) + '" spellcheck="false" autocomplete="off"></label>'
      + '<button type="button" id="map-use-focus">Use focused concept</button>'
      + '<p class="muted" id="map-focus">Focused: ' + esc(focusedName() || "none") + "</p>"
      + "</div>"
      + '<div id="map-compose"' + (draft.mode === "composed" ? "" : " hidden") + ">"
      + "<p>Recorded as <code>opengalen: null</code>. The expression goes in the rationale. A name is used only when this hierarchy already has it.</p>"
      + '<label>Genus <input id="map-genus" value="' + esc(draft.genus) + '" spellcheck="false"></label>'
      + '<button type="button" id="map-genus-focus">Use focused concept</button>'
      + criteria
      + '<button type="button" id="map-add-crit">Add criterion</button>'
      + '<p class="map-expr">' + esc(expression || "Expression") + "</p>"
      + (named ? '<p class="map-named">Named class in this hierarchy: <button type="button" id="map-use-named">' + esc(named) + "</button></p>" : '<p class="muted">No single generated class of this shape is in the hierarchy.</p>')
      + '<datalist id="map-roles"></datalist>'
      + "</div>"
      + '<label>Confidence <select id="map-conf">'
      + ["high", "medium", "low"].map((level) => '<option' + (draft.confidence === level ? " selected" : "") + ">" + level + "</option>").join("")
      + "</select></label>"
      + '<label class="map-rationale">Rationale<textarea id="map-why" rows="4">' + esc(draft.rationale) + "</textarea></label>"
      + '<label class="map-check"><input id="map-human" type="checkbox"' + (draft.needsHumanReview !== false ? " checked" : "") + "> Needs a human review</label>"
      + '<p class="map-error" id="map-msg"></p>'
      + '<div class="map-actions">'
      + '<button type="button" id="map-save">Record</button>'
      + '<button type="button" id="map-copy">Copy snippet</button>'
      + '<button type="button" id="map-issue">New issue</button>'
      + '<button type="button" id="map-issue-all">Issue for all recorded</button>'
      + '<button type="button" id="map-download">Download YAML</button>'
      + "</div>"
      + "<h4>Snippet</h4><pre id=\"map-snippet\"></pre>";
  }

  function bind(item) {
    body.querySelectorAll("[data-kind]").forEach((button) => {
      button.addEventListener("click", () => {
        state.kind = button.dataset.kind;
        paint();
      });
    });
    const find = document.getElementById("map-find");
    if (find) {
      find.addEventListener("input", () => {
        state.query = find.value;
        const start = find.selectionStart;
        paint();
        const again = document.getElementById("map-find");
        if (again) {
          again.focus();
          again.selectionStart = again.selectionEnd = start;
        }
      });
    }
    body.querySelectorAll("[data-name]").forEach((button) => {
      button.addEventListener("click", () => selectItem(button.dataset.name));
    });
    document.getElementById("map-file").addEventListener("change", (event) => {
      loadFiles(event.target.files);
    });
    document.getElementById("map-demo").addEventListener("click", () => {
      loading = null;
      state.items = [];
      state.selected = "";
      ensureItems();
    });
    if (!item) return;
    const draft = draftFor(item.name);
    body.querySelectorAll('input[name="map-mode"]').forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        draft.mode = input.value;
        document.getElementById("map-target-row").hidden = input.value !== "target";
        document.getElementById("map-compose").hidden = input.value !== "composed";
        refreshSnippet(item);
      });
    });
    const target = document.getElementById("map-target");
    target.addEventListener("input", () => { draft.opengalen = target.value.trim(); refreshSnippet(item); });
    document.getElementById("map-use-focus").addEventListener("click", () => {
      const name = focusedName();
      if (!focusConcept(name) && !(state.model && state.model.graph.byName.has(name))) {
        showMessage(name ? name + " is not in this hierarchy." : "Focus a concept in the graph first.");
        return;
      }
      draft.mode = "target";
      draft.opengalen = name;
      target.value = name;
      refreshSnippet(item);
    });
    body.querySelectorAll(".map-cand, .map-hint").forEach((button) => {
      button.addEventListener("click", () => {
        const name = button.dataset.og;
        draft.mode = "target";
        draft.opengalen = name;
        if (!focusConcept(name)) {
          showMessage(name + " is not in this hierarchy.");
          draft.opengalen = "";
          return;
        }
        const input = document.getElementById("map-target");
        const mode = document.querySelector('input[name="map-mode"][value="target"]');
        if (mode) mode.checked = true;
        const row = document.getElementById("map-target-row");
        const compose = document.getElementById("map-compose");
        if (row) row.hidden = false;
        if (compose) compose.hidden = true;
        if (input) input.value = name;
        const focus = document.getElementById("map-focus");
        if (focus) focus.textContent = "Focused: " + name;
        refreshSnippet(item);
      });
    });
    const genus = document.getElementById("map-genus");
    if (genus) {
      genus.addEventListener("input", () => { draft.genus = genus.value.trim(); refreshSnippet(item); });
      document.getElementById("map-genus-focus").addEventListener("click", () => {
        const name = focusedName();
        if (!state.model.graph.byName.has(name)) {
          showMessage("Focus a concept in the graph first.");
          return;
        }
        draft.genus = name;
        genus.value = name;
        refreshSnippet(item);
      });
    }
    body.querySelectorAll("[data-crit]").forEach((input) => {
      input.addEventListener("input", () => {
        draft.criteria[Number(input.dataset.i)][input.dataset.crit] = input.value.trim();
        refreshSnippet(item);
      });
    });
    body.querySelectorAll("[data-fill]").forEach((button) => {
      button.addEventListener("click", () => {
        const name = focusedName();
        if (!state.model || !state.model.graph.byName.has(name)) {
          showMessage("Focus a concept in the graph first.");
          return;
        }
        const index = Number(button.dataset.fill);
        draft.criteria[index].filler = name;
        body.querySelector('[data-crit="filler"][data-i="' + index + '"]').value = name;
        refreshSnippet(item);
      });
    });
    body.querySelectorAll("[data-drop]").forEach((button) => {
      button.addEventListener("click", () => {
        draft.criteria.splice(Number(button.dataset.drop), 1);
        if (!draft.criteria.length) draft.criteria.push({ role: "", filler: "" });
        paint();
      });
    });
    const add = document.getElementById("map-add-crit");
    if (add) add.addEventListener("click", () => { draft.criteria.push({ role: "", filler: "" }); paint(); });
    const named = document.getElementById("map-use-named");
    if (named) named.addEventListener("click", () => {
      draft.mode = "target";
      draft.opengalen = named.textContent;
      focusConcept(named.textContent);
      paint();
    });
    document.getElementById("map-conf").addEventListener("change", (event) => {
      draft.confidence = event.target.value;
      refreshSnippet(item);
    });
    document.getElementById("map-why").addEventListener("input", (event) => {
      draft.rationale = event.target.value;
      refreshSnippet(item);
    });
    document.getElementById("map-human").addEventListener("change", (event) => {
      draft.needsHumanReview = event.target.checked;
      refreshSnippet(item);
    });
    document.getElementById("map-save").addEventListener("click", () => record(item));
    document.getElementById("map-copy").addEventListener("click", () => copySnippet(item));
    document.getElementById("map-issue").addEventListener("click", () => contribute([item]));
    document.getElementById("map-issue-all").addEventListener("click", () => {
      const chosen = state.items.filter((row) => recorded(row.name));
      if (!chosen.length) showMessage("Record at least one decision first.");
      else contribute(chosen);
    });
    document.getElementById("map-download").addEventListener("click", () => {
      const chosen = exportable(state.items.filter((row) => recorded(row.name)));
      if (!chosen.length) {
        showMessage("Record at least one decision first.");
        return;
      }
      download(core.reviewedDocument(chosen), "reviewed.yaml");
    });
    fillRoles();
    refreshSnippet(item);
  }

  window.addEventListener("hashchange", () => {
    const node = document.getElementById("map-focus");
    if (node) node.textContent = "Focused: " + (focusedName() || "none");
  });

  async function ensureProps() {
    if (state.props || !state.model || !window.OG.loadProps) return;
    try {
      const doc = await window.OG.loadProps(state.model);
      state.props = new Set((doc.props || []).map((prop) => prop.n).filter(Boolean));
    } catch (err) {
      state.props = new Set();
    }
  }
  async function fillRoles() {
    const list = document.getElementById("map-roles");
    if (!list) return;
    await ensureProps();
    if (!state.props || !document.body.contains(list)) return;
    list.innerHTML = [...state.props].sort().map((name) => '<option value="' + esc(name) + '"></option>').join("");
  }

  function showMessage(text) {
    const node = document.getElementById("map-msg");
    if (node) node.textContent = text || "";
    else state.status = text || "";
  }

  function readRecord(item) {
    const draft = draftFor(item.name);
    const problem = validate(draft);
    if (problem) return { error: problem };
    const expression = core.compositionText(draft.genus, draft.criteria);
    return {
      record: core.decisionRecord(item, {
        mode: draft.mode,
        opengalen: draft.opengalen,
        confidence: draft.confidence,
        rationale: draft.rationale,
        needsHumanReview: draft.needsHumanReview,
        genus: draft.genus,
        criteria: draft.criteria,
        expression,
      }),
    };
  }

  function validate(draft) {
    if (!state.model) return "The hierarchy is still loading.";
    const known = (name) => state.model.graph.byName.has(name);
    if (draft.mode === "target") {
      if (!known(draft.opengalen)) return "Choose an OpenGALEN name that is in this hierarchy.";
      return "";
    }
    if (draft.mode === "composed") {
      if (!state.props) return "The property list is still loading.";
      if (!state.props.size) return "The property list did not load, so a role cannot be checked.";
      if (!known(draft.genus)) return "The genus must be a concept in this hierarchy.";
      const rows = draft.criteria.filter((row) => row.role || row.filler);
      if (!rows.length) return "Add a role and a filler from this hierarchy.";
      for (const row of rows) {
        if (!row.role || !row.filler) return "Each criterion needs a role and a filler.";
        if (state.props && state.props.size && !state.props.has(row.role)) return row.role + " is not a property in this extract.";
        if (!known(row.filler)) return row.filler + " is not in this hierarchy.";
      }
    }
    return "";
  }

  function refreshSnippet(item) {
    const pre = document.getElementById("map-snippet");
    const expr = document.querySelector(".map-expr");
    const draft = draftFor(item.name);
    if (expr) expr.textContent = core.compositionText(draft.genus, draft.criteria) || "Expression";
    const read = readRecord(item);
    if (!pre) return;
    pre.textContent = read.error ? read.error : core.reviewedDocument([{ name: item.name, record: read.record }]);
  }

  function record(item) {
    const read = readRecord(item);
    if (read.error) {
      showMessage(read.error);
      return null;
    }
    const draft = draftFor(item.name);
    draft.saved = true;
    saveDrafts();
    showMessage("Recorded " + item.name + ".");
    const count = document.querySelector(".map-count");
    if (count) {
      const n = state.items.filter((row) => recorded(row.name)).length;
      count.textContent = count.textContent.replace(/\d+ recorded/, n + " recorded");
    }
    const mark = body.querySelector('[data-name="' + CSS.escape(item.name) + '"] span');
    if (mark && !mark.textContent.endsWith(" ✓")) mark.textContent += " ✓";
    const kicker = body.querySelector(".map-kicker");
    if (kicker) kicker.textContent = (core.KIND_LABEL[item.kind] || item.kind) + " · recorded";
    refreshSnippet(item);
    return read.record;
  }

  function exportable(items) {
    const out = [];
    for (const item of items) {
      const read = readRecord(item);
      if (!read.error) out.push({ name: item.name, record: read.record });
    }
    return out;
  }

  function copySnippet(item) {
    const saved = record(item);
    if (!saved) return;
    const text = core.reviewedDocument([{ name: item.name, record: saved }]);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showMessage("Snippet copied."),
        () => showMessage("Could not copy. The snippet is in the box below."),
      );
    } else showMessage("Could not copy. The snippet is in the box below.");
  }

  function contribute(items) {
    const entries = [];
    for (const item of items) {
      if (!recorded(item.name)) {
        if (items.length !== 1) {
          showMessage("Record " + item.name + " before including it.");
          return;
        }
        const made = record(item);
        if (!made) return;
        entries.push({ name: item.name, record: made });
        continue;
      }
      const read = readRecord(item);
      if (read.error) {
        showMessage(item.name + ": " + read.error);
        return;
      }
      entries.push({ name: item.name, record: read.record });
    }
    if (!entries.length) return;
    const link = core.issueUrl(entries);
    if (link.tooLong) download(link.snippet, "reviewed.yaml");
    window.open(link.url, "_blank", "noopener");
    showMessage(link.tooLong ? "Snippet downloaded. Attach it to the issue that just opened." : "Opened a GitHub issue with this snippet.");
  }

  function download(text, filename) {
    const blob = new Blob([text], { type: "application/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function loadFiles(files) {
    const list = [...files || []];
    if (!list.length) return;
    Promise.all(list.map((file) => file.text().then((text) => core.parseWorklistText(text, file.name))))
      .then((lists) => {
        state.items = applyDeepLink(core.mergeItems(lists));
        state.selected = state.items[0] ? state.items[0].name : "";
        state.status = "Loaded " + state.items.length + " names from " + list.length + " file" + (list.length === 1 ? "" : "s") + ".";
        state.kind = "all";
        paint();
      })
      .catch((err) => {
        state.status = err.message || String(err);
        paint();
      });
  }
})();
