---
name: hwpx
description: "개방형 표준 한글 문서(.hwpx) 생성·편집·분석. ZIP+XML(OWPML) 구조를 직접 다뤄 본문/스타일을 보존한 채 내용을 갱신하고, 텍스트를 추출한다. 특히 공공·금융 양식에서 흔한 표 작업(N×M 표 생성, 셀 병합/분할, 표 안의 표=중첩표, 라벨 기반 양식 채우기)을 1급으로 지원. 오프라인 샌드박스에서 외부 호출 없이 동작. .hwpx 파일이 입력 또는 출력으로 관여하는 모든 작업(신규 생성, 기존 문서 편집, 표 작성, 텍스트 추출, docx 대안 산출 포맷)에 사용. 단, 구형 바이너리 .hwp는 미지원이며 .hwpx로 저장 후 사용 권장."
license: Proprietary. LICENSE.txt has complete terms
---

# HWPX (한글 문서) creation, editing, and analysis

## Overview

A `.hwpx` file is the open national-standard Korean word-processor format
(**KS X 6101 / OWPML**): a ZIP archive of XML parts, much like `.docx`. This
skill reads and writes `.hwpx` with the same *unpack → edit XML → repack*
pattern as the docx skill, plus first-class support for tables — the most
common construct in Korean public-sector and finance documents.

Everything works **fully offline with zero external traffic**. The text path
uses only the Python standard library (`zipfile` + `xml.etree.ElementTree`) plus
`defusedxml` — the same hardened-XML baseline the docx skill ships with — which
parses untrusted `.hwpx` input safely (no entity-expansion / external-entity
attacks). Richer table work optionally uses `python-hwpx` (Apache-2.0) when
installed, and gracefully falls back to a dependency-free prototype-clone path
otherwise.

> **Legacy `.hwp` (binary 한글 5.0) is NOT supported.** If the input is `.hwp`,
> tell the user to open it in 한/글 and "다른 이름으로 저장 → .hwpx", then retry.

## Quick Reference

| Task | Command |
|------|---------|
| Extract text/tables → Markdown | `python3 scripts/extract_text.py doc.hwpx -o out.md` |
| Extract → HTML (tables preserved) | `python3 scripts/extract_text.py doc.hwpx --format html -o out.html` |
| Create a text document | `python3 scripts/hydrate.py new out.hwpx --text "문단1" "문단2"` |
| Replace body text (layout kept) | `python3 scripts/hydrate.py edit in.hwpx out.hwpx --text "..."` |
| Create an N×M table (merges, title) | `python3 scripts/build_table.py out.hwpx --spec table.json` |
| Fill a form table by label | `python3 scripts/fill_form.py in.hwpx out.hwpx --map form.json` |
| Unpack for raw XML edits | `python3 scripts/unpack.py doc.hwpx unpacked/` |
| Repack | `python3 scripts/pack.py unpacked/ out.hwpx --validate true` |
| Validate a package | `python3 scripts/validate.py doc.hwpx` |

All scripts accept Korean (UTF-8) text directly. See `reference/owpml.md` for
the format and `reference/tables.md` for table patterns.

---

## Reading / extraction

```bash
python3 scripts/extract_text.py document.hwpx                 # Markdown to stdout
python3 scripts/extract_text.py document.hwpx -o out.md        # → file (KB injection)
python3 scripts/extract_text.py document.hwpx --format html -o out.html
```

- Paragraphs become Markdown lines / `<p>` blocks.
- **Tables are emitted as HTML `<table>` with `colspan`/`rowspan`**, not Markdown
  pipe tables, so merged cells and nested tables survive. Markdown renderers
  display inline HTML tables fine.

---

## Creating a new document (text)

```bash
python3 scripts/hydrate.py new out.hwpx --text "사업 개요" "본 사업은 ..." "예산: 12억원"
python3 scripts/hydrate.py new out.hwpx --from-file body.txt   # one paragraph per line
```

This clones the complete, valid base template (`templates/base.hwpx`) and
substitutes body text only — it never assembles XML from zero, so style and
layout references stay intact (Static Hydration, spec §5).

## Editing an existing document

Two routes:

1. **Body text replacement (preserves layout):**
   ```bash
   python3 scripts/hydrate.py edit input.hwpx output.hwpx --text "교체할 문단"
   ```
2. **Raw XML edits (precise control):**
   ```bash
   python3 scripts/unpack.py input.hwpx unpacked/
   # edit unpacked/Contents/section0.xml, header.xml, etc. with the Edit tool
   python3 scripts/pack.py unpacked/ output.hwpx --validate true
   ```
   Repacking always writes `mimetype` as the first ZIP entry, uncompressed
   (STORED) — the HWPX/OPC signature rule.

---

## Tables (1급 기능)

Tables sit one level below a paragraph's run and can recurse, so "split text on
newlines" does not work for them. Use the table scripts. See `reference/tables.md`.

**Create a table** with a JSON spec:

```json
{
  "title": "사업 개요",
  "rows": 3, "cols": 4,
  "cells": [
    ["성명", "홍길동", "소속", "플랫폼팀"],
    ["기간", "2026.01~12", "예산", "12억원"]
  ],
  "merges": [{ "row": 0, "col": 0, "rowSpan": 1, "colSpan": 4 }]
}
```
```bash
python3 scripts/build_table.py out.hwpx --spec table.json
```

- **Merges**: the anchor cell gets `colSpan`/`rowSpan`; absorbed cells are
  omitted; `cellAddr` stays consistent — all handled for you.
- **Nested tables (표 안의 표)**: make a cell value
  `{ "table": { "rows": 2, "cols": 1, "cells": [["세부1"], ["세부2"]] } }`.

**Fill a form table** by label (writes the neighbouring cell):

```json
{ "성명 > right": "홍길동", "소속 > right": "플랫폼팀", "비고 > below": "해당없음" }
```
```bash
python3 scripts/fill_form.py blank_form.hwpx filled.hwpx --map form.json
```
Directions: `right` (default), `left`, `below`, `above`. Output JSON reports
`applied_count` / `failed_count` / `failed_paths`.

---

## Validation

```bash
python3 scripts/validate.py document.hwpx              # integrity + references
python3 scripts/validate.py document.hwpx --soffice true   # + headless PDF load
```

Checks: mimetype-first/STORED, manifest↔parts consistency, XML well-formedness,
section roots are `sec`, and that `borderFill`/`charPr`/`paraPr`/`style` IDRefs
used in the body resolve against `header.xml`.

---

## Engines & dependencies

- **Text / pack / unpack / extract / validate** — Python stdlib + `defusedxml`
  (preinstalled sandbox baseline, same as docx). No extra install.
- **Tables** — `build_table.py` and `fill_form.py` prefer **`python-hwpx`**
  (`pip install python-hwpx`; Apache-2.0, pure Python + lxml) when available,
  and otherwise use the stdlib prototype-clone path. Force one with
  `--engine python-hwpx|stdlib` (default `auto`).
- **PDF preview/validation** — optional `soffice` (LibreOffice). If absent,
  validation prints `Warning: soffice not found. Skipping.` and continues.

**Capability notes / limits (반드시 인지):**
- The stdlib fallback covers simple, merged, and nested N×M tables. Very complex
  forms (auto-sizing, rich shapes) are best with `python-hwpx`.
- Images (`<hp:pic>`), complex drawings, and encrypted/password HWPX are not
  generated by this skill.
- **한/글 visual fidelity is best-effort.** Package integrity and text/table
  round-trip are verified automatically; documents heavy in images or complex
  shapes should be opened once in 한/글 (2022+) to confirm (spec §8 #2/#4).

## Cross-platform

No OS-specific code. cowork-core runs the agent in a Linux guest (Lima on macOS,
WSL on Windows), so these Python scripts behave identically on macOS, Windows,
and Linux. `soffice` is invoked from PATH and skipped when missing.

## Templates

`templates/base.hwpx` (empty document) and `templates/table_proto.hwpx` (styled
2×2 table prototype) are generated by `scripts/build_templates.py` — their
auditable source of truth. Regenerate with `python3 scripts/build_templates.py`.
