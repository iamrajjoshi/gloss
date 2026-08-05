import { describe, expect, it } from 'vitest';
import { makeDiff } from '../../test/factories';
import { buildTuiRows } from './row-model';
import { inlineTargetForRowSelection, rowIndexForMouseY, selectedTextForRows } from './selection';

describe('TUI selection helpers', () => {
  it('maps mouse y coordinates into visible diff row indexes', () => {
    expect(rowIndexForMouseY(4, 3, 10, 5, 20)).toBe(10);
    expect(rowIndexForMouseY(8, 3, 10, 5, 20)).toBe(14);
    expect(rowIndexForMouseY(9, 3, 10, 5, 20)).toBeNull();
  });

  it('copies selected visible text by row and column', () => {
    const rows = buildTuiRows(makeDiff({ cwd: '/repo', code: 'export const selected = true;' }));
    const text = selectedTextForRows(
      rows,
      { rowIndex: 2, column: 1 },
      { rowIndex: 2, column: 80 },
      100
    );

    expect(text).toContain('export const selected = true;');
  });

  it('derives a same-file same-side inline range from selected rows', () => {
    const rows = buildTuiRows(
      makeDiff({
        cwd: '/repo',
        rawDiff: '',
        code: 'unused'
      })
    );
    rows.push({
      ...rows[2],
      id: 'line-2',
      lineNumber: 2,
      newLine: 2,
      content: 'second();',
      plainText: '        2 + second();'
    });

    expect(inlineTargetForRowSelection(rows, 2, 3)).toMatchObject({
      filePath: 'app.ts',
      side: 'R',
      startLine: 1,
      endLine: 2,
      originalSnippet: 'unused\nsecond();'
    });
  });
});
