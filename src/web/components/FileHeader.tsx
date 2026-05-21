import { ChevronDown, ChevronRight, FileCode2 } from 'lucide-react';
import type { DiffFile } from '../../shared/types';

export function FileHeader({
  file,
  collapsed,
  onToggle
}: {
  file: DiffFile;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button className="file-header" type="button" onClick={onToggle}>
      {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
      <FileCode2 size={17} />
      <span className="file-path">{file.path}</span>
      {file.oldPath && file.oldPath !== file.path ? (
        <span className="rename-path">from {file.oldPath}</span>
      ) : null}
      <span className="stat add">+{file.additions}</span>
      <span className="stat del">-{file.deletions}</span>
    </button>
  );
}
