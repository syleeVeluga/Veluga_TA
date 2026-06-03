#!/usr/bin/env python3
"""Stdlib (no-dependency) table builder via prototype cloning (spec §5.4 path 2).

We never assemble table XML from zero — that would break the ``borderFillIDRef`` /
``charPrIDRef`` / ``paraPrIDRef`` references into ``header.xml``. Instead we clone
a fully-styled cell out of ``templates/table_proto.hwpx`` and re-grid it to the
requested dimensions, recomputing ``cellAddr`` / ``cellSpan`` / ``cellSz`` and
omitting cells absorbed by a merge.

This path covers simple/merged N×M tables. Nested tables and rich form-fill are
better served by ``python-hwpx`` (see ``build_table.py``), which this module
falls back from gracefully.
"""

from __future__ import annotations

import copy
import xml.etree.ElementTree as ET
from pathlib import Path

from hwpx_common import (
    children_local,
    find_local,
    local_name,
    namespaces_of,
    register_all,
    section_files,
    serialize,
)

TABLE_W = 42520  # must match build_templates.py
ROW_H = 2835


class TableSpecError(ValueError):
    """Raised when a table/merge specification is internally inconsistent."""


def _qname(ns: dict[str, str], local: str) -> str:
    hp = ns.get("hp", "http://www.hancom.co.kr/hwpml/2011/paragraph")
    return f"{{{hp}}}{local}"


def _set_attr(el: ET.Element, name: str, value) -> None:
    el.set(name, str(value))


def _cell_paragraphs(tc: ET.Element, text: str, ns: dict[str, str]) -> None:
    """Set a cell's text, splitting on newlines into separate <hp:p> elements.

    The cloned cell already contains exactly one styled paragraph; we use it as
    the prototype, set the first line, then clone it for any extra lines.
    """
    sublist = find_local(tc, "subList")
    if sublist is None:
        return
    paras = children_local(sublist, "p")
    if not paras:
        return
    proto_p = paras[0]
    # Remove any paragraphs beyond the prototype so refills are idempotent.
    for extra in paras[1:]:
        sublist.remove(extra)

    lines = text.split("\n") if text else [""]

    def _set_line(p: ET.Element, line: str) -> None:
        t = next((e for e in p.iter() if local_name(e.tag) == "t"), None)
        if t is None:
            run = next((e for e in p.iter() if local_name(e.tag) == "run"), None)
            if run is None:
                return
            t = ET.SubElement(run, _qname(ns, "t"))
        t.text = line

    _set_line(proto_p, lines[0])
    insert_at = list(sublist).index(proto_p) + 1
    for line in lines[1:]:
        clone = copy.deepcopy(proto_p)
        _set_line(clone, line)
        sublist.insert(insert_at, clone)
        insert_at += 1


def _normalise_merges(rows: int, cols: int, merges):
    """Return ``{(row, col): (rowSpan, colSpan)}`` and an occupancy grid.

    Validates that merges stay in bounds and never overlap.
    """
    anchors: dict[tuple[int, int], tuple[int, int]] = {}
    occupied = [[False] * cols for _ in range(rows)]
    for m in merges or []:
        r, c = int(m["row"]), int(m["col"])
        rs, cs = int(m.get("rowSpan", 1)), int(m.get("colSpan", 1))
        if rs < 1 or cs < 1:
            raise TableSpecError(f"merge span must be >= 1 at ({r},{c})")
        if r < 0 or c < 0 or r + rs > rows or c + cs > cols:
            raise TableSpecError(f"merge ({r},{c}) span {rs}x{cs} out of {rows}x{cols} bounds")
        for rr in range(r, r + rs):
            for cc in range(c, c + cs):
                if occupied[rr][cc]:
                    raise TableSpecError(f"overlapping merge at cell ({rr},{cc})")
                occupied[rr][cc] = True
        anchors[(r, c)] = (rs, cs)
    return anchors, occupied


def _set_cell_table(tc: ET.Element, nested_tbl: ET.Element) -> None:
    """Embed a nested table inside a cell's lead paragraph run, after its text."""
    sublist = find_local(tc, "subList")
    if sublist is None:
        return
    paras = children_local(sublist, "p")
    if not paras:
        return
    run = next((e for e in paras[0].iter() if local_name(e.tag) == "run"), None)
    if run is not None:
        run.append(nested_tbl)


def build_tbl(proto_tbl: ET.Element, rows, cols, cells, merges, ns):
    """Clone ``proto_tbl`` into a fresh tbl of the requested grid + content."""
    if rows < 1 or cols < 1:
        raise TableSpecError("rows and cols must be >= 1")

    anchors, _ = _normalise_merges(rows, cols, merges)

    # Prototype cell = the first styled <hp:tc> in the prototype table.
    proto_tr = children_local(proto_tbl, "tr")[0]
    proto_tc = children_local(proto_tr, "tc")[0]

    tbl = copy.deepcopy(proto_tbl)
    # Drop the prototype's rows; we rebuild them.
    for tr in children_local(tbl, "tr"):
        tbl.remove(tr)

    _set_attr(tbl, "rowCnt", rows)
    _set_attr(tbl, "colCnt", cols)
    sz = find_local(tbl, "sz")
    cell_w = TABLE_W // cols
    if sz is not None:
        _set_attr(sz, "width", TABLE_W)
        _set_attr(sz, "height", ROW_H * rows)

    occupied = [[False] * cols for _ in range(rows)]
    for (ar, ac), (rs, cs) in anchors.items():
        for rr in range(ar, ar + rs):
            for cc in range(ac, ac + cs):
                if (rr, cc) != (ar, ac):
                    occupied[rr][cc] = True

    tr_index = list(tbl).index(find_local(tbl, "inMargin")) + 1 if find_local(tbl, "inMargin") is not None else len(list(tbl))
    for r in range(rows):
        tr = ET.Element(proto_tr.tag)
        for c in range(cols):
            if occupied[r][c]:
                continue  # absorbed by a merge anchor — omit the cell
            rs, cs = anchors.get((r, c), (1, 1))
            tc = copy.deepcopy(proto_tc)
            addr = find_local(tc, "cellAddr")
            if addr is not None:
                _set_attr(addr, "colAddr", c)
                _set_attr(addr, "rowAddr", r)
            span = find_local(tc, "cellSpan")
            if span is not None:
                _set_attr(span, "colSpan", cs)
                _set_attr(span, "rowSpan", rs)
            csz = find_local(tc, "cellSz")
            if csz is not None:
                _set_attr(csz, "width", cell_w * cs)
                _set_attr(csz, "height", ROW_H * rs)
            val = cells[r][c] if cells and r < len(cells) and c < len(cells[r]) else None
            if isinstance(val, dict) and "table" in val:
                # Nested table (표 안의 표): recurse, then embed in the cell run.
                # The nested grid is sized against the page-width constant TABLE_W
                # rather than the host cell's width, so its absolute widths are an
                # approximation — visual fidelity is best-effort (SKILL.md §limits);
                # 한/글 reflows nested tables to the cell on open.
                nt = val["table"]
                nested = build_tbl(
                    proto_tbl, int(nt["rows"]), int(nt["cols"]), nt.get("cells"), nt.get("merges"), ns
                )
                _set_cell_table(tc, nested)
            else:
                _cell_paragraphs(tc, "" if val is None else str(val), ns)
            tr.append(tc)
        tbl.insert(tr_index, tr)
        tr_index += 1
    return tbl


def build_table_document(
    proto_path: str | Path,
    *,
    rows: int,
    cols: int,
    cells=None,
    merges=None,
    title: str | None = None,
):
    """Return new section0.xml bytes for ``table_proto.hwpx`` resized + filled.

    The caller copies the rest of the prototype package verbatim and swaps in
    these bytes, preserving all header.xml style references. When ``title`` is
    given it is written into the section's first (lead) paragraph.
    """
    proto = Path(proto_path)
    import zipfile

    with zipfile.ZipFile(proto) as zf:
        section_name = next(
            (n for n in zf.namelist() if n.startswith("Contents/section") and n.endswith(".xml")),
            "Contents/section0.xml",
        )
        section_bytes = zf.read(section_name)

    ns = namespaces_of(section_bytes)
    register_all(ns)
    root = ET.fromstring(section_bytes)
    proto_tbl = next((e for e in root.iter() if local_name(e.tag) == "tbl"), None)
    if proto_tbl is None:
        raise TableSpecError("prototype section has no <hp:tbl> to clone")

    if title:
        lead = children_local(root, "p")
        if lead:
            t = next((e for e in lead[0].iter() if local_name(e.tag) == "t"), None)
            if t is not None:
                t.text = title

    new_tbl = build_tbl(proto_tbl, rows, cols, cells, merges, ns)
    # Replace the prototype table in-place (find its parent run).
    for parent in root.iter():
        for idx, child in enumerate(list(parent)):
            if child is proto_tbl:
                parent.remove(child)
                parent.insert(idx, new_tbl)
                return serialize(root)
    raise TableSpecError("could not locate prototype table parent")


def write_table_document(
    proto_path: str | Path,
    out_path: str | Path,
    *,
    rows: int,
    cols: int,
    cells=None,
    merges=None,
    title: str | None = None,
) -> None:
    """Build a single-table .hwpx by cloning the prototype package (stdlib path)."""
    from hwpx_common import rewrite_package
    import zipfile

    proto = Path(proto_path)
    new_section = build_table_document(
        proto, rows=rows, cols=cols, cells=cells, merges=merges, title=title
    )
    with zipfile.ZipFile(proto) as zf:
        section_name = next(
            n for n in zf.namelist() if n.startswith("Contents/section") and n.endswith(".xml")
        )
    rewrite_package(proto, out_path, {section_name: new_section})


def set_cell_text(tc: ET.Element, text: str, ns: dict[str, str]) -> None:
    """Public alias: set a cell's text (newline-aware). Used by fill_form."""
    _cell_paragraphs(tc, text, ns)


def index_cells(tbl: ET.Element):
    """Map grid ``(row, col) -> <hp:tc>`` for present (non-absorbed) cells."""
    index: dict[tuple[int, int], ET.Element] = {}
    for tr in children_local(tbl, "tr"):
        for tc in children_local(tr, "tc"):
            addr = find_local(tc, "cellAddr")
            if addr is None:
                continue
            index[(int(addr.get("rowAddr", "0")), int(addr.get("colAddr", "0")))] = tc
    return index


def cell_text(tc: ET.Element) -> str:
    sub = find_local(tc, "subList")
    if sub is None:
        return ""
    parts = []
    for p in children_local(sub, "p"):
        for el in p.iter():
            if local_name(el.tag) == "t":
                parts.append("".join(el.itertext()))
    return "".join(parts)
