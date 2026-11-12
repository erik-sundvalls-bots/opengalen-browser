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

> This product uses the OpenGALEN Clinical Terminology, Copyright the Universities of Manchester and Nijmegen, licensed through OpenGALEN (www.opengalen.org).

## What you can do in the browser

- Search a concept (prefix or words from the CamelCase name, plus the published language annotations).
- See its neighbourhood as a Sugiyama DAG: ancestors up to the top, with chains of intermediate concepts collapsed into a dashed **+n** cluster, direct children, and optional siblings.
- Click a concept to refocus. Click a **+n** pill to expand that cluster. Hover a cluster to read the hidden names.
- Read the side panel: GRAIL-like definition, sanction level, sensible and grammatical role sanctions, GRAIL `topicNecessarily` lines where the original source has them, dissection rubric, parents, children and equivalents.
- Hide the long generated `…which…which…` class names (the default) or show them.
- Permalink a concept with `#concept=Name`.
- Repeat visits are cached in IndexedDB, including offline reuse of what has already been fetched.

Generated classes are real nodes in the published hierarchy (the OWL translation names anonymous expressions by concatenating them). A class is treated as generated when its name contains two or more `which` glue words, or one `which` and is at least 56 characters long. Shorter single-`which` names such as `PhenomenonwhichinvolvesHeart` stay visible, because they are the ordinary inferred parents.

## How the data is built

Requirements: Python 3.9+ with the standard library only. From the repository root:

```bash
python3 build/og8_extract.py
python3 build/test_render.py
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

The binary layouts are documented at the top of `build/og8_extract.py`.

## Develop the page locally

```bash
python3 -m http.server -d site 8765
```

Open http://127.0.0.1:8765/ . The Pages deploy uses the same `site/` directory, so relative URLs work both locally and at `/opengalen-browser/`.

## Publish

Pushing `main` runs `.github/workflows/pages.yml`, which deploys `site/` with the GitHub Actions Pages workflow. The repository Pages setting has to be **GitHub Actions**, not a branch folder.
