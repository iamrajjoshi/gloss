import { describe, expect, it } from 'vitest';
import { isFeedbackBundle } from './validation';

describe('isFeedbackBundle', () => {
  it('accepts legacy line comments without an explicit kind', () => {
    expect(
      isFeedbackBundle({
        version: 1,
        reviewId: 'review-1',
        timestamp: '2026-05-21T14:32:11Z',
        base: { ref: 'HEAD', sha: 'a3f8b21ffffff' },
        branch: 'raj--gloss--test',
        comments: [
          {
            id: 'comment-1',
            filePath: 'src/app.ts',
            startLine: 1,
            endLine: 1,
            side: 'R',
            body: 'fix this',
            originalSnippet: 'const value = 1;',
            createdAt: '2026-05-21T14:32:11Z'
          }
        ]
      })
    ).toBe(true);
  });

  it('accepts review-level general comments', () => {
    expect(
      isFeedbackBundle({
        version: 1,
        reviewId: 'review-1',
        timestamp: '2026-05-21T14:32:11Z',
        base: { ref: 'HEAD', sha: 'a3f8b21ffffff' },
        branch: 'raj--gloss--test',
        comments: [
          {
            kind: 'general',
            id: 'comment-1',
            body: 'Please update the docs too.',
            createdAt: '2026-05-21T14:32:11Z'
          }
        ]
      })
    ).toBe(true);
  });
});
