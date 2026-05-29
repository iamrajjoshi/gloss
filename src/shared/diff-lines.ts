import type { DiffLine, Side } from './types';

export function diffLineSide(line: DiffLine): Side {
  return line.type === 'delete' ? 'L' : 'R';
}

export function diffLineNumber(line: DiffLine): number | null {
  return diffLineSide(line) === 'L' ? line.oldLine : line.newLine;
}

export function diffLineKey(side: Side, line: number): string {
  return `${side}:${line}`;
}
