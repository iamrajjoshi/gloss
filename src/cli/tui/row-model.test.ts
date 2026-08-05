import { describe, expect, it } from 'vitest';
import type { DiffFile, DiffPayload } from '../../shared/types';
import { makeDiff } from '../../test/factories';
import { buildTuiRows, formatRowDisplayText, lineTargetForRow } from './row-model';

describe('buildTuiRows', () => {
  it('normalizes text, binary, renamed, and deleted files', () => {
    const diff = makeDiff({ cwd: '/repo' });
    const binaryFile: DiffFile = {
      path: 'asset.png',
      oldPath: null,
      additions: 0,
      deletions: 0,
      isBinary: true,
      isDeleted: false,
      isNew: false,
      isRenamed: false,
      language: null,
      hunks: []
    };
    const renamedDeletedFile: DiffFile = {
      path: 'new-name.ts',
      oldPath: 'old-name.ts',
      additions: 0,
      deletions: 1,
      isBinary: false,
      isDeleted: true,
      isNew: false,
      isRenamed: true,
      language: 'ts',
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 0,
          newLines: 0,
          header: '@@ -1 +0,0 @@',
          lines: [{ type: 'delete', oldLine: 1, newLine: null, content: 'removed();' }]
        }
      ]
    };
    const rows = buildTuiRows({ files: [diff.files[0], binaryFile, renamedDeletedFile] });

    expect(rows.map((row) => row.kind)).toContain('binary');
    expect(
      rows.find((row) => row.kind === 'file' && row.filePath === 'new-name.ts')?.plainText
    ).toContain('renamed from old-name.ts');
    expect(rows.find((row) => row.kind === 'line' && row.filePath === 'new-name.ts')).toMatchObject(
      {
        side: 'L',
        lineNumber: 1,
        diffType: 'delete',
        targetable: true
      }
    );
  });

  it('creates inline targets for selectable diff lines', () => {
    const rows = buildTuiRows(makeDiff({ cwd: '/repo' }) satisfies Pick<DiffPayload, 'files'>);
    const line = rows.find((row) => row.kind === 'line');

    expect(lineTargetForRow(line)).toMatchObject({
      filePath: 'app.ts',
      side: 'R',
      startLine: 1,
      endLine: 1,
      originalSnippet: 'export const value = 1;'
    });
  });

  it('truncates rendered row text to the terminal width', () => {
    const rows = buildTuiRows(
      makeDiff({ cwd: '/repo', code: 'export const veryLongValue = true;' })
    );

    expect(formatRowDisplayText(rows[2], 18)).toMatch(/…$/);
  });
});
