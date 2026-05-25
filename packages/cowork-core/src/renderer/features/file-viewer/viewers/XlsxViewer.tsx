import { useEffect, useState } from 'react';
import ExcelJS, { type Cell, type CellErrorValue, type CellValue, type Worksheet } from 'exceljs';
import Spreadsheet, { type CellBase, type DataViewerProps, type Matrix } from 'react-spreadsheet';
import type { ViewerComponentProps } from '../viewer-map';
import { decodeBase64ArrayBuffer } from '../utils/base64';
import { readErrorMessage } from '../utils/read-result';

export const XLSX_MAX_RENDER_ROWS = 10_000;
export const XLSX_MAX_RENDER_COLUMNS = 200;

type XlsxCell = CellBase<string>;

interface XlsxSheetView {
  name: string;
  data: Matrix<XlsxCell>;
  rowLabels: string[];
  columnLabels: string[];
  rowCount: number;
  columnCount: number;
  renderedRowCount: number;
  renderedColumnCount: number;
  truncated: boolean;
}

function isLegacyXls(path: string): boolean {
  return path.split(/[?#]/, 1)[0]?.toLowerCase().endsWith('.xls') ?? false;
}

function isCellErrorValue(value: unknown): value is CellErrorValue {
  return typeof value === 'object' && value !== null && 'error' in value;
}

function isFormulaValue(
  value: CellValue
): value is Extract<CellValue, { formula: string } | { sharedFormula: string }> {
  return (
    typeof value === 'object' && value !== null && ('formula' in value || 'sharedFormula' in value)
  );
}

function formulaText(value: Extract<CellValue, { formula: string } | { sharedFormula: string }>) {
  if ('formula' in value && value.formula) {
    return `=${value.formula}`;
  }
  if ('sharedFormula' in value && value.sharedFormula) {
    return `=${value.sharedFormula}`;
  }
  return '';
}

function valueToText(value: CellValue | CellErrorValue | Date | number | string | boolean): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (isCellErrorValue(value)) {
    return value.error;
  }
  if ('richText' in value) {
    return value.richText.map((item) => item.text).join('');
  }
  if ('text' in value) {
    return value.text;
  }
  return '';
}

function cellToText(cell: Cell): string {
  const value = cell.value;
  if (isFormulaValue(value)) {
    return value.result === undefined ? formulaText(value) : valueToText(value.result);
  }
  if (cell.text) {
    return cell.text;
  }
  return valueToText(value);
}

function columnLabel(columnNumber: number): string {
  let remaining = columnNumber;
  let label = '';
  while (remaining > 0) {
    remaining -= 1;
    label = String.fromCharCode(65 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26);
  }
  return label;
}

export function worksheetToSpreadsheetData(
  worksheet: Worksheet,
  maxRows = XLSX_MAX_RENDER_ROWS,
  maxColumns = XLSX_MAX_RENDER_COLUMNS
): XlsxSheetView {
  const data: Matrix<XlsxCell> = [];
  const renderedRowCount = Math.min(worksheet.rowCount, maxRows);
  const renderedColumnCount = Math.min(worksheet.columnCount, maxColumns);

  for (let rowNumber = 1; rowNumber <= renderedRowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const cells: Array<XlsxCell | undefined> = [];
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (colNumber > maxColumns) {
        return;
      }
      cells[colNumber - 1] = { value: cellToText(cell), readOnly: true };
    });
    data[rowNumber - 1] = cells;
  }

  return {
    name: worksheet.name,
    data,
    rowLabels: Array.from({ length: renderedRowCount }, (_, index) => String(index + 1)),
    columnLabels: Array.from({ length: renderedColumnCount }, (_, index) =>
      columnLabel(index + 1)
    ),
    rowCount: worksheet.rowCount,
    columnCount: worksheet.columnCount,
    renderedRowCount,
    renderedColumnCount,
    truncated: worksheet.rowCount > maxRows || worksheet.columnCount > maxColumns,
  };
}

function XlsxDataViewer({ cell }: DataViewerProps<XlsxCell>) {
  return (
    <span className="block min-w-[5rem] max-w-[18rem] truncate px-2 py-1 text-xs text-text-primary">
      {cell?.value ?? ''}
    </span>
  );
}

export default function XlsxViewer({ path, readResult }: ViewerComponentProps) {
  const [sheets, setSheets] = useState<XlsxSheetView[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSheets([]);
    setActiveSheetIndex(0);
    setLoadError(false);

    if (isLegacyXls(path) || !readResult || 'error' in readResult) {
      return () => {
        cancelled = true;
      };
    }

    const arrayBuffer = decodeBase64ArrayBuffer(readResult.buffer);
    const workbook = new ExcelJS.Workbook();

    void workbook.xlsx
      .load(arrayBuffer as Parameters<typeof workbook.xlsx.load>[0])
      .then(() => {
        if (!cancelled) {
          setSheets(workbook.worksheets.map((worksheet) => worksheetToSpreadsheetData(worksheet)));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [path, readResult]);

  if (isLegacyXls(path)) {
    return (
      <div className="p-4 text-sm text-text-muted">
        Legacy .xls files are not supported in the preview panel. Convert the workbook to .xlsx to
        preview it here.
      </div>
    );
  }

  if (!readResult || 'error' in readResult) {
    return <div className="p-4 text-sm text-text-muted">{readErrorMessage(readResult)}</div>;
  }

  if (loadError) {
    return <div className="p-4 text-sm text-text-muted">Unable to render XLSX preview.</div>;
  }

  if (sheets.length === 0) {
    return <div className="p-4 text-sm text-text-muted">Loading workbook...</div>;
  }

  const activeSheet = sheets[Math.min(activeSheetIndex, sheets.length - 1)];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {sheets.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border-muted px-3 py-2">
          {sheets.map((sheet, index) => (
            <button
              key={sheet.name}
              type="button"
              onClick={() => setActiveSheetIndex(index)}
              className={`shrink-0 rounded-md px-2.5 py-1 text-xs transition-colors ${
                index === activeSheetIndex
                  ? 'bg-surface-active text-text-primary'
                  : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
      {activeSheet.truncated && (
        <div className="shrink-0 border-b border-border-muted bg-surface-muted px-3 py-2 text-xs text-text-muted">
          Showing first {activeSheet.renderedRowCount.toLocaleString()} of{' '}
          {activeSheet.rowCount.toLocaleString()} rows and{' '}
          {activeSheet.renderedColumnCount.toLocaleString()} of{' '}
          {activeSheet.columnCount.toLocaleString()} columns.
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {activeSheet.data.length === 0 ? (
          <div className="text-sm text-text-muted">This sheet is empty.</div>
        ) : (
          <Spreadsheet
            data={activeSheet.data}
            rowLabels={activeSheet.rowLabels}
            columnLabels={activeSheet.columnLabels}
            DataViewer={XlsxDataViewer}
            className="text-xs"
          />
        )}
      </div>
    </div>
  );
}
