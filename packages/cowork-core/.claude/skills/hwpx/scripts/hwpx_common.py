#!/usr/bin/env python3
"""Shared HWPX (한글 문서, OWPML / KS X 6101) helpers.

This module uses only the Python standard library plus ``defusedxml`` (the same
hardened-XML baseline the docx skill relies on), so the text/pack/unpack path
works in a fully offline sandbox with zero external traffic. Untrusted ``.hwpx``
input is always parsed through defusedxml (``safe_fromstring`` /
``safe_iterparse``) to neutralise entity-expansion ("billion laughs") and
external-entity attacks; stdlib ``ElementTree`` is used only to *build* and
serialise parts we author ourselves. Richer table work optionally delegates to
``python-hwpx`` when it is installed (see ``build_table.py``).

Core invariants this module protects:
  * ``mimetype`` is always the first ZIP entry and stored uncompressed (STORED).
    This is the OPC/EPUB/ODF signature rule HWPX inherits.
  * Namespace prefixes are never hard-coded into element lookups. HWPX parts mix
    2011/2016/2021/2023 namespace URIs, so prefixes are extracted at runtime and
    elements are addressed with Clark notation ``{uri}local``.
  * The section body root local name is ``sec`` (not ``section``).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO
from pathlib import Path

# Hardened parsers for UNTRUSTED .hwpx input. defusedxml returns plain stdlib
# ElementTree elements, so the rest of the code (build/serialise) is unchanged.
from defusedxml.ElementTree import fromstring as safe_fromstring  # noqa: E402
from defusedxml.ElementTree import iterparse as safe_iterparse  # noqa: E402

# The HWPX package signature. Must match exactly (no trailing newline) and be
# stored uncompressed as the first ZIP entry.
MIMETYPE = "application/hwp+zip"

# Default OWPML 2011 namespace map. Used only when authoring brand-new parts
# (templates); when editing existing parts always prefer ``namespaces_of`` so we
# honour whatever URIs the source document actually declares.
NS = {
    "ha": "http://www.hancom.co.kr/hwpml/2011/app",
    "hp": "http://www.hancom.co.kr/hwpml/2011/paragraph",
    "hp10": "http://www.hancom.co.kr/hwpml/2016/paragraph",
    "hs": "http://www.hancom.co.kr/hwpml/2011/section",
    "hc": "http://www.hancom.co.kr/hwpml/2011/core",
    "hh": "http://www.hancom.co.kr/hwpml/2011/head",
    "hhs": "http://www.hancom.co.kr/hwpml/2011/history",
    "hm": "http://www.hancom.co.kr/hwpml/2011/master-page",
    "hpf": "http://www.hancom.co.kr/schema/2011/hpf",
    "hv": "http://www.hancom.co.kr/hwpml/2011/version",
    "ocf": "urn:oasis:names:tc:opendocument:xmlns:container",
    "opf": "http://www.idpf.org/2007/opf/",
    "dc": "http://purl.org/dc/elements/1.1/",
    "odf": "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "config": "http://www.hancom.co.kr/hwpml/2011/configItemSet",
}


# --------------------------------------------------------------------------- #
# Namespace handling (dynamic, prefix-agnostic)
# --------------------------------------------------------------------------- #
def namespaces_of(xml_bytes: bytes) -> dict[str, str]:
    """Extract every ``prefix -> uri`` namespace declaration from an XML part.

    HWPX parts differ in which OWPML version URI they bind a prefix to, so we
    read them straight from the document rather than assuming.
    """
    ns: dict[str, str] = {}
    for _event, (prefix, uri) in safe_iterparse(BytesIO(xml_bytes), events=("start-ns",)):
        # Later declarations win, matching XML scoping for our flat parts.
        ns[prefix] = uri
    return ns


def register_all(ns: dict[str, str]) -> None:
    """Register prefixes so ``ET.tostring`` serialises with the same prefixes."""
    for prefix, uri in ns.items():
        if prefix:  # ElementTree forbids registering the empty default prefix
            ET.register_namespace(prefix, uri)


def qn(uri: str, local: str) -> str:
    """Build a Clark-notation qualified name ``{uri}local``."""
    return f"{{{uri}}}{local}"


def local_name(tag: str) -> str:
    """Return the local part of a (possibly namespaced) element tag."""
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def uri_of(ns: dict[str, str], prefix: str, fallback: str | None = None) -> str:
    """Resolve a prefix to its URI, falling back to the 2011 default map."""
    if prefix in ns:
        return ns[prefix]
    if fallback is not None:
        return fallback
    if prefix in NS:
        return NS[prefix]
    raise KeyError(f"namespace prefix {prefix!r} not declared in document")


def iter_local(parent: ET.Element, local: str):
    """Iterate descendants whose local name matches, ignoring prefix/URI."""
    for el in parent.iter():
        if local_name(el.tag) == local:
            yield el


def find_local(parent: ET.Element, local: str) -> ET.Element | None:
    """First descendant (including self) with the given local name, or None."""
    if local_name(parent.tag) == local:
        return parent
    for el in parent.iter():
        if local_name(el.tag) == local:
            return el
    return None


def children_local(parent: ET.Element, local: str) -> list[ET.Element]:
    """Direct children with the given local name."""
    return [c for c in parent if local_name(c.tag) == local]


# --------------------------------------------------------------------------- #
# ZIP packaging (mimetype-safe)
# --------------------------------------------------------------------------- #
def pack_hwpx(src_dir: str | Path, out_path: str | Path) -> None:
    """Repack an unpacked HWPX directory into a valid ``.hwpx`` file.

    ``mimetype`` is written first and STORED; every other part is DEFLATE-d.
    Ordering of the remaining parts is deterministic (sorted) for reproducible
    output and stable round-trips.
    """
    src = Path(src_dir)
    out = Path(out_path)
    mimetype_file = src / "mimetype"
    out.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(out, "w") as zf:
        # 1) mimetype MUST be the first entry and uncompressed.
        mimetype_bytes = (
            mimetype_file.read_bytes() if mimetype_file.exists() else MIMETYPE.encode("utf-8")
        )
        zf.writestr(zipfile.ZipInfo("mimetype"), mimetype_bytes, compress_type=zipfile.ZIP_STORED)

        # 2) Everything else, DEFLATE-compressed, in sorted order.
        for p in sorted(src.rglob("*")):
            if p.is_file() and p.name != "mimetype":
                zf.write(p, p.relative_to(src).as_posix(), compress_type=zipfile.ZIP_DEFLATED)


def unpack_hwpx(in_path: str | Path, out_dir: str | Path) -> list[str]:
    """Extract a ``.hwpx`` archive into a directory. Returns the part names."""
    src = Path(in_path)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(src, "r") as zf:
        names = zf.namelist()
        zf.extractall(out)
    return names


def rewrite_package(
    template_path: str | Path, out_path: str | Path, replacements: dict[str, bytes]
) -> None:
    """Copy a .hwpx, swapping named parts for new bytes, mimetype-first/STORED.

    Used by the in-memory text/table writers: take a known-good template
    package and replace only the parts that changed (e.g. ``Contents/section0.xml``)
    without ever re-deriving the header/manifest, so style references stay intact.
    """
    template = Path(template_path)
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(template, "r") as zin:
        names = zin.namelist()
        data = {name: zin.read(name) for name in names}
    data.update(replacements)

    with zipfile.ZipFile(out, "w") as zf:
        mimetype_bytes = data.get("mimetype", MIMETYPE.encode("utf-8"))
        zf.writestr(zipfile.ZipInfo("mimetype"), mimetype_bytes, compress_type=zipfile.ZIP_STORED)
        for name in names:
            if name == "mimetype":
                continue
            zf.writestr(name, data[name], compress_type=zipfile.ZIP_DEFLATED)
        # Append any brand-new parts not present in the template.
        for name in replacements:
            if name not in names and name != "mimetype":
                zf.writestr(name, data[name], compress_type=zipfile.ZIP_DEFLATED)


def is_hwpx(path: str | Path) -> bool:
    """Cheap signature check: valid ZIP whose first entry is the HWPX mimetype."""
    p = Path(path)
    if p.suffix.lower() != ".hwpx":
        return False
    try:
        with zipfile.ZipFile(p, "r") as zf:
            names = zf.infolist()
            if not names or names[0].filename != "mimetype":
                return False
            with zf.open("mimetype") as fh:
                return fh.read().decode("utf-8", "replace").strip() == MIMETYPE
    except (zipfile.BadZipFile, OSError):
        return False


# --------------------------------------------------------------------------- #
# Package navigation
# --------------------------------------------------------------------------- #
def read_part(unpacked: str | Path, rel: str) -> bytes:
    return (Path(unpacked) / rel).read_bytes()


def write_part(unpacked: str | Path, rel: str, data: bytes) -> None:
    (Path(unpacked) / rel).write_bytes(data)


def section_files(unpacked: str | Path) -> list[Path]:
    """Return ``Contents/sectionN.xml`` files in spine order (N ascending)."""
    contents = Path(unpacked) / "Contents"
    if not contents.is_dir():
        return []
    sections = [p for p in contents.glob("section*.xml")]

    def order(p: Path) -> int:
        digits = "".join(ch for ch in p.stem if ch.isdigit())
        return int(digits) if digits else 0

    return sorted(sections, key=order)


def serialize(root: ET.Element) -> bytes:
    """Serialise an element tree as a standalone UTF-8 XML part."""
    body = ET.tostring(root, encoding="unicode")
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + body).encode("utf-8")
