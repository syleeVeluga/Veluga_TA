import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ExcelJS from 'exceljs';
import XlsxViewer, {
  XLSX_MAX_RENDER_COLUMNS,
  XLSX_MAX_RENDER_ROWS,
  worksheetToSpreadsheetData,
} from '../src/renderer/features/file-viewer/viewers/XlsxViewer';

const viewerMapPath = path.resolve(
  process.cwd(),
  'src/renderer/features/file-viewer/viewer-map.ts'
);
const xlsxViewerPath = path.resolve(
  process.cwd(),
  'src/renderer/features/file-viewer/viewers/XlsxViewer.tsx'
);

describe('XlsxViewer stage 5', () => {
  it('converts worksheet rows into read-only spreadsheet cells', () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Budget');

    worksheet.getCell('A1').value = 'Label';
    worksheet.getCell('B1').value = 'Amount';
    worksheet.getCell('A2').value = 'Total';
    worksheet.getCell('B2').value = { formula: 'SUM(B3:B4)', result: 42 };

    const sheet = worksheetToSpreadsheetData(worksheet);

    expect(sheet.name).toBe('Budget');
    expect(sheet.data[0][0]).toEqual({ value: 'Label', readOnly: true });
    expect(sheet.data[0][1]).toEqual({ value: 'Amount', readOnly: true });
    expect(sheet.data[1][0]).toEqual({ value: 'Total', readOnly: true });
    expect(sheet.data[1][1]).toEqual({ value: '42', readOnly: true });
  });

  it('limits large sheets and reports truncation metadata', () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Large');

    worksheet.getCell(`A${XLSX_MAX_RENDER_ROWS + 1}`).value = 'not rendered';

    const sheet = worksheetToSpreadsheetData(worksheet);

    expect(sheet.truncated).toBe(true);
    expect(sheet.renderedRowCount).toBe(XLSX_MAX_RENDER_ROWS);
    expect(sheet.rowCount).toBe(XLSX_MAX_RENDER_ROWS + 1);
    expect(sheet.data[XLSX_MAX_RENDER_ROWS]).toBeUndefined();
  });

  it('limits wide sheets before rendering the spreadsheet grid', () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Wide');

    worksheet.getCell('A1').value = 'visible';
    worksheet.getCell(`${columnName(XLSX_MAX_RENDER_COLUMNS + 1)}1`).value = 'not rendered';

    const sheet = worksheetToSpreadsheetData(worksheet);

    expect(sheet.truncated).toBe(true);
    expect(sheet.renderedColumnCount).toBe(XLSX_MAX_RENDER_COLUMNS);
    expect(sheet.columnCount).toBe(XLSX_MAX_RENDER_COLUMNS + 1);
    expect(sheet.columnLabels).toHaveLength(XLSX_MAX_RENDER_COLUMNS);
    expect(sheet.data[0]).toHaveLength(1);
    expect(sheet.data[0][0]).toEqual({ value: 'visible', readOnly: true });
    expect(sheet.data[0][XLSX_MAX_RENDER_COLUMNS]).toBeUndefined();
  });

  it('renders a clear unsupported message for legacy xls files', () => {
    const markup = renderToStaticMarkup(
      React.createElement(XlsxViewer, {
        path: 'legacy.xls',
        readResult: undefined,
      })
    );

    expect(markup).toContain('Legacy .xls files are not supported');
  });

  it('activates xlsx in the viewer map and file read path', () => {
    const source = fs.readFileSync(viewerMapPath, 'utf8');

    expect(source).toContain("'xlsx',");
    expect(source).toContain("xlsx: lazy(() => import('./viewers/XlsxViewer'))");
  });

  it('uses ExcelJS and react-spreadsheet for workbook previews', () => {
    const source = fs.readFileSync(xlsxViewerPath, 'utf8');

    expect(source).toContain('import ExcelJS');
    expect(source).toContain("from 'react-spreadsheet'");
    expect(source).toContain('new ExcelJS.Workbook()');
    expect(source).toContain('workbook.xlsx');
    expect(source).toContain('worksheet.getRow');
  });
});

function columnName(columnNumber: number): string {
  let remaining = columnNumber;
  let name = '';
  while (remaining > 0) {
    remaining -= 1;
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    remaining = Math.floor(remaining / 26);
  }
  return name;
}
