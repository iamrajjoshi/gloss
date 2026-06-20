import {
  AppWindow,
  ChevronDown,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  MoreHorizontal,
  SquareTerminal,
  WrapText
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type SimpleIcon,
  siAndroidstudio,
  siClion,
  siCursor,
  siDatagrip,
  siGhostty,
  siGnuemacs,
  siGoland,
  siIntellijidea,
  siIterm2,
  siLapce,
  siNeovim,
  siPhpstorm,
  siPycharm,
  siRubymine,
  siSublimetext,
  siVim,
  siVscodium,
  siWebstorm,
  siWindsurf,
  siXcode,
  siZedindustries
} from 'simple-icons';
import type { OpenFileTarget, OpenFileTargetInfo } from '../../shared/types';

const fallbackOpenTargets: OpenFileTargetInfo[] = [
  { label: 'Default app', target: 'default' },
  { label: 'Open in folder', target: 'folder' }
];

const actionsMenuWidth = 190;
const openMenuWidth = 172;
const menuViewportMargin = 8;

interface MenuPosition {
  right: number;
  top: number;
}

type OpenTargetIcon =
  | { kind: 'lucide'; Icon: typeof ExternalLink }
  | { kind: 'simple'; icon: SimpleIcon };

const iconByOpenTarget: Record<OpenFileTarget, OpenTargetIcon> = {
  'android-studio': { icon: siAndroidstudio, kind: 'simple' },
  bbedit: { Icon: Code2, kind: 'lucide' },
  clion: { icon: siClion, kind: 'simple' },
  coteditor: { Icon: Code2, kind: 'lucide' },
  cursor: { icon: siCursor, kind: 'simple' },
  datagrip: { icon: siDatagrip, kind: 'simple' },
  default: { Icon: AppWindow, kind: 'lucide' },
  emacs: { icon: siGnuemacs, kind: 'simple' },
  fleet: { Icon: Code2, kind: 'lucide' },
  folder: { Icon: FolderOpen, kind: 'lucide' },
  ghostty: { icon: siGhostty, kind: 'simple' },
  goland: { icon: siGoland, kind: 'simple' },
  intellij: { icon: siIntellijidea, kind: 'simple' },
  iterm2: { icon: siIterm2, kind: 'simple' },
  lapce: { icon: siLapce, kind: 'simple' },
  macvim: { icon: siVim, kind: 'simple' },
  neovide: { icon: siNeovim, kind: 'simple' },
  nova: { Icon: Code2, kind: 'lucide' },
  phpstorm: { icon: siPhpstorm, kind: 'simple' },
  pycharm: { icon: siPycharm, kind: 'simple' },
  rubymine: { icon: siRubymine, kind: 'simple' },
  sublime: { icon: siSublimetext, kind: 'simple' },
  terminal: { Icon: SquareTerminal, kind: 'lucide' },
  textedit: { Icon: FileText, kind: 'lucide' },
  textmate: { Icon: Code2, kind: 'lucide' },
  vscodium: { icon: siVscodium, kind: 'simple' },
  vscode: { Icon: Code2, kind: 'lucide' },
  'vscode-insiders': { Icon: Code2, kind: 'lucide' },
  webstorm: { icon: siWebstorm, kind: 'simple' },
  windsurf: { icon: siWindsurf, kind: 'simple' },
  xcode: { icon: siXcode, kind: 'simple' },
  zed: { icon: siZedindustries, kind: 'simple' }
};

export function FileActionsMenu({
  fileContent,
  filePath,
  openTargets,
  wordWrap,
  onActionMessage,
  onCopyFileContents,
  onOpenFile,
  onWordWrapChange
}: {
  fileContent?: string;
  filePath: string;
  openTargets: OpenFileTargetInfo[];
  wordWrap?: boolean;
  onActionMessage?: (message: string) => void;
  onCopyFileContents?: () => Promise<string>;
  onOpenFile: (target: OpenFileTarget) => Promise<void>;
  onWordWrapChange?: (wordWrap: boolean) => void;
}) {
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const [actionsMenuPosition, setActionsMenuPosition] = useState<MenuPosition | null>(null);
  const [openMenuPosition, setOpenMenuPosition] = useState<MenuPosition | null>(null);
  const actionsButtonRef = useRef<HTMLButtonElement | null>(null);
  const actionsPopoverRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const openPopoverRef = useRef<HTMLDivElement | null>(null);
  const visibleOpenTargets = useMemo(
    () => (openTargets.length > 0 ? openTargets : fallbackOpenTargets),
    [openTargets]
  );
  const canCopyFileContents = fileContent !== undefined || onCopyFileContents !== undefined;

  const closeMenus = useCallback(() => {
    setActionsMenuOpen(false);
    setOpenMenuOpen(false);
  }, []);

  const updateMenuPositions = useCallback(() => {
    if (actionsMenuOpen) {
      setActionsMenuPosition(getMenuPosition(actionsButtonRef.current, actionsMenuWidth));
    }
    if (openMenuOpen) {
      setOpenMenuPosition(getMenuPosition(openButtonRef.current, openMenuWidth));
    }
  }, [actionsMenuOpen, openMenuOpen]);

  useEffect(() => {
    if (!actionsMenuOpen && !openMenuOpen) {
      return;
    }

    updateMenuPositions();
    window.addEventListener('resize', updateMenuPositions);
    window.addEventListener('scroll', updateMenuPositions, true);
    return () => {
      window.removeEventListener('resize', updateMenuPositions);
      window.removeEventListener('scroll', updateMenuPositions, true);
    };
  }, [actionsMenuOpen, openMenuOpen, updateMenuPositions]);

  useEffect(() => {
    if (!actionsMenuOpen && !openMenuOpen) {
      return;
    }

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !actionsPopoverRef.current?.contains(target) &&
        !openPopoverRef.current?.contains(target)
      ) {
        closeMenus();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenus();
      }
    };

    window.addEventListener('pointerdown', closeOnOutsidePointerDown);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointerDown);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [actionsMenuOpen, closeMenus, openMenuOpen]);

  const copyToClipboard = async (value: string, label: string) => {
    closeMenus();
    try {
      await navigator.clipboard.writeText(value);
      onActionMessage?.(`${label} copied`);
    } catch (error) {
      onActionMessage?.(`Could not copy ${label.toLowerCase()}: ${formatActionError(error)}`);
    }
  };

  const copyFileContents = async () => {
    closeMenus();
    try {
      const contents = fileContent ?? (await onCopyFileContents?.());
      if (contents === undefined) {
        return;
      }
      await navigator.clipboard.writeText(contents);
      onActionMessage?.('File contents copied');
    } catch (error) {
      onActionMessage?.(`Could not copy file contents: ${formatActionError(error)}`);
    }
  };

  const openFile = async (target: OpenFileTarget, label: string) => {
    closeMenus();
    onActionMessage?.(`Opening in ${label}`);
    try {
      await onOpenFile(target);
      onActionMessage?.(`Opened in ${label}`);
    } catch (error) {
      onActionMessage?.(`Could not open in ${label}: ${formatActionError(error)}`);
    }
  };

  const actionsPopover =
    actionsMenuOpen && actionsMenuPosition
      ? createPortal(
          <div
            className="file-actions-popover actions"
            ref={actionsPopoverRef}
            role="menu"
            style={actionsMenuPosition}
          >
            <button role="menuitem" type="button" onClick={() => copyToClipboard(filePath, 'Path')}>
              <Copy size={16} />
              <span>Copy path</span>
            </button>
            {canCopyFileContents ? (
              <button role="menuitem" type="button" onClick={copyFileContents}>
                <FileText size={16} />
                <span>Copy file contents</span>
              </button>
            ) : null}
            {onWordWrapChange ? (
              <button
                aria-checked={Boolean(wordWrap)}
                role="menuitemcheckbox"
                type="button"
                onClick={() => {
                  onWordWrapChange(!wordWrap);
                  closeMenus();
                }}
              >
                <WrapText size={16} />
                <span>{wordWrap ? 'Disable' : 'Enable'} word wrap</span>
              </button>
            ) : null}
          </div>,
          document.body
        )
      : null;
  const openPopover =
    openMenuOpen && openMenuPosition
      ? createPortal(
          <div
            className="file-actions-popover open"
            ref={openPopoverRef}
            role="menu"
            style={openMenuPosition}
          >
            {visibleOpenTargets.map((option, index) => {
              return (
                <button
                  className={index === visibleOpenTargets.length - 1 ? 'separated' : ''}
                  key={option.target}
                  role="menuitem"
                  type="button"
                  onClick={() => openFile(option.target, option.label)}
                >
                  <OpenTargetIcon option={option} />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>,
          document.body
        )
      : null;

  return (
    <div className="file-actions-menu" ref={menuRef}>
      <div className="file-actions-menu-group">
        <button
          aria-expanded={actionsMenuOpen}
          aria-haspopup="menu"
          aria-label="File actions"
          className="icon-button file-actions-menu-trigger"
          ref={actionsButtonRef}
          type="button"
          onClick={() => {
            setActionsMenuPosition(getMenuPosition(actionsButtonRef.current, actionsMenuWidth));
            setActionsMenuOpen((current) => !current);
            setOpenMenuOpen(false);
          }}
        >
          <MoreHorizontal size={17} />
        </button>
        {actionsPopover}
      </div>
      <div className="file-actions-menu-group">
        <button
          aria-expanded={openMenuOpen}
          aria-haspopup="menu"
          className="file-actions-open-button"
          ref={openButtonRef}
          type="button"
          onClick={() => {
            setOpenMenuPosition(getMenuPosition(openButtonRef.current, openMenuWidth));
            setOpenMenuOpen((current) => !current);
            setActionsMenuOpen(false);
          }}
        >
          <ExternalLink size={16} />
          <span>Open</span>
          <ChevronDown size={15} />
        </button>
        {openPopover}
      </div>
    </div>
  );
}

function getMenuPosition(element: HTMLElement | null, menuWidth: number): MenuPosition | null {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  const right = Math.max(menuViewportMargin, window.innerWidth - rect.right);
  const maxRight = Math.max(menuViewportMargin, window.innerWidth - menuWidth - menuViewportMargin);
  return {
    right: Math.min(right, maxRight),
    top: rect.bottom + menuViewportMargin
  };
}

function OpenTargetIcon({ option }: { option: OpenFileTargetInfo }) {
  const menuIcon = iconByOpenTarget[option.target];
  if (menuIcon.kind === 'simple') {
    return (
      <svg
        aria-hidden="true"
        className="file-actions-brand-icon"
        focusable="false"
        role="img"
        style={{ color: simpleIconColor(menuIcon.icon) }}
        viewBox="0 0 24 24"
      >
        <path d={menuIcon.icon.path} />
      </svg>
    );
  }

  return <menuIcon.Icon aria-hidden="true" className="file-actions-target-icon" size={16} />;
}

function simpleIconColor(icon: SimpleIcon): string {
  return icon.hex === '000000' ? 'var(--ide-fg-muted)' : `#${icon.hex}`;
}

function formatActionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
