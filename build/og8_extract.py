#!/usr/bin/env python3
"""Build the static OpenGALEN 8 browser artefacts.

Reads the unmodified release zips (GALEN Open Source License) and writes a
compact graph, a token search index, and sharded definitions. This packaging
is a compiled form of that source: integer ids and rendered text, not a
change to the terminology. See NOTICE and README.md.

Graph file ``graph.bin.gz`` (little-endian), after gzip:

    offset  size
    0       4     magic b'OG8G'
    4       4     version = 1
    8       4     n                 concept count
    12      4     nEdges            parent links (child -> parent)
    16      4     nEq               equivalent-class links (both directions)
    20      4     nameBytes
    24      4     nRoots            concepts with no parent
    28      4     reserved
    32      4*(n+1)   nameOff       byte offsets into the name blob
    ...     4*(n+1)   parOff        CSR offsets of parents
    ...     4*(n+1)   kidOff        CSR offsets of children
    ...     4*(n+1)   eqOff         CSR offsets of equivalents
    ...     4*nEdges  parIds
    ...     4*nEdges  kidIds
    ...     4*nEq     eqIds
    ...     4*nRoots  roots
    ...     n         mod           0 unknown, 1 CRM, 2 Disease, 3 Procedure, 4 Drug
    ...     n         gen           1 if the name is a generated which-class
    ...     nameBytes names         utf-8, concatenated, sliced by nameOff

Search file ``search.bin.gz``:

    0       4     magic b'SRCH'
    4       4     version = 1
    8       4     nTokens
    12      4     nPosts
    16      4     tokenBytes
    20      4     reserved
    24      4*(nTokens+1) tokenOff
    ...     4*(nTokens+1) postOff
    ...     4*nPosts      postings   concept ids
    ...     tokenBytes    tokens     utf-8, concatenated

Ids are the alphabetical order of concept names, starting at 0.
"""

from __future__ import annotations

import argparse
import array
import gzip
import io
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

DUMP = (
    "OpenGALEN8/Hierarchy_Dumps/"
    "OpenGALEN8_WithPropertyChains_CRM+Diseases+SurgicalProcedures+DrugOntology.dump"
)
EXPECT_IMPLIES = 246_576
EXPECT_EQUIV = 1_664
EXPECT_CLASSES = 164_626
EXPECT_EQ_AXIOMS = 154_509
EXPECT_SUB = 54_285
SPOT_CHILD = "PulmonaryAtresiaWithVentricularSeptalDefect"
SPOT_PARENT = "PhenomenonwhichinvolvesHeart"
SHARD = 512
MOD_NAME = ["Unspecified", "CRM", "Disease", "Procedure", "Drug"]
STOP = {"which", "and", "the", "of"}
EXAMPLES = [
    "Heart",
    "Lung",
    "Kidney",
    "Liver",
    "Femur",
    "Asthma",
    "Pneumonia",
    "DiabetesMellitus",
    "Appendicectomy",
    "Amifostine",
    "MyocardialInfarction",
    "PulmonaryAtresiaWithVentricularSeptalDefect",
    "Hypertension",
    "ThyroidGland",
    "Breast",
    "Aspirin",
    "Paracetamol",
    "FractureOfFemur",
    "Anaemia",
    "Anemia",
    "Drug",
    "BodyStructure",
    "Phenomenon",
]


def local_name(iri: str) -> str:
    if "#" in iri:
        return iri.rsplit("#", 1)[1]
    return iri.rstrip("/").rsplit("/", 1)[-1]


def is_generated(name: str) -> bool:
    """Long concatenated OWL expressions, not the short single-which parents."""
    w = name.count("which")
    return w >= 2 or (w >= 1 and len(name) >= 56)


def module_for(path: str) -> int:
    base = path.rsplit("/", 1)[-1]
    if base.startswith("OpenGALEN8_DS_") or "Surgical" in base:
        return 3
    drug_bits = ("Drug", "VMP", "BNF", "Interaction", "Formulation", "Component")
    if any(bit in base for bit in drug_bits):
        return 4
    if base.startswith("OpenGALEN8_DD_") or "Disease" in base:
        return 2
    return 1


def tokenize(s: str) -> list:
    out = []
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c.isspace():
            i += 1
            continue
        if c in "()":
            out.append(c)
            i += 1
            continue
        if c == "<":
            j = s.find(">", i + 1)
            if j < 0:
                break
            out.append(("iri", s[i + 1 : j]))
            i = j + 1
            continue
        if c == '"':
            i += 1
            buf = []
            while i < n:
                if s[i] == "\\" and i + 1 < n:
                    esc = s[i + 1]
                    buf.append({"n": "\n", "t": "\t", "r": "\r"}.get(esc, esc))
                    i += 2
                    continue
                if s[i] == '"':
                    i += 1
                    break
                buf.append(s[i])
                i += 1
            if s.startswith("^^", i):
                i += 2
                if i < n and s[i] == "<":
                    j = s.find(">", i + 1)
                    i = n if j < 0 else j + 1
                else:
                    while i < n and (s[i].isalnum() or s[i] in "_-:"):
                        i += 1
            out.append(("str", "".join(buf)))
            continue
        j = i
        while j < n and (s[j].isalnum() or s[j] in "_-:"):
            j += 1
        if j == i:
            i += 1
            continue
        out.append(("id", s[i:j]))
        i = j
    return out


def parse_expr(tokens: list, pos: int):
    tok = tokens[pos]
    if isinstance(tok, tuple) and tok[0] == "iri":
        return local_name(tok[1]), pos + 1
    if isinstance(tok, tuple) and tok[0] == "str":
        return tok[1], pos + 1
    if isinstance(tok, tuple) and tok[0] == "id":
        name = tok[1]
        pos += 1
        if pos < len(tokens) and tokens[pos] == "(":
            pos += 1
            args = []
            while pos < len(tokens) and tokens[pos] != ")":
                arg, pos = parse_expr(tokens, pos)
                args.append(arg)
            if pos < len(tokens) and tokens[pos] == ")":
                pos += 1
            return (name, args), pos
        return name, pos
    raise ValueError(f"bad token {tok!r}")


def paren(text: str) -> str:
    if text.startswith("(") and text.endswith(")"):
        return text
    if " " in text or " which " in text:
        return f"({text})"
    return text


def render(node) -> str:
    """Render an OWL class expression in a GRAIL-like 'which' notation."""
    if isinstance(node, str):
        return node
    if not isinstance(node, tuple) or len(node) != 2:
        return str(node)
    op, args = node
    if op == "ObjectIntersectionOf":
        somes = []
        others = []
        for arg in args:
            if isinstance(arg, tuple) and arg[0] in (
                "ObjectSomeValuesFrom",
                "ObjectAllValuesFrom",
                "ObjectHasValue",
                "DataHasValue",
                "DataSomeValuesFrom",
            ):
                somes.append(arg)
            else:
                others.append(render(arg))
        bits = []
        for arg in somes:
            kind, aargs = arg
            if kind in ("ObjectHasValue", "DataHasValue") and len(aargs) == 2:
                bits.append(f"{render(aargs[0])} value {paren(render(aargs[1]))}")
            elif len(aargs) >= 2:
                role = render(aargs[0])
                filler = paren(render(aargs[1]))
                if kind == "ObjectAllValuesFrom":
                    bits.append(f"only {role} {filler}")
                else:
                    bits.append(f"{role} {filler}")
        base = " and ".join(p for p in others if p)
        chain = " which ".join(bits)
        if base and chain:
            return f"{base} which {chain}"
        if chain and not base:
            return f"which {chain}"
        return base
    if op == "ObjectUnionOf":
        return " or ".join(paren(render(a)) for a in args)
    if op == "ObjectComplementOf" and args:
        return "not " + paren(render(args[0]))
    if op == "ObjectOneOf":
        return "one of {" + ", ".join(render(a) for a in args) + "}"
    if op in ("ObjectSomeValuesFrom", "ObjectAllValuesFrom") and len(args) >= 2:
        role = render(args[0])
        filler = paren(render(args[1]))
        if op == "ObjectAllValuesFrom":
            return f"only {role} {filler}"
        return f"{role} {filler}"
    rendered = ", ".join(render(a) for a in args)
    return f"{op}({rendered})" if args else op


def axiom_call(line: str):
    tokens = tokenize(line.strip())
    if not tokens:
        return None
    node, _pos = parse_expr(tokens, 0)
    return node


def gzip_bytes(data: bytes) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0, compresslevel=9) as gz:
        gz.write(data)
    return buf.getvalue()


def u32_bytes(nums) -> bytes:
    arr = array.array("I", nums)
    if sys.byteorder != "little":
        arr.byteswap()
    return arr.tobytes()


def camel_tokens(text: str) -> list[str]:
    spaced = text.replace("which", " ")
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", spaced)
    spaced = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", spaced)
    return [p for p in re.split(r"[^A-Za-z0-9]+", spaced.lower()) if len(p) >= 3 and p not in STOP]


def grail_body(text: str) -> str:
    parts = text.split(">>>>>>>>>>>>>>>>>>>><<<<<<<<<<<<<<<<<<<<")
    return parts[-1] if parts else text


ROLE_OPS = ("ObjectSomeValuesFrom", "ObjectAllValuesFrom", "ObjectHasValue")
BROAD_GROUPS = {
    "Attribute",
    "InverseAttribute",
    "DomainAttribute",
    "InverseDomainAttribute",
}


def top_restrictions(expr):
    """Role restrictions that belong to this expression, not to a nested filler."""
    if not isinstance(expr, tuple) or len(expr) != 2:
        return
    op, args = expr
    if op == "ObjectIntersectionOf":
        for arg in args:
            if isinstance(arg, tuple) and arg[0] in ROLE_OPS and len(arg[1]) >= 2 and isinstance(arg[1][0], str):
                yield arg[1][0], arg[1][1]
        return
    if op in ROLE_OPS and len(args) >= 2 and isinstance(args[0], str):
        yield args[0], args[1]


def named_target(node):
    """The concept a restriction points at.

    A named filler is that concept, including a generated which-class.
    A nested anonymous filler (hasConsequence (X which hasReversibility Reversible))
    points at the genus, which GALEN writes last in the intersection. The nested
    roles stay in the definition text rather than becoming extra edges.
    """
    if isinstance(node, str):
        return node
    if not isinstance(node, tuple) or len(node) != 2:
        return None
    op, args = node
    if op == "ObjectIntersectionOf":
        named = [arg for arg in args if isinstance(arg, str)]
        if named:
            return named[-1]
        for arg in args:
            if isinstance(arg, tuple) and arg[0] in ROLE_OPS and len(arg[1]) >= 2:
                found = named_target(arg[1][1])
                if found:
                    return found
        return None
    if op in ROLE_OPS and len(args) >= 2:
        return named_target(args[1])
    return None


def property_group(prop: str, parents: dict[str, set[str]]) -> str:
    """Attribute category used to group a role in the panel.

    LocativeAttribute groups hasSpecificLocation. ConstructiveAttribute is only
    used when nothing finer sits between the role and DomainAttribute.
    """
    chain = []
    seen = set()
    cursor = prop
    while cursor and cursor not in seen:
        seen.add(cursor)
        chain.append(cursor)
        ups = parents.get(cursor) or set()
        cursor = sorted(ups)[0] if ups else None
    coarse = {"ConstructiveAttribute", "InverseConstructiveAttribute"}
    fine = [name for name in chain if name.endswith("Attribute") and name not in BROAD_GROUPS and name not in coarse]
    if fine:
        return fine[-1]
    broader = [name for name in chain if name.endswith("Attribute") and name not in BROAD_GROUPS]
    if broader:
        return broader[-1]
    return prop


def qualifier_phrase(prop: str, value: str) -> str | None:
    if prop.startswith("S-SANCTION-") and prop.endswith("AP"):
        role = prop[len("S-SANCTION-") : -2]
        return f"sensibly {role} {value}"
    if prop.startswith("G-SANCTION-") and prop.endswith("AP"):
        role = prop[len("G-SANCTION-") : -2]
        return f"grammatically {role} {value}"
    return None


def load_dump(owl_zip: zipfile.ZipFile, bag: dict[str, str]):
    edges: set[tuple[str, str]] = set()
    equiv: set[tuple[str, str]] = set()
    n_implies = 0
    n_equiv = 0
    self_implies = 0
    with owl_zip.open(DUMP) as raw:
        for line in io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline=""):
            line = line.strip()
            if line.startswith("(implies "):
                n_implies += 1
                body = line[len("(implies ") : -1] if line.endswith(")") else line[len("(implies ") :]
                child, parent = body.split(" ", 1)
                child, parent = bag.setdefault(child, child), bag.setdefault(parent, parent)
                if child == parent:
                    self_implies += 1
                    continue
                edges.add((child, parent))
            elif line.startswith("(equivalent "):
                n_equiv += 1
                body = line[len("(equivalent ") : -1] if line.endswith(")") else line[len("(equivalent ") :]
                a, b = body.split(" ", 1)
                a, b = bag.setdefault(a, a), bag.setdefault(b, b)
                if a != b:
                    equiv.add((a, b) if a < b else (b, a))
    return edges, equiv, n_implies, n_equiv, self_implies


def load_owl(owl_zip: zipfile.ZipFile, bag: dict[str, str]):
    declared: dict[str, int] = {}
    n_decl_lines = 0
    n_eq_axioms = 0
    n_sub = 0
    n_rubric_lines = 0
    n_sanction_lines = 0
    n_label_lines = 0
    spot_asserted = False
    defs: dict[str, str] = {}
    equiv_names: dict[str, set[str]] = defaultdict(set)
    sanction: dict[str, str] = {}
    rubrics: dict[str, str] = {}
    labels: dict[str, str] = {}
    features: dict[str, str] = {}
    quals: dict[str, set[str]] = defaultdict(set)
    prop_parents: dict[str, set[str]] = defaultdict(set)
    role_edges: dict[str, set[tuple[str, str]]] = defaultdict(set)
    unknown_ops: Counter[str] = Counter()
    ann_fail = 0
    eq_fail = 0
    files = [
        n
        for n in owl_zip.namelist()
        if "/OWL-F/" in n and n.endswith(".owl") and not n.endswith("gosl.html")
    ]
    files.sort()
    for nth, name in enumerate(files, 1):
        mod = module_for(name)
        with owl_zip.open(name) as raw:
            for line in io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline=""):
                if line.startswith("Declaration(Class("):
                    n_decl_lines += 1
                    try:
                        node = axiom_call(line)
                    except Exception:
                        continue
                    # Declaration(Class(<iri>)) -> ("Declaration", [("Class", [name])])
                    cname = None
                    if isinstance(node, tuple) and node[0] == "Declaration" and node[1]:
                        inner = node[1][0]
                        if isinstance(inner, tuple) and inner[0] == "Class" and inner[1]:
                            cname = inner[1][0]
                        elif isinstance(inner, str):
                            cname = inner
                    if isinstance(cname, str):
                        cname = bag.setdefault(cname, cname)
                        declared.setdefault(cname, mod)
                    continue
                if line.startswith("SubObjectPropertyOf("):
                    try:
                        node = axiom_call(line)
                    except Exception:
                        continue
                    if isinstance(node, tuple) and node[0] == "SubObjectPropertyOf" and len(node[1]) >= 2:
                        child, parent = node[1][0], node[1][1]
                        if isinstance(child, str) and isinstance(parent, str):
                            prop_parents[child].add(parent)
                    continue
                if line.startswith("SubClassOf("):
                    n_sub += 1
                    if SPOT_CHILD in line and SPOT_PARENT in line:
                        spot_asserted = True
                    continue
                if line.startswith("EquivalentClasses("):
                    n_eq_axioms += 1
                    try:
                        node = axiom_call(line)
                    except Exception:
                        eq_fail += 1
                        continue
                    if not isinstance(node, tuple) or node[0] != "EquivalentClasses":
                        eq_fail += 1
                        continue
                    named = []
                    complex_text = ""
                    complex_node = None
                    for arg in node[1]:
                        if isinstance(arg, str):
                            named.append(bag.setdefault(arg, arg))
                        else:
                            if isinstance(arg, tuple):
                                unknown_ops[arg[0]] += 0
                                _count_ops(arg, unknown_ops)
                            rendered = render(arg)
                            if len(rendered) > len(complex_text):
                                complex_text = rendered
                                complex_node = arg
                    if complex_text.startswith("Object") or "Object" in complex_text[:40]:
                        pass
                    for i, cname in enumerate(named):
                        others = [o for o in named if o != cname]
                        equiv_names[cname].update(others)
                        if complex_text and len(complex_text) > len(defs.get(cname, "")):
                            defs[cname] = complex_text
                    if complex_node:
                        for role, filler in top_restrictions(complex_node):
                            target = named_target(filler)
                            if not target or target == role:
                                continue
                            for cname in named:
                                if cname != target:
                                    role_edges[cname].add((role, target))
                    continue
                if line.startswith("AnnotationAssertion("):
                    try:
                        node = axiom_call(line)
                    except Exception:
                        ann_fail += 1
                        continue
                    if not isinstance(node, tuple) or node[0] != "AnnotationAssertion" or len(node[1]) < 3:
                        ann_fail += 1
                        continue
                    prop, subj, val = node[1][0], node[1][1], node[1][2]
                    if not isinstance(prop, str) or not isinstance(subj, str):
                        ann_fail += 1
                        continue
                    subj = bag.setdefault(subj, subj)
                    value = val if isinstance(val, str) else render(val)
                    if prop == "SANCTION-LEVELAP":
                        n_sanction_lines += 1
                        if subj not in sanction:
                            sanction[subj] = value
                    elif prop == "hasDissectionRubricAP":
                        n_rubric_lines += 1
                        if subj not in rubrics or len(value) > len(rubrics[subj]):
                            rubrics[subj] = value
                    elif prop == "hasLanguageAnnotationAP":
                        n_label_lines += 1
                        if subj not in labels or len(value) < len(labels[subj]):
                            labels[subj] = value
                    elif prop == "hasDrugFeatureAP":
                        if " " in value and value.count("which") < 2 and len(value) <= 180:
                            features.setdefault(subj, value)
                    else:
                        phrase = qualifier_phrase(prop, value)
                        if phrase:
                            bucket = quals[subj]
                            if len(bucket) < 80:
                                bucket.add(phrase)
        if nth % 10 == 0 or nth == len(files):
            print(f"  owl {nth}/{len(files)} declarations {len(declared)}", flush=True)
    return {
        "declared": declared,
        "n_decl_lines": n_decl_lines,
        "n_eq_axioms": n_eq_axioms,
        "n_sub": n_sub,
        "spot_asserted": spot_asserted,
        "defs": defs,
        "equiv_names": equiv_names,
        "sanction": sanction,
        "rubrics": rubrics,
        "labels": labels,
        "features": features,
        "quals": quals,
        "unknown_ops": unknown_ops,
        "ann_fail": ann_fail,
        "eq_fail": eq_fail,
        "n_rubric_lines": n_rubric_lines,
        "n_sanction_lines": n_sanction_lines,
        "n_label_lines": n_label_lines,
        "prop_parents": prop_parents,
        "role_edges": role_edges,
    }


def _count_ops(node, counter: Counter) -> None:
    if isinstance(node, tuple) and len(node) == 2 and isinstance(node[0], str):
        counter[node[0]] += 1
        for arg in node[1]:
            _count_ops(arg, counter)


TOPIC_RE = re.compile(
    r"(?P<subj>[A-Za-z][A-Za-z0-9]*)\s+"
    r"(?P<qual>sensiblyAndTopicNecessarily|grammaticallyAndTopicNecessarily|topicNecessarily)\s+"
    r"(?P<role>[A-Za-z][A-Za-z0-9]*)\s+"
    r"(?P<obj>[A-Za-z][A-Za-z0-9]*)"
)
NAME_RE = re.compile(r"name\s+([A-Za-z][A-Za-z0-9]*)\s*\.")


def load_grail(grail_zip: zipfile.ZipFile):
    """GRAIL snippets stay keyed by source name and are attached later.

    They must not invent concepts: a GRAIL accessor that never became an OWL
    class is not a node in the published hierarchy.
    """
    snippets: dict[str, str] = {}
    topic: dict[str, set[str]] = defaultdict(set)
    files = [n for n in grail_zip.namelist() if n.endswith(".grl")]
    for name in files:
        text = grail_zip.read(name).decode("latin-1", errors="replace")
        body = grail_body(text)
        flat = re.sub(r"\s+", " ", body)
        for match in NAME_RE.finditer(flat):
            cname = match.group(1)
            start = max(0, match.start() - 320)
            snippet = flat[start : match.end()].strip()
            if len(snippet) > 420:
                snippet = snippet[-420:]
            prev = snippets.get(cname)
            if prev is None or len(snippet) > len(prev):
                snippets[cname] = snippet
        for match in TOPIC_RE.finditer(flat):
            cname = match.group("subj")
            phrase = f"{match.group('qual')} {match.group('role')} {match.group('obj')}"
            if len(topic[cname]) < 40:
                topic[cname].add(phrase)
    return snippets, topic


def break_cycles(parents: list[list[int]]) -> list[tuple[int, int]]:
    """Remove back-edges so the parent relation is a DAG. Iterative DFS."""
    n = len(parents)
    color = bytearray(n)
    removed: list[tuple[int, int]] = []
    for start in range(n):
        if color[start]:
            continue
        stack = [(start, 0)]
        color[start] = 1
        while stack:
            node, idx = stack[-1]
            plist = parents[node]
            if idx < len(plist):
                stack[-1] = (node, idx + 1)
                parent = plist[idx]
                if color[parent] == 1:
                    removed.append((node, parent))
                elif color[parent] == 0:
                    color[parent] = 1
                    stack.append((parent, 0))
            else:
                color[node] = 2
                stack.pop()
    if not removed:
        return []
    ban = set(removed)
    for node, plist in enumerate(parents):
        if any((node, parent) in ban for parent in plist):
            parents[node] = [parent for parent in plist if (node, parent) not in ban]
    return removed


def ancestor_count(parents: list[list[int]], start: int) -> int:
    seen: set[int] = set()
    stack = list(parents[start])
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        stack.extend(parents[node])
    return len(seen)


def choose_default(names: list[str], parents, children, gen: bytearray, id_of: dict[str, int]):
    """Pick a focus whose ancestor chain is deep enough to show a cluster."""
    prefer = [
        "Amifostine",
        "Asthma",
        "Appendicectomy",
        "Heart",
        "DiabetesMellitus",
        "PulmonaryAtresiaWithVentricularSeptalDefect",
        "Pneumonia",
        "Femur",
    ]
    present = []
    scored = []
    for name in EXAMPLES:
        if name not in id_of:
            continue
        i = id_of[name]
        anc = ancestor_count(parents, i)
        kids = len(children[i])
        present.append(name)
        scored.append((name, anc, kids, int(gen[i])))
        print(f"  example {name}: ancestors {anc}, children {kids}, generated {gen[i]}", flush=True)
    for name in prefer:
        row = next((item for item in scored if item[0] == name and not item[3]), None)
        if row and 6 <= row[1] <= 160 and row[2] >= 1:
            return name, present
    best_name = "TopCategory" if "TopCategory" in id_of else names[0]
    best_key = None
    for name, anc, kids, generated in scored:
        if generated or anc < 8 or kids < 1:
            continue
        key = (abs(anc - 36), -min(kids, 20), name)
        if best_key is None or key < best_key:
            best_key = key
            best_name = name
    return best_name, present


def write_graph(path: Path, names, parents, children, equiv, roots, mods, gen) -> None:
    n = len(names)
    name_parts = []
    name_off = [0]
    for name in names:
        blob = name.encode("utf-8")
        name_parts.append(blob)
        name_off.append(name_off[-1] + len(blob))
    par_off = [0]
    par_ids = []
    kid_off = [0]
    kid_ids = []
    eq_off = [0]
    eq_ids = []
    for i in range(n):
        par_ids.extend(parents[i])
        par_off.append(len(par_ids))
        kid_ids.extend(children[i])
        kid_off.append(len(kid_ids))
        eq_ids.extend(equiv[i])
        eq_off.append(len(eq_ids))
    header = struct_header(n, len(par_ids), len(eq_ids), name_off[-1], len(roots))
    parts = [
        header,
        u32_bytes(name_off),
        u32_bytes(par_off),
        u32_bytes(kid_off),
        u32_bytes(eq_off),
        u32_bytes(par_ids),
        u32_bytes(kid_ids),
        u32_bytes(eq_ids),
        u32_bytes(roots),
        bytes(mods),
        bytes(gen),
        b"".join(name_parts),
    ]
    path.write_bytes(gzip_bytes(b"".join(parts)))


def struct_header(n, n_edges, n_eq, name_bytes, n_roots) -> bytes:
    import struct

    return struct.pack("<4sIIIIIII", b"OG8G", 1, n, n_edges, n_eq, name_bytes, n_roots, 0)


def write_search(path: Path, postings: dict[str, list[int]]) -> None:
    import struct

    tokens = sorted(postings)
    parts_b = []
    token_off = [0]
    post_off = [0]
    posts: list[int] = []
    for token in tokens:
        blob = token.encode("utf-8")
        parts_b.append(blob)
        token_off.append(token_off[-1] + len(blob))
        ids = postings[token]
        posts.extend(ids)
        post_off.append(len(posts))
    header = struct.pack("<4sIIIII", b"SRCH", 1, len(tokens), len(posts), token_off[-1], 0)
    blob = b"".join(
        [
            header,
            u32_bytes(token_off),
            u32_bytes(post_off),
            u32_bytes(posts) if posts else b"",
            b"".join(parts_b),
        ]
    )
    path.write_bytes(gzip_bytes(blob))


def build(owl_path: Path, grail_path: Path, out_dir: Path, report_path: Path) -> dict:
    bag: dict[str, str] = {}
    print("reading hierarchy dump", flush=True)
    with zipfile.ZipFile(owl_path) as owl_zip:
        edges, equiv_pairs, n_implies, n_equiv_lines, self_implies = load_dump(owl_zip, bag)
        print(f"  implies {n_implies} unique {len(edges)} equiv lines {n_equiv_lines}", flush=True)
        print("reading OWL-F", flush=True)
        owl = load_owl(owl_zip, bag)
    print("reading GRAIL", flush=True)
    with zipfile.ZipFile(grail_path) as grail_zip:
        snippets, topic = load_grail(grail_zip)
    # Concepts are unique declared classes plus any name the hierarchy dump
    # uses. Duplicate Declaration lines (164,626 lines, fewer names) are a
    # known artefact of the OWL translation and are not extra concepts.
    # GRAIL-only accessors are not added.
    concept_names = set(owl["declared"])
    for child, parent in edges:
        concept_names.add(child)
        concept_names.add(parent)
    for a, b in equiv_pairs:
        concept_names.add(a)
        concept_names.add(b)
    names = sorted(concept_names, key=lambda s: (s.lower(), s))
    id_of = {name: i for i, name in enumerate(names)}
    n = len(names)
    print(f"concepts {n}", flush=True)

    parents: list[list[int]] = [[] for _ in range(n)]
    for child, parent in edges:
        parents[id_of[child]].append(id_of[parent])
    for i in range(n):
        if parents[i]:
            parents[i] = sorted(set(parents[i]))
    removed = break_cycles(parents)
    if removed:
        print(f"removed {len(removed)} cycle back-edges", flush=True)

    children: list[list[int]] = [[] for _ in range(n)]
    for i, plist in enumerate(parents):
        for parent in plist:
            children[parent].append(i)
    for i in range(n):
        if len(children[i]) > 1:
            children[i].sort(key=lambda j: names[j].lower())

    # Equivalents: dump pairs plus OWL named equivalences, closed by union-find.
    uf = list(range(n))

    def find(x: int) -> int:
        while uf[x] != x:
            uf[x] = uf[uf[x]]
            x = uf[x]
        return x

    def union(a: str, b: str) -> None:
        if a not in id_of or b not in id_of:
            return
        ra, rb = find(id_of[a]), find(id_of[b])
        if ra != rb:
            uf[rb] = ra

    for a, b in equiv_pairs:
        union(a, b)
    for cname, others in owl["equiv_names"].items():
        for other in others:
            union(cname, other)
    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        groups[find(i)].append(i)
    equiv: list[list[int]] = [[] for _ in range(n)]
    for members in groups.values():
        if len(members) < 2:
            continue
        members.sort(key=lambda j: names[j].lower())
        for i in members:
            equiv[i] = [j for j in members if j != i]

    mods = bytearray(n)
    for cname, mod in owl["declared"].items():
        mods[id_of[cname]] = mod
    gen = bytearray(n)
    for i, name in enumerate(names):
        if is_generated(name):
            gen[i] = 1

    defs = owl["defs"]
    # One-step copy when a named class only points at another defined class.
    borrowed: dict[str, str] = {}
    for i, name in enumerate(names):
        if defs.get(name):
            continue
        for j in equiv[i]:
            other = defs.get(names[j])
            if other:
                borrowed[name] = f"equivalent to {names[j]}: {other}"
                break

    out_dir.mkdir(parents=True, exist_ok=True)
    shard_dir = out_dir / "d"
    if shard_dir.exists():
        for old in shard_dir.glob("*.json.gz"):
            old.unlink()
    shard_dir.mkdir(exist_ok=True)
    shard_bufs: dict[int, dict] = defaultdict(dict)
    n_def = 0
    for i, name in enumerate(names):
        rec = {}
        definition = defs.get(name) or borrowed.get(name)
        if definition:
            if len(definition) > 1800:
                definition = definition[:1799] + "…"
            rec["d"] = definition
        level = owl["sanction"].get(name)
        if level:
            rec["s"] = level.lower()
        rubric = owl["rubrics"].get(name)
        if rubric:
            rec["r"] = rubric
        label = owl["labels"].get(name)
        if label:
            rec["l"] = label
        feature = owl["features"].get(name)
        if feature:
            rec["f"] = feature
        phrases = set(owl["quals"].get(name, ()))
        phrases.update(topic.get(name, ()))
        if phrases:
            rec["q"] = sorted(phrases)[:60]
        snippet = snippets.get(name)
        if snippet:
            rec["g"] = snippet
        if not rec:
            continue
        n_def += 1
        shard_bufs[i // SHARD][str(i)] = rec
    for sid, payload in shard_bufs.items():
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        (shard_dir / f"{sid:04d}.json.gz").write_bytes(gzip_bytes(raw))

    print("writing relationship shards", flush=True)
    prop_parents = owl["prop_parents"]

    def skip_role(role: str) -> bool:
        if "Dissection" in role or role in {"hasReadCode", "hasLanguageAnnotation", "hasCategoryString", "hasPrecedence"}:
            return True
        seen = set()
        cursor = role
        while cursor and cursor not in seen:
            seen.add(cursor)
            if "Dissection" in cursor or cursor == "ApplicationAttribute":
                return True
            ups = prop_parents.get(cursor) or set()
            cursor = sorted(ups)[0] if ups else None
        return False

    used_props = sorted({role for pairs in owl["role_edges"].values() for role, _target in pairs if not skip_role(role)})
    group_name = {prop: property_group(prop, prop_parents) for prop in used_props}
    group_list = sorted(set(group_name.values()))
    group_index = {name: i for i, name in enumerate(group_list)}
    prop_index = {prop: i for i, prop in enumerate(used_props)}
    props_doc = {
        "groups": group_list,
        "props": [{"n": prop, "g": group_index[group_name[prop]]} for prop in used_props],
    }
    (out_dir / "props.json.gz").write_bytes(
        gzip_bytes(json.dumps(props_doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    )
    rel_dir = out_dir / "r"
    if rel_dir.exists():
        for old in rel_dir.glob("*.json.gz"):
            old.unlink()
    rel_dir.mkdir(exist_ok=True)
    rel_bufs: dict[int, dict] = defaultdict(dict)
    n_rel = 0
    n_rel_concepts = 0
    for cname, pairs in owl["role_edges"].items():
        if cname not in id_of:
            continue
        rows = []
        seen_row = set()
        for role, target in pairs:
            if skip_role(role) or target not in id_of or target == cname:
                continue
            row = (prop_index[role], id_of[target])
            if row in seen_row:
                continue
            seen_row.add(row)
            rows.append(list(row))
        if not rows:
            continue
        rows.sort()
        cid = id_of[cname]
        rel_bufs[cid // SHARD][str(cid)] = rows
        n_rel += len(rows)
        n_rel_concepts += 1
    for sid, payload in rel_bufs.items():
        raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        (rel_dir / f"{sid:04d}.json.gz").write_bytes(gzip_bytes(raw))
    rel_bytes = sum(p.stat().st_size for p in rel_dir.glob("*.json.gz"))
    props_bytes = (out_dir / "props.json.gz").stat().st_size
    print(f"  relationship edges {n_rel} on {n_rel_concepts} concepts, {len(group_list)} groups, {props_bytes+rel_bytes} bytes", flush=True)

    labels_out = {str(id_of[name]): text for name, text in owl["labels"].items() if name in id_of}
    (out_dir / "labels.json.gz").write_bytes(
        gzip_bytes(json.dumps(labels_out, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    )

    roots = [i for i in range(n) if not parents[i]]
    roots.sort(key=lambda i: names[i].lower())
    graph_path = out_dir / "graph.bin.gz"
    write_graph(graph_path, names, parents, children, equiv, roots, mods, gen)

    print("building search index", flush=True)
    postings: dict[str, list[int]] = defaultdict(list)
    seen_tok: dict[str, set[int]] = defaultdict(set)

    def add_tokens(text: str, idx: int) -> None:
        for token in camel_tokens(text):
            if idx in seen_tok[token]:
                continue
            seen_tok[token].add(idx)
            postings[token].append(idx)

    for i, name in enumerate(names):
        add_tokens(name, i)
        label = owl["labels"].get(name)
        if label:
            add_tokens(label, i)
        rubric = owl["rubrics"].get(name)
        if rubric:
            add_tokens(rubric, i)
    for ids in postings.values():
        ids.sort()
    search_path = out_dir / "search.bin.gz"
    write_search(search_path, postings)

    default, present = choose_default(names, parents, children, gen, id_of)
    n_generated = sum(gen)
    def reaches(child: str, parent: str) -> bool:
        if child not in id_of or parent not in id_of:
            return False
        target = id_of[parent]
        seen: set[int] = set()
        stack = list(parents[id_of[child]])
        while stack:
            node = stack.pop()
            if node in seen:
                continue
            seen.add(node)
            if node == target:
                return True
            stack.extend(parents[node])
        return False

    direct_ok = (
        "PulmonaryAtresia" in id_of
        and "CongenitalPathologywhichinvolvesHeartChamber" in id_of
        and id_of["CongenitalPathologywhichinvolvesHeartChamber"] in parents[id_of["PulmonaryAtresia"]]
    )
    transitive_ok = reaches(SPOT_CHILD, SPOT_PARENT)
    removed_names = [(names[c], names[p]) for c, p in removed]

    def sz(path: Path) -> int:
        return path.stat().st_size

    shard_bytes = sum(p.stat().st_size for p in shard_dir.glob("*.json.gz"))
    checks = []

    def check(ok: bool, label: str) -> None:
        checks.append((ok, label))
        print(("OK  " if ok else "FAIL") + " " + label, flush=True)

    check(n_implies == EXPECT_IMPLIES, f"implies lines {n_implies} (expected {EXPECT_IMPLIES})")
    check(n_equiv_lines == EXPECT_EQUIV, f"equivalent lines {n_equiv_lines} (expected {EXPECT_EQUIV})")
    check(
        owl["n_decl_lines"] == EXPECT_CLASSES,
        f"class declaration lines {owl['n_decl_lines']} (expected {EXPECT_CLASSES})",
    )
    check(
        120_000 <= len(owl["declared"]) <= EXPECT_CLASSES,
        f"unique class names {len(owl['declared'])} from {owl['n_decl_lines']} declaration lines (duplicates are a translation artefact)",
    )
    check(owl["n_eq_axioms"] == EXPECT_EQ_AXIOMS, f"EquivalentClasses axioms {owl['n_eq_axioms']} (expected {EXPECT_EQ_AXIOMS})")
    check(owl["n_sub"] == EXPECT_SUB, f"SubClassOf axioms {owl['n_sub']} (expected {EXPECT_SUB})")
    check(direct_ok, "PulmonaryAtresia implies CongenitalPathologywhichinvolvesHeartChamber")
    check(
        transitive_ok,
        f"{SPOT_CHILD} has ancestor {SPOT_PARENT} (inferred, not a direct dump line)",
    )
    check(not owl["spot_asserted"], f"{SPOT_CHILD} / {SPOT_PARENT} is not an asserted SubClassOf")
    # The published dump contains 8 implies-cycles. They are dropped so the
    # browser can lay the neighbourhood out as a DAG. A change in the count
    # means the dump parse or the cycle finder moved.
    check(len(removed) == 8, f"known cyclic implies edges dropped: {len(removed)} (expected 8)")

    meta = {
        "name": "OpenGALEN 8",
        "dump": DUMP.split("/")[-1],
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "shardSize": SHARD,
        "modules": MOD_NAME,
        "defaultConcept": default,
        "examples": present,
        "acknowledgement": (
            "This product uses the OpenGALEN Clinical Terminology, Copyright the "
            "Universities of Manchester and Nijmegen, licensed through OpenGALEN "
            "(www.opengalen.org). "
            "(now mirrored at https://opengalen.eggbird.eu/, contact mailto:eh@eggbird.eu, "
            "and archived at the Internet Archive: https://web.archive.org/web/*/opengalen.org)"
        ),
        "counts": {
            "concepts": n,
            "declaredClasses": len(owl["declared"]),
            "declarationLines": owl["n_decl_lines"],
            "impliesLines": n_implies,
            "uniqueParentLinks": sum(len(p) for p in parents),
            "selfImplies": self_implies,
            "equivalentLines": n_equiv_lines,
            "equivalentPairsInDump": len(equiv_pairs),
            "conceptsWithEquivalents": sum(1 for row in equiv if row),
            "generated": n_generated,
            "roots": len(roots),
            "definitions": n_def,
            "rubrics": len(owl["rubrics"]),
            "rubricLines": owl["n_rubric_lines"],
            "sanctions": len(owl["sanction"]),
            "sanctionLines": owl["n_sanction_lines"],
            "labelLines": owl["n_label_lines"],
            "roleSanctions": sum(len(v) for v in owl["quals"].values()),
            "labels": len(owl["labels"]),
            "grailSnippets": len(snippets),
            "topicQualifiers": sum(len(v) for v in topic.values()),
            "equivalentClassAxioms": owl["n_eq_axioms"],
            "subClassAxioms": owl["n_sub"],
            "searchTokens": len(postings),
            "shards": len(shard_bufs),
            "relationshipEdges": n_rel,
            "conceptsWithRelationships": n_rel_concepts,
            "relationshipGroups": len(group_list),
        },
        "files": {
            "graph": "graph.bin.gz",
            "search": "search.bin.gz",
            "labels": "labels.json.gz",
            "definitions": "d/{shard}.json.gz",
            "properties": "props.json.gz",
            "relationships": "r/{shard}.json.gz",
        },
        "bytes": {
            "graph": sz(graph_path),
            "search": sz(search_path),
            "labels": sz(out_dir / "labels.json.gz"),
            "definitions": shard_bytes,
            "properties": props_bytes,
            "relationships": rel_bytes,
        },
        "checks": [{"ok": ok, "label": label} for ok, label in checks],
        "parseNotes": {
            "annotationLinesUnparsed": owl["ann_fail"],
            "equivalentLinesUnparsed": owl["eq_fail"],
            "topConstructors": owl["unknown_ops"].most_common(12),
        },
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    (out_dir / "NOTICE.txt").write_text(
        "Derived from OpenGALEN 8 under the GALEN Open Source License.\n"
        "Copyright the Universities of Manchester and Nijmegen.\n"
        "Built by build/og8_extract.py. See the repository NOTICE and README.\n"
        + meta["acknowledgement"]
        + "\n",
        encoding="utf-8",
    )

    lines = [
        "# OpenGALEN 8 extraction checks",
        "",
        f"Built {meta['built']}.",
        "",
        "## Counts",
        "",
        "| Check | Result |",
        "|---|---|",
    ]
    for ok, label in checks:
        lines.append(f"| {'pass' if ok else 'FAIL'} | {label} |")
    lines += [
        "",
        "## Sizes",
        "",
        f"- graph.bin.gz: {sz(graph_path):,} bytes",
        f"- search.bin.gz: {sz(search_path):,} bytes",
        f"- labels.json.gz: {sz(out_dir / 'labels.json.gz'):,} bytes",
        f"- definition shards: {len(shard_bufs)} files, {shard_bytes:,} bytes",
        f"- props.json.gz: {props_bytes:,} bytes",
        f"- relationship shards: {len(list(rel_dir.glob('*.json.gz')))} files, {rel_bytes:,} bytes, {n_rel:,} edges on {n_rel_concepts:,} concepts in {len(group_list)} groups",
        f"- concepts in the browser graph: {n:,} (declarations plus any dump-only names)",
        f"- generated names hidden by default: {n_generated:,}",
        f"- default concept: `{default}`",
        "",
        "The plan's class count, 164,626, is the number of `Declaration(Class …)` lines. "
        f"Those lines name {len(owl['declared']):,} unique classes; the OWL release notes say duplicate declarations are translation artefacts. "
        f"The browser graph has {n:,} concepts (unique declarations plus dump names that were not declared).",
        "",
        f"Dissection-rubric annotation lines: {owl['n_rubric_lines']:,} "
        f"({len(owl['rubrics']):,} concepts). "
        f"Sanction-level lines: {owl['n_sanction_lines']:,} "
        f"({len(owl['sanction']):,} concepts). "
        f"Language-annotation lines: {owl['n_label_lines']:,} "
        f"({len(owl['labels']):,} concepts).",
        "",
        "Parent links stored in the graph are unique. "
        f"The dump has {n_implies:,} implies lines, {len(edges):,} unique pairs, and {self_implies:,} self-implies that are ignored. "
        "Eight implies-cycles in the published dump are dropped so the neighbourhood can be drawn as a DAG:",
        "",
    ]
    for child, parent in removed_names:
        lines.append(f"- `{child}` implies `{parent}` (edge dropped)")
    lines += [
        "",
        f"`{SPOT_CHILD}` is not a direct child of `{SPOT_PARENT}` in the dump. "
        "Walking parents does reach that concept, and no OWL `SubClassOf` axiom states the pair. "
        "Direct spot-check: `PulmonaryAtresia` implies `CongenitalPathologywhichinvolvesHeartChamber`.",
        "",
    ]
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines), encoding="utf-8")
    failed = [label for ok, label in checks if not ok]
    if failed:
        print("FAILED CHECKS:", file=sys.stderr)
        for label in failed:
            print(" -", label, file=sys.stderr)
        return meta | {"ok": False}
    print("all checks passed", flush=True)
    return meta | {"ok": True}


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--owl", type=Path, default=root / "sources/opengalen8-owl-sources.zip")
    ap.add_argument("--grail", type=Path, default=root / "sources/opengalen8-ascii-sources.zip")
    ap.add_argument("--out", type=Path, default=root / "site/data")
    ap.add_argument("--report", type=Path, default=root / "build/VALIDATION.md")
    args = ap.parse_args()
    meta = build(args.owl, args.grail, args.out, args.report)
    return 0 if meta.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
