import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { languageForPath } from '../shared/language';
import type { SourcePeekResponse } from '../shared/types';
import { SOURCE_PEEK_MAX_BYTES, type SourcePeekMatchReason } from '../shared/types';

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const PATH_CONFIG_FILES = ['tsconfig.json', 'jsconfig.json'];
const IGNORED_SEARCH_PATHS = ['node_modules', 'dist', 'build', 'coverage', '.git'];
const IDENTIFIER_PATTERN = '[A-Za-z_$][\\w$]*';
const SOURCE_PEEK_CONTEXT_LINES = 520;
const SOURCE_PEEK_TARGET_CONTEXT_LINES = 240;

interface SourcePeekOptions {
  repoRoot: string;
  sourceFilePath: string;
  sourceRef: string | null;
  symbol: string;
  line: number;
  column: number;
}

interface ImportBinding {
  importedName: string;
  kind: 'default' | 'named' | 'namespace';
  localName: string;
  moduleSpecifier: string;
}

interface ReExportBinding {
  exportedName: string;
  importedName: string;
  moduleSpecifier: string;
}

interface PathAlias {
  pattern: string;
  replacements: string[];
}

interface PathAliasConfig {
  baseUrl: string | null;
  aliases: PathAlias[];
}

interface DefinitionMatch {
  column: number;
  line: number;
}

interface ModuleFile {
  content: string;
  filePath: string;
}

interface ReferenceToken {
  namespace: string | null;
  symbol: string;
}

export async function resolveSourcePeek({
  column,
  line,
  repoRoot,
  sourceFilePath,
  sourceRef,
  symbol
}: SourcePeekOptions): Promise<SourcePeekResponse> {
  const sourceContent = await readRepoText(repoRoot, sourceRef, sourceFilePath);
  const sourceLines = splitFileLines(sourceContent);
  const reference = referenceTokenAt(sourceLines[line - 1] ?? '', column, symbol);
  const imports = parseImportBindings(sourceContent);
  const aliasConfig = await loadPathAliasConfig(repoRoot);
  const importedCandidates = candidateImportsForReference(imports, reference);

  for (const candidate of importedCandidates) {
    const resolved = await resolveImportedTarget({
      aliasConfig,
      importedName: candidate.targetSymbol,
      matchReason: 'import',
      moduleSpecifier: candidate.moduleSpecifier,
      repoRoot,
      sourceFilePath,
      sourceRef,
      symbol
    });
    if (resolved) {
      return resolved;
    }
  }

  const sameFileMatch = findDefinition(sourceContent, symbol);
  if (sameFileMatch) {
    return responseForMatch({
      column: sameFileMatch.column,
      content: sourceContent,
      filePath: sourceFilePath,
      line: sameFileMatch.line,
      matchReason: 'same-file',
      symbol,
      targetSymbol: symbol
    });
  }

  const searched = await searchRepoDefinition(repoRoot, sourceRef, symbol);
  if (searched) {
    return responseForMatch({
      ...searched,
      matchReason: 'repo-search',
      symbol,
      targetSymbol: symbol
    });
  }

  throw new Error(`No definition found for ${symbol}`);
}

async function resolveImportedTarget({
  aliasConfig,
  importedName,
  matchReason,
  moduleSpecifier,
  repoRoot,
  sourceFilePath,
  sourceRef,
  symbol
}: {
  aliasConfig: PathAliasConfig;
  importedName: string;
  matchReason: SourcePeekMatchReason;
  moduleSpecifier: string;
  repoRoot: string;
  sourceFilePath: string;
  sourceRef: string | null;
  symbol: string;
}): Promise<SourcePeekResponse | null> {
  const moduleFile = await firstExistingModuleFile(
    repoRoot,
    sourceRef,
    moduleCandidates(repoRoot, aliasConfig, sourceFilePath, moduleSpecifier)
  );
  if (!moduleFile) {
    return null;
  }

  const targetMatch = findDefinition(moduleFile.content, importedName);
  if (targetMatch) {
    return responseForMatch({
      column: targetMatch.column,
      content: moduleFile.content,
      filePath: moduleFile.filePath,
      line: targetMatch.line,
      matchReason,
      symbol,
      targetSymbol: importedName
    });
  }

  const reExported = await resolveReExport({
    aliasConfig,
    content: moduleFile.content,
    depth: 0,
    repoRoot,
    sourceFilePath: moduleFile.filePath,
    sourceRef,
    symbol,
    targetSymbol: importedName
  });
  if (reExported) {
    return reExported;
  }

  if (importedName === 'default') {
    const fallbackLine = firstMeaningfulLine(moduleFile.content);
    return responseForMatch({
      column: 0,
      content: moduleFile.content,
      filePath: moduleFile.filePath,
      line: fallbackLine,
      matchReason: 'module',
      symbol,
      targetSymbol: importedName
    });
  }

  return null;
}

async function resolveReExport({
  aliasConfig,
  content,
  depth,
  repoRoot,
  sourceFilePath,
  sourceRef,
  symbol,
  targetSymbol
}: {
  aliasConfig: PathAliasConfig;
  content: string;
  depth: number;
  repoRoot: string;
  sourceFilePath: string;
  sourceRef: string | null;
  symbol: string;
  targetSymbol: string;
}): Promise<SourcePeekResponse | null> {
  if (depth > 3) {
    return null;
  }

  for (const binding of parseReExportBindings(content)) {
    if (binding.exportedName !== '*' && binding.exportedName !== targetSymbol) {
      continue;
    }
    const nextTarget = binding.importedName === '*' ? targetSymbol : binding.importedName;
    const moduleFile = await firstExistingModuleFile(
      repoRoot,
      sourceRef,
      moduleCandidates(repoRoot, aliasConfig, sourceFilePath, binding.moduleSpecifier)
    );
    if (!moduleFile) {
      continue;
    }
    const match = findDefinition(moduleFile.content, nextTarget);
    if (match) {
      return responseForMatch({
        column: match.column,
        content: moduleFile.content,
        filePath: moduleFile.filePath,
        line: match.line,
        matchReason: 'import',
        symbol,
        targetSymbol: nextTarget
      });
    }
    const nested = await resolveReExport({
      aliasConfig,
      content: moduleFile.content,
      depth: depth + 1,
      repoRoot,
      sourceFilePath: moduleFile.filePath,
      sourceRef,
      symbol,
      targetSymbol: nextTarget
    });
    if (nested) {
      return nested;
    }
  }

  return null;
}

async function searchRepoDefinition(
  repoRoot: string,
  sourceRef: string | null,
  symbol: string
): Promise<({ content: string; filePath: string } & DefinitionMatch) | null> {
  const grepPattern = definitionGrepPattern(symbol);
  const args = ['grep', '-n', '-I', '-E', grepPattern];
  if (sourceRef) {
    args.push(sourceRef);
  }
  args.push('--', '.');
  for (const ignoredPath of IGNORED_SEARCH_PATHS) {
    args.push(`:!${ignoredPath}`);
  }

  let output = '';
  try {
    output = (await execa('git', args, { cwd: repoRoot })).stdout;
  } catch (error) {
    if (isExitCode(error, 1)) {
      return null;
    }
    throw error;
  }

  for (const rawLine of output.split('\n')) {
    const parsed = parseGrepLine(rawLine, sourceRef);
    if (!parsed) {
      continue;
    }
    const content = await readRepoText(repoRoot, sourceRef, parsed.filePath).catch(() => null);
    if (!content) {
      continue;
    }
    const match = findDefinition(content, symbol);
    if (!match) {
      continue;
    }
    return {
      column: match.column,
      content,
      filePath: parsed.filePath,
      line: match.line
    };
  }

  return null;
}

async function readRepoText(
  repoRoot: string,
  ref: string | null,
  filePath: string
): Promise<string> {
  if (ref === null) {
    return readFile(path.resolve(repoRoot, filePath), 'utf8');
  }
  return (await execa('git', ['show', `${ref}:${filePath}`], { cwd: repoRoot })).stdout;
}

function responseForMatch({
  column,
  content,
  filePath,
  line,
  matchReason,
  symbol,
  targetSymbol
}: {
  column: number;
  content: string;
  filePath: string;
  line: number;
  matchReason: SourcePeekMatchReason;
  symbol: string;
  targetSymbol: string;
}): SourcePeekResponse {
  const limited = limitContentAroundLine(content, line);
  return {
    symbol,
    targetSymbol,
    filePath,
    startLine: limited.startLine,
    line,
    column,
    language: languageForPath(filePath),
    content: limited.content,
    truncated: limited.truncated,
    matchReason
  };
}

function limitContentAroundLine(
  content: string,
  line: number
): {
  content: string;
  startLine: number;
  truncated: boolean;
} {
  if (Buffer.byteLength(content, 'utf8') <= SOURCE_PEEK_MAX_BYTES) {
    return { content, startLine: 1, truncated: false };
  }

  const lines = splitFileLines(content);
  const targetIndex = Math.max(0, line - 1);
  const preferredStartIndex = Math.max(0, targetIndex - SOURCE_PEEK_TARGET_CONTEXT_LINES);
  const preferredEndIndex = Math.min(lines.length, preferredStartIndex + SOURCE_PEEK_CONTEXT_LINES);
  let startIndex = preferredStartIndex;
  let endIndex = preferredEndIndex;
  let limitedContent = lines.slice(startIndex, endIndex).join('\n');

  while (
    Buffer.byteLength(limitedContent, 'utf8') > SOURCE_PEEK_MAX_BYTES &&
    endIndex - startIndex > 1
  ) {
    if (targetIndex - startIndex > endIndex - targetIndex - 1) {
      startIndex += 1;
    } else {
      endIndex -= 1;
    }
    limitedContent = lines.slice(startIndex, endIndex).join('\n');
  }

  if (Buffer.byteLength(limitedContent, 'utf8') > SOURCE_PEEK_MAX_BYTES) {
    limitedContent = truncateUtf8(limitedContent, SOURCE_PEEK_MAX_BYTES);
  }

  return {
    content: limitedContent,
    startLine: startIndex + 1,
    truncated: true
  };
}

function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return value;
  }
  return buffer
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/\uFFFD$/, '');
}

function candidateImportsForReference(
  imports: ImportBinding[],
  reference: ReferenceToken
): Array<{ moduleSpecifier: string; targetSymbol: string }> {
  if (reference.namespace) {
    return imports
      .filter(
        (binding) => binding.kind === 'namespace' && binding.localName === reference.namespace
      )
      .map((binding) => ({
        moduleSpecifier: binding.moduleSpecifier,
        targetSymbol: reference.symbol
      }));
  }

  return imports
    .filter((binding) => binding.localName === reference.symbol)
    .map((binding) => ({
      moduleSpecifier: binding.moduleSpecifier,
      targetSymbol: binding.importedName
    }));
}

function referenceTokenAt(line: string, column: number, symbol: string): ReferenceToken {
  let start = Math.min(Math.max(column, 0), line.length);
  if (line.slice(start, start + symbol.length) !== symbol) {
    const beforeOrAt = line.lastIndexOf(symbol, start);
    start = beforeOrAt >= 0 ? beforeOrAt : line.indexOf(symbol);
  }
  if (start < 0) {
    return { namespace: null, symbol };
  }

  const namespaceMatch = line.slice(0, start).match(/([A-Za-z_$][\w$]*)\s*\.\s*$/);
  return {
    namespace: namespaceMatch?.[1] ?? null,
    symbol
  };
}

function parseImportBindings(content: string): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  const importRegex = /^\s*import\s+(?:type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"];?/gm;
  let match = importRegex.exec(content);
  while (match !== null) {
    const body = match[1]?.trim() ?? '';
    const moduleSpecifier = match[2] ?? '';
    for (const part of splitImportParts(body)) {
      if (part.startsWith('{') && part.endsWith('}')) {
        bindings.push(
          ...parseNamedBindings(part).map((binding) => ({
            ...binding,
            kind: 'named' as const,
            moduleSpecifier
          }))
        );
        continue;
      }

      const namespaceMatch = part.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (namespaceMatch?.[1]) {
        bindings.push({
          importedName: '*',
          kind: 'namespace',
          localName: namespaceMatch[1],
          moduleSpecifier
        });
        continue;
      }

      if (new RegExp(`^${IDENTIFIER_PATTERN}$`).test(part)) {
        bindings.push({
          importedName: 'default',
          kind: 'default',
          localName: part,
          moduleSpecifier
        });
      }
    }
    match = importRegex.exec(content);
  }
  return bindings;
}

function parseReExportBindings(content: string): ReExportBinding[] {
  const bindings: ReExportBinding[] = [];
  const exportRegex = /^\s*export\s+(?:type\s+)?(\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"];?/gm;
  let match = exportRegex.exec(content);
  while (match !== null) {
    const body = match[1] ?? '';
    const moduleSpecifier = match[2] ?? '';
    if (body === '*') {
      bindings.push({ exportedName: '*', importedName: '*', moduleSpecifier });
      match = exportRegex.exec(content);
      continue;
    }
    bindings.push(
      ...parseNamedBindings(body).map((binding) => ({
        exportedName: binding.localName,
        importedName: binding.importedName,
        moduleSpecifier
      }))
    );
    match = exportRegex.exec(content);
  }
  return bindings;
}

function parseNamedBindings(body: string): Array<{ importedName: string; localName: string }> {
  return body
    .slice(1, -1)
    .split(',')
    .map((part) => part.trim().replace(/^type\s+/, ''))
    .filter(Boolean)
    .map((part) => {
      const aliasMatch = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (aliasMatch?.[1] && aliasMatch[2]) {
        return { importedName: aliasMatch[1], localName: aliasMatch[2] };
      }
      return new RegExp(`^${IDENTIFIER_PATTERN}$`).test(part)
        ? { importedName: part, localName: part }
        : null;
    })
    .filter((binding): binding is { importedName: string; localName: string } => Boolean(binding));
}

function splitImportParts(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth = Math.max(0, depth - 1);
    } else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(body.slice(start).trim());
  return parts.filter(Boolean);
}

async function loadPathAliasConfig(repoRoot: string): Promise<PathAliasConfig> {
  for (const configFile of PATH_CONFIG_FILES) {
    const rawConfig = await readFile(path.join(repoRoot, configFile), 'utf8').catch(() => null);
    if (!rawConfig) {
      continue;
    }
    const parsed = parseJsonConfig(rawConfig);
    if (!parsed) {
      continue;
    }
    const compilerOptions = asRecord(parsed.compilerOptions);
    const baseUrlValue = compilerOptions ? compilerOptions.baseUrl : null;
    const baseUrl =
      typeof baseUrlValue === 'string' ? path.resolve(repoRoot, baseUrlValue) : repoRoot;
    const paths = asRecord(compilerOptions?.paths);
    const aliases = paths
      ? Object.entries(paths).flatMap(([pattern, replacements]) =>
          Array.isArray(replacements)
            ? [
                {
                  pattern,
                  replacements: replacements.filter(
                    (replacement): replacement is string => typeof replacement === 'string'
                  )
                }
              ]
            : []
        )
      : [];
    return { aliases, baseUrl };
  }

  return { aliases: [], baseUrl: null };
}

function parseJsonConfig(rawConfig: string): Record<string, unknown> | null {
  try {
    return JSON.parse(stripJsonComments(rawConfig).replace(/,\s*([}\]])/g, '$1'));
  } catch {
    return null;
  }
}

function stripJsonComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function moduleCandidates(
  repoRoot: string,
  aliasConfig: PathAliasConfig,
  sourceFilePath: string,
  moduleSpecifier: string
): string[] {
  const roots: string[] = [];
  if (moduleSpecifier.startsWith('.')) {
    roots.push(path.resolve(repoRoot, path.dirname(sourceFilePath), moduleSpecifier));
  } else {
    roots.push(...aliasCandidateRoots(repoRoot, aliasConfig, moduleSpecifier));
    if (aliasConfig.baseUrl) {
      roots.push(path.resolve(aliasConfig.baseUrl, moduleSpecifier));
    }
  }

  const candidates = new Set<string>();
  for (const root of roots) {
    for (const candidate of expandModuleRoot(root)) {
      const relativePath = repoRelativePath(repoRoot, candidate);
      if (relativePath) {
        candidates.add(relativePath);
      }
    }
  }
  return [...candidates];
}

function aliasCandidateRoots(
  repoRoot: string,
  aliasConfig: PathAliasConfig,
  moduleSpecifier: string
): string[] {
  const roots: string[] = [];
  for (const alias of aliasConfig.aliases) {
    const wildcardIndex = alias.pattern.indexOf('*');
    const matched =
      wildcardIndex >= 0
        ? matchWildcardPattern(alias.pattern, wildcardIndex, moduleSpecifier)
        : alias.pattern === moduleSpecifier
          ? ''
          : null;
    if (matched === null) {
      continue;
    }
    for (const replacement of alias.replacements) {
      roots.push(
        path.resolve(
          aliasConfig.baseUrl ?? repoRoot,
          wildcardIndex >= 0 ? replacement.replace('*', matched) : replacement
        )
      );
    }
  }
  return roots;
}

function matchWildcardPattern(
  pattern: string,
  wildcardIndex: number,
  value: string
): string | null {
  const prefix = pattern.slice(0, wildcardIndex);
  const suffix = pattern.slice(wildcardIndex + 1);
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) {
    return null;
  }
  return value.slice(prefix.length, value.length - suffix.length);
}

function expandModuleRoot(root: string): string[] {
  const candidates: string[] = [];
  if (path.extname(root)) {
    candidates.push(root);
  } else {
    for (const extension of MODULE_EXTENSIONS) {
      candidates.push(`${root}${extension}`);
    }
    for (const extension of MODULE_EXTENSIONS) {
      candidates.push(path.join(root, `index${extension}`));
    }
  }
  return candidates;
}

async function firstExistingModuleFile(
  repoRoot: string,
  sourceRef: string | null,
  candidates: string[]
): Promise<ModuleFile | null> {
  for (const filePath of candidates) {
    const content = await readRepoText(repoRoot, sourceRef, filePath).catch(() => null);
    if (content !== null) {
      return { content, filePath };
    }
  }
  return null;
}

function findDefinition(content: string, symbol: string): DefinitionMatch | null {
  const lines = splitFileLines(content);
  const patterns = definitionPatterns(symbol);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!patterns.some((pattern) => pattern.test(line))) {
      continue;
    }
    return {
      column: Math.max(0, line.indexOf(symbol === 'default' ? 'default' : symbol)),
      line: index + 1
    };
  }
  return null;
}

function definitionPatterns(symbol: string): RegExp[] {
  if (symbol === 'default') {
    return [/^\s*export\s+default\b/];
  }

  const escaped = escapeRegex(symbol);
  return [
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:async\\s+)?function\\s+${escaped}\\b`),
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:const|let|var)\\s+${escaped}\\b`),
    new RegExp(
      `^\\s*(?:export\\s+)?(?:declare\\s+)?(?:class|interface|type|enum)\\s+${escaped}\\b`
    ),
    new RegExp(`^\\s*export\\s+default\\s+(?:async\\s+)?function\\s+${escaped}\\b`),
    new RegExp(`^\\s*export\\s+default\\s+class\\s+${escaped}\\b`)
  ];
}

function definitionGrepPattern(symbol: string): string {
  const escaped = escapeExtendedGrep(symbol);
  return [
    `^[[:space:]]*(export[[:space:]]+)?(declare[[:space:]]+)?(async[[:space:]]+)?function[[:space:]]+${escaped}([^[:alnum:]_$]|$)`,
    `^[[:space:]]*(export[[:space:]]+)?(declare[[:space:]]+)?(const|let|var)[[:space:]]+${escaped}([^[:alnum:]_$]|$)`,
    `^[[:space:]]*(export[[:space:]]+)?(declare[[:space:]]+)?(class|interface|type|enum)[[:space:]]+${escaped}([^[:alnum:]_$]|$)`
  ].join('|');
}

function firstMeaningfulLine(content: string): number {
  const lines = splitFileLines(content);
  const index = lines.findIndex((line) => line.trim() !== '');
  return index >= 0 ? index + 1 : 1;
}

function parseGrepLine(
  rawLine: string,
  sourceRef: string | null
): { filePath: string; line: number } | null {
  const line = sourceRef ? rawLine.slice(sourceRef.length + 1) : rawLine;
  const firstColon = line.indexOf(':');
  const secondColon = line.indexOf(':', firstColon + 1);
  if (firstColon < 0 || secondColon < 0) {
    return null;
  }
  const lineNumber = Number(line.slice(firstColon + 1, secondColon));
  if (!Number.isFinite(lineNumber)) {
    return null;
  }
  return {
    filePath: line.slice(0, firstColon),
    line: lineNumber
  };
}

function repoRelativePath(repoRoot: string, absolutePath: string): string | null {
  const relativePath = path.relative(repoRoot, absolutePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }
  return relativePath.split(path.sep).join('/');
}

function splitFileLines(contents: string): string[] {
  const lines = contents.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isExitCode(error: unknown, exitCode: number): boolean {
  return typeof error === 'object' && error !== null && 'exitCode' in error
    ? error.exitCode === exitCode
    : false;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeExtendedGrep(value: string): string {
  return value.replace(/[.[*^$()+?{}|\\]/g, '\\$&');
}
