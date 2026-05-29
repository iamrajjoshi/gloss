import {
  Check,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  PanelLeftClose,
  Search,
  SlidersHorizontal,
  X
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
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

export interface FileTreeFileNode {
  type: 'file';
  id: string;
  name: string;
  path: string;
  file: DiffFile;
}

interface FileTreeProps {
  activeFilePath: string | null;
  extensionBuckets: ExtensionBucket[];
  files: DiffFile[];
  filteredFiles: DiffFile[];
  onCollapse?: () => void;
  onClearExtensions: () => void;
  onFileSelect: (filePath: string) => void;
  onSearchChange: (query: string) => void;
  onSelectAllExtensions: () => void;
  onToggleExtension: (extensionId: string) => void;
  searchQuery: string;
  selectedExtensionIds: Set<string>;
}

interface ExtensionMenuProps {
  buckets: ExtensionBucket[];
  onClear: () => void;
  onSelectAll: () => void;
  onToggle: (extensionId: string) => void;
  selectedExtensionIds: Set<string>;
}

export function FileTree({
  activeFilePath,
  extensionBuckets,
  files,
  filteredFiles,
  onCollapse,
  onClearExtensions,
  onFileSelect,
  onSearchChange,
  onSelectAllExtensions,
  onToggleExtension,
  searchQuery,
  selectedExtensionIds
}: FileTreeProps) {
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [expandedDirectoryIds, setExpandedDirectoryIds] = useState<Set<string>>(new Set());
  const filterShellRef = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => buildFileTree(filteredFiles), [filteredFiles]);
  const selectedCount = selectedExtensionIds.size;
  const extensionFilterActive = selectedCount !== extensionBuckets.length;

  useEffect(() => {
    setExpandedDirectoryIds(collectExpandedDirectoryIds(tree));
  }, [tree]);

  useEffect(() => {
    if (!filterMenuOpen) {
      return;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      if (!filterShellRef.current?.contains(event.target as Node)) {
        setFilterMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFilterMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [filterMenuOpen]);

  const toggleDirectory = (directoryId: string) => {
    setExpandedDirectoryIds((current) => {
      const next = new Set(current);
      next.has(directoryId) ? next.delete(directoryId) : next.add(directoryId);
      return next;
    });
  };

  return (
    <section className="file-tree-panel" aria-label="Changed files">
      <div className="file-tree-header">
        <span>Changed files</span>
        {onCollapse ? (
          <button
            aria-label="Collapse file tree"
            className="file-tree-icon-button"
            title="Collapse file tree"
            type="button"
            onClick={onCollapse}
          >
            <PanelLeftClose size={15} />
          </button>
        ) : null}
      </div>
      <div className="file-tree-controls">
        <label className="file-tree-search">
          <Search size={18} />
          <span className="sr-only">Filter files</span>
          <input
            type="search"
            value={searchQuery}
            placeholder="Filter files..."
            onChange={(event) => onSearchChange(event.target.value)}
          />
          {searchQuery ? (
            <button
              aria-label="Clear file search"
              className="file-tree-clear"
              type="button"
              onClick={() => onSearchChange('')}
            >
              <X size={14} />
            </button>
          ) : null}
        </label>
        <div className="file-tree-filter-shell" ref={filterShellRef}>
          <button
            aria-label="Filter by file extension"
            aria-expanded={filterMenuOpen}
            className={`file-tree-filter-button ${extensionFilterActive ? 'active' : ''}`}
            title="Filter by file extension"
            type="button"
            onClick={() => setFilterMenuOpen((open) => !open)}
          >
            <SlidersHorizontal size={17} />
          </button>
          {filterMenuOpen ? (
            <ExtensionMenu
              buckets={extensionBuckets}
              selectedExtensionIds={selectedExtensionIds}
              onClear={onClearExtensions}
              onSelectAll={onSelectAllExtensions}
              onToggle={onToggleExtension}
            />
          ) : null}
        </div>
      </div>
      <div className="file-tree-summary">
        <span>
          {filteredFiles.length} of {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
      </div>
      {filteredFiles.length === 0 ? (
        <div className="file-tree-empty">
          {files.length === 0 ? 'No files changed' : 'No files match'}
        </div>
      ) : (
        <div className="file-tree-list">
          {tree.children.map((node) => (
            <FileTreeNodeRow
              activeFilePath={activeFilePath}
              expandedDirectoryIds={expandedDirectoryIds}
              key={node.id}
              node={node}
              depth={0}
              onFileSelect={onFileSelect}
              onToggleDirectory={toggleDirectory}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ExtensionMenu({
  buckets,
  onClear,
  onSelectAll,
  onToggle,
  selectedExtensionIds
}: ExtensionMenuProps) {
  return (
    <div className="extension-popover" role="menu" aria-label="File extensions">
      <div className="extension-popover-header">
        <span>File extensions</span>
        <div className="extension-popover-actions">
          <button type="button" onClick={onSelectAll}>
            All
          </button>
          <button type="button" onClick={onClear}>
            None
          </button>
        </div>
      </div>
      <div className="extension-options">
        {buckets.map((bucket) => {
          const selected = selectedExtensionIds.has(bucket.id);
          return (
            <button
              aria-checked={selected}
              className="extension-option"
              key={bucket.id}
              role="menuitemcheckbox"
              type="button"
              onClick={() => onToggle(bucket.id)}
            >
              <span className="extension-check">{selected ? <Check size={16} /> : null}</span>
              <span className="extension-label">{bucket.label}</span>
              <span className="extension-count">{bucket.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FileTreeNodeRow({
  activeFilePath,
  depth,
  expandedDirectoryIds,
  node,
  onFileSelect,
  onToggleDirectory
}: {
  activeFilePath: string | null;
  depth: number;
  expandedDirectoryIds: Set<string>;
  node: FileTreeNode;
  onFileSelect: (filePath: string) => void;
  onToggleDirectory: (directoryId: string) => void;
}) {
  const style: CSSProperties = { paddingLeft: 8 + depth * 14 };

  if (node.type === 'directory') {
    const compacted = compactDirectoryNode(node);
    const expanded = expandedDirectoryIds.has(compacted.node.id);
    return (
      <div>
        <button
          aria-expanded={expanded}
          className="file-tree-row directory"
          style={style}
          title={compacted.node.path}
          type="button"
          onClick={() => onToggleDirectory(compacted.node.id)}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {expanded ? <FolderOpen size={17} /> : <Folder size={17} />}
          <span className="file-tree-name">{compacted.name}</span>
        </button>
        {expanded ? (
          <div>
            {compacted.node.children.map((child) => (
              <FileTreeNodeRow
                activeFilePath={activeFilePath}
                expandedDirectoryIds={expandedDirectoryIds}
                key={child.id}
                node={child}
                depth={depth + 1}
                onFileSelect={onFileSelect}
                onToggleDirectory={onToggleDirectory}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <button
        className={`file-tree-row file ${activeFilePath === node.path ? 'active' : ''}`}
        style={style}
        title={node.path}
        type="button"
        onClick={() => onFileSelect(node.path)}
      >
        <span className="file-tree-spacer" />
        <FileCode2 size={16} />
        <span className="file-tree-name">{node.name}</span>
        <span className="file-tree-stats">
          <span className="stat add">+{node.file.additions}</span>
          <span className="stat del">-{node.file.deletions}</span>
        </span>
      </button>
    </div>
  );
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
        let directory = current.children.find(
          (child): child is FileTreeDirectoryNode =>
            child.type === 'directory' && child.name === part
        );
        if (!directory) {
          directory = {
            type: 'directory',
            id: `dir:${path}`,
            name: part,
            path,
            children: []
          };
          current.children.push(directory);
        }
        current = directory;
      }
    }
  }

  sortTree(root);
  return root;
}

export function collectExpandedDirectoryIds(root: FileTreeDirectoryNode): Set<string> {
  const expanded = new Set<string>();

  const visit = (node: FileTreeDirectoryNode) => {
    for (const child of node.children) {
      if (child.type === 'directory') {
        expanded.add(child.id);
        visit(child);
      }
    }
  };

  visit(root);
  return expanded;
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
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });

  for (const child of directory.children) {
    if (child.type === 'directory') {
      sortTree(child);
    }
  }
}
