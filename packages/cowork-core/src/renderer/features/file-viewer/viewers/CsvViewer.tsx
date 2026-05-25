import type { ViewerComponentProps } from '../viewer-map';
import { readErrorMessage, textFromReadResult } from '../utils/read-result';

function parseDelimited(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && next === '\n') {
        i += 1;
      }
      continue;
    }

    cell += char;
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

export default function CsvViewer({ path, readResult }: ViewerComponentProps) {
  const text = textFromReadResult(readResult);

  if (text === null) {
    return <div className="p-4 text-sm text-text-muted">{readErrorMessage(readResult)}</div>;
  }

  const delimiter = path.toLowerCase().endsWith('.tsv') ? '\t' : ',';
  const rows = parseDelimited(text, delimiter);
  const [header, ...body] = rows;

  return (
    <div className="h-full overflow-auto p-4">
      <table className="min-w-full border-collapse text-left text-sm">
        {header && (
          <thead>
            <tr>
              {header.map((cell, index) => (
                <th
                  key={index}
                  className="border border-border px-3 py-2 font-semibold text-text-primary bg-surface-muted"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border border-border px-3 py-2 text-text-primary">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
