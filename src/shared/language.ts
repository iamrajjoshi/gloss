import path from 'node:path';

const languageByExtension: Record<string, string> = {
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

export function languageForPath(filePath: string): string | null {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (!ext) {
    return null;
  }
  return languageByExtension[ext] ?? ext;
}
