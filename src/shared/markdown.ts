import { compareCommentsByLocation, formatLineRange } from './comments';
import { languageForPath } from './language';
import type { FeedbackBundle } from './types';

function fenceFor(snippet: string): string {
  let fence = '```';
  while (snippet.includes(fence)) {
    fence += '`';
  }
  return fence;
}

function languageForSnippet(filePath: string, snippet: string): string {
  const lines = snippet.split('\n').filter((line) => line.length > 0);
  const looksLikeUnifiedDiff =
    lines.length > 0 &&
    lines.some((line) => line.startsWith('+') || line.startsWith('-')) &&
    lines.every((line) => line.startsWith('+') || line.startsWith('-') || line.startsWith(' '));
  return looksLikeUnifiedDiff ? 'diff' : (languageForPath(filePath) ?? '');
}

export function serializeFeedbackMarkdown(bundle: FeedbackBundle): string {
  const comments = [...bundle.comments].sort(compareCommentsByLocation);
  const files = [...new Set(comments.map((comment) => comment.filePath))];
  const lines: string[] = [
    `# Gloss feedback - ${bundle.timestamp}`,
    `Review: ${bundle.reviewId}`,
    `Base: ${bundle.base.ref} (${bundle.base.sha.slice(0, 7)})  Branch: ${bundle.branch ?? '(detached)'}`,
    `Files: ${files.length}   Comments: ${comments.length}`,
    ''
  ];

  for (const filePath of files) {
    lines.push(`## ${filePath}`, '');
    for (const comment of comments.filter((item) => item.filePath === filePath)) {
      const snippet = comment.originalSnippet.trimEnd();
      const firstSnippetLine = snippet.split('\n').find((line) => line.trim().length > 0);
      const heading =
        comment.startLine === comment.endLine && firstSnippetLine
          ? `### ${formatLineRange(comment)} - \`${firstSnippetLine.trim().slice(0, 80)}\``
          : `### ${formatLineRange(comment)}`;
      lines.push(heading, comment.body.trim(), '');
      if (snippet) {
        const fence = fenceFor(snippet);
        lines.push(`${fence}${languageForSnippet(comment.filePath, snippet)}`, snippet, fence, '');
      }
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
