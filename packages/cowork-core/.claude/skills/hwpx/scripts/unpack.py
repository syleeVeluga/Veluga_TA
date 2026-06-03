#!/usr/bin/env python3
"""Unpack a .hwpx file for raw XML editing.

Extracts the ZIP archive and pretty-prints the XML parts so they are easy to
diff and edit with the Edit tool. Re-pack with ``pack.py`` afterwards.

    python3 scripts/unpack.py document.hwpx unpacked/
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import defusedxml.minidom  # noqa: E402

from hwpx_common import is_hwpx, unpack_hwpx  # noqa: E402


def unpack(input_file: str, output_directory: str, pretty: bool = True) -> tuple[None, str]:
    input_path = Path(input_file)
    output_path = Path(output_directory)

    if not input_path.exists():
        return None, f"Error: {input_file} does not exist"
    if input_path.suffix.lower() == ".hwp":
        return None, (
            "Error: legacy binary .hwp is not supported. "
            "Open it in 한/글 and 'Save As' .hwpx, then retry."
        )
    if input_path.suffix.lower() != ".hwpx":
        return None, f"Error: {input_file} must be a .hwpx file"
    if not is_hwpx(input_path):
        return None, f"Error: {input_file} is not a valid HWPX package (bad mimetype/zip)"

    try:
        names = unpack_hwpx(input_path, output_path)
        if pretty:
            xml_parts = (
                list(output_path.rglob("*.xml"))
                + list(output_path.rglob("*.hpf"))
                + list(output_path.rglob("*.rdf"))
            )
            for part in xml_parts:
                _pretty_print(part)
        return None, f"Unpacked {input_file} ({len(names)} parts) to {output_directory}"
    except Exception as e:  # noqa: BLE001 - surface a friendly message
        return None, f"Error unpacking: {e}"


def _pretty_print(xml_file: Path) -> None:
    try:
        content = xml_file.read_text(encoding="utf-8")
        dom = defusedxml.minidom.parseString(content)
        pretty = dom.toprettyxml(indent="  ", encoding="utf-8")
        # Drop the blank lines minidom inserts between elements.
        lines = [ln for ln in pretty.decode("utf-8").splitlines() if ln.strip()]
        xml_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    except Exception:  # noqa: BLE001 - leave non-XML / odd parts untouched
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Unpack a HWPX file for editing")
    parser.add_argument("input_file", help="HWPX file to unpack")
    parser.add_argument("output_directory", help="Output directory")
    parser.add_argument(
        "--pretty",
        type=lambda x: x.lower() == "true",
        default=True,
        metavar="true|false",
        help="Pretty-print XML parts (default: true)",
    )
    args = parser.parse_args()
    _, message = unpack(args.input_file, args.output_directory, pretty=args.pretty)
    print(message)
    if message.startswith("Error"):
        sys.exit(1)
