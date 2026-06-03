#!/usr/bin/env python3
"""Static Hydration: dependency-free text writing into a HWPX template (spec §5).

We keep a complete, valid base template and only substitute body text — never
assemble XML from zero (that breaks style references). Namespace prefixes are
read at runtime and elements addressed by local name so we are robust to the
2011/2016/2021 namespace variations across HWPX versions.

CLI — create a new .hwpx from text (one paragraph per line, or --text):

    python3 scripts/hydrate.py new out.hwpx --text "첫 문단" "둘째 문단"
    python3 scripts/hydrate.py new out.hwpx --from-file body.txt

CLI — replace the body text of an existing .hwpx (layout preserved):

    python3 scripts/hydrate.py edit in.hwpx out.hwpx --text "교체할 문단"
"""

from __future__ import annotations

import argparse
import copy
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from hwpx_common import (  # noqa: E402
    children_local,
    find_local,
    is_hwpx,
    local_name,
    namespaces_of,
    register_all,
    rewrite_package,
    safe_fromstring,
    serialize,
)

TEMPLATES = Path(__file__).resolve().parent.parent / "templates"


def _first_text_node(paragraph: ET.Element) -> ET.Element | None:
    return next((e for e in paragraph.iter() if local_name(e.tag) == "t"), None)


def _strip_secpr(paragraph: ET.Element) -> None:
    """Remove section properties from a cloned paragraph (only the first
    paragraph of a section may carry <hp:secPr>)."""
    secpr = find_local(paragraph, "secPr")
    if secpr is None:
        return
    for parent in paragraph.iter():
        if secpr in list(parent):
            parent.remove(secpr)
            return


def set_section_text(section_xml: bytes, paragraphs: list[str]) -> bytes:
    """Replace a section's body paragraphs with ``paragraphs``.

    The first template paragraph (which carries section properties) is reused as
    the prototype; its formatting (paraPrIDRef/charPrIDRef) is preserved. Extra
    paragraphs are clones with section properties stripped.
    """
    ns = namespaces_of(section_xml)
    register_all(ns)
    root = safe_fromstring(section_xml)
    if local_name(root.tag) != "sec":
        raise ValueError(f"section root must be 'sec', got {local_name(root.tag)!r}")

    body_paras = children_local(root, "p")
    if not body_paras:
        raise ValueError("template section has no <hp:p> to use as a prototype")
    proto = body_paras[0]
    anchor_index = list(root).index(proto)

    # Remove every existing body paragraph; we re-emit from the prototype.
    for p in body_paras:
        root.remove(p)

    texts = paragraphs if paragraphs else [""]
    insert_at = anchor_index
    for i, text in enumerate(texts):
        para = copy.deepcopy(proto)
        if i > 0:
            _strip_secpr(para)
        t = _first_text_node(para)
        if t is not None:
            t.text = text
        root.insert(insert_at, para)
        insert_at += 1
    return serialize(root)


def _section_part_name(template_path: Path) -> str:
    import zipfile

    with zipfile.ZipFile(template_path) as zf:
        for name in zf.namelist():
            if name.startswith("Contents/section") and name.endswith(".xml"):
                return name
    return "Contents/section0.xml"


def new_document(out_path: str, paragraphs: list[str], template: str | None = None) -> str:
    tpl = Path(template) if template else TEMPLATES / "base.hwpx"
    if not tpl.exists():
        return f"Error: template not found: {tpl}"
    section_name = _section_part_name(tpl)
    import zipfile

    with zipfile.ZipFile(tpl) as zf:
        section_bytes = zf.read(section_name)
    new_section = set_section_text(section_bytes, paragraphs)
    rewrite_package(tpl, out_path, {section_name: new_section})
    return f"Created {out_path} ({len(paragraphs) or 1} paragraph(s))"


def edit_document(in_path: str, out_path: str, paragraphs: list[str]) -> str:
    if not is_hwpx(in_path):
        return f"Error: {in_path} is not a valid HWPX package"
    section_name = _section_part_name(Path(in_path))
    import zipfile

    with zipfile.ZipFile(in_path) as zf:
        section_bytes = zf.read(section_name)
    new_section = set_section_text(section_bytes, paragraphs)
    rewrite_package(in_path, out_path, {section_name: new_section})
    return f"Edited {in_path} -> {out_path} ({len(paragraphs) or 1} paragraph(s))"


def _collect_paragraphs(args) -> list[str]:
    if args.from_file:
        return Path(args.from_file).read_text(encoding="utf-8").splitlines()
    return list(args.text or [])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Hydrate HWPX body text (stdlib path)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_new = sub.add_parser("new", help="create a new .hwpx from text")
    p_new.add_argument("out_file")
    p_new.add_argument("--text", nargs="*", help="paragraph text (repeatable)")
    p_new.add_argument("--from-file", help="read paragraphs from a UTF-8 text file (one per line)")
    p_new.add_argument("--template", help="override base template path")

    p_edit = sub.add_parser("edit", help="replace body text of an existing .hwpx")
    p_edit.add_argument("in_file")
    p_edit.add_argument("out_file")
    p_edit.add_argument("--text", nargs="*", help="paragraph text (repeatable)")
    p_edit.add_argument("--from-file", help="read paragraphs from a UTF-8 text file")

    args = parser.parse_args()
    if args.cmd == "new":
        msg = new_document(args.out_file, _collect_paragraphs(args), template=args.template)
    else:
        msg = edit_document(args.in_file, args.out_file, _collect_paragraphs(args))
    print(msg)
    if msg.startswith("Error"):
        sys.exit(1)
