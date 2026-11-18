/* Orientation tour and lesson panel. Fetched on first use, not at startup. MIT.
   Progress is stored in localStorage under og-tutorial and is not sent anywhere. */
(function () {
  const OG = (window.OG = window.OG || {});
  const ASSET = "16";
  const STORE = "og-tutorial";
  const PDF = "https://pen-pad-revival.github.io/assets/PEN-PAD-GALEN-GRAIL.pdf";
  const ACK = "This product uses the OpenGALEN Clinical Terminology, Copyright the Universities of Manchester and Nijmegen, licensed through OpenGALEN (www.opengalen.org).";
  const EXPLAIN = {
    which: [
      "which joins the base of a definition to a role, as in A = B which ….",
      "It is wording in this browser, not a concept name."
    ],
    newSub: [
      "GRAIL writes the hierarchy backwards from OWL, A newSub B rather than B subClassOf A (draft p. 6, §7.5).",
      "The footnote says: newSub was convenient check on spelling errors."
    ],
    told: [
      "A red is-a link is a told OWL SubClassOf parent the classified dump omitted.",
      "Restored from the source. This page does not run a classifier. See issue #10."
    ]
  };

  const host = () => OG.tutorialHost;
  let indexDoc = null;
  let lessons = {};
  let appliedKey = "";
  let tocSticky = false;
  let syncToken = 0;
  let built = false;

  function loadProgress() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || "");
      if (!raw || typeof raw !== "object") return { v: 1, done: {} };
      if (!raw.done || typeof raw.done !== "object") raw.done = {};
      return raw;
    } catch (err) {
      return { v: 1, done: {} };
    }
  }
  function saveProgress(progress) {
    try { localStorage.setItem(STORE, JSON.stringify(progress)); }
    catch (err) { /* private mode */ }
  }
  function isDone(id, step) {
    const list = loadProgress().done[id];
    return Array.isArray(list) && list.indexOf(step) !== -1;
  }
  function markDone(id, step) {
    const progress = loadProgress();
    const list = Array.isArray(progress.done[id]) ? progress.done[id].slice() : [];
    if (list.indexOf(step) === -1) list.push(step);
    list.sort((a, b) => a - b);
    progress.done[id] = list;
    progress.v = 1;
    saveProgress(progress);
  }

  function els() {
    return {
      lesson: document.getElementById("lesson"),
      scroll: document.getElementById("lesson-scroll"),
      title: document.getElementById("lesson-title"),
      kicker: document.getElementById("lesson-kicker"),
      body: document.getElementById("lesson-body"),
      task: document.getElementById("lesson-task"),
      quotes: document.getElementById("lesson-quotes"),
      dump: document.getElementById("lesson-dump"),
      steps: document.getElementById("lesson-steps"),
      toc: document.getElementById("lesson-toc"),
      back: document.getElementById("lesson-back"),
      next: document.getElementById("lesson-next"),
      tour: document.getElementById("tour"),
      hole: document.getElementById("tour-hole"),
      card: document.getElementById("tour-card"),
      tourKicker: document.getElementById("tour-kicker"),
      tourTitle: document.getElementById("tour-title"),
      tourBody: document.getElementById("tour-body"),
      tourTask: document.getElementById("tour-task"),
      tourQuotes: document.getElementById("tour-quotes"),
      tourBack: document.getElementById("tour-back"),
      tourNext: document.getElementById("tour-next"),
      tourSkip: document.getElementById("tour-skip")
    };
  }

  function ensureDom() {
    if (built) return;
    built = true;
    const layout = document.querySelector(".layout");
    const lesson = document.createElement("aside");
    lesson.id = "lesson";
    lesson.hidden = true;
    lesson.setAttribute("aria-label", "Lesson");
    lesson.innerHTML = ""
      + "<div class='lesson-bar'>"
      + "<h2 id='lesson-title'>Lessons</h2>"
      + "<button type='button' id='lesson-min' class='lesson-icon' aria-expanded='true' aria-label='Collapse lessons' title='Collapse lessons'>⌃</button>"
      + "<button type='button' id='lesson-close' class='lesson-icon' aria-label='Close lessons' title='Close lessons'>×</button>"
      + "</div>"
      + "<div id='lesson-scroll'>"
      + "<p id='lesson-kicker' class='lesson-kicker'></p>"
      + "<div id='lesson-body'></div>"
      + "<p id='lesson-task' class='lesson-task' hidden></p>"
      + "<div id='lesson-quotes'></div>"
      + "<p id='lesson-dump' class='lesson-dump' hidden></p>"
      + "<ol id='lesson-steps' class='lesson-steps'></ol>"
      + "<div class='lesson-nav'><button type='button' id='lesson-back'>Back</button><button type='button' id='lesson-next'>Next</button></div>"
      + "<h3 class='lesson-h'>Chapters</h3>"
      + "<ol id='lesson-toc' class='lesson-toc'></ol>"
      + "<p class='lesson-save'>Progress is saved only in this browser. Nothing is sent.</p>"
      + "<p class='lesson-ack'></p>"
      + "</div>";
    layout.insertBefore(lesson, layout.firstChild);
    lesson.querySelector(".lesson-ack").textContent = ACK;
    lesson.querySelector("#lesson-close").addEventListener("click", closeLessons);
    lesson.querySelector("#lesson-min").addEventListener("click", () => {
      const min = lesson.classList.toggle("is-min");
      const button = lesson.querySelector("#lesson-min");
      button.setAttribute("aria-expanded", min ? "false" : "true");
      button.setAttribute("aria-label", min ? "Expand lessons" : "Collapse lessons");
      button.textContent = min ? "⌄" : "⌃";
    });
    lesson.querySelector("#lesson-back").addEventListener("click", () => shift(-1));
    lesson.querySelector("#lesson-next").addEventListener("click", () => shift(1));

    const tour = document.createElement("div");
    tour.id = "tour";
    tour.hidden = true;
    tour.innerHTML = ""
      + "<div id='tour-shade'></div>"
      + "<div id='tour-hole'></div>"
      + "<div id='tour-card' role='dialog' aria-modal='false' aria-labelledby='tour-title'>"
      + "<p id='tour-kicker' class='lesson-kicker'></p>"
      + "<h2 id='tour-title'></h2>"
      + "<div id='tour-body'></div>"
      + "<p id='tour-task' class='lesson-task' hidden></p>"
      + "<div id='tour-quotes'></div>"
      + "<div class='tour-nav'>"
      + "<button type='button' id='tour-back'>Back</button>"
      + "<button type='button' id='tour-next'>Next</button>"
      + "<button type='button' id='tour-skip'>Skip</button>"
      + "</div></div>";
    document.body.appendChild(tour);
    tour.querySelector("#tour-back").addEventListener("click", () => shift(-1));
    tour.querySelector("#tour-next").addEventListener("click", () => shift(1));
    tour.querySelector("#tour-skip").addEventListener("click", closeLessons);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || tour.hidden) return;
      event.preventDefault();
      closeLessons();
    });
    window.addEventListener("resize", () => { if (!tour.hidden) placeTour(); });
    document.addEventListener("og-draw", () => {
      if (!tour.hidden) placeTour();
      if (document.body.classList.contains("tutorial-on")) widenToldHits();
    });
    document.addEventListener("og-panel", () => {
      if (document.body.classList.contains("tutorial-on")) wrapExplain();
    });
    document.addEventListener("pointerover", onExplainOver);
    document.addEventListener("pointerout", onExplainOut);
    document.addEventListener("focusin", onExplainOver);
    document.addEventListener("focusout", onExplainOut);
    document.addEventListener("pointerdown", onExplainDown, true);
  }

  function chapterById(id) {
    const chapters = (indexDoc && indexDoc.chapters) || [];
    for (let i = 0; i < chapters.length; i++) if (chapters[i].id === id) return chapters[i];
    return null;
  }

  function fetchJson(path) {
    return fetch(path + "?v=" + ASSET).then((res) => {
      if (!res.ok) throw new Error(path + " (" + res.status + ")");
      return res.json();
    });
  }
  function loadIndex() {
    if (indexDoc) return Promise.resolve(indexDoc);
    return fetchJson("lessons/index.json").then((doc) => { indexDoc = doc; return doc; });
  }
  function loadLesson(id) {
    if (lessons[id]) return Promise.resolve(lessons[id]);
    const chapter = chapterById(id);
    if (!chapter) return Promise.reject(new Error("Unknown lesson."));
    return fetchJson("lessons/" + chapter.file).then((doc) => { lessons[id] = doc; return doc; });
  }

  function current() {
    const parsed = OG.parseHash(location.hash);
    const id = parsed.params.lesson || "";
    return { id: id, concept: parsed.concept || "", params: parsed.params };
  }

  function writeHash(concept, lesson, step, method) {
    const params = Object.assign({}, OG.parseHash(location.hash).params);
    if (lesson) {
      params.lesson = lesson;
      params.step = String(step);
    } else {
      delete params.lesson;
      delete params.step;
    }
    const name = concept || OG.parseHash(location.hash).concept || "";
    const next = OG.buildHash(name, params);
    if ((location.hash || "") === next) {
      syncFromHash();
      return;
    }
    if (method === "replace") {
      history.replaceState(null, "", next);
      syncFromHash();
    } else {
      location.hash = next;
    }
  }

  function applyStepConcept(lesson, step, parsed) {
    const spec = lesson.steps[step - 1] || {};
    const key = lesson.id + ":" + step;
    if (appliedKey === key) return false;
    appliedKey = key;
    if (spec.concept && spec.concept !== parsed.concept) {
      writeHash(spec.concept, lesson.id, step, "replace");
      return true;
    }
    return false;
  }

  function applyControls(spec) {
    const api = host();
    if (!api) return;
    const switches = spec.switches || {};
    Object.keys(switches).forEach((key) => api.setSwitch(key, !!switches[key]));
    const actions = spec.actions || {};
    Object.keys(actions).forEach((key) => api.ensureAction(key, !!actions[key]));
  }

  function clearHighlight() {
    document.querySelectorAll(".tutorial-hi").forEach((el) => el.classList.remove("tutorial-hi"));
  }
  function highlight(selector) {
    clearHighlight();
    if (!selector) return;
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.add("tutorial-hi");
    if (el.closest && el.closest("#panel") && host()) host().openPanel();
    try { el.scrollIntoView({ block: "nearest" }); } catch (err) { /* ignore */ }
  }

  function quotesOf(step) {
    if (Array.isArray(step.quotes)) return step.quotes;
    if (step.quote) return [step.quote];
    return [];
  }
  function fillQuotes(container, step, pdf) {
    container.replaceChildren();
    const href = pdf && pdf.indexOf("https://pen-pad-revival.github.io/") === 0 ? pdf : PDF;
    quotesOf(step).forEach((quote) => {
      if (!quote || !quote.text) return;
      const block = document.createElement("blockquote");
      const p = document.createElement("p");
      const text = String(quote.text);
      p.textContent = /^[“"]/.test(text) ? text : "“" + text + "”";
      const foot = document.createElement("footer");
      foot.textContent = "Rector, draft, " + (quote.cite || "") + ". ";
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "PDF";
      foot.append(a);
      block.append(p, foot);
      container.append(block);
    });
  }
  function fillProse(container, text) {
    container.replaceChildren();
    if (!text) return;
    const p = document.createElement("p");
    p.className = "lesson-prose";
    p.textContent = text;
    container.append(p);
  }

  function setPressed(on) {
    const button = document.getElementById("lessons-btn");
    if (button) button.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function showShell(which) {
    ensureDom();
    const ui = els();
    const lessonOn = which === "lesson" || which === "toc";
    const tourOn = which === "tour";
    ui.lesson.hidden = !lessonOn;
    ui.tour.hidden = !tourOn;
    document.body.classList.toggle("lesson-open", lessonOn);
    document.body.classList.toggle("tour-open", tourOn);
    document.body.classList.toggle("tutorial-on", lessonOn || tourOn);
    setPressed(lessonOn || tourOn);
    if (!tourOn) clearHighlight();
    if (lessonOn || tourOn) wrapExplain();
  }
  function hideAll() {
    if (!built) {
      document.body.classList.remove("lesson-open", "tour-open", "tutorial-on");
      setPressed(false);
      return;
    }
    els().lesson.hidden = true;
    els().tour.hidden = true;
    document.body.classList.remove("lesson-open", "tour-open", "tutorial-on");
    clearHighlight();
    unwrapExplain();
    setPressed(false);
    appliedKey = "";
  }

  function renderToc(activeId) {
    const list = els().toc;
    list.replaceChildren();
    const chapters = (indexDoc && indexDoc.chapters) || [];
    chapters.forEach((chapter) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      if (chapter.id === activeId) button.setAttribute("aria-current", "true");
      const title = document.createElement("span");
      title.textContent = (chapter.chapter === 0 ? "Tour" : "Chapter " + chapter.chapter) + ". " + chapter.title;
      button.append(title);
      if (chapter.status === "awaiting-author") {
        const mark = document.createElement("span");
        mark.className = "lesson-wait";
        mark.textContent = " · awaiting review";
        button.append(mark);
      }
      const done = (loadProgress().done[chapter.id] || []).length;
      if (done) {
        const lesson = lessons[chapter.id];
        const total = lesson && lesson.steps ? "/" + lesson.steps.length : "";
        const count = document.createElement("span");
        count.className = "lesson-tick";
        count.textContent = " · " + done + total;
        button.append(count);
      }
      button.addEventListener("click", () => open(chapter.id, 1));
      li.append(button);
      list.append(li);
    });
  }

  function renderSteps(lesson, step) {
    const list = els().steps;
    list.replaceChildren();
    lesson.steps.forEach((spec, index) => {
      const n = index + 1;
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      if (n === step) button.setAttribute("aria-current", "step");
      const tick = document.createElement("span");
      tick.className = "lesson-tick";
      tick.textContent = isDone(lesson.id, n) ? "✓ " : "";
      button.append(tick, document.createTextNode(n + ". " + spec.title));
      button.addEventListener("click", () => writeHash(spec.concept || current().concept, lesson.id, n, "push"));
      li.append(button);
      list.append(li);
    });
  }

  function placeTour() {
    const ui = els();
    if (!ui.tour || ui.tour.hidden) return;
    const parsed = current();
    const lesson = lessons[parsed.id];
    if (!lesson) return;
    const step = OG.stepNumber(parsed.params.step, lesson.steps.length);
    const spec = lesson.steps[step - 1] || {};
    let target = spec.target ? document.querySelector(spec.target) : null;
    if (target && target.hidden) target = null;
    if (!target) target = document.getElementById("stage");
    const rect = target.getBoundingClientRect();
    const pad = 6;
    const left = Math.max(0, rect.left - pad);
    const top = Math.max(0, rect.top - pad);
    const width = Math.max(24, rect.width + pad * 2);
    const height = Math.max(24, rect.height + pad * 2);
    ui.hole.style.left = left + "px";
    ui.hole.style.top = top + "px";
    ui.hole.style.width = width + "px";
    ui.hole.style.height = height + "px";
    const shade = document.getElementById("tour-shade");
    if (shade) {
      const right = left + width;
      const bottom = top + height;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      shade.style.clipPath = "polygon(evenodd, 0px 0px, " + vw + "px 0px, " + vw + "px " + vh
        + "px, 0px " + vh + "px, 0px 0px, " + left + "px " + top + "px, " + right + "px " + top
        + "px, " + right + "px " + bottom + "px, " + left + "px " + bottom + "px, " + left + "px " + top + "px)";
    }
    const card = ui.card;
    const cardWidth = Math.min(340, window.innerWidth - 16);
    card.style.width = cardWidth + "px";
    const cardHeight = card.offsetHeight || 200;
    let cardTop = rect.bottom + 12;
    let cardLeft = Math.max(8, rect.left);
    if (rect.height > window.innerHeight * 0.45) {
      cardTop = Math.max(8, rect.top + 16);
      cardLeft = Math.max(8, rect.left + 16);
    }
    if (cardTop + cardHeight > window.innerHeight - 8) cardTop = Math.max(8, rect.top - cardHeight - 12);
    if (cardLeft + cardWidth > window.innerWidth - 8) cardLeft = Math.max(8, window.innerWidth - cardWidth - 8);
    card.style.top = cardTop + "px";
    card.style.left = cardLeft + "px";
  }

  function renderTour(lesson, step) {
    showShell("tour");
    const spec = lesson.steps[step - 1];
    const ui = els();
    ui.tourKicker.textContent = "Tour · " + step + " of " + lesson.steps.length;
    ui.tourTitle.textContent = spec.title;
    fillProse(ui.tourBody, spec.body);
    if (spec.note) {
      const note = document.createElement("p");
      note.className = "lesson-note";
      note.textContent = spec.note;
      ui.tourBody.append(note);
    }
    ui.tourTask.hidden = !spec.task;
    ui.tourTask.textContent = spec.task ? "Do this. " + spec.task : "";
    fillQuotes(ui.tourQuotes, spec, lesson.pdf);
    ui.tourBack.disabled = step <= 1;
    ui.tourNext.disabled = false;
    ui.tourNext.textContent = step >= lesson.steps.length ? "Done" : "Next";
    highlight(spec.highlight || spec.target);
    placeTour();
    widenToldHits();
  }

  function renderLesson(lesson, step) {
    showShell("lesson");
    const spec = lesson.steps[step - 1];
    const ui = els();
    const waiting = lesson.status === "awaiting-author";
    ui.title.textContent = lesson.title;
    ui.kicker.textContent = "Chapter " + (lesson.chapter || "") + " · Step " + step + " of " + lesson.steps.length
      + (waiting ? " · awaiting author review" : "");
    fillProse(ui.body, spec.body);
    ui.task.hidden = !spec.task;
    ui.task.textContent = spec.task ? "Do this. " + spec.task : "";
    fillQuotes(ui.quotes, spec, lesson.pdf);
    ui.dump.hidden = !spec.dump;
    ui.dump.textContent = spec.dump || "";
    renderSteps(lesson, step);
    renderToc(lesson.id);
    ui.back.disabled = step <= 1;
    ui.next.disabled = false;
    ui.next.textContent = step >= lesson.steps.length ? "Done" : "Next";
    highlight(spec.highlight);
    widenToldHits();
  }

  function renderTocOnly() {
    showShell("toc");
    const ui = els();
    ui.title.textContent = "Lessons";
    ui.kicker.textContent = "Choose a chapter";
    fillProse(ui.body, "The tour is a short look at the browser. Three layers walks meaning, background knowledge, and why patient data is not in this graph. Sanctions and Composition are waiting on the author.");
    ui.task.hidden = true;
    ui.quotes.replaceChildren();
    ui.dump.hidden = true;
    ui.steps.replaceChildren();
    renderToc("");
    ui.back.disabled = true;
    ui.next.disabled = true;
    ui.next.textContent = "Next";
    clearHighlight();
  }

  function fail(message) {
    showShell("lesson");
    const ui = els();
    ui.title.textContent = "Lessons";
    ui.kicker.textContent = "";
    fillProse(ui.body, message);
    ui.task.hidden = true;
    ui.quotes.replaceChildren();
    ui.dump.hidden = true;
  }

  function syncFromHash() {
    ensureDom();
    const token = ++syncToken;
    const parsed = OG.parseHash(location.hash);
    const id = parsed.params.lesson || "";
    if (!id) {
      if (tocSticky) {
        loadIndex().then(() => { if (token === syncToken) renderTocOnly(); }).catch((err) => fail(err.message || String(err)));
        return;
      }
      hideAll();
      return;
    }
    tocSticky = false;
    loadIndex().then(() => loadLesson(id)).then((lesson) => {
      if (token !== syncToken) return;
      if (!lesson || !lesson.steps || !lesson.steps.length) {
        fail("This lesson has no steps.");
        return;
      }
      const step = OG.stepNumber(parsed.params.step, lesson.steps.length);
      if (String(parsed.params.step || "") !== String(step)) {
        writeHash(parsed.concept, id, step, "replace");
        return;
      }
      if (applyStepConcept(lesson, step, parsed)) return;
      const spec = lesson.steps[step - 1];
      applyControls(spec);
      if (lesson.kind === "tour") renderTour(lesson, step);
      else renderLesson(lesson, step);
      wrapExplain();
    }).catch((err) => { if (token === syncToken) fail(err.message || String(err)); });
  }

  function shift(delta) {
    const parsed = current();
    const lesson = lessons[parsed.id];
    if (!lesson) return;
    const step = OG.stepNumber(parsed.params.step, lesson.steps.length);
    const last = lesson.steps.length;
    if (delta > 0) markDone(lesson.id, step);
    if (delta > 0 && step >= last) {
      closeLessons();
      return;
    }
    const next = step + delta;
    if (next < 1 || next > last) return;
    const spec = lesson.steps[next - 1];
    writeHash(spec.concept || parsed.concept, lesson.id, next, "push");
  }

  function closeLessons() {
    tocSticky = false;
    appliedKey = "";
    const parsed = OG.parseHash(location.hash);
    if (!parsed.params.lesson) {
      hideAll();
      return;
    }
    writeHash(parsed.concept, "", 0, "push");
  }

  function whenReady(fn) {
    const api = host();
    if (api && api.ready()) fn();
    else if (api) api.onReady(fn);
    else fn();
  }

  function open(id, step) {
    whenReady(() => {
      loadIndex().then(() => loadLesson(id)).then((lesson) => {
        const n = OG.stepNumber(step, lesson.steps.length);
        const spec = lesson.steps[n - 1] || {};
        const concept = spec.concept || current().concept || (host() && host().focusName()) || "";
        appliedKey = "";
        writeHash(concept, id, n, "push");
      }).catch((err) => fail(err.message || String(err)));
    });
  }

  function openToc() {
    whenReady(() => {
      tocSticky = true;
      const parsed = current();
      if (parsed.id) writeHash(parsed.concept, "", 0, "push");
      else loadIndex().then(() => renderTocOnly()).catch((err) => fail(err.message || String(err)));
    });
  }

  function resetProgress() {
    try { localStorage.removeItem(STORE); } catch (err) { /* ignore */ }
    if (built && indexDoc) {
      const parsed = current();
      if (parsed.id && lessons[parsed.id]) {
        const lesson = lessons[parsed.id];
        const step = OG.stepNumber(parsed.params.step, lesson.steps.length);
        if (lesson.kind === "tour") renderTour(lesson, step);
        else renderLesson(lesson, step);
      } else if (!els().lesson.hidden) {
        renderTocOnly();
      }
    }
  }

  function widenToldHits() {
    document.querySelectorAll("#g path.told-link").forEach((path) => {
      if (path.dataset.hit) return;
      const hit = path.cloneNode();
      hit.setAttribute("class", "told-link told-hit");
      hit.setAttribute("stroke", "transparent");
      hit.setAttribute("stroke-width", "16");
      hit.removeAttribute("stroke-dasharray");
      hit.dataset.hit = "1";
      path.parentNode.insertBefore(hit, path);
      path.dataset.hit = "1";
    });
  }

  function unwrapWithin(root) {
    if (!root) return;
    root.querySelectorAll(".og-explain").forEach((button) => {
      button.replaceWith(document.createTextNode(button.textContent));
    });
  }
  function unwrapExplain() { unwrapWithin(document.body); }
  function wrapRoot(root) {
    if (!root) return;
    unwrapWithin(root);
    root.normalize();
    const re = /\b(which|newSub)\b/g;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const text = node.nodeValue;
      if (!text || !re.test(text)) return;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const match of text.matchAll(re)) {
        if (match.index > last) frag.append(text.slice(last, match.index));
        const button = document.createElement("button");
        button.type = "button";
        button.className = "og-explain";
        button.dataset.explain = match[1];
        button.textContent = match[1];
        frag.append(button);
        last = match.index + match[0].length;
      }
      if (last < text.length) frag.append(text.slice(last));
      node.parentNode.replaceChild(frag, node);
    });
  }
  function wrapExplain() {
    if (!document.body.classList.contains("tutorial-on")) return;
    wrapRoot(document.getElementById("def-text"));
    wrapRoot(document.getElementById("grail-text"));
  }

  function explainKey(target) {
    if (!target || !target.closest) return "";
    const button = target.closest(".og-explain");
    if (button && button.dataset.explain) return button.dataset.explain;
    if (target.closest(".told-mark, .told-link")) return "told";
    return "";
  }
  function showExplain(key, event) {
    const lines = EXPLAIN[key];
    if (!lines) return;
    const tip = document.getElementById("tip");
    const body = document.getElementById("tip-body");
    if (!tip || !body) return;
    body.replaceChildren();
    lines.forEach((line, index) => {
      if (index) body.append(document.createElement("br"));
      body.append(document.createTextNode(line));
    });
    tip.dataset.explain = "1";
    tip.hidden = false;
    tip.classList.remove("is-touch");
    const x = event && event.clientX ? event.clientX : 24;
    const y = event && event.clientY ? event.clientY : 24;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - 380, x + 14)) + "px";
    tip.style.top = Math.min(window.innerHeight - 80, y + 14) + "px";
  }
  function hideExplain() {
    const tip = document.getElementById("tip");
    if (!tip || tip.dataset.explain !== "1") return;
    tip.hidden = true;
    delete tip.dataset.explain;
  }
  function onExplainOver(event) {
    if (!document.body.classList.contains("tutorial-on")) return;
    if (event.pointerType && event.pointerType !== "mouse") return;
    const key = explainKey(event.target);
    if (!key) return;
    showExplain(key, event);
  }
  function onExplainOut(event) {
    if (!explainKey(event.target)) return;
    hideExplain();
  }
  function onExplainDown(event) {
    if (!document.body.classList.contains("tutorial-on")) return;
    const key = explainKey(event.target);
    if (!key) return;
    if ((event.pointerType || "mouse") === "mouse") return;
    event.stopPropagation();
    showExplain(key, event);
  }

  OG.onHash = function () { syncFromHash(); };
  OG.tutorial = {
    open: open,
    openToc: openToc,
    resetProgress: resetProgress,
    syncFromHash: syncFromHash
  };
})();
