import { describe, expect, it } from 'vitest';
import type { DiffFile } from '../../shared/types';
import {
  buildExtensionBuckets,
  buildFileTree,
  compactDirectoryNode,
  extensionIdForPath,
  type FileTreeNode,
  filterDiffFiles,
  NO_EXTENSION_ID
} from './file-tree-helpers';

describe('file tree helpers', () => {
  it('builds a sorted directory tree from diff file paths', () => {
    const tree = buildFileTree([
      makeFile('src/web/store.ts'),
      makeFile('README.md'),
      makeFile('src/web/App.tsx'),
      makeFile('src/api.ts')
    ]);

    expect(tree.children.map((node) => node.name)).toEqual(['src', 'README.md']);
    const src = directory(tree.children[0]);
    expect(src.children.map((node) => node.name)).toEqual(['web', 'api.ts']);
    const web = directory(src.children[0]);
    expect(web.children.map((node) => node.name)).toEqual(['App.tsx', 'store.ts']);
  });

  it('derives extension buckets from the final basename suffix', () => {
    const buckets = buildExtensionBuckets([
      makeFile('src/app.TS'),
      makeFile('src/index.ts'),
      makeFile('README.md'),
      makeFile('CODEOWNER'),
      makeFile('.env')
    ]);

    expect(buckets).toEqual([
      { id: '.md', label: '.md', count: 1 },
      { id: '.ts', label: '.ts', count: 2 },
      { id: NO_EXTENSION_ID, label: 'No extension', count: 2 }
    ]);
    expect(extensionIdForPath('archive.tar.gz')).toBe('.gz');
    expect(extensionIdForPath('config/.eslintrc.json')).toBe('.json');
    expect(extensionIdForPath('config/.env')).toBe(NO_EXTENSION_ID);
  });

  it('filters files by full path search and selected extensions', () => {
    const files = [
      makeFile('src/web/App.tsx'),
      makeFile('src/server/index.ts'),
      makeFile('docs/setup.md'),
      makeFile('CODEOWNER')
    ];
    const selectedExtensions = new Set(['.tsx', '.md']);

    expect(filterDiffFiles(files, 'web', selectedExtensions).map((file) => file.path)).toEqual([
      'src/web/App.tsx'
    ]);
    expect(filterDiffFiles(files, 'src', selectedExtensions).map((file) => file.path)).toEqual([
      'src/web/App.tsx'
    ]);
    expect(filterDiffFiles(files, 'setup', selectedExtensions).map((file) => file.path)).toEqual([
      'docs/setup.md'
    ]);
  });

  it('returns no files when every extension bucket is unchecked', () => {
    expect(filterDiffFiles([makeFile('src/app.ts')], '', new Set())).toEqual([]);
  });

  it('keeps tree leaves aligned with the filtered file list', () => {
    const files = [
      makeFile('src/web/App.tsx'),
      makeFile('src/web/store.ts'),
      makeFile('README.md')
    ];
    const filtered = filterDiffFiles(files, 'src/web', new Set(['.ts', '.tsx']));
    const tree = buildFileTree(filtered);

    expect(collectFilePaths(tree.children)).toEqual(['src/web/App.tsx', 'src/web/store.ts']);
  });

  it('compacts single-child directory chains for display', () => {
    const tree = buildFileTree([
      makeFile('website/assets/pages/rdp/rejuvenated/lib/attributes.ts'),
      makeFile('website/assets/pages/rdp/rejuvenated/lib/routes.ts')
    ]);

    const compacted = compactDirectoryNode(directory(tree.children[0]));

    expect(compacted.name).toBe('website/assets/pages/rdp/rejuvenated/lib');
    expect(compacted.node.path).toBe('website/assets/pages/rdp/rejuvenated/lib');
    expect(compacted.node.children.map((node) => node.name)).toEqual([
      'attributes.ts',
      'routes.ts'
    ]);
  });
});

function makeFile(path: string): DiffFile {
  return {
    path,
    oldPath: null,
    additions: 1,
    deletions: 0,
    isBinary: false,
    isDeleted: false,
    isNew: false,
    isRenamed: false,
    language: null,
    hunks: []
  };
}

function directory(node: FileTreeNode) {
  expect(node.type).toBe('directory');
  if (node.type !== 'directory') {
    throw new Error('Expected directory node');
  }
  return node;
}

function collectFilePaths(nodes: FileTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      paths.push(node.path);
    } else {
      paths.push(...collectFilePaths(node.children));
    }
  }
  return paths;
}
