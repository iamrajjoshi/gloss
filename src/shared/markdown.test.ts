import { describe, expect, it } from 'vitest';
import { serializeFeedbackMarkdown } from './markdown';
import type { FeedbackBundle } from './types';

describe('serializeFeedbackMarkdown', () => {
  it('sorts comments by file and line with side-prefixed headings', () => {
    const bundle: FeedbackBundle = {
      version: 1,
      reviewId: '01HFXJ3K7Z6E2BQYR4M0V8N5DH',
      timestamp: '2026-05-21T14:32:11Z',
      base: { ref: 'HEAD', sha: 'a3f8b21ffffff' },
      branch: 'raj--gloss--test',
      comments: [
        {
          id: 'b',
          filePath: 'src/server/handler.ts',
          startLine: 42,
          endLine: 42,
          side: 'L',
          body: 'wrap in tx helper',
          originalSnippet: 'await db.query(...)',
          createdAt: '2026-05-21T14:32:11Z'
        },
        {
          id: 'a',
          filePath: 'CurrentPackage/Sources/CurrentFeature/ContentView.swift',
          startLine: 294,
          endLine: 295,
          side: 'R',
          body: 'extract constants',
          originalSnippet: 'if model.isToday { return 42 }\nreturn 64',
          createdAt: '2026-05-21T14:32:10Z'
        }
      ]
    };

    expect(serializeFeedbackMarkdown(bundle)).toMatchInlineSnapshot(`
      "# Gloss feedback - 2026-05-21T14:32:11Z
      Review: 01HFXJ3K7Z6E2BQYR4M0V8N5DH
      Base: HEAD (a3f8b21)  Branch: raj--gloss--test
      Files: 2   Comments: 2

      ## CurrentPackage/Sources/CurrentFeature/ContentView.swift

      ### R294-R295
      extract constants

      \`\`\`swift
      if model.isToday { return 42 }
      return 64
      \`\`\`

      ## src/server/handler.ts

      ### L42 - \`await db.query(...)\`
      wrap in tx helper

      \`\`\`ts
      await db.query(...)
      \`\`\`
      "
    `);
  });
});
