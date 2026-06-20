import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DiffFile, OpenFileTarget, OpenFileTargetInfo } from '../../shared/types';
import { FileActionsMenu } from './FileActionsMenu';
import { LanguageIcon } from './LanguageIcon';

export function FileHeader({
  file,
  collapsed,
  viewed,
  onToggle,
  onCopyFileContents,
  onViewedChange,
  onOpenFile,
  openTargets
}: {
  file: DiffFile;
  collapsed: boolean;
  viewed: boolean;
  onToggle: () => void;
  onCopyFileContents?: () => Promise<string>;
  onViewedChange: (viewed: boolean) => void;
  onOpenFile: (target: OpenFileTarget) => void | Promise<void>;
  openTargets: OpenFileTargetInfo[];
}) {
  return (
    <div className="file-header">
      <button className="file-header-toggle" type="button" onClick={onToggle}>
        {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
        <LanguageIcon isBinary={file.isBinary} language={file.language} />
        <span className="file-path">{file.path}</span>
        {file.oldPath && file.oldPath !== file.path ? (
          <span className="rename-path">from {file.oldPath}</span>
        ) : null}
      </button>
      <span className="stat add">+{file.additions}</span>
      <span className="stat del">-{file.deletions}</span>
      <label className="viewed-toggle">
        <input
          type="checkbox"
          checked={viewed}
          onChange={(event) => onViewedChange(event.currentTarget.checked)}
        />
        <span>Viewed</span>
      </label>
      <FileActionsMenu
        filePath={file.path}
        openTargets={openTargets}
        onCopyFileContents={onCopyFileContents}
        onOpenFile={async (target) => onOpenFile(target)}
      />
    </div>
  );
}
