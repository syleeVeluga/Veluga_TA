# HWPX tables, merged cells, and nested tables

Tables are heavily used in Korean public-sector / finance forms, so this skill
treats them as first-class. This is the reference for the structure and the
write/read patterns.

## Structure (recursive)

A table is a `run`'s child (`hp:tbl`), so it is **one level below a paragraph**,
and a cell's content is itself a paragraph list (`subList`) — which can contain
another table. Nesting therefore needs no special device; it is plain recursion.

```
hp:p
└ hp:run (charPrIDRef)
   └ hp:tbl                 rowCnt · colCnt · borderFillIDRef
      ├ hp:sz               whole-table width/height (explicit)
      └ hp:tr               row
         └ hp:tc            cell
            ├ hp:subList    cell content = ParaList
            │  └ hp:p → hp:run → hp:t   ← cell text
            │              └ hp:tbl     ← ★ nested table (recursion)
            ├ hp:cellAddr   colAddr · rowAddr   (grid coordinate)
            ├ hp:cellSpan   colSpan · rowSpan   (merge)
            ├ hp:cellSz     width · height       (explicit, must be recomputed)
            └ hp:cellMargin
```

### Three things that make tables hard (and how the scripts handle them)

1. **Merged cells.** The anchor cell carries `cellSpan` (`colSpan`/`rowSpan` > 1);
   absorbed cells are **omitted** entirely. On read you must reconstruct the
   grid from `cellAddr`; on write you must omit absorbed cells and keep
   `cellAddr` consistent. → `hwpx_table.build_tbl` builds an occupancy grid,
   emits only anchor cells, and sets each `cellAddr` to its grid coordinate.
2. **Reference integrity.** `tbl@borderFillIDRef` and each cell paragraph's
   `paraPrIDRef`/`charPrIDRef` point into `header.xml`. Building a table from
   zero breaks those references. → We **clone a styled cell from
   `templates/table_proto.hwpx`**, which ships with `borderFill #2` and the
   matching style IDs already defined, instead of authoring from scratch.
3. **Cell sizing.** HWPX requires explicit `cellSz` and whole-table size. Growing
   rows/cols means recomputing them. → The stdlib builder divides the fixed
   table width (`42520` HWPUNIT) evenly across columns and `2835` per row, and
   sums spans for merged cells. `python-hwpx` does this more precisely.

## Writing tables

### Preferred engine — `python-hwpx` (if installed)

`build_table.py` / `fill_form.py` call it automatically when present. Its API
(per the project README — confirm exact signatures in its
[usage docs](https://airmang.github.io/python-hwpx/usage.html) at integration
time):

```python
from hwpx import HwpxDocument
doc = HwpxDocument.new()
tbl = doc.add_table(3, 4)
tbl.merge_cells(0, 0, 0, 3)                       # header row across 4 cols
tbl.set_cell_text(0, 0, "사업 개요", logical=True, split_merged=True)
inner = tbl.cell(1, 0).add_table(2, 2)            # nested table (재귀)
doc.fill_by_path({"성명 > right": "홍길동"})       # form fill by label
doc.save_to_path(out_path)
```

### Dependency-free fallback — prototype clone (`hwpx_table.py`)

Used when `python-hwpx` is absent. Covers simple, **merged**, and **nested**
N×M tables by cloning the styled cell from `table_proto.hwpx`. Drive it through
`build_table.py --spec`:

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

A cell value may be a **nested table** instead of a string:

```json
{ "rows": 2, "cols": 2,
  "cells": [
    [{ "table": { "rows": 2, "cols": 1, "cells": [["세부1"], ["세부2"]] } }, "B"],
    ["C", "D"] ] }
```

`merges` are validated: spans must stay in bounds and must not overlap, or
`TableSpecError` is raised.

## Filling form tables (`fill_form.py`)

Keys are `label > direction` paths; the value is written into the cell adjacent
to the cell whose text equals `label`.

```json
{ "성명 > right": "홍길동", "소속 > right": "플랫폼팀", "비고 > below": "해당없음" }
```

Directions: `right` (default if omitted), `left`, `below`, `above`. The result
JSON reports `applied_count`, `failed_count`, and `failed_paths` so you can tell
which labels were not found.

## Reading tables

`extract_text.py` exports tables as HTML `<table>` with `colspan`/`rowspan` (not
Markdown pipe tables) so merges and nesting are preserved:

```bash
python3 scripts/extract_text.py form.hwpx --format html -o out.html
```

For programmatic checks, `extract_text.extract_tables(path)` returns structured
data — `rowCnt`/`colCnt` and per-cell `row`/`col`/`colSpan`/`rowSpan`/`text`,
with each cell's own `tables` list recursing into nested tables.
