# OpenGALEN browser

A static, client-side **graph browser** for the [OpenGALEN 8](https://opengalen.eggbird.eu/sources/sources.html) ontology (2010-01-28). It is part of Erik Sundvall's PEN&PAD revival work. The hierarchy is the one OpenGALEN already classified. Nothing is reasoned in the browser.

The running site is published with GitHub Pages from this repository:

**https://erik-sundvalls-bots.github.io/opengalen-browser/**

## Licences

Two licences apply, and they are not interchangeable.

| Material | Licence |
|---|---|
| Browser code, build scripts, CSS, this README | [MIT](LICENSE). Copyright 2026 Erik Sundvall (erik-sundvalls-bots). |
| `sources/` (the OpenGALEN 8 release zips and `gosl.html`) | [GALEN Open Source License](sources/gosl.html) (GOSL) 1.0. Copyright the Universities of Manchester and Nijmegen and their contributors. |
| `site/data/` (integer ids, hierarchy, definitions, search index) | GOSL, as a compiled form of those sources. See [NOTICE](NOTICE). |

The source zips are unmodified. `build/og8_extract.py` only repackages them: stable integer ids, the inferred parent links, and a GRAIL-like rendering of each OWL equivalent-class axiom. That packaging is described here so a recipient can see what was derived and from which files.

Acknowledgement, as GOSL requires at start-up and within the application:

> This product uses the OpenGALEN Clinical Terminology, Copyright the Universities of Manchester and Nijmegen, licensed through OpenGALEN (www.opengalen.org). (now mirrored at [https://opengalen.eggbird.eu/](https://opengalen.eggbird.eu/), and archived at the Internet Archive: [https://web.archive.org/web/20220308122743/https://opengalen.org/](https://web.archive.org/web/20220308122743/https://opengalen.org/))

## What you can do in the browser

- Search a concept (prefix or words from the CamelCase name, plus the published language annotations).
- See its neighbourhood as a Sugiyama DAG: ancestors up to the top, with chains of intermediate concepts collapsed into a dashed **+n** cluster, direct children, and optional siblings.
- Click a concept to refocus. Click a **+n** pill to expand that cluster. Hover a cluster to read the hidden names.
- Read the side panel: GRAIL-like definition, sanction level, sensible and grammatical role sanctions, GRAIL `topicNecessarily` lines where the original source has them, dissection rubric, parents, children and, where a concept has more than one name, the full name list. The panel slides away to a narrow icon strip.
- **Incoming relationships** list the concepts whose definitions use the focus as a role filler, as source + role, for example `Pollux = Thumb hasOrdinalPosition` on `first`. They use the same All / None and “shown X of N” controls, but nothing is ticked to start with, because some fillers are used by thousands of definitions (the largest has 21,679). A filter box narrows the list, and at most 300 rows are listed at once. Ticking a row adds that concept, its ancestors and a dashed arrow pointing at the focus.
- Equivalent names are one node. `#concept=Thumb` and `#concept=Pollux` show the same merged graph (parents, children, roles and the GRAIL snippet that hangs on either name), with a heading `Thumb = Pollux`. The address keeps the name you opened. Search still finds each name. The dump’s BannedKnowledgeNames bag (ambiguous names such as `Tonsil` and `ZootleWordle`) is kept as separate nodes, with a panel note.
- **Relationships** and **Sanctions and qualifiers** each have a side-panel list of checkboxes, with All / None and a “shown X of N” count. The list scrolls when it is long. The first 16 items are checked to start with; you can check more, or fewer. The toggle draws only the checked items, and is off until you turn it on (ticking a box while it is off turns it on). The ticks stay until you open another concept.
- Switches beside the search box for generated classes (on at start), labels, and clustering. Cluster-marking appears while clustering is on. Siblings is a side-panel button. Zoom and fit sit at the upper right of the graph. Click an expanded cluster’s area, not a node, to collapse it. With cluster-marking off that area is invisible.
- Hide the long generated `…which…which…` class names, or show them. They are shown at start.
- Permalink a concept with `#concept=Name` (a `?concept=Name` query is accepted and rewritten to that hash). For an equivalence group the permalink may use any of the names. A lesson can share that address: `#concept=Pericarditis&lesson=layers&step=1`. Unknown extra fields are ignored, and a plain `#concept=Name` link is unchanged.
- The About and licence dialog opens automatically only on a plain visit, with no concept and no lesson in the address. A URL that already names a concept, such as `#concept=Thumb`, or a lesson, such as `#lesson=orientation`, goes straight to the graph. The About button in the side strip still opens the dialog. **Start the tour** is in that dialog. It does not start by itself.
- A short tutorial (orientation tour, and a chapter on meaning, background knowledge, and data) loads only when you open it. Progress stays in this browser’s `localStorage` and is not sent anywhere. See [Tutorial](#tutorial).
- Repeat visits are cached in IndexedDB, including offline reuse of what has already been fetched.
- **Hierarchy: Inferred | Told (original)** beside the switches. *Inferred* (the default) is the classified dump. *Told* shows the parents stated in the OWL translation of the GRAIL sources, before any classification. Its data is fetched only on the first click (about 240 KB), so the normal start-up is unchanged. See [Told hierarchy variant](#told-hierarchy-variant).

Generated classes are real nodes in the published hierarchy (the OWL translation names anonymous expressions by concatenating them). A class is treated as generated when its name contains two or more `which` glue words, or one `which` and is at least 56 characters long. Shorter single-`which` names such as `PhenomenonwhichinvolvesHeart` stay visible, because they are the ordinary inferred parents.

## How the data is built

Requirements: Python 3.9+ with the standard library only. From the repository root:

```bash
python3 build/og8_extract.py      # also rebuilds site/data/told-variant/
python3 build/og8_told.py         # only the told variant, against the committed graph
python3 -m unittest discover -s build -p 'test_*.py'
```

The script reads:

- `sources/opengalen8-owl-sources.zip`
  - hierarchy: `OpenGALEN8/Hierarchy_Dumps/OpenGALEN8_WithPropertyChains_CRM+Diseases+SurgicalProcedures+DrugOntology.dump`
  - definitions, sanctions, rubrics, labels: `OpenGALEN8/OWL_Sources/OWL-F/*.owl`
- `sources/opengalen8-ascii-sources.zip`
  - GRAIL `name` snippets and `topicNecessarily` qualifiers

It writes `site/data/` and `build/VALIDATION.md`. It checks the published counts (164,626 class declarations, 246,576 `implies` lines in the full with-property-chains dump) and the spot-check that `PulmonaryAtresiaWithVentricularSeptalDefect` implies `PhenomenonwhichinvolvesHeart` even though that link is not an asserted `SubClassOf`.

Commit the generated `site/data/` if you want Pages to serve it without rebuilding. Re-running the script is enough to regenerate it; the eggbird site is not required once the zips are in `sources/`.

### Artefacts

| File | Role |
|---|---|
| `site/data/meta.json` | Counts, default concept, shard size. Loaded first. |
| `site/data/graph.bin.gz` | Names, parent and child indexes, equivalents, module, generated flag. |
| `site/data/search.bin.gz` | Token index over CamelCase names and language labels. |
| `site/data/labels.json.gz` | The 9k language annotations, for the panel and search. |
| `site/data/d/NNN.json.gz` | Definition shards (512 concepts each), loaded when a concept is opened. |
| `site/data/r/NNN.json.gz` | Outgoing definition-role rows `[property, filler]`, sharded by source concept. |
| `site/data/i/NNN.json.gz` | Incoming index: the same rows reversed, `[property, source]`, sharded by filler concept. Loaded when a concept is opened. |
| `site/data/told.json.gz` | Told OWL `SubClassOf` parents restored for concepts the dump left parentless: `[child, parent, file, line]`, plus the skipped pairs and why. Loaded at start (8 KB) so those links can be drawn in red. |

| `site/data/told-variant/meta.json`, `parents.bin.gz` | The told (pre-classification) hierarchy, built by `build/og8_told.py`. **Not** part of the first load: fetched only when the user clicks *Told (original)*. |

The binary layouts are documented at the top of `build/og8_extract.py` and `build/og8_told.py`.

### Told hierarchy variant

The OpenGALEN 8 release ships seven classified hierarchy dumps (`Hierarchy_Dumps/*.dump`: with and without property chains, for the CRM alone and with the disease, procedure and drug extensions). It also ships the compiled ClaW/KnoME model (`opengalen8-compiled.zip`, a binary `.gra` file that needs the GALEN tools). It does **not** ship a told, pre-classification hierarchy file. The browser's default graph is the with-property-chains full dump.

`build/og8_told.py` derives the told hierarchy from the same OWL-F files the main extract reads. According to `OpenGALEN_OWL_Translations_Documentation.pdf` (v1.02, 2010-01-16, in the release), those files are the GRAIL statements copied out one by one during compilation. Nothing is reasoned. A told parent of a named class `A` is a named class `B` in one of these axioms:

| Kind | OWL axiom | GRAIL form | Links |
|---|---|---|---|
| 0 | `SubClassOf(A B)` | `B newSub A` | 13,164 |
| 1 | `EquivalentClasses(A ObjectIntersectionOf(B …))` | `(B which …) name A` | 108,011 |
| 2 | `SubClassOf(A ObjectIntersectionOf(B …))` | | 315 |

That gives 121,490 unique told links on the graph's 125,511 ids. 81 statements with `owl:Thing` as the parent, 81 that name a class that is not in the graph, and 7 self-links are skipped. No cycles. The variant reuses the default graph's ids, names, equivalence groups (which already include the OWL named equivalences) and canonical names, so a concept keeps its node and address in both views. Compared with the classified dump (without the 103 restored red links):

- 31,995 told links are also direct classified links (drawn as usual);
- 89,249 are still ancestors after classification, but the classifier put more specific parents in between (drawn **blue, dash-dot**, “moved up” in the panel);
- 246 are not above the child in the dump at all (drawn **red**, “not in dump”). These are the 103 links the main extract already restores, plus 143 definitional parents of dump-parentless concepts, for example `AbdominalFistula` = `Fistula which isPartitivelyTo AbdominalSkin`, which has no parent in the dump (93 of the 143 are long `DrugInteraction…` classes). They are listed in `told-variant/meta.json` under `notInferred`.

In the told view the side panel shows *Told parents* and, for comparison, the *Classifier parents* of the same concept, with “not told” on parents only the classifier found. Children, ancestors, clusters, relationships and incoming rows all follow the told parents. Links that skip hidden generated classes are drawn in the default style, because no single told statement matches them.

## What the build checked

`build/VALIDATION.md` is the last run. It matches the published OWL-F and dump counts:

| Published figure | This build |
|---|---|
| 164,626 class declarations | 164,626 `Declaration(Class …)` lines, naming **125,389** unique classes. The OWL release notes say duplicate declarations are translation artefacts. |
| 246,576 parent links | 246,576 `implies` lines, 244,980 unique pairs, 436 self-links ignored. Two classifier-artefact pairs (`BodyStructure` under `Adenoma`, and under Adenoma's defining which-class) are removed; they are not in the no-chains or CRM-only dumps. The graph stores **245,076** links after dropping the 5 remaining surgical cycles and restoring 103 told OWL parents that the dump omitted (for example `first` ⊑ `OrdinalPositionValueType`; see Known limits). |
| 1,664 `equivalent` lines | 1,664 |
| 154,509 equivalent-class axioms, 54,285 subclass axioms | both exact |
| `PulmonaryAtresiaWithVentricularSeptalDefect` implies `PhenomenonwhichinvolvesHeart` | true as an **ancestor**, and it is not an asserted `SubClassOf`. The direct dump parent of `PulmonaryAtresia` includes `CongenitalPathologywhichinvolvesHeartChamber`. |

The browser graph has **125,511** concepts: the unique declared names plus dump names that were not declared. **90,775** of those names are treated as generated (two or more `which` glue words, or one `which` and at least 56 characters) and are hidden until the toggle is on.

## Size and first load

Gzipped artefacts from the last build:

| File | Bytes |
|---|---|
| `graph.bin.gz` | 2,720,245 |
| `search.bin.gz` | 3,122,406 |
| `labels.json.gz` | 41,921 |
| 246 definition shards | 3,114,691 |
| `props.json.gz` plus relationship shards | 444,467 |
| 133 incoming-index shards (`i/`) | 436,917 |
| `told.json.gz` | 8,214 |
| `site/lib/` d3 + d3-dag | about 375,000 |
| `told-variant/` (lazy, on click only) | 244,572 (`parents.bin.gz` 234,260 + `meta.json` 10,312) |

The first view fetches the graph, the search index, the labels and `meta.json`: about **6.3 MB** on the wire. Definition shards, and the relationship shards for non-is-a roles, load when a concept is opened. The relationship extract is 149,129 edges on 106,275 concepts in 52 property groups, and it is not part of the first load. On a local server the page was interactive in about **0.6 s**, of which the 6 MB download was a few tens of milliseconds, so building the indexes and the first Sugiyama layout is about half a second once the bytes have arrived. Repeat visits read those files from IndexedDB.

## Known limits

- There is no in-browser reasoner. The hierarchy is the 2010 with-property-chains dump, plus 103 told OWL parents that the dump omitted (see below and [issue #10](https://github.com/erik-sundvalls-bots/opengalen-browser/issues/10)). Those links are drawn in **red**, marked “told” in the Parents and Children lists, and a banner warns when the open concept or the drawn graph has one.
- Told parents. 4,816 concepts have no parent in the dump, and 676 of them have a told named OWL `SubClassOf` parent. For 572 of them, the told parent is already a classified ancestor of an equivalent name, or of a name equivalent to the parent. For example, the dump hangs `NAMEDNervePlexus` on `PlexusBrachialis`, not on `BrachialPlexus`. The browser merges those names into one node, so nothing is added. Two are skipped: `TopCategory` ⊑ `owl:Thing`, and `MagnitudeValueType` ⊑ `PrimitiveValueType`, which is not a concept here. The remaining **102 concepts (103 links)** are restored. All of them lie in the `ValueType` branch: the ordinal positions, the number and percentage ranges such as `moreThanOne` ⊑ `oneOrMore`, and `ValueType` ⊑ `TopCategory`. No dump file has implies lines for them. Roots go from 4,816 in the dump to **4,714**. The restored links create no cycles and reach no concept outside those 102.
- Two edges in the with-chains dump are classifier artefacts, not told axioms: `BodyStructure` implies `Adenoma` (lines 32231–32237) and `BodyStructure` implies Adenoma's defining which-class (lines 33133–33137). They are absent from the no-chains and CRM-only dumps and are removed before cycle breaking. Without that filter about 10,886 concepts, including Heart, Hand and Femur, had Adenoma as an ancestor. `BodyStructure`'s only stored parent is `OrganicSolidStructure`.
- Five `implies` cycles remain after that filter and are dropped so the picture is a DAG. They are long surgical-procedure names listed in `build/VALIDATION.md`. Five narrower generated-class inversions (HeartBeat, SurgicalAblating, and tachycardia wrappers) are logged there and kept.
- A neighbourhood with many parents (Heart has 52 ancestors) is dense. Labels can overlap. The on-canvas zoom tools and turning labels off are the relief valves. `decrossOpt` is exponential on these DAGs, so the layout uses `decrossTwoLayer`. The vertical gap is the V7 value of 46; the horizontal gap is wider because GALEN names are long.
- Equivalent names are merged only in the browser, not in `graph.bin`. The extract still stores each name and its own parent, child and `equiv[]` lists. The canonical name prefers a name that does not contain `which` (so `MentalDisease` beats `PathologicalPhenomenonwhichinvolvesMentalSystem`), then the member with the most classified is-a relations, then the shorter official name; ties are broken alphabetically. `Pollux` remains canonical for `Thumb` / `Pollux` because neither name contains `which` and the dump hangs every `implies` line on `Pollux`. When the group is the focus, the node is labelled with every name, opened first. When it is a neighbour, the label is the canonical name, or `Canonical = Alias` when that string stays short.
- Almost every equivalence group in this build hangs all of its is-a relations on a single member (3,998 of 3,999 groups; `twelfth` / `twelvth` have none). The dump’s BannedKnowledgeNames bag (`ZootleWordle`, `Base`, `BoneMarrow`, `Clipping`, `Fornix`, `Tonsil`, `Tubercle`) is not merged: those GRAIL names are marked equivalent because they are ambiguous, not because they are one concept. Opening any of them stays on that name, with a panel note and links to the other bag members. It does not jump to a more specific concept such as `PalatineTonsil`.
- A concept with no OWL equivalent-class expression is shown as primitive: parents, children and sanctions. The encircled i beside Definition says so. `Anaemia` is an example that does have a GRAIL-like definition.
- Definition roles are optional dashed arrows (pointing at the filler), off until a kind is switched on. Is-a links have no arrowheads. Every selected target is climbed by is-a to the root, and clustering folds the ancestors those targets share. The widest such neighbourhood in this build is 195 ancestors. With clustering on it lays out in a few tenths of a second; with clustering off that same picture takes several seconds. A nested filler is one edge to its genus (the last named class in the intersection) or to the named class when the filler is a single class. Roles inside that filler stay in the definition text. Dissection and application-metadata roles are left out of the shards.
- Definition roles and sanctions can each be drawn from a scrollable checkbox list in the side panel. The first 16 items are checked to start with; All / None and “shown X of N” let you pick a subset, or every item, when a concept has many (AbdominalCavity has 60 sanctions). The section toggle draws only the checked items, off until you turn it on. Ticking a box while the toggle is off turns drawing on. The choice is kept in the session for that concept and is cleared when you open another. Sanctions are dotted arrows in a single colour; they are not stored in the address. `topicNecessarily` is read from the GRAIL sources when the line is a simple subject-qualifier-role-object statement. The OWL file itself only distinguishes sensible (`S-SANCTION-`) and grammatical (`G-SANCTION-`) sanctions.
- `#concept=first` is an ordinal-position selector, not a free-floating clinical concept. GRAIL declares `OrdinalPositionValueType newSub [first second … fifteenth]` in `GRAIL_Sources/64-3434624046.grl`. OWL has the told parent `SubClassOf(first OrdinalPositionValueType)` in `OpenGALEN8_FoundationModel_TopClassesForMedicalDomain.owl` line 1763, and `OrdinalPositionValueType` ⊑ `SymbolicValueType` in `OpenGALEN8_GenericModel.owl` line 156. The classified dump has no `(implies first …)` line, so earlier builds showed `first` with no parents. The extract restores those told parents and draws them in red. The **Incoming relationships** list on `first` shows the 11 concepts, in 9 merged nodes, whose definitions have `hasOrdinalPosition first`. They include Thumb = Pollux, Hallux = GreatToe, FirstMetacarpal and related first-position structures. Tick one to draw it.
- Generated-class detection is a name heuristic, not an OWL flag. Short single-`which` names such as `PhenomenonwhichinvolvesHeart` stay visible.

## Tutorial

The browser includes the start of an interactive reading of Alan Rector’s draft *PEN&PAD, GALEN & GRAIL* (November 2026). The design is [docs/TUTORIAL-DESIGN.md](docs/TUTORIAL-DESIGN.md). Lesson files live in `site/lessons/` and are fetched with `site/js/tutorial.js` and `site/css/tutorial.css` the first time you open a lesson, not with the initial page.

- **Start the tour** in About walks search, the graph, the side panel, clustering, and the red told-parent link on `#concept=first`.
- **Three layers** opens `Pericarditis`, `Bird`, `GramPositiveBacterium`, and `Gorilla`, with short quotations and page numbers from the draft.
- **Sanctions** opens `Hand`, `Cell`, `Digit`, and `Thumb`. Sensible, grammatical, and `topicNecessarily` lines use the OpenGALEN 8 names. The draft’s generic labels are quoted and mapped. In the OWL files those sanctions are annotation assertions, not class axioms; Alan Rector’s November 2026 note to Erik says the draft should have called them comments in the OWL version, not guaranteed complete.
- **Composition** walks `InflammationLesion`, `Pericarditis`, `Thumb`, and `ChestPainRadiatingToLeftArm`, and says this page cannot classify a new expression.
- **Where the terminology ends** uses `FingerPain` and the draft’s documentation–statement–observation–situation chain. An aside marked `TODO(erik)` mentions openEHR and FHIR; Erik has not signed that aside off.
- The book icon on the side strip opens the chapter list. **Reset tutorial progress** is in About.

Quotations were checked against the draft PDF. They are not a copy of the paper.

## Develop the page locally

```bash
python3 -m http.server -d site 8765
```

Open http://127.0.0.1:8765/ . The Pages deploy uses the same `site/` directory, so relative URLs work both locally and at `/opengalen-browser/`.

## Publish

Pushing `main` runs `.github/workflows/pages.yml`, which uploads `site/` and deploys it with GitHub Actions. The workflow asks `actions/configure-pages` to create the Pages site if it is missing.

That create call needs a permission this repository's automation token does not have (`Resource not accessible by integration` on `POST /repos/.../pages`). One setting has to be flipped by someone with admin on the repo:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Re-run the latest **Deploy GitHub Pages** workflow, or push again.

After that, the site is https://erik-sundvalls-bots.github.io/opengalen-browser/ . The workflow itself is already on `main`.

## Contributing / Feedback

[Suggest improvement/feature](https://github.com/erik-sundvalls-bots/opengalen-browser/issues/new).

The new-issue chooser leads with that template. A bug report and a data question (a concept, parent link, definition, or sanction that looks wrong) follow it. Include the concept’s `#concept=Name` address when the note is about one concept. Browser code is MIT. Terminology changes belong upstream of this browser: the graph is the published 2010 hierarchy, not a place to edit OpenGALEN itself.
