import stringWidth from 'string-width';
import { formatRowDisplayText, type InlineCommentTarget, type TuiDiffRow } from './row-model';

export interface MouseRowPoint {
  rowIndex: number;
  column: number;
}

export function rowIndexForMouseY(
  y: number,
  headerHeight: number,
  scrollTop: number,
  viewportHeight: number,
  rowCount: number
): number | null {
  const relativeY = y - headerHeight - 1;
  if (relativeY < 0 || relativeY >= viewportHeight) {
    return null;
  }
  const rowIndex = scrollTop + relativeY;
  return rowIndex >= 0 && rowIndex < rowCount ? rowIndex : null;
}

export function selectedTextForRows(
  rows: TuiDiffRow[],
  start: MouseRowPoint,
  end: MouseRowPoint,
  width: number
): string {
  const first = start.rowIndex <= end.rowIndex ? start : end;
  const last = start.rowIndex <= end.rowIndex ? end : start;
  const selectedRows = rows.slice(first.rowIndex, last.rowIndex + 1);
  return selectedRows
    .map((row, index) => {
      const text = formatRowDisplayText(row, width);
      if (selectedRows.length === 1) {
        return sliceByDisplayColumns(
          text,
          Math.min(first.column, last.column),
          Math.max(first.column, last.column)
        );
      }
      if (index === 0) {
        return sliceByDisplayColumns(text, first.column, Number.POSITIVE_INFINITY);
      }
      if (index === selectedRows.length - 1) {
        return sliceByDisplayColumns(text, 1, last.column);
      }
      return text;
    })
    .join('\n');
}

export function inlineTargetForRowSelection(
  rows: TuiDiffRow[],
  startRowIndex: number,
  endRowIndex: number
): InlineCommentTarget | null {
  const start = Math.min(startRowIndex, endRowIndex);
  const end = Math.max(startRowIndex, endRowIndex);
  const selectedRows = rows.slice(start, end + 1);
  if (selectedRows.length === 0 || selectedRows.some((row) => row.kind !== 'line')) {
    return null;
  }

  const first = selectedRows[0];
  if (!first?.filePath || !first.side || first.lineNumber === null) {
    return null;
  }

  const lineNumbers: number[] = [];
  for (const row of selectedRows) {
    if (row.filePath !== first.filePath || row.side !== first.side || row.lineNumber === null) {
      return null;
    }
    lineNumbers.push(row.lineNumber);
  }

  const sorted = [...lineNumbers].sort((a, b) => a - b);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] !== sorted[index - 1] + 1) {
      return null;
    }
  }

  return {
    filePath: first.filePath,
    side: first.side,
    startLine: sorted[0],
    endLine: sorted[sorted.length - 1],
    originalSnippet: selectedRows.map((row) => row.content).join('\n')
  };
}

function sliceByDisplayColumns(value: string, startColumn: number, endColumn: number): string {
  const start = Math.max(1, startColumn);
  let used = 1;
  let output = '';
  for (const char of Array.from(value)) {
    const next = used + Math.max(1, stringWidth(char));
    if (next > start && used <= endColumn) {
      output += char;
    }
    if (used > endColumn) {
      break;
    }
    used = next;
  }
  return output;
}
