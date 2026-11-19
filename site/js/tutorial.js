/* Orientation tour and lesson panel. Fetched on first use, not at startup. MIT.
   Progress is stored in localStorage under og-tutorial and is not sent anywhere. */
(function () {
  const OG = (window.OG = window.OG || {});
  const ASSET = "18";
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
  let currentSpec = null;

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
      + "<div class='lesson-nav'><button type='button' id='lesson-back'>← Back</button><button type='button' id='lesson-next'>Next →</button></div>"
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
      + "<div id='tour-step'>"
      + "<p id='tour-kicker' class='lesson-kicker'></p>"
      + "<h2 id='tour-title'></h2>"
      + "<div id='tour-body'></div>"
      + "<p id='tour-task' class='lesson-task' hidden></p>"
      + "<div id='tour-quotes'></div>"
      + "<div class='tour-nav'>"
      + "<button type='button' id='tour-back'>← Back</button>"
      + "<button type='button' id='tour-skip'>Skip tour</button>"
      + "<button type='button' id='tour-next'>Next →</button>"
      + "</div></div>"
      + "<div id='tour-end' hidden>"
      + "<p class='lesson-kicker'>Tutorial</p>"
      + "<h2 id='tour-end-title'>Tour of the screen (chapter 0)</h2>"
      + "<p id='tour-end-text'></p>"
      + "<div class='tour-nav'>"
      + "<button type='button' id='tour-close'>Close</button>"
      + "<button type='button' id='tour-continue'>Continue to chapter 2 (layers) →</button>"
      + "</div></div></div>";
    document.body.appendChild(tour);
    tour.querySelector("#tour-back").addEventListener("click", () => shift(-1));
    tour.querySelector("#tour-next").addEventListener("click", () => shift(1));
    tour.querySelector("#tour-skip").addEventListener("click", closeLessons);
    tour.querySelector("#tour-close").addEventListener("click", closeLessons);
    tour.querySelector("#tour-continue").addEventListener("click", () => open("layers", 1));
    tour.querySelector("#tour-end-text").textContent = "That’s the end of the tour. Chapter 2 is the next lesson: meaning, background, and data.";
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || tour.hidden) return;
      event.preventDefault();
      closeLessons();
    });
    window.addEventListener("resize", () => {
      if (!tour.hidden) placeTour();
      placeLesson();
    });
    document.addEventListener("og-draw", () => {
      if (!tour.hidden) placeTour();
      if (document.body.classList.contains("tutorial-on")) widenToldHits();
    });
    document.addEventListener("og-panel", () => {
      if (!document.body.classList.contains("tutorial-on")) return;
      wrapExplain();
      if (currentSpec) applySpecChrome(currentSpec);
      placeLesson();
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
      const api = host();
      if (api && name && api.focusName() !== name) api.go(name);
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

  function applySpecChrome(spec) {
    if (!spec) return;
    applyControls(spec);
    highlight(spec.highlight || spec.target);
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
    currentSpec = null;
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
      title.textContent = chapter.kind === "tour" || chapter.chapter === 0
        ? "Tour of the screen (chapter 0)"
        : "Chapter " + chapter.chapter + ". " + chapter.title;
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

  function boxesOverlap(a, b, pad) {
    const gap = pad || 0;
    return a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
  }

  function visibleBox(selector) {
    if (!selector) return null;
    const el = document.querySelector(selector);
    if (!el || el.hidden) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }

  /* Put the card on the side of the target with the most free space, and keep it off the target. */
  function placeBeside(card, obstacles) {
    const margin = 8;
    const gap = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardWidth = Math.min(340, vw - margin * 2);
    card.style.width = cardWidth + "px";
    card.style.maxHeight = Math.round(vh * 0.72) + "px";
    const ch = Math.min(card.offsetHeight || 200, Math.round(vh * 0.72));
    const cw = cardWidth;
    const primary = obstacles[0];
    const sides = [
      { side: "right", space: vw - primary.right - gap - margin, left: primary.right + gap, top: primary.top },
      { side: "left", space: primary.left - gap - margin, left: primary.left - gap - cw, top: primary.top },
      { side: "bottom", space: vh - primary.bottom - gap - margin, left: primary.left, top: primary.bottom + gap },
      { side: "top", space: primary.top - gap - margin, left: primary.left, top: primary.top - gap - ch }
    ].sort((a, b) => b.space - a.space);

    function fits(left, top) {
      if (left < margin - 1 || top < margin - 1) return false;
      if (left + cw > vw - margin + 1 || top + ch > vh - margin + 1) return false;
      const box = { left: left, top: top, right: left + cw, bottom: top + ch };
      for (let i = 0; i < obstacles.length; i++) {
        if (boxesOverlap(box, obstacles[i], 8)) return false;
      }
      return true;
    }

    const shifts = [0, 48, -48, 120, -120, 200, -200, 280, -280];
    for (let s = 0; s < sides.length; s++) {
      const cand = sides[s];
      for (let i = 0; i < shifts.length; i++) {
        let left = cand.left;
        let top = cand.top;
        if (cand.side === "left" || cand.side === "right") top += shifts[i];
        else left += shifts[i];
        left = Math.max(margin, Math.min(left, vw - cw - margin));
        top = Math.max(margin, Math.min(top, vh - ch - margin));
        if (fits(left, top)) {
          card.style.left = left + "px";
          card.style.top = top + "px";
          return;
        }
      }
    }

    /* Shrink into a free side. Do not slide the card back across the target. */
    const savedWidth = card.style.width;
    const savedMax = card.style.maxHeight;
    for (let s = 0; s < sides.length; s++) {
      const edge = sides[s];
      let maxW = cw;
      let maxH = Math.round(vh * 0.72);
      if (edge.side === "right") maxW = vw - primary.right - gap - margin;
      else if (edge.side === "left") maxW = primary.left - gap - margin;
      else if (edge.side === "bottom") maxH = vh - primary.bottom - gap - margin;
      else maxH = primary.top - gap - margin;
      if (maxW < 160 || maxH < 90) continue;
      card.style.width = Math.min(cw, maxW) + "px";
      card.style.maxHeight = Math.min(Math.round(vh * 0.72), maxH) + "px";
      const fw = Math.min(cw, maxW);
      const fh = Math.min(card.offsetHeight || maxH, maxH);
      let left = margin;
      let top = margin;
      if (edge.side === "right") {
        left = primary.right + gap;
        top = Math.min(Math.max(margin, primary.top), vh - fh - margin);
      } else if (edge.side === "left") {
        left = primary.left - gap - fw;
        top = Math.min(Math.max(margin, primary.top), vh - fh - margin);
      } else if (edge.side === "bottom") {
        top = primary.bottom + gap;
        left = Math.min(Math.max(margin, primary.left), vw - fw - margin);
      } else {
        top = primary.top - gap - fh;
        left = Math.min(Math.max(margin, primary.left), vw - fw - margin);
      }
      const box = { left: left, top: top, right: left + fw, bottom: top + fh };
      let blocked = false;
      for (let i = 0; i < obstacles.length; i++) {
        if (boxesOverlap(box, obstacles[i], 6)) blocked = true;
      }
      if (blocked || left < margin || top < margin || left + fw > vw - margin || top + fh > vh - margin) continue;
      card.style.left = left + "px";
      card.style.top = top + "px";
      return;
    }
    card.style.width = savedWidth;
    card.style.maxHeight = savedMax;
    card.style.left = margin + "px";
    card.style.top = margin + "px";
  }

  function placeEndCard() {
    const card = document.getElementById("tour-card");
    const header = document.querySelector(".topbar");
    const margin = 8;
    const width = Math.min(340, window.innerWidth - margin * 2);
    card.style.width = width + "px";
    card.style.maxHeight = Math.round(window.innerHeight * 0.72) + "px";
    const top = (header ? header.getBoundingClientRect().bottom : 8) + 12;
    const left = Math.max(margin, window.innerWidth - width - margin);
    card.style.top = top + "px";
    card.style.left = left + "px";
  }

  function placeTour() {
    const ui = els();
    if (!ui.tour || ui.tour.hidden) return;
    const end = document.getElementById("tour-end");
    if (end && !end.hidden) {
      placeEndCard();
      return;
    }
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
    ui.hole.hidden = false;
    ui.hole.style.left = left + "px";
    ui.hole.style.top = top + "px";
    ui.hole.style.width = width + "px";
    ui.hole.style.height = height + "px";
    const shade = document.getElementById("tour-shade");
    if (shade) {
      shade.hidden = false;
      const right = left + width;
      const bottom = top + height;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      shade.style.clipPath = "polygon(evenodd, 0px 0px, " + vw + "px 0px, " + vw + "px " + vh
        + "px, 0px " + vh + "px, 0px 0px, " + left + "px " + top + "px, " + right + "px " + top
        + "px, " + right + "px " + bottom + "px, " + left + "px " + bottom + "px, " + left + "px " + top + "px)";
    }
    const obstacles = [];
    const primary = visibleBox(spec.target) || visibleBox("#stage");
    if (primary) obstacles.push(primary);
    const extra = visibleBox(spec.highlight);
    if (extra) obstacles.push(extra);
    if (!obstacles.length) obstacles.push({ left: 8, top: 8, right: 80, bottom: 80, width: 72, height: 72 });
    placeBeside(ui.card, obstacles);
  }

  /* On a narrow window the lesson sheet must not cover the highlighted section. */
  function placeLesson() {
    const lesson = document.getElementById("lesson");
    if (!lesson || lesson.hidden) return;
    lesson.classList.remove("dock-top");
    if (window.innerWidth > 960 || !currentSpec) return;
    const box = visibleBox(currentSpec.highlight || currentSpec.target);
    if (!box) return;
    const sheet = lesson.getBoundingClientRect();
    const overlaps = boxesOverlap(box, { left: sheet.left, top: sheet.top, right: sheet.right, bottom: sheet.bottom }, 0);
    if (overlaps && box.top > window.innerHeight * 0.35) lesson.classList.add("dock-top");
  }

  function renderTour(lesson, step) {
    showShell("tour");
    const spec = lesson.steps[step - 1];
    const ui = els();
    document.getElementById("tour-end").hidden = true;
    document.getElementById("tour-step").hidden = false;
    document.getElementById("tour-card").setAttribute("aria-labelledby", "tour-title");
    ui.tourKicker.textContent = "Tour of the screen (chapter 0) · " + step + " of " + lesson.steps.length;
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
    ui.tourBack.hidden = step <= 1;
    ui.tourBack.disabled = step <= 1;
    ui.tourNext.disabled = false;
    ui.tourNext.textContent = step >= lesson.steps.length ? "Done" : "Next →";
    currentSpec = null;
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
    if (spec.note) {
      const note = document.createElement("p");
      note.className = "lesson-note";
      note.textContent = spec.note;
      ui.body.append(note);
    }
    if (spec.aside) {
      const aside = document.createElement("aside");
      aside.className = "lesson-aside";
      aside.textContent = spec.aside;
      ui.body.append(aside);
    }
    ui.task.hidden = !spec.task;
    ui.task.textContent = spec.task ? "Do this. " + spec.task : "";
    fillQuotes(ui.quotes, spec, lesson.pdf);
    ui.dump.hidden = !spec.dump;
    ui.dump.textContent = spec.dump || "";
    renderSteps(lesson, step);
    renderToc(lesson.id);
    ui.back.hidden = step <= 1;
    ui.back.disabled = step <= 1;
    ui.next.disabled = false;
    ui.next.textContent = step >= lesson.steps.length ? "Done" : "Next →";
    currentSpec = spec;
    applySpecChrome(spec);
    placeLesson();
    widenToldHits();
  }

  function renderTocOnly() {
    showShell("toc");
    const ui = els();
    ui.title.textContent = "Lessons";
    ui.kicker.textContent = "Choose a chapter";
    fillProse(ui.body, "The tutorial starts with a tour of the screen (chapter 0). The later chapters walk meaning and background, sanctions, named compositions, and where a terminology stops before a record.");
    currentSpec = null;
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
      if (lesson.kind === "tour") showTourEnd();
      else closeLessons();
      return;
    }
    const next = step + delta;
    if (next < 1 || next > last) return;
    const spec = lesson.steps[next - 1];
    writeHash(spec.concept || parsed.concept, lesson.id, next, "push");
  }

  function showTourEnd() {
    ensureDom();
    const step = document.getElementById("tour-step");
    const end = document.getElementById("tour-end");
    const shade = document.getElementById("tour-shade");
    const hole = document.getElementById("tour-hole");
    if (step) step.hidden = true;
    if (end) end.hidden = false;
    document.getElementById("tour-card").setAttribute("aria-labelledby", "tour-end-title");
    if (shade) shade.hidden = true;
    if (hole) hole.hidden = true;
    clearHighlight();
    currentSpec = null;
    document.getElementById("tour").hidden = false;
    document.body.classList.add("tour-open", "tutorial-on");
    placeEndCard();
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
