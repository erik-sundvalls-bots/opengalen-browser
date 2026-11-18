#!/usr/bin/env python3
"""Build the lazy-loaded *told* (pre-classification) hierarchy variant.

The default browser data (``site/data/graph.bin.gz``) is the hierarchy that
GALEN's own classifier produced: the precomputed "inferred view" dump in the
OWL release (``OpenGALEN8/Hierarchy_Dumps/*.dump``). The release ships no
told-hierarchy file, so this script derives one from the same OWL-F axioms the
main extract already reads. These axioms are the statement-by-statement OWL
copy of the GRAIL sources (see ``OpenGALEN_OWL_Translations_Documentation.pdf``
in the release). Nothing is reasoned.

A told parent of a named class ``A`` is a named class ``B`` stated by:

    kind 0  SubClassOf(A B)                               GRAIL ``B newSub A``
    kind 1  EquivalentClasses(A ObjectIntersectionOf(B …)) GRAIL ``(B which …) name A``
    kind 2  SubClassOf(A ObjectIntersectionOf(B …))

Only top-level named operands count, and owl:Thing is ignored. This is the
"asserted" hierarchy an OWL editor shows before a reasoner runs. Named
equivalences (``EquivalentClasses(A B)``) are already merged into the
default graph's equivalence groups, so the told variant reuses those groups.

Ids are the ids of the committed ``graph.bin.gz`` (alphabetical names), so
the told file is useless without that graph. Its manifest records the graph's
``built`` stamp, and the browser refuses a mismatch.

Output (``site/data/told-variant/``), fetched only when the user switches the
hierarchy to *Told*:

    meta.json              manifest, counts, checks
    parents.bin.gz         little-endian, after gzip:
        0   4  magic b'OG8T'
        4   4  version = 1
        8   4  n             must equal the graph's concept count
        12  4  nEdges        told child -> parent links
        16  4*(n+1)          parOff  CSR offsets
        ..  4*nEdges         parIds
        ..  nEdges           kind    0, 1 or 2 as above, plus
                                     bit 7 (128): also a direct inferred parent
                                     bit 6 (64):  not direct, but still an
                                     inferred ancestor (the classifier put
                                     something in between)
                                     neither bit: the classified dump does not
                                     have the parent above the child at all
"""

from __future__ import annotations

import argparse
import gzip
import io
import json
import struct
import sys
import zipfile
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import og8_extract as og  # noqa: E402

KIND_NAMES = [
    "SubClassOf(A B)",
    "EquivalentClasses(A ObjectIntersectionOf(B …))",
    "SubClassOf(A ObjectIntersectionOf(B …))",
]
ALSO_INFERRED = 0x80
INFERRED_ANCESTOR = 0x40
TOP = {"owl:Thing", "Thing"}


def read_graph(path: Path) -> dict:
    """Names and inferred parents of the committed graph.bin.gz."""
    raw = gzip.decompress(path.read_bytes())
    magic, version, n, n_edges, n_eq, name_bytes, n_roots, _r = struct.unpack_from("<4sIIIIIII", raw, 0)
    if magic != b"OG8G" or version != 1:
        raise SystemExit("unexpected graph.bin.gz")
    o = 32

    def take(count: int):
        nonlocal o
        arr = struct.unpack_from(f"<{count}I", raw, o)
        o += 4 * count
        return arr

    name_off = take(n + 1)
    par_off = take(n + 1)
    take(n + 1)  # kidOff
    eq_off = take(n + 1)
    par_ids = take(n_edges)
    take(n_edges)  # kidIds
    eq_ids = take(n_eq)
    take(n_roots)
    o += n  # mod
    gen = raw[o : o + n]
    o += n
    blob = raw[o : o + name_bytes]
    names = [blob[name_off[i] : name_off[i + 1]].decode("utf-8") for i in range(n)]
    parents = [list(par_ids[par_off[i] : par_off[i + 1]]) for i in range(n)]
    equiv = [list(eq_ids[eq_off[i] : eq_off[i + 1]]) for i in range(n)]
    return {"n": n, "names": names, "parents": parents, "equiv": equiv, "gen": gen}


def told_pairs(owl_zip: zipfile.ZipFile):
    """Yield (child, parent, kind) for every told named parent in OWL-F."""
    files = sorted(
        n for n in owl_zip.namelist() if "/OWL-F/" in n and n.endswith(".owl")
    )
    counts = Counter()
    for nth, name in enumerate(files, 1):
        with owl_zip.open(name) as raw:
            for line in io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline=""):
                if line.startswith("SubClassOf("):
                    head = "SubClassOf"
                elif line.startswith("EquivalentClasses("):
                    head = "EquivalentClasses"
                else:
                    continue
                counts[head + " lines"] += 1
                try:
                    node = og.axiom_call(line)
                except Exception:
                    counts["parse failures"] += 1
                    continue
                if not isinstance(node, tuple) or node[0] != head:
                    counts["parse failures"] += 1
                    continue
                args = node[1]
                if head == "SubClassOf":
                    if len(args) < 2 or not isinstance(args[0], str):
                        continue
                    child, sup = args[0], args[1]
                    if isinstance(sup, str):
                        yield child, sup, 0
                    elif isinstance(sup, tuple) and sup[0] == "ObjectIntersectionOf":
                        for op in sup[1]:
                            if isinstance(op, str):
                                yield child, op, 2
                    continue
                named = [a for a in args if isinstance(a, str)]
                for expr in args:
                    if isinstance(expr, tuple) and expr[0] == "ObjectIntersectionOf":
                        bases = [op for op in expr[1] if isinstance(op, str)]
                        for child in named:
                            for base in bases:
                                yield child, base, 1
        if nth % 20 == 0 or nth == len(files):
            print(f"  owl {nth}/{len(files)}", flush=True)
    told_pairs.counts = counts


def build(owl_path: Path, data_dir: Path) -> dict:
    graph_meta = json.loads((data_dir / "meta.json").read_text(encoding="utf-8"))
    g = read_graph(data_dir / graph_meta["files"]["graph"])
    n, names = g["n"], g["names"]
    id_of = {name: i for i, name in enumerate(names)}
    print(f"graph {n} concepts, built {graph_meta['built']}", flush=True)

    kind_of: dict[tuple[int, int], int] = {}
    skipped = Counter()
    raw_kinds = Counter()
    with zipfile.ZipFile(owl_path) as owl_zip:
        for child, parent, kind in told_pairs(owl_zip):
            raw_kinds[kind] += 1
            if parent in TOP:
                skipped["parent is owl:Thing"] += 1
                continue
            if child == parent:
                skipped["self link"] += 1
                continue
            if child not in id_of or parent not in id_of:
                skipped["name not a concept in the graph"] += 1
                continue
            pair = (id_of[child], id_of[parent])
            # Keep the most direct statement kind (SubClassOf before definitions).
            if pair not in kind_of or kind < kind_of[pair]:
                kind_of[pair] = kind
    owl_counts = dict(told_pairs.counts)

    parents: list[list[int]] = [[] for _ in range(n)]
    for (c, p) in kind_of:
        parents[c].append(p)
    for i in range(n):
        parents[i].sort()
    removed = og.break_cycles(parents)
    for pair in removed:
        kind_of.pop(pair, None)

    # The dump's own links: graph parents minus the told parents that the main
    # extract restored for dump-parentless concepts (told.json.gz, drawn red).
    restored: set[tuple[int, int]] = set()
    told_file = graph_meta["files"].get("told")
    if told_file and (data_dir / told_file).exists():
        doc = json.loads(gzip.decompress((data_dir / told_file).read_bytes()))
        restored = {(int(r[0]), int(r[1])) for r in doc.get("edges", [])}
    dump_parents = [[p for p in plist if (i, p) not in restored] for i, plist in enumerate(g["parents"])]
    g["parents"] = dump_parents
    inferred = [set(p) for p in g["parents"]]
    # Equivalence groups as the browser merges them (graph.equiv is closed).
    group = [frozenset([i, *g["equiv"][i]]) for i in range(n)]

    def inferred_ancestor(child: int, parent: int) -> bool:
        targets = group[parent]
        seen: set[int] = set()
        stack = [p for m in group[child] for p in g["parents"][m]]
        while stack:
            node = stack.pop()
            if node in targets:
                return True
            if node in seen:
                continue
            seen.add(node)
            for m in group[node]:
                if m in targets:
                    return True
                stack.extend(g["parents"][m])
        return False

    par_off = [0]
    par_ids: list[int] = []
    kinds = bytearray()
    both = told_only = told_ancestor = 0
    by_kind = Counter()
    final_kind: dict[tuple[int, int], int] = {}

    def kinds_at(i: int, p: int) -> int:
        return final_kind[(i, p)]
    for i in range(n):
        for p in parents[i]:
            k = kind_of[(i, p)]
            by_kind[k] += 1
            if p in inferred[i]:
                k |= ALSO_INFERRED
                both += 1
            elif inferred_ancestor(i, p):
                k |= INFERRED_ANCESTOR
                told_ancestor += 1
            else:
                told_only += 1
            par_ids.append(p)
            kinds.append(k)
            final_kind[(i, p)] = k
        par_off.append(len(par_ids))
    not_inferred = [
        [i, p, kind_of[(i, p)]]
        for i in range(n)
        for p in parents[i]
        if not (kinds_at(i, p) & (ALSO_INFERRED | INFERRED_ANCESTOR))
    ]
    told_set = [set(p) for p in parents]
    inferred_only = sum(1 for i in range(n) for p in inferred[i] if p not in told_set[i])
    with_told = sum(1 for i in range(n) if parents[i])
    roots = sum(1 for i in range(n) if not parents[i])
    gen_roots = sum(1 for i in range(n) if not parents[i] and g["gen"][i])

    body = struct.pack("<4sIII", b"OG8T", 1, n, len(par_ids))
    body += og.u32_bytes(par_off) + og.u32_bytes(par_ids) + bytes(kinds)
    out = data_dir / "told-variant"
    out.mkdir(parents=True, exist_ok=True)
    gz = og.gzip_bytes(body)
    (out / "parents.bin.gz").write_bytes(gz)

    def check(ok: bool, label: str) -> dict:
        print(("  ok   " if ok else "  FAIL ") + label, flush=True)
        return {"ok": bool(ok), "label": label}

    def has_told(child: str, parent: str) -> bool:
        return child in id_of and parent in id_of and id_of[parent] in told_set[id_of[child]]

    checks = [
        check(owl_counts.get("SubClassOf lines") == og.EXPECT_SUB, f"SubClassOf lines {owl_counts.get('SubClassOf lines')} (expected {og.EXPECT_SUB})"),
        check(owl_counts.get("EquivalentClasses lines") == og.EXPECT_EQ_AXIOMS, f"EquivalentClasses lines {owl_counts.get('EquivalentClasses lines')} (expected {og.EXPECT_EQ_AXIOMS})"),
        check(not owl_counts.get("parse failures"), f"parse failures {owl_counts.get('parse failures', 0)}"),
        check(has_told("first", "OrdinalPositionValueType"), "first has told parent OrdinalPositionValueType (omitted from the dump)"),
        check(has_told("BrachialPlexus", "NAMEDNervePlexus"), "BrachialPlexus has told parent NAMEDNervePlexus"),
        check(not has_told(og.SPOT_CHILD, og.SPOT_PARENT), f"{og.SPOT_CHILD} has no told parent {og.SPOT_PARENT} (inferred only)"),
        check(not has_told("BodyStructure", "Adenoma"), "BodyStructure has no told parent Adenoma (classifier artefact)"),
        check(len(par_ids) > 100_000, f"told links {len(par_ids)}"),
        check(
            all(not (final_kind.get(pair, 0) & ALSO_INFERRED) for pair in restored),
            f"the {len(restored)} told parents restored in red (told.json.gz) are not counted as dump links",
        ),
    ]
    doc = {
        "variant": "told",
        "title": "Told (asserted) OWL hierarchy, before classification",
        "graphBuilt": graph_meta["built"],
        "concepts": n,
        "files": {"parents": "parents.bin.gz"},
        "bytes": {"parents": len(gz)},
        "kinds": KIND_NAMES,
        "source": "OpenGALEN8/OWL_Sources/OWL-F/*.owl in opengalen8-owl-sources.zip (GOSL)",
        "counts": {
            "owlSubClassOfLines": owl_counts.get("SubClassOf lines", 0),
            "owlEquivalentClassesLines": owl_counts.get("EquivalentClasses lines", 0),
            "toldStatements": sum(raw_kinds.values()),
            "toldStatementsByKind": [raw_kinds[k] for k in range(3)],
            "skipped": dict(skipped),
            "toldLinks": len(par_ids),
            "toldLinksByKind": [by_kind[k] for k in range(3)],
            "cycleLinksDropped": len(removed),
            "alsoDirectInferred": both,
            "toldStillInferredAncestor": told_ancestor,
            "toldNotInferredAncestor": told_only,
            "inferredOnly": inferred_only,
            "conceptsWithToldParent": with_told,
            "toldRoots": roots,
            "toldRootsGenerated": gen_roots,
        },
        "notInferred": not_inferred,
        "checks": checks,
        "ok": all(c["ok"] for c in checks),
    }
    (out / "meta.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(doc["counts"], indent=1), flush=True)
    print(f"parents.bin.gz {len(gz):,} bytes; told links not under the dump: {len(not_inferred)}", flush=True)
    return doc


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--owl", type=Path, default=root / "sources/opengalen8-owl-sources.zip")
    ap.add_argument("--data", type=Path, default=root / "site/data")
    args = ap.parse_args()
    return 0 if build(args.owl, args.data)["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
