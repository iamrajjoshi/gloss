import { compareCommentsByLocation, formatLineRange, isLineComment } from './comments';
import { languageForPath } from './language';
import { reviewScopeLabel } from './review-scope';
import type { FeedbackBundle, LineComment } from './types';

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
  const comments = bundle.comments.toSorted(compareCommentsByLocation);
  const generalComments = comments.filter((comment) => !isLineComment(comment));
  const lineComments = comments.filter(isLineComment);
  const commentsByFile = new Map<string, LineComment[]>();
  const files: string[] = [];
  for (const comment of lineComments) {
    const fileComments = commentsByFile.get(comment.filePath);
    if (fileComments) {
      fileComments.push(comment);
    } else {
      commentsByFile.set(comment.filePath, [comment]);
      files.push(comment.filePath);
    }
  }
  const lines: string[] = [
    `# Gloss feedback - ${bundle.timestamp}`,
    `Review: ${bundle.reviewId}`,
    ...(bundle.turnIndex ? [`Turn: ${bundle.turnIndex} (${bundle.turnId ?? 'unknown'})`] : []),
    ...(bundle.reviewScope ? [`Review scope: ${reviewScopeLabel(bundle.reviewScope)}`] : []),
    `Base: ${bundle.base.ref} (${bundle.base.sha.slice(0, 7)})  Branch: ${bundle.branch ?? '(detached)'}`,
    `Files: ${files.length}   Comments: ${comments.length}`,
    ''
  ];

  if (generalComments.length > 0) {
    lines.push('## General comments', '');
    for (const comment of generalComments) {
      lines.push(`### ${comment.id}`, comment.body.trim(), '');
    }
  }

  for (const filePath of files) {
    lines.push(`## ${filePath}`, '');
    for (const comment of commentsByFile.get(filePath) ?? []) {
      const snippet = comment.originalSnippet.trimEnd();
      const firstSnippetLine = firstNonEmptyLine(snippet);
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

function firstNonEmptyLine(text: string): string | undefined {
  for (const line of text.split('\n')) {
    if (line.trim().length > 0) {
      return line;
    }
  }
  return undefined;
}
