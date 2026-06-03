#!/usr/bin/env python3
"""Generate the binary HWPX templates shipped with this skill.

The two ``.hwpx`` files under ``templates/`` are opaque ZIP blobs, so this
script is their auditable source of truth. Re-run it to regenerate them:

    python3 scripts/build_templates.py

It emits:
  * ``templates/base.hwpx``        — a complete, empty single-section document.
  * ``templates/table_proto.hwpx`` — base + a styled 2x2 table (borderFill #2),
                                      cloned by the stdlib table fallback.

The parts follow the OWPML 2011 (KS X 6101) structure. Sizes are in HWPUNIT
(1 inch = 7200 HWPUNIT; 1 mm ~= 283.46 HWPUNIT). A4 page = 59528 x 84188.

These templates are validated offline for package integrity and round-trip
text fidelity. Visual fidelity in Hancom Office (한/글) is a best-effort,
manually verified criterion (see SKILL.md / spec §8).
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hwpx_common import MIMETYPE, pack_hwpx  # noqa: E402

XMLDECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

# A4 content geometry used by the default section + table prototype.
TABLE_W = 42520  # ~150 mm content width
ROW_H = 2835  # ~10 mm per row
CELL_W = TABLE_W // 2

VERSION_XML = (
    XMLDECL
    + '<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version"'
    ' tagetApplication="WORDPROCESSOR" major="5" minor="0" micro="5" buildNumber="0"'
    ' os="1" xmlVersion="1.4" application="Veluga HWPX Skill"'
    ' appVersion="1.0.0.0"/>\n'
)

SETTINGS_XML = (
    XMLDECL
    + '<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"'
    ' xmlns:config="http://www.hancom.co.kr/hwpml/2011/configItemSet">\n'
    '  <ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/>\n'
    "</ha:HWPApplicationSetting>\n"
)

CONTAINER_XML = (
    XMLDECL
    + '<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container"'
    ' xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf">\n'
    "  <ocf:rootfiles>\n"
    '    <ocf:rootfile full-path="Contents/content.hpf"'
    ' media-type="application/hwpml-package+xml"/>\n'
    "  </ocf:rootfiles>\n"
    "</ocf:container>\n"
)

MANIFEST_XML = (
    XMLDECL
    + '<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"'
    ' odf:version="1.2">\n'
    '  <odf:file-entry odf:full-path="/" odf:media-type="application/hwpml-package+xml"/>\n'
    "</odf:manifest>\n"
)

CONTAINER_RDF = (
    XMLDECL
    + '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"'
    ' xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
    '  <rdf:Description rdf:about="">\n'
    "    <dc:format>application/hwp+zip</dc:format>\n"
    "  </rdf:Description>\n"
    "</rdf:RDF>\n"
)

PREVIEW_TEXT = ""  # PrvText.txt: extracted preview text, empty for a blank doc.


def content_hpf() -> str:
    return (
        XMLDECL
        + '<hpf:package xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"'
        ' xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:dc="http://purl.org/dc/elements/1.1/"'
        ' xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container"'
        ' version="1.4" unique-identifier="hwpxRoot" id="">\n'
        "  <opf:metadata>\n"
        "    <opf:title>Veluga HWPX Document</opf:title>\n"
        "    <opf:language>ko</opf:language>\n"
        '    <opf:meta name="creator" content="Veluga HWPX Skill"/>\n'
        "  </opf:metadata>\n"
        "  <opf:manifest>\n"
        '    <opf:item id="settings" href="settings.xml" media-type="application/xml"/>\n'
        '    <opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>\n'
        '    <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>\n'
        "  </opf:manifest>\n"
        "  <opf:spine>\n"
        '    <opf:itemref idref="header" linear="yes"/>\n'
        '    <opf:itemref idref="section0" linear="yes"/>\n'
        "  </opf:spine>\n"
        "</hpf:package>\n"
    )


def _font(face: str) -> str:
    return (
        f'<hh:font id="0" face="{face}" type="TTF" isEmbedded="0">'
        '<hh:typeInfo familyType="FCAT_GOTHIC" weight="0" proportion="0" contrast="0"'
        ' strokeVariation="0" armStyle="0" letterform="0" midline="0" xHeight="0"/></hh:font>'
    )


def _fontface(lang: str, face: str) -> str:
    return f'<hh:fontface lang="{lang}" fontCnt="1">{_font(face)}</hh:fontface>'


def _border_fill(bid: int, line_type: str) -> str:
    """borderFill #1 = no visible border, #2 = solid single line (tables)."""
    line = f'type="{line_type}" width="0.12 mm" color="#000000"'
    return (
        f'<hh:borderFill id="{bid}" threeD="0" shadow="0" centerLine="NONE"'
        ' breakCellSeparateLine="0">'
        '<hh:slash type="NONE" Crooked="0" isCounter="0"/>'
        '<hh:backSlash type="NONE" Crooked="0" isCounter="0"/>'
        f"<hh:leftBorder {line}/><hh:rightBorder {line}/>"
        f"<hh:topBorder {line}/><hh:bottomBorder {line}/>"
        '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>'
        '<hh:fillBrush><hc:winBrush faceColor="none" hatchColor="#999999" alpha="0"/></hh:fillBrush>'
        "</hh:borderFill>"
    )


def header_xml() -> str:
    fontfaces = "".join(
        _fontface(lang, "함초롬돋움" if lang in ("LATIN", "OTHER", "SYMBOL", "USER") else "함초롬바탕")
        for lang in ("HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER")
    )
    char_pr = (
        '<hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none"'
        ' useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">'
        '<hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>'
        '<hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>'
        '<hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>'
        '<hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>'
        '<hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>'
        "</hh:charPr>"
    )
    para_pr = (
        '<hh:paraPr id="0" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1"'
        ' suppressLineNumbers="0" checked="0">'
        '<hh:align horizontal="JUSTIFY" vertical="BASELINE"/>'
        '<hh:heading type="NONE" idRef="0" level="0"/>'
        '<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD"'
        ' widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>'
        '<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/>'
        '<hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/>'
        '<hc:next value="0" unit="HWPUNIT"/></hh:margin>'
        '<hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>'
        '<hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0" offsetTop="0"'
        ' offsetBottom="0" connect="0" ignoreMargin="0"/>'
        "</hh:paraPr>"
    )
    style = (
        '<hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0"'
        ' charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/>'
    )
    return (
        XMLDECL
        + '<hh:head xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"'
        ' xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"'
        ' xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph"'
        ' xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"'
        ' xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"'
        ' xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"'
        ' version="1.4" secCnt="1">\n'
        '  <hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>\n'
        "  <hh:refList>\n"
        f'    <hh:fontfaces itemCnt="7">{fontfaces}</hh:fontfaces>\n'
        f'    <hh:borderFills itemCnt="2">{_border_fill(1, "NONE")}{_border_fill(2, "SOLID")}</hh:borderFills>\n'
        f'    <hh:charProperties itemCnt="1">{char_pr}</hh:charProperties>\n'
        '    <hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties>\n'
        f'    <hh:paraProperties itemCnt="1">{para_pr}</hh:paraProperties>\n'
        f'    <hh:styles itemCnt="1">{style}</hh:styles>\n'
        "  </hh:refList>\n"
        '  <hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>\n'
        "</hh:head>\n"
    )


def _sec_pr() -> str:
    return (
        '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000"'
        ' tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="0" memoShapeIDRef="0"'
        ' textVerticalWidthHead="0" masterPageCnt="0">'
        '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0" strtnum="0"/>'
        '<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>'
        '<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0"'
        ' border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>'
        '<hp:pagePr landscape="WIDELY" width="59528" height="84188" gutterType="LEFT_ONLY">'
        '<hp:margin header="4252" footer="4252" gutter="0" left="8504" right="8504"'
        ' top="5668" bottom="4252"/></hp:pagePr>'
        '<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>'
        '<hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/>'
        '<hp:noteSpacing betweenNotes="850" belowLine="567" aboveLine="567"/>'
        '<hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>'
        '<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>'
        '<hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/>'
        '<hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/>'
        '<hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>'
        '<hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER" headerInside="0"'
        ' footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>'
        '<hp:pageBorderFill type="EVEN" borderFillIDRef="1" textBorder="PAPER" headerInside="0"'
        ' footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>'
        '<hp:pageBorderFill type="ODD" borderFillIDRef="1" textBorder="PAPER" headerInside="0"'
        ' footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>'
        "</hp:secPr>"
    )


def _lineseg(horzsize: int = TABLE_W) -> str:
    return (
        '<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000"'
        f' baseline="850" spacing="600" horzpos="0" horzsize="{horzsize}" flags="393216"/></hp:linesegarray>'
    )


def _para(inner_run: str, *, with_secpr: bool = False, pid: int = 0) -> str:
    secpr = _sec_pr() if with_secpr else ""
    return (
        f'<hp:p id="{pid}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="0">{secpr}{inner_run}</hp:run>'
        f"{_lineseg()}</hp:p>"
    )


def _table(rows: int, cols: int) -> str:
    """A styled rows x cols table (all single cells, borderFill #2)."""
    cell_h = ROW_H
    cell_w = TABLE_W // cols
    trs = []
    for r in range(rows):
        tcs = []
        for c in range(cols):
            sublist = (
                '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER"'
                ' linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0"'
                ' hasTextRef="0" hasNumRef="0">'
                '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
                '<hp:run charPrIDRef="0"><hp:t></hp:t></hp:run>'
                f"{_lineseg(cell_w)}</hp:p></hp:subList>"
            )
            tcs.append(
                '<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0"'
                ' borderFillIDRef="2">'
                f"{sublist}"
                f'<hp:cellAddr colAddr="{c}" rowAddr="{r}"/>'
                '<hp:cellSpan colSpan="1" rowSpan="1"/>'
                f'<hp:cellSz width="{cell_w}" height="{cell_h}"/>'
                '<hp:cellMargin left="510" right="510" top="141" bottom="141"/>'
                "</hp:tc>"
            )
        trs.append(f"<hp:tr>{''.join(tcs)}</hp:tr>")
    total_h = cell_h * rows
    return (
        f'<hp:tbl id="1234567890" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM"'
        ' textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1"'
        f' rowCnt="{rows}" colCnt="{cols}" cellSpacing="0" borderFillIDRef="2" noAdjust="0">'
        f'<hp:sz width="{TABLE_W}" widthRelTo="ABSOLUTE" height="{total_h}" heightRelTo="ABSOLUTE" protect="0"/>'
        '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0"'
        ' holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT"'
        ' vertOffset="0" horzOffset="0"/>'
        '<hp:outMargin left="283" right="283" top="283" bottom="283"/>'
        '<hp:inMargin left="510" right="510" top="141" bottom="141"/>'
        f"{''.join(trs)}</hp:tbl>"
    )


def section_xml(*, with_table: bool = False) -> str:
    # First paragraph carries the section properties; it stays as a text anchor.
    paras = [_para('<hp:t></hp:t>', with_secpr=True, pid=0)]
    if with_table:
        # A paragraph whose run hosts the table, then a trailing empty paragraph.
        paras.append(_para(_table(2, 2), pid=1))
        paras.append(_para('<hp:t></hp:t>', pid=2))
    body = "".join(paras)
    return (
        XMLDECL
        + '<hs:sec xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"'
        ' xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"'
        ' xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph"'
        ' xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"'
        ' xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">\n'
        f"{body}\n</hs:sec>\n"
    )


def _build(out_path: Path, *, with_table: bool) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "Contents").mkdir()
        (root / "META-INF").mkdir()
        (root / "Preview").mkdir()
        (root / "mimetype").write_text(MIMETYPE, encoding="utf-8", newline="")
        (root / "version.xml").write_text(VERSION_XML, encoding="utf-8")
        (root / "settings.xml").write_text(SETTINGS_XML, encoding="utf-8")
        (root / "Contents" / "content.hpf").write_text(content_hpf(), encoding="utf-8")
        (root / "Contents" / "header.xml").write_text(header_xml(), encoding="utf-8")
        (root / "Contents" / "section0.xml").write_text(
            section_xml(with_table=with_table), encoding="utf-8"
        )
        (root / "META-INF" / "container.xml").write_text(CONTAINER_XML, encoding="utf-8")
        (root / "META-INF" / "manifest.xml").write_text(MANIFEST_XML, encoding="utf-8")
        (root / "META-INF" / "container.rdf").write_text(CONTAINER_RDF, encoding="utf-8")
        (root / "Preview" / "PrvText.txt").write_text(PREVIEW_TEXT, encoding="utf-8")
        pack_hwpx(root, out_path)


def main() -> int:
    templates = Path(__file__).resolve().parent.parent / "templates"
    templates.mkdir(parents=True, exist_ok=True)
    _build(templates / "base.hwpx", with_table=False)
    _build(templates / "table_proto.hwpx", with_table=True)
    print(f"Wrote {templates / 'base.hwpx'}")
    print(f"Wrote {templates / 'table_proto.hwpx'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
