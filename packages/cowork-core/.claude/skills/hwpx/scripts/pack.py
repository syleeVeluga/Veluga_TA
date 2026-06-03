#!/usr/bin/env python3
"""Pack an unpacked HWPX directory back into a .hwpx file.

Condenses the pretty-printed XML, then writes a ZIP whose first entry is the
uncompressed ``mimetype`` (HWPX/OPC signature rule). Pass ``--validate`` to run
package-integrity checks before writing.

    python3 scripts/pack.py unpacked/ output.hwpx
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import defusedxml.minidom  # noqa: E402

from hwpx_common import pack_hwpx  # noqa: E402


def pack(
    input_directory: str, output_file: str, condense: bool = True, validate: bool = False
) -> tuple[None, str]:
    input_dir = Path(input_directory)
    output_path = Path(output_file)

    if not input_dir.is_dir():
        return None, f"Error: {input_directory} is not a directory"
    if output_path.suffix.lower() != ".hwpx":
        return None, f"Error: {output_file} must be a .hwpx file"
    if not (input_dir / "mimetype").exists():
        return None, f"Error: {input_directory} has no mimetype part (not an unpacked HWPX)"

    try:
        with tempfile.TemporaryDirectory() as tmp:
            staging = Path(tmp) / "content"
            shutil.copytree(input_dir, staging)
            if condense:
                for pattern in ("*.xml", "*.hpf", "*.rdf"):
                    for xml_file in staging.rglob(pattern):
                        _condense(xml_file)
            pack_hwpx(staging, output_path)
    except Exception as e:  # noqa: BLE001
        return None, f"Error packing: {e}"

    if validate:
        ok, report = _validate(output_path)
        if report:
            print(report)
        if not ok:
            return None, f"Error: validation failed for {output_file}"

    return None, f"Successfully packed {input_directory} to {output_file}"


def _condense(xml_file: Path) -> None:
    """Strip pretty-print whitespace without disturbing <hp:t> text content."""
    try:
        with open(xml_file, encoding="utf-8") as f:
            dom = defusedxml.minidom.parse(f)
        for element in dom.getElementsByTagName("*"):
            # Preserve text inside text-bearing leaves (hp:t, hc:* text, etc.).
            local = element.tagName.rsplit(":", 1)[-1]
            if local in ("t", "char", "title"):
                continue
            for child in list(element.childNodes):
                if (
                    child.nodeType == child.TEXT_NODE
                    and child.nodeValue
                    and child.nodeValue.strip() == ""
                ) or child.nodeType == child.COMMENT_NODE:
                    element.removeChild(child)
        with open(xml_file, "wb") as f:
            f.write(dom.toxml(encoding="UTF-8"))
    except Exception:  # noqa: BLE001
        pass


def _validate(output_path: Path) -> tuple[bool, str | None]:
    try:
        from validate import validate_package  # local import to keep pack standalone

        result = validate_package(str(output_path))
        return result["ok"], result["report"]
    except Exception as e:  # noqa: BLE001
        return True, f"Warning: validation skipped ({e})"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pack a directory into a HWPX file")
    parser.add_argument("input_directory", help="Unpacked HWPX directory")
    parser.add_argument("output_file", help="Output HWPX file")
    parser.add_argument(
        "--condense",
        type=lambda x: x.lower() == "true",
        default=True,
        metavar="true|false",
        help="Strip pretty-print whitespace (default: true)",
    )
    parser.add_argument(
        "--validate",
        type=lambda x: x.lower() == "true",
        default=False,
        metavar="true|false",
        help="Run package-integrity validation (default: false)",
    )
    args = parser.parse_args()
    _, message = pack(
        args.input_directory, args.output_file, condense=args.condense, validate=args.validate
    )
    print(message)
    if message.startswith("Error"):
        sys.exit(1)
