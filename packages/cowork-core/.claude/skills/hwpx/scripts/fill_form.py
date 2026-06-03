#!/usr/bin/env python3
"""Fill a form-style HWPX table by label, then report applied/failed counts.

Mapping keys are "label > direction" paths: the value is written into the cell
adjacent to the cell whose text matches ``label``. Directions: ``right``
(default), ``below``, ``left``, ``above``. A bare ``label`` means ``label > right``.

Engine selection mirrors build_table.py:
  * ``python-hwpx`` ``fill_by_path`` when installed (handles its own label search).
  * Stdlib fallback: locate label cells in each table and write the neighbour.

    python3 scripts/fill_form.py in.hwpx out.hwpx --map form.json
    python3 scripts/fill_form.py in.hwpx out.hwpx \
        --pair "성명 > right" "홍길동" --pair "소속 > right" "플랫폼팀"

Exit code is 0 only when every requested fill was applied.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from hwpx_common import (  # noqa: E402
    is_hwpx,
    local_name,
    namespaces_of,
    register_all,
    rewrite_package,
    safe_fromstring,
    serialize,
)

_DELTA = {
    "right": (0, 1),
    "left": (0, -1),
    "below": (1, 0),
    "above": (-1, 0),
}


def _parse_path(path: str) -> tuple[str, str]:
    if ">" in path:
        label, _, direction = path.partition(">")
        return label.strip(), direction.strip().lower() or "right"
    return path.strip(), "right"


def _fill_with_python_hwpx(in_path: str, out_path: str, mapping: dict) -> dict:
    from hwpx import HwpxDocument  # type: ignore

    doc = HwpxDocument.open(in_path)
    result = doc.fill_by_path(mapping)
    doc.save_to_path(out_path)
    # python-hwpx returns applied/failed counts; normalise defensively.
    applied = getattr(result, "applied_count", None)
    failed = getattr(result, "failed_count", None)
    if isinstance(result, dict):
        applied = result.get("applied_count", applied)
        failed = result.get("failed_count", failed)
    return {
        "engine": "python-hwpx",
        "applied_count": applied if applied is not None else len(mapping),
        "failed_count": failed if failed is not None else 0,
        "failed_paths": [],
    }


def _fill_with_stdlib(in_path: str, out_path: str, mapping: dict) -> dict:
    import hwpx_table

    with zipfile.ZipFile(in_path) as zf:
        section_name = next(
            n
            for n in zf.namelist()
            if n.startswith("Contents/section") and n.endswith(".xml")
        )
        section_bytes = zf.read(section_name)
    ns = namespaces_of(section_bytes)
    register_all(ns)
    root = safe_fromstring(section_bytes)

    tables = [e for e in root.iter() if local_name(e.tag) == "tbl"]
    applied, failed_paths = 0, []

    for path, value in mapping.items():
        label, direction = _parse_path(path)
        dr, dc = _DELTA.get(direction, (0, 1))
        hit = False
        for tbl in tables:
            index = hwpx_table.index_cells(tbl)
            target = None
            for (r, c), tc in index.items():
                if hwpx_table.cell_text(tc).strip() == label:
                    target = index.get((r + dr, c + dc))
                    break
            if target is not None:
                hwpx_table.set_cell_text(target, str(value), ns)
                applied += 1
                hit = True
                break
        if not hit:
            failed_paths.append(path)

    rewrite_package(in_path, out_path, {section_name: serialize(root)})
    return {
        "engine": "stdlib",
        "applied_count": applied,
        "failed_count": len(failed_paths),
        "failed_paths": failed_paths,
    }


def fill_form(in_path: str, out_path: str, mapping: dict, engine: str = "auto") -> dict:
    if not is_hwpx(in_path):
        return {"error": f"{in_path} is not a valid HWPX package"}
    if engine in ("auto", "python-hwpx"):
        try:
            return _fill_with_python_hwpx(in_path, out_path, mapping)
        except ImportError:
            if engine == "python-hwpx":
                return {"error": "python-hwpx is not installed (engine forced)"}
        except Exception as e:  # noqa: BLE001
            if engine == "python-hwpx":
                return {"error": f"python-hwpx fill failed: {e}"}
            print(f"Warning: python-hwpx path failed ({e}); using stdlib fallback")
    return _fill_with_stdlib(in_path, out_path, mapping)


def _load_mapping(args) -> dict:
    mapping: dict[str, str] = {}
    if args.map:
        mapping.update(json.loads(Path(args.map).read_text(encoding="utf-8")))
    for path, value in args.pair or []:
        mapping[path] = value
    if not mapping:
        raise SystemExit("provide --map and/or --pair")
    return mapping


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fill a HWPX form table by label")
    parser.add_argument("in_file", help="input .hwpx")
    parser.add_argument("out_file", help="output .hwpx")
    parser.add_argument("--map", help="JSON file: { 'label > right': 'value', ... }")
    parser.add_argument(
        "--pair", nargs=2, action="append", metavar=("PATH", "VALUE"), help="label-path/value pair"
    )
    parser.add_argument("--engine", choices=["auto", "python-hwpx", "stdlib"], default="auto")
    args = parser.parse_args()

    mapping = _load_mapping(args)
    result = fill_form(args.in_file, args.out_file, mapping, engine=args.engine)
    print(json.dumps(result, ensure_ascii=False))
    if "error" in result or result.get("failed_count", 0) > 0:
        sys.exit(1)
