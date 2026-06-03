#!/usr/bin/env python3
"""Extract text/tables from a .hwpx into Markdown or HTML (stdlib only).

Tables are emitted as HTML ``<table>`` with ``colspan``/``rowspan`` (not Markdown
pipe tables) so merged and nested tables survive the round-trip — Markdown
renderers display inline HTML tables fine. Plain paragraphs become Markdown
lines / ``<p>`` blocks.

    python3 scripts/extract_text.py document.hwpx                # markdown to stdout
    python3 scripts/extract_text.py document.hwpx -o out.md
    python3 scripts/extract_text.py document.hwpx --format html -o out.html
"""

from __future__ import annotations

import argparse
import html
import os
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from hwpx_common import (  # noqa: E402
    children_local,
    find_local,
    is_hwpx,
    local_name,
    safe_fromstring,
)


def _run_children(paragraph: ET.Element):
    """Yield, in document order, the meaningful children of a paragraph's runs.

    Only direct children of <hp:run> are considered so nested-table text is not
    double-counted at the outer level.
    """
    for child in paragraph:
        if local_name(child.tag) == "run":
            for node in child:
                yield node


def _paragraph_text(paragraph: ET.Element) -> str:
    """Concatenate this paragraph's own text (excludes nested table text)."""
    parts: list[str] = []
    for node in _run_children(paragraph):
        ln = local_name(node.tag)
        if ln == "t":
            parts.append("".join(node.itertext()))
        elif ln in ("tab",):
            parts.append("\t")
    return "".join(parts)


def _direct_tables(paragraph: ET.Element) -> list[ET.Element]:
    return [n for n in _run_children(paragraph) if local_name(n.tag) == "tbl"]


def _cell_blocks_md(tc: ET.Element) -> str:
    sublist = find_local(tc, "subList")
    if sublist is None:
        return ""
    return _render_blocks([p for p in children_local(sublist, "p")], fmt="html").strip()


def _render_table_html(tbl: ET.Element) -> str:
    rows_html: list[str] = []
    for tr in children_local(tbl, "tr"):
        cells_html: list[str] = []
        for tc in children_local(tr, "tc"):
            span = find_local(tc, "cellSpan")
            colspan = int(span.get("colSpan", "1")) if span is not None else 1
            rowspan = int(span.get("rowSpan", "1")) if span is not None else 1
            attrs = ""
            if colspan > 1:
                attrs += f' colspan="{colspan}"'
            if rowspan > 1:
                attrs += f' rowspan="{rowspan}"'
            content = _cell_blocks_md(tc)
            cells_html.append(f"<td{attrs}>{content}</td>")
        rows_html.append("<tr>" + "".join(cells_html) + "</tr>")
    return "<table>" + "".join(rows_html) + "</table>"


def _render_blocks(paragraphs: list[ET.Element], fmt: str) -> str:
    """Render a list of paragraphs (and the tables they host) to md/html."""
    out: list[str] = []
    for p in paragraphs:
        text = _paragraph_text(p)
        if text.strip():
            out.append(html.escape(text) if fmt == "html" else text)
        elif fmt == "html":
            out.append("")
        for tbl in _direct_tables(p):
            out.append(_render_table_html(tbl))
    if fmt == "html":
        rendered = []
        for block in out:
            if block.startswith("<table>"):
                rendered.append(block)
            elif block:
                rendered.append(f"<p>{block}</p>")
        return "\n".join(rendered)
    # markdown: blank line between blocks, tables inline as HTML
    return "\n\n".join(b for b in out if b)


def _iter_sections(path: str | Path):
    with zipfile.ZipFile(path) as zf:
        names = [n for n in zf.namelist() if n.startswith("Contents/section") and n.endswith(".xml")]

        def order(n: str) -> int:
            digits = "".join(ch for ch in Path(n).stem if ch.isdigit())
            return int(digits) if digits else 0

        for name in sorted(names, key=order):
            yield safe_fromstring(zf.read(name))


def extract(path: str | Path, fmt: str = "markdown") -> str:
    blocks: list[str] = []
    for sec in _iter_sections(path):
        paras = children_local(sec, "p")
        rendered = _render_blocks(paras, fmt)
        if rendered:
            blocks.append(rendered)
    body = ("\n\n" if fmt == "markdown" else "\n").join(blocks)
    if fmt == "html":
        return (
            '<!DOCTYPE html>\n<html lang="ko"><head><meta charset="utf-8"></head>\n'
            f"<body>\n{body}\n</body></html>\n"
        )
    return body + "\n" if body else ""


def paragraph_texts(path: str | Path) -> list[str]:
    """Top-level (non-table) paragraph texts in reading order — for round-trip."""
    texts: list[str] = []
    for sec in _iter_sections(path):
        for p in children_local(sec, "p"):
            texts.append(_paragraph_text(p))
    return texts


def extract_tables(path: str | Path) -> list[dict]:
    """Structured table data for verification (recurses into nested tables)."""

    def grab(tbl: ET.Element) -> dict:
        cells = []
        for tr in children_local(tbl, "tr"):
            for tc in children_local(tr, "tc"):
                addr = find_local(tc, "cellAddr")
                span = find_local(tc, "cellSpan")
                sub = find_local(tc, "subList")
                nested = []
                text_parts = []
                if sub is not None:
                    for p in children_local(sub, "p"):
                        text_parts.append(_paragraph_text(p))
                        nested.extend(grab(t) for t in _direct_tables(p))
                cells.append(
                    {
                        "col": int(addr.get("colAddr", "0")) if addr is not None else 0,
                        "row": int(addr.get("rowAddr", "0")) if addr is not None else 0,
                        "colSpan": int(span.get("colSpan", "1")) if span is not None else 1,
                        "rowSpan": int(span.get("rowSpan", "1")) if span is not None else 1,
                        "text": "\n".join(text_parts),
                        "tables": nested,
                    }
                )
        return {
            "rowCnt": int(tbl.get("rowCnt", "0")),
            "colCnt": int(tbl.get("colCnt", "0")),
            "cells": cells,
        }

    tables: list[dict] = []
    for sec in _iter_sections(path):
        for p in children_local(sec, "p"):
            tables.extend(grab(t) for t in _direct_tables(p))
    return tables


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract HWPX text/tables")
    parser.add_argument("input_file", help="HWPX file")
    parser.add_argument("-o", "--output", help="output file (default: stdout)")
    parser.add_argument(
        "--format", choices=["markdown", "html"], default="markdown", help="output format"
    )
    args = parser.parse_args()

    if not is_hwpx(args.input_file):
        print(f"Error: {args.input_file} is not a valid HWPX package")
        sys.exit(1)

    result = extract(args.input_file, fmt=args.format)
    if args.output:
        Path(args.output).write_text(result, encoding="utf-8")
        print(f"Extracted {args.input_file} -> {args.output} ({args.format})")
    else:
        sys.stdout.write(result)
