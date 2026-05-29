import { ChevronDown, ChevronRight, ExternalLink, FileCode2, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DiffFile } from '../../shared/types';

export function FileHeader({
  file,
  collapsed,
  viewed,
  onToggle,
  onViewedChange,
  onOpenFile
}: {
  file: DiffFile;
  collapsed: boolean;
  viewed: boolean;
  onToggle: () => void;
  onViewedChange: (viewed: boolean) => void;
  onOpenFile: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="file-header">
      <button className="file-header-toggle" type="button" onClick={onToggle}>
        {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
        <FileCode2 size={17} />
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
      <div className="file-menu" ref={menuRef}>
        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`Open actions for ${file.path}`}
          className="icon-button file-menu-button"
          title="File actions"
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
        >
          <MoreHorizontal size={17} />
        </button>
        {menuOpen ? (
          <div className="file-menu-popover" role="menu">
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpenFile();
              }}
            >
              <ExternalLink size={16} />
              <span>Open locally</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
