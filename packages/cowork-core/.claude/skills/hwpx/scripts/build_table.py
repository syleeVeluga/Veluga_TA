#!/usr/bin/env python3
"""Create a .hwpx containing an N×M table, with optional merges and a title.

Engine selection (spec §3 / §5.4):
  * For flat (simple / merged) tables, if ``python-hwpx`` (Apache-2.0,
    pure-Python + lxml) is installed it owns the cellAddr/cellSpan/cellSz
    arithmetic and header.xml reference integrity — the robust path.
  * The dependency-free prototype-clone path (``hwpx_table``) covers simple,
    merged AND nested N×M tables. Specs containing nested tables
    (``{"table": {...}}`` cell values) always take this path, because the
    python-hwpx wrapper here only writes flat cell text.

Table spec is JSON (file via --spec, or inline via --spec-json):

    {
      "title": "사업 개요",
      "rows": 3, "cols": 4,
      "cells": [["성명","홍길동","소속","플랫폼팀"], ["기간","2026","예산","12억"]],
      "merges": [{"row": 0, "col": 0, "rowSpan": 1, "colSpan": 4}]
    }

    python3 scripts/build_table.py out.hwpx --spec table.json
    python3 scripts/build_table.py out.hwpx --rows 3 --cols 4
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

TEMPLATES = Path(__file__).resolve().parent.parent / "templates"


def _build_with_python_hwpx(out_path: str, spec: dict) -> str:
    """Best-effort python-hwpx path. Method names per its README (spec §5.4 ⚠️).

    Wrapped defensively: any API mismatch raises and the caller falls back to the
    stdlib engine, so a different python-hwpx version never breaks table output.
    """
    from hwpx import HwpxDocument  # type: ignore

    rows, cols = int(spec["rows"]), int(spec["cols"])
    doc = HwpxDocument.new()
    if spec.get("title"):
        doc.add_paragraph(str(spec["title"]))
    tbl = doc.add_table(rows, cols)
    for m in spec.get("merges", []) or []:
        r, c = int(m["row"]), int(m["col"])
        tbl.merge_cells(r, c, r + int(m.get("rowSpan", 1)) - 1, c + int(m.get("colSpan", 1)) - 1)
    cells = spec.get("cells") or []
    for r in range(rows):
        for c in range(cols):
            if r < len(cells) and c < len(cells[r]) and cells[r][c] is not None:
                val = cells[r][c]
                if isinstance(val, dict) and "table" in val:
                    # Nested tables aren't expressible via set_cell_text; build_table
                    # routes such specs to the stdlib engine. Guard defensively so a
                    # stray nested cell never gets stringified into literal text.
                    raise ValueError("nested tables are not supported by the python-hwpx path")
                tbl.set_cell_text(r, c, str(val), logical=True, split_merged=True)
    doc.save_to_path(out_path)
    return f"Created {out_path} via python-hwpx ({rows}x{cols} table)"


def _build_with_stdlib(out_path: str, spec: dict) -> str:
    import hwpx_table

    proto = TEMPLATES / "table_proto.hwpx"
    if not proto.exists():
        raise FileNotFoundError(f"prototype template missing: {proto}")
    hwpx_table.write_table_document(
        proto,
        out_path,
        rows=int(spec["rows"]),
        cols=int(spec["cols"]),
        cells=spec.get("cells"),
        merges=spec.get("merges"),
        title=spec.get("title"),
    )
    return (
        f"Created {out_path} via stdlib prototype-clone "
        f"({spec['rows']}x{spec['cols']} table)"
    )


def _spec_has_nested(spec: dict) -> bool:
    """True if any cell value is a nested-table spec (``{"table": {...}}``)."""
    for row in spec.get("cells") or []:
        for val in row or []:
            if isinstance(val, dict) and "table" in val:
                return True
    return False


def build_table(out_path: str, spec: dict, engine: str = "auto") -> str:
    nested = _spec_has_nested(spec)
    if nested and engine == "python-hwpx":
        return (
            "Error: nested tables are not supported by the python-hwpx engine; "
            "use --engine stdlib (or auto)"
        )
    # Nested specs always use the stdlib prototype-clone path, which handles them;
    # python-hwpx is only tried for flat (simple/merged) tables.
    if engine in ("auto", "python-hwpx") and not nested:
        try:
            return _build_with_python_hwpx(out_path, spec)
        except ImportError:
            if engine == "python-hwpx":
                return "Error: python-hwpx is not installed (engine forced)"
        except Exception as e:  # noqa: BLE001 - any API mismatch → fall back
            if engine == "python-hwpx":
                return f"Error: python-hwpx table build failed: {e}"
            print(f"Warning: python-hwpx path failed ({e}); using stdlib fallback")
    try:
        return _build_with_stdlib(out_path, spec)
    except Exception as e:  # noqa: BLE001
        return f"Error: table build failed: {e}"


def _load_spec(args) -> dict:
    if args.spec:
        return json.loads(Path(args.spec).read_text(encoding="utf-8"))
    if args.spec_json:
        return json.loads(args.spec_json)
    if args.rows and args.cols:
        return {"rows": args.rows, "cols": args.cols, "title": args.title}
    raise SystemExit("provide --spec, --spec-json, or --rows/--cols")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create a HWPX with an N×M table")
    parser.add_argument("out_file", help="output .hwpx")
    parser.add_argument("--spec", help="path to a JSON table spec")
    parser.add_argument("--spec-json", help="inline JSON table spec")
    parser.add_argument("--rows", type=int, help="row count (when no --spec)")
    parser.add_argument("--cols", type=int, help="column count (when no --spec)")
    parser.add_argument("--title", help="lead paragraph title (when no --spec)")
    parser.add_argument(
        "--engine", choices=["auto", "python-hwpx", "stdlib"], default="auto"
    )
    args = parser.parse_args()
    spec = _load_spec(args)
    if args.engine == "stdlib":
        msg = _build_with_stdlib(args.out_file, spec)
    else:
        msg = build_table(args.out_file, spec, engine=args.engine)
    print(msg)
    if msg.startswith("Error"):
        sys.exit(1)
