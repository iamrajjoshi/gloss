import { AlertCircle, FileSearch, GripHorizontal, LoaderCircle, X } from 'lucide-react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, UIEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  OpenFileTarget,
  OpenFileTargetInfo,
  SourcePeekRangeResponse,
  SourcePeekResponse
} from '../../shared/types';
import type { HighlightedSourceLines, SyntaxToken } from '../syntax';
import { useTheme } from '../theme';
import { FileActionsMenu } from './FileActionsMenu';
import {
  initialLoadedSource,
  type LoadedSourcePeek,
  mergeLoadedSourceRange,
  type SourcePeekRangeDirection,
  sourcePeekRangeRequest,
  splitSourceLines
} from './source-peek-range';

const PANEL_MARGIN = 16;
const PANEL_MIN_WIDTH = 360;
const PANEL_MIN_HEIGHT = 280;
const SOURCE_PEEK_SCROLL_LOAD_THRESHOLD = 360;
const EMPTY_RANGE_LOADING: Record<SourcePeekRangeDirection, boolean> = {
  above: false,
  below: false
};

function emptyRangeLoading(): Record<SourcePeekRangeDirection, boolean> {
  return { ...EMPTY_RANGE_LOADING };
}

export type SourcePeekPanelState =
  | { status: 'loading'; symbol: string }
  | { status: 'ready'; response: SourcePeekResponse }
  | { status: 'error'; message: string; symbol: string };

export function SourcePeekPanel({
  openTargets,
  onCopyFileContents,
  onLoadRange,
  onOpenFile,
  state,
  onClose
}: {
  openTargets: OpenFileTargetInfo[];
  onCopyFileContents: (filePath: string) => Promise<string>;
  onLoadRange: (
    filePath: string,
    startLine: number,
    lineCount: number
  ) => Promise<SourcePeekRangeResponse>;
  onOpenFile: (filePath: string, target: OpenFileTarget) => Promise<void>;
  state: SourcePeekPanelState;
  onClose: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const panelRef = useRef<HTMLElement | null>(null);
  const codeRef = useRef<HTMLElement | null>(null);
  const targetLineRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pendingRectRef = useRef<PanelRect | null>(null);
  const cleanupInteractionRef = useRef<(() => void) | null>(null);
  const response = state.status === 'ready' ? state.response : null;
  const errorPresentation =
    state.status === 'error' ? sourcePeekErrorPresentation(state.message, state.symbol) : null;
  const rangeLoadingRef = useRef<Record<SourcePeekRangeDirection, boolean>>(EMPTY_RANGE_LOADING);
  const rangeRequestIdRef = useRef<Record<SourcePeekRangeDirection, number>>({
    above: 0,
    below: 0
  });
  const responseRef = useRef<SourcePeekResponse | null>(response);
  const [highlightedSource, setHighlightedSource] = useState<{
    lines: HighlightedSourceLines | null;
    content: string;
    language: string | null;
    theme: typeof resolvedTheme;
  } | null>(null);
  const [loadedSource, setLoadedSource] = useState<LoadedSourcePeek | null>(() =>
    response ? initialLoadedSource(response) : null
  );
  const loadedResponseRef = useRef<SourcePeekResponse | null>(response);
  const [rangeLoading, setRangeLoading] =
    useState<Record<SourcePeekRangeDirection, boolean>>(emptyRangeLoading);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [wordWrap, setWordWrap] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  if (response !== loadedResponseRef.current) {
    const nextRangeLoading = emptyRangeLoading();
    loadedResponseRef.current = response;
    responseRef.current = response;
    rangeRequestIdRef.current = {
      above: rangeRequestIdRef.current.above + 1,
      below: rangeRequestIdRef.current.below + 1
    };
    rangeLoadingRef.current = nextRangeLoading;
    setLoadedSource(response ? initialLoadedSource(response) : null);
    setRangeError(null);
    setRangeLoading(nextRangeLoading);
    setActionMessage(null);
  }

  const sourceLines = useMemo(
    () => (loadedSource ? splitSourceLines(loadedSource.content) : []),
    [loadedSource]
  );
  const highlightedLines =
    loadedSource &&
    response &&
    highlightedSource?.content === loadedSource.content &&
    highlightedSource.language === response.language &&
    highlightedSource.theme === resolvedTheme
      ? highlightedSource.lines
      : null;
  const sourcePeekRangeMessage = loadedSource
    ? rangeMessageForSourcePeek(loadedSource, rangeLoading, rangeError)
    : null;

  const applyPanelRect = useCallback((rect: PanelRect) => {
    pendingRectRef.current = rect;
    if (animationFrameRef.current !== null) {
      return;
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const nextRect = pendingRectRef.current;
      const panel = panelRef.current;
      if (!nextRect || !panel) {
        return;
      }

      panel.style.top = `${Math.round(nextRect.top)}px`;
      panel.style.left = `${Math.round(nextRect.left)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.width = `${Math.round(nextRect.width)}px`;
      panel.style.height = `${Math.round(nextRect.height)}px`;
      panel.style.transform = '';
    });
  }, []);

  const cleanupInteraction = useCallback(() => {
    cleanupInteractionRef.current?.();
    cleanupInteractionRef.current = null;
    document.body.classList.remove('source-peek-interacting');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const updateRangeLoading = useCallback(
    (direction: SourcePeekRangeDirection, isLoading: boolean) => {
      const nextLoading = { ...rangeLoadingRef.current, [direction]: isLoading };
      rangeLoadingRef.current = nextLoading;
      setRangeLoading(nextLoading);
    },
    []
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    if (!actionMessage) {
      return;
    }

    const timeout = window.setTimeout(() => setActionMessage(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [actionMessage]);

  useEffect(() => {
    if (!response || !loadedSource) {
      return;
    }
    let cancelled = false;
    import('../syntax')
      .then(({ highlightSourceContent }) =>
        highlightSourceContent(loadedSource.content, response.language, resolvedTheme)
      )
      .then((nextHighlightedLines) => {
        if (!cancelled) {
          setHighlightedSource({
            lines: nextHighlightedLines,
            content: loadedSource.content,
            language: response.language,
            theme: resolvedTheme
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHighlightedSource({
            lines: null,
            content: loadedSource.content,
            language: response.language,
            theme: resolvedTheme
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadedSource, response, resolvedTheme]);

  useEffect(() => {
    if (!response) {
      return;
    }
    window.requestAnimationFrame(() => {
      targetLineRef.current?.scrollIntoView({ block: 'center' });
    });
  }, [response]);

  useEffect(() => {
    const clampPanelToViewport = () => {
      const panel = panelRef.current;
      if (!panel) {
        return;
      }
      applyPanelRect(clampPanelRect(rectFromElement(panel)));
    };

    window.requestAnimationFrame(() => applyPanelRect(defaultPanelRect()));
    window.addEventListener('resize', clampPanelToViewport);
    return () => {
      window.removeEventListener('resize', clampPanelToViewport);
    };
  }, [applyPanelRect]);

  useEffect(
    () => () => {
      cleanupInteraction();
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    },
    [cleanupInteraction]
  );

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) {
      return;
    }
    event.preventDefault();
    cleanupInteraction();

    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    const startRect = clampPanelRect(rectFromElement(panel));
    const startX = event.clientX;
    const startY = event.clientY;
    pendingRectRef.current = startRect;
    document.body.classList.add('source-peek-interacting');
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    panel.classList.add('dragging');

    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextRect = clampPanelRect({
        ...startRect,
        left: startRect.left + moveEvent.clientX - startX,
        top: startRect.top + moveEvent.clientY - startY
      });
      panel.style.transform = `translate3d(${Math.round(nextRect.left - startRect.left)}px, ${Math.round(
        nextRect.top - startRect.top
      )}px, 0)`;
      pendingRectRef.current = nextRect;
    };
    const onPointerUp = () => {
      const finalRect = pendingRectRef.current ?? startRect;
      panel.classList.remove('dragging');
      applyPanelRect(finalRect);
      cleanupInteraction();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      panel.classList.remove('dragging');
    };

    cleanupInteractionRef.current = cleanup;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const startResize = (edges: ResizeEdges) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    cleanupInteraction();

    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    const startRect = clampPanelRect(rectFromElement(panel));
    const startX = event.clientX;
    const startY = event.clientY;
    const cursor = cursorForResizeEdges(edges);
    pendingRectRef.current = startRect;
    document.body.classList.add('source-peek-interacting');
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';

    const onPointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      applyPanelRect(resizePanelRect(startRect, edges, dx, dy));
    };
    const onPointerUp = () => cleanupInteraction();
    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    cleanupInteractionRef.current = cleanup;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const loadSourceRange = useCallback(
    async (direction: SourcePeekRangeDirection) => {
      if (!response || !loadedSource || rangeLoadingRef.current[direction]) {
        return;
      }

      const request = sourcePeekRangeRequest(loadedSource, direction);
      if (!request) {
        return;
      }

      const requestId = rangeRequestIdRef.current[direction] + 1;
      rangeRequestIdRef.current = { ...rangeRequestIdRef.current, [direction]: requestId };
      const isCurrentRequest = () =>
        responseRef.current === response && rangeRequestIdRef.current[direction] === requestId;
      const previousScrollHeight =
        direction === 'above' ? (codeRef.current?.scrollHeight ?? null) : null;

      if (!isCurrentRequest()) {
        return;
      }
      updateRangeLoading(direction, true);
      setRangeError(null);
      try {
        const range = await onLoadRange(response.filePath, request.startLine, request.lineCount);
        if (isCurrentRequest()) {
          setLoadedSource((current) =>
            current?.response === response ? mergeLoadedSourceRange(current, range) : current
          );
          if (direction === 'above' && previousScrollHeight !== null) {
            window.requestAnimationFrame(() => {
              const scroller = codeRef.current;
              if (scroller) {
                scroller.scrollTop += scroller.scrollHeight - previousScrollHeight;
              }
            });
          }
        }
      } catch (reason) {
        if (isCurrentRequest()) {
          setRangeError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (isCurrentRequest()) {
          updateRangeLoading(direction, false);
        }
      }
    },
    [loadedSource, onLoadRange, response, updateRangeLoading]
  );

  const handleCodeScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const scroller = event.currentTarget;
      const bottomDistance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (scroller.scrollTop <= SOURCE_PEEK_SCROLL_LOAD_THRESHOLD) {
        void loadSourceRange('above');
      }
      if (bottomDistance <= SOURCE_PEEK_SCROLL_LOAD_THRESHOLD) {
        void loadSourceRange('below');
      }
    },
    [loadSourceRange]
  );

  return (
    <aside aria-label="Source peek" className="source-peek-panel" ref={panelRef}>
      <button
        aria-label="Resize source peek horizontally"
        className="source-peek-resize-handle left"
        type="button"
        onPointerDown={startResize({ left: true })}
      />
      <button
        aria-label="Resize source peek vertically"
        className="source-peek-resize-handle bottom"
        type="button"
        onPointerDown={startResize({ bottom: true })}
      />
      <button
        aria-label="Resize source peek"
        className="source-peek-resize-handle bottom-left"
        type="button"
        onPointerDown={startResize({ bottom: true, left: true })}
      />
      <button
        aria-label="Resize source peek"
        className="source-peek-resize-handle bottom-right"
        type="button"
        onPointerDown={startResize({ bottom: true, right: true })}
      />
      <header className="source-peek-header" onPointerDown={startDrag}>
        <div className="source-peek-title">
          <FileSearch size={17} />
          <span>Source peek</span>
        </div>
        <GripHorizontal className="source-peek-drag-indicator" size={16} aria-hidden="true" />
        <div className="source-peek-toolbar">
          {response ? (
            <FileActionsMenu
              filePath={response.filePath}
              openTargets={openTargets}
              wordWrap={wordWrap}
              onActionMessage={setActionMessage}
              onCopyFileContents={() => onCopyFileContents(response.filePath)}
              onOpenFile={(target) => onOpenFile(response.filePath, target)}
              onWordWrapChange={setWordWrap}
            />
          ) : null}
          <button
            aria-label="Close source peek"
            className="icon-button source-peek-close"
            type="button"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      {state.status === 'loading' ? (
        <div className="source-peek-status">
          <LoaderCircle className="spin" size={18} />
          <span>Resolving {state.symbol}</span>
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div className="source-peek-status error">
          <div className="source-peek-error-card">
            <AlertCircle size={18} />
            <div className="source-peek-error-copy">
              <strong>{errorPresentation?.title}</strong>
              <p>{errorPresentation?.message}</p>
              {errorPresentation?.hint ? <span>{errorPresentation.hint}</span> : null}
            </div>
          </div>
        </div>
      ) : null}
      {response ? (
        <>
          <div className="source-peek-meta">
            <span className="source-peek-symbol">{response.targetSymbol}</span>
            <span className="source-peek-path" title={`${response.filePath}:${response.line}`}>
              {response.filePath}:{response.line}
            </span>
            {actionMessage ? (
              <span className="source-peek-action-message">{actionMessage}</span>
            ) : null}
          </div>
          {sourcePeekRangeMessage ? (
            <div className="source-peek-truncated">{sourcePeekRangeMessage}</div>
          ) : null}
          <section
            className={`source-peek-code ${wordWrap ? 'wrap-lines' : ''}`}
            aria-label={response.filePath}
            ref={codeRef}
            onScroll={handleCodeScroll}
          >
            {sourceLines.map((line, index) => {
              const lineNumber = (loadedSource?.startLine ?? response.startLine) + index;
              const isTargetLine = lineNumber === response.line;
              return (
                <div
                  className={`source-peek-row ${isTargetLine ? 'target' : ''}`}
                  key={lineNumber}
                  ref={isTargetLine ? targetLineRef : null}
                >
                  <span className="source-peek-line-number">{lineNumber}</span>
                  <code>{renderSourceLine(line || ' ', highlightedLines?.[index] ?? null)}</code>
                </div>
              );
            })}
          </section>
        </>
      ) : null}
    </aside>
  );
}

interface PanelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ResizeEdges {
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
}

function rectFromElement(element: HTMLElement): PanelRect {
  const rect = element.getBoundingClientRect();
  return {
    height: rect.height,
    left: rect.left,
    top: rect.top,
    width: rect.width
  };
}

function clampPanelRect(rect: PanelRect): PanelRect {
  const margin = sourcePeekViewportMargin();
  if (window.innerWidth <= 980) {
    return {
      height: window.innerHeight - margin * 2,
      left: margin,
      top: margin,
      width: window.innerWidth - margin * 2
    };
  }

  const maxWidth = Math.max(PANEL_MIN_WIDTH, window.innerWidth - margin * 2);
  const maxHeight = Math.max(PANEL_MIN_HEIGHT, window.innerHeight - margin * 2);
  const width = clamp(rect.width, PANEL_MIN_WIDTH, maxWidth);
  const height = clamp(rect.height, PANEL_MIN_HEIGHT, maxHeight);
  return {
    height,
    left: clamp(rect.left, margin, window.innerWidth - width - margin),
    top: clamp(rect.top, margin, window.innerHeight - height - margin),
    width
  };
}

function defaultPanelRect(): PanelRect {
  const margin = sourcePeekViewportMargin();
  if (window.innerWidth <= 980) {
    return clampPanelRect({
      height: window.innerHeight - margin * 2,
      left: margin,
      top: margin,
      width: window.innerWidth - margin * 2
    });
  }

  const leftReveal = Math.max(margin, Math.round(window.innerWidth / 3));
  const width = window.innerWidth - leftReveal - margin;
  const height = window.innerHeight - margin * 2;
  return clampPanelRect({
    height,
    left: leftReveal,
    top: margin,
    width
  });
}

function resizePanelRect(rect: PanelRect, edges: ResizeEdges, dx: number, dy: number): PanelRect {
  const margin = sourcePeekViewportMargin();
  let nextLeft = rect.left;
  let nextWidth = rect.width;
  let nextHeight = rect.height;

  if (edges.left) {
    const right = rect.left + rect.width;
    const minLeft = margin;
    const maxLeft = right - PANEL_MIN_WIDTH;
    nextLeft = clamp(rect.left + dx, minLeft, maxLeft);
    nextWidth = right - nextLeft;
  }

  if (edges.right) {
    nextWidth = clamp(rect.width + dx, PANEL_MIN_WIDTH, window.innerWidth - rect.left - margin);
  }

  if (edges.bottom) {
    nextHeight = clamp(rect.height + dy, PANEL_MIN_HEIGHT, window.innerHeight - rect.top - margin);
  }

  return clampPanelRect({
    height: nextHeight,
    left: nextLeft,
    top: rect.top,
    width: nextWidth
  });
}

function cursorForResizeEdges(edges: ResizeEdges): string {
  if (edges.bottom && edges.left) {
    return 'nesw-resize';
  }
  if (edges.bottom && edges.right) {
    return 'nwse-resize';
  }
  if (edges.bottom) {
    return 'row-resize';
  }
  return 'col-resize';
}

function rangeMessageForSourcePeek(
  loadedSource: LoadedSourcePeek,
  rangeLoading: Record<SourcePeekRangeDirection, boolean>,
  rangeError: string | null
): string | null {
  if (rangeError) {
    return `Could not load more source: ${cleanSourcePeekErrorMessage(rangeError)}`;
  }
  if (rangeLoading.above && rangeLoading.below) {
    return 'Loading more source lines above and below.';
  }
  if (rangeLoading.above) {
    return 'Loading more source lines above.';
  }
  if (rangeLoading.below) {
    return 'Loading more source lines below.';
  }
  if (loadedSource.hasMoreAbove || loadedSource.hasMoreBelow) {
    return 'Large source file - more lines load as you scroll.';
  }
  if (loadedSource.truncated) {
    return 'Source preview was shortened for a very long line.';
  }
  return null;
}

function sourcePeekErrorPresentation(message: string, symbol: string) {
  const cleanedMessage = cleanSourcePeekErrorMessage(message);
  if (/no definition found/i.test(cleanedMessage)) {
    return {
      hint: 'This can happen for Node built-ins, package exports, or symbols outside the repo.',
      message: `Gloss could not find a project definition for ${symbol}.`,
      title: 'No definition found'
    };
  }

  return {
    hint: null,
    message: cleanedMessage,
    title: 'Source peek unavailable'
  };
}

function cleanSourcePeekErrorMessage(message: string): string {
  const withoutStatus = message.replace(/^\d+:\s*/, '').trim();
  try {
    const parsed: unknown = JSON.parse(withoutStatus);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).error === 'string'
    ) {
      return cleanSourcePeekErrorMessage((parsed as { error: string }).error);
    }
  } catch {
    // Non-JSON messages are already displayable once prefixes are stripped.
  }
  return withoutStatus.replace(/^source peek unavailable:\s*/i, '').trim();
}

function sourcePeekViewportMargin(): number {
  return window.innerWidth <= 720 ? 8 : PANEL_MARGIN;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function renderSourceLine(line: string, tokens: SyntaxToken[] | null) {
  if (!tokens || tokens.length === 0) {
    return line;
  }
  return tokens.map((token) => (
    <span key={`${token.offset}:${token.content}`} style={styleForToken(token)}>
      {token.content}
    </span>
  ));
}

function styleForToken(token: SyntaxToken): CSSProperties {
  const style: CSSProperties = {};
  if (token.color) {
    style.color = token.color;
  }
  if (token.fontStyle && (token.fontStyle & 1) !== 0) {
    style.fontStyle = 'italic';
  }
  if (token.fontStyle && (token.fontStyle & 2) !== 0) {
    style.fontWeight = 700;
  }
  const textDecoration = [];
  if (token.fontStyle && (token.fontStyle & 4) !== 0) {
    textDecoration.push('underline');
  }
  if (token.fontStyle && (token.fontStyle & 8) !== 0) {
    textDecoration.push('line-through');
  }
  if (textDecoration.length > 0) {
    style.textDecorationLine = textDecoration.join(' ');
  }
  return style;
}
