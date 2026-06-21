import { compareFilePaths } from '../../shared/file-order';
import type { DiffFile } from '../../shared/types';

export const NO_EXTENSION_ID = '__gloss_no_extension__';

export interface ExtensionBucket {
  id: string;
  label: string;
  count: number;
}

export type FileTreeNode = FileTreeDirectoryNode | FileTreeFileNode;

export interface FileTreeDirectoryNode {
  type: 'directory';
  id: string;
  name: string;
  path: string;
  children: FileTreeNode[];
}

interface FileTreeFileNode {
  type: 'file';
  id: string;
  name: string;
  path: string;
  file: DiffFile;
}

export function compactDirectoryNode(node: FileTreeDirectoryNode): {
  name: string;
  node: FileTreeDirectoryNode;
} {
  const names = [node.name];
  let current = node;

  while (current.children.length === 1 && current.children[0].type === 'directory') {
    current = current.children[0];
    names.push(current.name);
  }

  return {
    name: names.join('/'),
    node: current
  };
}

export function buildExtensionBuckets(files: DiffFile[]): ExtensionBucket[] {
  const counts = new Map<string, ExtensionBucket>();

  for (const file of files) {
    const id = extensionIdForPath(file.path);
    const current = counts.get(id);
    if (current) {
      current.count += 1;
    } else {
      counts.set(id, {
        id,
        label: id === NO_EXTENSION_ID ? 'No extension' : id,
        count: 1
      });
    }
  }

  return Array.from(counts.values()).sort((left, right) => {
    if (left.id === NO_EXTENSION_ID) {
      return 1;
    }
    if (right.id === NO_EXTENSION_ID) {
      return -1;
    }
    return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
  });
}

export function filterDiffFiles(
  files: DiffFile[],
  searchQuery: string,
  selectedExtensionIds: Set<string>
): DiffFile[] {
  const normalizedSearch = searchQuery.trim().toLowerCase();
  if (selectedExtensionIds.size === 0) {
    return [];
  }

  return files.filter((file) => {
    const extensionMatches = selectedExtensionIds.has(extensionIdForPath(file.path));
    const searchMatches =
      normalizedSearch.length === 0 || file.path.toLowerCase().includes(normalizedSearch);
    return extensionMatches && searchMatches;
  });
}

export function buildFileTree(files: DiffFile[]): FileTreeDirectoryNode {
  const root: FileTreeDirectoryNode = {
    type: 'directory',
    id: 'root',
    name: '',
    path: '',
    children: []
  };
  const directoryIndexes = new Map<FileTreeDirectoryNode, Map<string, FileTreeDirectoryNode>>();

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let current = root;

    for (const [index, part] of parts.entries()) {
      const isFile = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join('/');
      if (isFile) {
        current.children.push({
          type: 'file',
          id: `file:${file.path}`,
          name: part,
          path: file.path,
          file
        });
      } else {
        current = directoryChildFor(current, part, path, directoryIndexes);
      }
    }
  }

  sortTree(root);
  return root;
}

function directoryChildFor(
  parent: FileTreeDirectoryNode,
  name: string,
  path: string,
  directoryIndexes: Map<FileTreeDirectoryNode, Map<string, FileTreeDirectoryNode>>
): FileTreeDirectoryNode {
  let index = directoryIndexes.get(parent);
  if (!index) {
    index = new Map();
    directoryIndexes.set(parent, index);
  }

  const existing = index.get(name);
  if (existing) {
    return existing;
  }

  const directory: FileTreeDirectoryNode = {
    type: 'directory',
    id: `dir:${path}`,
    name,
    path,
    children: []
  };
  parent.children.push(directory);
  index.set(name, directory);
  return directory;
}

export function extensionIdForPath(path: string): string {
  const basename = path.split('/').pop() ?? path;
  const dotIndex = basename.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === basename.length - 1) {
    return NO_EXTENSION_ID;
  }
  return basename.slice(dotIndex).toLowerCase();
}

function sortTree(directory: FileTreeDirectoryNode) {
  directory.children.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1;
    }
    return compareFilePaths(left.name, right.name);
  });

  for (const child of directory.children) {
    if (child.type === 'directory') {
      sortTree(child);
    }
  }
}
