# Vendored libraries

Runtime pages load these files from this directory. They are not fetched
from a CDN.

| File | Version | Licence |
|---|---|---|
| `d3.min.js` | d3 7.9.0 | ISC, Copyright 2010-2023 Mike Bostock |
| `d3-dag.min.js` | d3-dag 0.11.5 (IIFE build) | MIT, Copyright 2022 Erik Brinkman |

d3-dag 0.11 exposes `d3.sugiyama`, `d3.layeringLongestPath` (with
`topDown`), `d3.decrossTwoLayer`, `d3.decrossOpt`, `d3.coordQuad` and
`d3.dagStratify`. The older `.gap([x, y])` setter is not in 0.11; the
layout passes the same `[7, 46]` slack through `nodeSize`, which is how
0.11 expresses inter-node gaps. `d3.graphStratify` in the CDR Catalyst V7
demo is the same stratify operator; this build names it `dagStratify`.
