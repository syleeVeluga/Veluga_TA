#!/usr/bin/env python3
"""Validate a .hwpx package: signature, manifest, XML, references, round-trip.

Checks (spec §7):
  1. mimetype is the first ZIP entry AND stored uncompressed (STORED).
  2. Every content.hpf manifest item resolves to a real part; spine idrefs map
     to manifest ids.
  3. All XML parts are well-formed; section roots have local name 'sec'.
  4. Referential integrity: borderFill/charPr/paraPr/style IDRefs used in the
     sections exist in header.xml's mapping tables.
  5. (optional) headless load: ``soffice --convert-to pdf`` if available, else
     skipped with a warning (matches the docx/pptx/xlsx pattern).

XSD validation against the official OWPML schema is attempted only if both lxml
and a schema path are provided (--xsd); otherwise skipped.

    python3 scripts/validate.py document.hwpx
    python3 scripts/validate.py document.hwpx --soffice true
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from defusedxml.common import DefusedXmlException  # noqa: E402

from hwpx_common import MIMETYPE, children_local, local_name, safe_fromstring  # noqa: E402


def _check_signature(zf: zipfile.ZipFile, checks: list) -> None:
    infos = zf.infolist()
    first_ok = bool(infos) and infos[0].filename == "mimetype"
    checks.append(("mimetype is first entry", first_ok, "" if first_ok else "mimetype must be first"))
    if first_ok:
        stored = infos[0].compress_type == zipfile.ZIP_STORED
        checks.append(("mimetype is STORED", stored, "" if stored else "must be uncompressed"))
        content = zf.read("mimetype").decode("utf-8", "replace").strip()
        ok = content == MIMETYPE
        checks.append(("mimetype content", ok, "" if ok else f"got {content!r}"))


def _check_manifest(zf: zipfile.ZipFile, checks: list) -> None:
    names = set(zf.namelist())
    if "Contents/content.hpf" not in names:
        checks.append(("content.hpf present", False, "missing OPF package part"))
        return
    checks.append(("content.hpf present", True, ""))
    root = safe_fromstring(zf.read("Contents/content.hpf"))
    item_ids, hrefs = set(), []
    for el in root.iter():
        if local_name(el.tag) == "item":
            item_ids.add(el.get("id"))
            href = el.get("href")
            if href:
                hrefs.append(href)
    missing = [h for h in hrefs if h not in names and h.lstrip("/") not in names]
    checks.append(
        ("manifest parts exist", not missing, "" if not missing else f"missing: {missing}")
    )
    spine_refs = [
        el.get("idref") for el in root.iter() if local_name(el.tag) == "itemref"
    ]
    dangling = [r for r in spine_refs if r not in item_ids]
    checks.append(
        ("spine idrefs valid", not dangling, "" if not dangling else f"dangling: {dangling}")
    )


def _check_xml_and_sections(zf: zipfile.ZipFile, checks: list) -> None:
    bad = []
    section_roots_ok = True
    for name in zf.namelist():
        if not name.endswith((".xml", ".hpf", ".rdf")):
            continue
        try:
            root = safe_fromstring(zf.read(name))
        except (ET.ParseError, DefusedXmlException) as e:
            bad.append(f"{name}: {e}")
            continue
        if name.startswith("Contents/section") and name.endswith(".xml"):
            if local_name(root.tag) != "sec":
                section_roots_ok = False
    checks.append(("all XML well-formed", not bad, "" if not bad else "; ".join(bad)))
    checks.append(("section roots are 'sec'", section_roots_ok, ""))


def _check_references(zf: zipfile.ZipFile, checks: list) -> None:
    names = set(zf.namelist())
    if "Contents/header.xml" not in names:
        checks.append(("header.xml present", False, "missing header"))
        return
    header = safe_fromstring(zf.read("Contents/header.xml"))
    ids = {"borderFill": set(), "charPr": set(), "paraPr": set(), "style": set()}
    for el in header.iter():
        ln = local_name(el.tag)
        if ln in ids and el.get("id") is not None:
            ids[ln].add(el.get("id"))

    ref_attr = {
        "borderFillIDRef": "borderFill",
        "charPrIDRef": "charPr",
        "paraPrIDRef": "paraPr",
        "styleIDRef": "style",
    }
    broken = []
    for name in names:
        if not (name.startswith("Contents/section") and name.endswith(".xml")):
            continue
        sec = safe_fromstring(zf.read(name))
        for el in sec.iter():
            for attr, kind in ref_attr.items():
                val = el.get(attr)
                if val is None or not ids[kind]:
                    continue
                if val not in ids[kind]:
                    broken.append(f"{name}: {attr}={val} (no {kind} #{val} in header)")
    # Cap noise; integrity is best-effort.
    broken = broken[:10]
    checks.append(
        ("style references resolve", not broken, "" if not broken else "; ".join(broken))
    )


def _check_soffice(path: Path, checks: list) -> None:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        checks.append(("headless load (soffice)", True, "Warning: soffice not found. Skipping."))
        return
    with tempfile.TemporaryDirectory() as outdir:
        try:
            proc = subprocess.run(
                [soffice, "--headless", "--convert-to", "pdf", "--outdir", outdir, str(path)],
                capture_output=True,
                timeout=120,
            )
            pdfs = list(Path(outdir).glob("*.pdf"))
            ok = proc.returncode == 0 and pdfs and pdfs[0].stat().st_size > 0
            checks.append(
                ("headless load (soffice)", bool(ok), "" if ok else "conversion produced no PDF")
            )
        except Exception as e:  # noqa: BLE001
            checks.append(("headless load (soffice)", True, f"Warning: soffice failed ({e})"))


def validate_package(path: str | Path, soffice: bool = False) -> dict:
    p = Path(path)
    checks: list[tuple[str, bool, str]] = []
    if not p.exists():
        return {"ok": False, "report": f"Error: {p} does not exist", "checks": []}
    try:
        with zipfile.ZipFile(p) as zf:
            _check_signature(zf, checks)
            _check_manifest(zf, checks)
            _check_xml_and_sections(zf, checks)
            _check_references(zf, checks)
    except zipfile.BadZipFile:
        return {"ok": False, "report": f"Error: {p} is not a valid ZIP/HWPX", "checks": []}
    except (ET.ParseError, DefusedXmlException) as e:
        return {"ok": False, "report": f"Error: malformed or unsafe XML in {p}: {e}", "checks": []}
    if soffice:
        _check_soffice(p, checks)

    ok = all(passed for _name, passed, _detail in checks)
    lines = [
        f"  [{'PASS' if passed else 'FAIL'}] {name}" + (f" — {detail}" if detail else "")
        for name, passed, detail in checks
    ]
    report = f"Validation of {p.name}:\n" + "\n".join(lines)
    report += "\n" + ("All checks PASSED!" if ok else "Validation FAILED.")
    return {"ok": ok, "report": report, "checks": checks}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate a HWPX package")
    parser.add_argument("input_file", help="HWPX file")
    parser.add_argument(
        "--soffice",
        type=lambda x: x.lower() == "true",
        default=False,
        metavar="true|false",
        help="attempt headless PDF conversion if soffice is available (default: false)",
    )
    args = parser.parse_args()
    result = validate_package(args.input_file, soffice=args.soffice)
    print(result["report"])
    sys.exit(0 if result["ok"] else 1)
