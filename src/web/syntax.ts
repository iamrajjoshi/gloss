import bash from '@shikijs/langs/bash';
import css from '@shikijs/langs/css';
import go from '@shikijs/langs/go';
import html from '@shikijs/langs/html';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import jsx from '@shikijs/langs/jsx';
import markdown from '@shikijs/langs/markdown';
import python from '@shikijs/langs/python';
import ruby from '@shikijs/langs/ruby';
import rust from '@shikijs/langs/rust';
import swift from '@shikijs/langs/swift';
import tsx from '@shikijs/langs/tsx';
import typescript from '@shikijs/langs/typescript';
import yaml from '@shikijs/langs/yaml';
import githubDarkDefault from '@shikijs/themes/github-dark-default';
import { createHighlighterCore, type HighlighterCore, type ThemedToken } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import wasm from 'shiki/wasm';
import type { DiffFile, DiffLine, Side } from '../shared/types';

export interface SyntaxToken {
  color?: string;
  content: string;
  fontStyle?: number;
  offset: number;
}

export type HighlightedDiffLines = Map<string, SyntaxToken[]>;

const diffTheme = 'github-dark-default';
const supportedLanguages = [
  bash,
  css,
  go,
  html,
  javascript,
  json,
  jsx,
  markdown,
  python,
  ruby,
  rust,
  swift,
  tsx,
  typescript,
  yaml
];

const shikiLanguageByGlossLanguage: Record<string, string> = {
  bash: 'bash',
  css: 'css',
  go: 'go',
  html: 'html',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  markdown: 'markdown',
  python: 'python',
  ruby: 'ruby',
  rust: 'rust',
  swift: 'swift',
  ts: 'typescript',
  tsx: 'tsx',
  yaml: 'yaml'
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

export function shikiLanguageForGlossLanguage(language: string | null): string | null {
  return language ? (shikiLanguageByGlossLanguage[language] ?? null) : null;
}

export async function highlightDiffFile(file: DiffFile): Promise<HighlightedDiffLines | null> {
  const language = shikiLanguageForGlossLanguage(file.language);
  if (!language || file.isBinary) {
    return null;
  }

  const highlighter = await getDiffHighlighter();
  const highlightedLines: HighlightedDiffLines = new Map();

  for (const hunk of file.hunks) {
    const tokensByLine = highlighter.codeToTokens(
      hunk.lines.map((line) => line.content).join('\n'),
      {
        lang: language,
        theme: diffTheme
      }
    ).tokens;

    hunk.lines.forEach((line, index) => {
      const side = sideForLine(line);
      const lineNumber = lineNumberForLine(line);
      if (lineNumber == null) {
        return;
      }
      highlightedLines.set(rowKey(side, lineNumber), toSyntaxTokens(tokensByLine[index] ?? []));
    });
  }

  return highlightedLines;
}

export function rowKey(side: Side, line: number): string {
  return `${side}:${line}`;
}

function getDiffHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [githubDarkDefault],
    langs: supportedLanguages,
    engine: createOnigurumaEngine(wasm)
  });
  return highlighterPromise;
}

function toSyntaxTokens(tokens: ThemedToken[]): SyntaxToken[] {
  return tokens.map((token) => ({
    color: token.color,
    content: token.content,
    fontStyle: token.fontStyle,
    offset: token.offset
  }));
}

function sideForLine(line: DiffLine): Side {
  return line.type === 'delete' ? 'L' : 'R';
}

function lineNumberForLine(line: DiffLine): number | null {
  return sideForLine(line) === 'L' ? line.oldLine : line.newLine;
}
