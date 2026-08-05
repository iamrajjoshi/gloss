import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';
import wrapAnsi from 'wrap-ansi';
import { diffLineNumber, diffLineSide } from '../../shared/diff-lines';
import type { DiffFile, DiffLineType, DiffPayload, Side } from '../../shared/types';

export type TuiRowKind = 'file' | 'hunk' | 'line' | 'binary' | 'empty';

export interface TuiDiffRow {
  id: string;
  kind: TuiRowKind;
  filePath: string | null;
  oldPath: string | null;
  side: Side | null;
  lineNumber: number | null;
  oldLine: number | null;
  newLine: number | null;
  diffType: DiffLineType | null;
  marker: string;
  content: string;
  plainText: string;
  selectable: boolean;
  targetable: boolean;
}

export interface InlineCommentTarget {
  filePath: string;
  side: Side;
  startLine: number;
  endLine: number;
  originalSnippet: string;
}

const minRowWidth = 20;

export function buildTuiRows(diff: Pick<DiffPayload, 'files'>): TuiDiffRow[] {
  if (diff.files.length === 0) {
    return [
      {
        id: 'empty',
        kind: 'empty',
        filePath: null,
        oldPath: null,
        side: null,
        lineNumber: null,
        oldLine: null,
        newLine: null,
        diffType: null,
        marker: '',
        content: 'No changes to review.',
        plainText: 'No changes to review.',
        selectable: false,
        targetable: false
      }
    ];
  }

  return diff.files.flatMap((file, fileIndex) => rowsForFile(file, fileIndex));
}

export function visibleTuiRows(
  rows: TuiDiffRow[],
  scrollTop: number,
  viewportHeight: number
): TuiDiffRow[] {
  return rows.slice(scrollTop, scrollTop + Math.max(1, viewportHeight));
}

export function formatRowDisplayText(row: TuiDiffRow, width: number): string {
  const maxWidth = Math.max(minRowWidth, width);
  const plain = stripAnsi(row.plainText);
  if (stringWidth(plain) > maxWidth) {
    return truncateToWidth(plain, maxWidth);
  }

  const wrapped = wrapAnsi(plain, maxWidth, {
    hard: true,
    trim: false
  });
  const firstLine = wrapped.split('\n')[0] ?? '';
  return truncateToWidth(firstLine, maxWidth);
}

export function lineTargetForRow(row: TuiDiffRow | undefined): InlineCommentTarget | null {
  if (!row || row.kind !== 'line' || !row.filePath || !row.side || row.lineNumber === null) {
    return null;
  }

  return {
    filePath: row.filePath,
    side: row.side,
    startLine: row.lineNumber,
    endLine: row.lineNumber,
    originalSnippet: row.content
  };
}

export function formatInlineTarget(target: InlineCommentTarget): string {
  const start = Math.min(target.startLine, target.endLine);
  const end = Math.max(target.startLine, target.endLine);
  const range =
    start === end ? `${target.side}${start}` : `${target.side}${start}-${target.side}${end}`;
  return `${target.filePath} ${range}`;
}

export function truncateToWidth(value: string, width: number): string {
  const plain = stripAnsi(value);
  if (stringWidth(plain) <= width) {
    return plain;
  }

  const ellipsis = '…';
  const targetWidth = Math.max(0, width - stringWidth(ellipsis));
  let output = '';
  let used = 0;
  for (const char of Array.from(plain)) {
    const charWidth = stringWidth(char);
    if (used + charWidth > targetWidth) {
      break;
    }
    output += char;
    used += charWidth;
  }
  return `${output}${ellipsis}`;
}

function rowsForFile(file: DiffFile, fileIndex: number): TuiDiffRow[] {
  const rows: TuiDiffRow[] = [
    {
      id: `file:${fileIndex}:${file.path}`,
      kind: 'file',
      filePath: file.path,
      oldPath: file.oldPath,
      side: null,
      lineNumber: null,
      oldLine: null,
      newLine: null,
      diffType: null,
      marker: '',
      content: fileHeader(file),
      plainText: fileHeader(file),
      selectable: false,
      targetable: false
    }
  ];

  if (file.isBinary) {
    rows.push({
      id: `binary:${fileIndex}:${file.path}`,
      kind: 'binary',
      filePath: file.path,
      oldPath: file.oldPath,
      side: null,
      lineNumber: null,
      oldLine: null,
      newLine: null,
      diffType: null,
      marker: '',
      content: 'Binary file changed.',
      plainText: '  Binary file changed.',
      selectable: false,
      targetable: false
    });
    return rows;
  }

  for (const [hunkIndex, hunk] of file.hunks.entries()) {
    rows.push({
      id: `hunk:${fileIndex}:${hunkIndex}:${file.path}`,
      kind: 'hunk',
      filePath: file.path,
      oldPath: file.oldPath,
      side: null,
      lineNumber: null,
      oldLine: null,
      newLine: null,
      diffType: null,
      marker: '',
      content: hunk.header,
      plainText: `  ${hunk.header}`,
      selectable: false,
      targetable: false
    });

    for (const [lineIndex, line] of hunk.lines.entries()) {
      const side = diffLineSide(line);
      const lineNumber = diffLineNumber(line);
      const marker = markerForLine(line.type);
      rows.push({
        id: `line:${fileIndex}:${hunkIndex}:${lineIndex}:${side}:${lineNumber ?? 'x'}`,
        kind: 'line',
        filePath: file.path,
        oldPath: file.oldPath,
        side,
        lineNumber,
        oldLine: line.oldLine,
        newLine: line.newLine,
        diffType: line.type,
        marker,
        content: line.content,
        plainText: `${formatLineNumber(line.oldLine)} ${formatLineNumber(line.newLine)} ${marker} ${line.content}`,
        selectable: true,
        targetable: lineNumber !== null
      });
    }
  }

  return rows;
}

function fileHeader(file: DiffFile): string {
  const rename = file.isRenamed && file.oldPath ? ` (renamed from ${file.oldPath})` : '';
  const state = file.isNew ? ' new' : file.isDeleted ? ' deleted' : '';
  return `${file.path}${rename}${state} (+${file.additions} -${file.deletions})`;
}

function markerForLine(type: DiffLineType): string {
  if (type === 'add') {
    return '+';
  }
  if (type === 'delete') {
    return '-';
  }
  return ' ';
}

function formatLineNumber(line: number | null): string {
  return line === null ? '    ' : String(line).padStart(4, ' ');
}
