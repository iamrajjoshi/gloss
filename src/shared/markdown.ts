import type { Comment, FeedbackBundle } from './types';

function formatLineRange(comment: Comment): string {
  const prefix = comment.side;
  if (comment.startLine === comment.endLine) {
    return `${prefix}${comment.startLine}`;
  }
  return `${prefix}${comment.startLine}-${prefix}${comment.endLine}`;
}

function fenceFor(snippet: string): string {
  let fence = '```';
  while (snippet.includes(fence)) {
    fence += '`';
  }
  return fence;
}

function languageForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    cjs: 'js',
    css: 'css',
    go: 'go',
    html: 'html',
    js: 'js',
    json: 'json',
    jsx: 'jsx',
    md: 'markdown',
    mjs: 'js',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    sh: 'bash',
    swift: 'swift',
    ts: 'ts',
    tsx: 'tsx',
    yaml: 'yaml',
    yml: 'yaml'
  };
  return ext ? (map[ext] ?? ext) : '';
}

function byFileThenLine(a: Comment, b: Comment): number {
  return (
    a.filePath.localeCompare(b.filePath) ||
    a.startLine - b.startLine ||
    a.endLine - b.endLine ||
    a.side.localeCompare(b.side)
  );
}

export function serializeFeedbackMarkdown(bundle: FeedbackBundle): string {
  const comments = [...bundle.comments].sort(byFileThenLine);
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
        lines.push(`${fence}${languageForPath(comment.filePath)}`, snippet, fence, '');
      }
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
