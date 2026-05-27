import type { Comment, DiffPayload } from '../shared/types';

interface DiffFixtureOptions {
  branch?: string | null;
  capturedAt?: string;
  code?: string;
  cwd: string;
  filePath?: string;
  rawDiff?: string;
}

interface CommentFixtureOptions {
  body?: string;
  createdAt?: string;
  endLine?: number;
  filePath?: string;
  id?: string;
  originalSnippet?: string;
  startLine?: number;
}

export function makeDiff(options: DiffFixtureOptions | string): DiffPayload {
  const {
    branch = 'raj--gloss--test',
    capturedAt = '2026-05-22T12:00:00.000Z',
    code = 'export const value = 1;',
    cwd,
    filePath = 'app.ts',
    rawDiff
  } = typeof options === 'string' ? { cwd: options } : options;

  return {
    base: { ref: 'HEAD', sha: 'abc1234' },
    branch,
    cwd,
    scope: {
      mode: 'working',
      requestedBase: null,
      base: { ref: 'HEAD', sha: 'abc1234' },
      comparison: { ref: 'working tree', sha: null },
      fallbackReason: null
    },
    stats: { files: 1, additions: 1, deletions: 0 },
    rawDiff: rawDiff ?? `diff --git a/${filePath} b/${filePath}\n+${code}\n`,
    files: [
      {
        path: filePath,
        oldPath: null,
        additions: 1,
        deletions: 0,
        isBinary: false,
        isDeleted: false,
        isNew: false,
        isRenamed: false,
        language: 'ts',
        hunks: [
          {
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: 1,
            header: '@@ -0,0 +1 @@',
            lines: [
              {
                type: 'add',
                oldLine: null,
                newLine: 1,
                content: code
              }
            ]
          }
        ]
      }
    ],
    capturedAt
  };
}

export function makeComment(options: CommentFixtureOptions | string = {}): Comment {
  const {
    body = 'Looks good.',
    createdAt = '2026-05-22T12:00:01.000Z',
    endLine = 1,
    filePath = 'app.ts',
    id = 'comment-1',
    originalSnippet = 'export const value = 1;',
    startLine = 1
  } = typeof options === 'string' ? { id: options } : options;

  return {
    id,
    filePath,
    startLine,
    endLine,
    side: 'R',
    body,
    originalSnippet,
    createdAt
  };
}
