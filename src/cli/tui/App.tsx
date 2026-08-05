import clipboard from 'clipboardy';
import { Box, type Key, Text, useApp, useInput } from 'ink';
import {
  type Dispatch,
  type MutableRefObject,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react';
import type { Comment, DiffPayload } from '../../shared/types';
import { composerPreviewLines } from './composer';
import { type SgrMouseEvent, SgrMouseParser } from './mouse';
import { createInitialTuiState, type TuiAction, type TuiState, tuiReducer } from './reducer';
import {
  formatInlineTarget,
  formatRowDisplayText,
  type TuiDiffRow,
  visibleTuiRows
} from './row-model';
import {
  inlineTargetForRowSelection,
  type MouseRowPoint,
  rowIndexForMouseY,
  selectedTextForRows
} from './selection';

export interface TerminalReviewModel {
  reviewId: string;
  turnId?: string;
  turnIndex?: number;
  url: string;
  branch: string | null;
  scope: DiffPayload['scope'];
  stats: DiffPayload['stats'];
  rows: TuiDiffRow[];
}

export type TerminalReviewExit =
  | { type: 'submit'; comments: Comment[] }
  | { type: 'quit'; comments: Comment[] };

interface TerminalSize {
  columns: number;
  rows: number;
}

const headerHeight = 3;
const baseFooterHeight = 4;
const composerFooterHeight = 8;

export function TerminalReviewApp({ model }: { model: TerminalReviewModel }) {
  const app = useApp();
  const [size, setSize] = useState<TerminalSize>(() => terminalSize());
  const initialViewportHeight = viewportHeight(size.rows, baseFooterHeight);
  const [state, dispatch] = useReducer(tuiReducer, model.rows, (rows) =>
    createInitialTuiState(rows, initialViewportHeight)
  );
  const stateRef = useRef(state);
  const mouseParserRef = useRef(new SgrMouseParser());
  const dragStartRef = useRef<MouseRowPoint | null>(null);
  const footerHeight = state.composer ? composerFooterHeight : baseFooterHeight;
  const viewportRows = viewportHeight(size.rows, footerHeight);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    dispatch({ type: 'setViewportHeight', height: viewportRows });
  }, [viewportRows]);

  useEffect(() => {
    const handleResize = () => setSize(terminalSize());
    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, []);

  useInput((input, key) => {
    const mouseEvents = mouseParserRef.current.push(input);
    if (mouseEvents.length > 0) {
      for (const event of mouseEvents) {
        void handleMouseEvent({
          event,
          model,
          state: stateRef.current,
          dispatch,
          appExit: app.exit,
          columns: size.columns,
          viewportRows,
          dragStartRef
        });
      }
      return;
    }

    const current = stateRef.current;
    if (current.composer) {
      handleComposerInput(input, key, dispatch);
      return;
    }

    if (key.ctrl && input === 'c') {
      exitWithQuit(app.exit, current);
      return;
    }

    if (key.upArrow || input === 'k') {
      dispatch({ type: 'navigate', movement: 'up' });
    } else if (key.downArrow || input === 'j') {
      dispatch({ type: 'navigate', movement: 'down' });
    } else if (key.pageUp) {
      dispatch({ type: 'navigate', movement: 'pageUp' });
    } else if (key.pageDown) {
      dispatch({ type: 'navigate', movement: 'pageDown' });
    } else if (key.home) {
      dispatch({ type: 'navigate', movement: 'home' });
    } else if (key.end) {
      dispatch({ type: 'navigate', movement: 'end' });
    } else if (input === 'c') {
      dispatch({ type: 'openInlineComposer' });
    } else if (input === 'g') {
      dispatch({ type: 'openGeneralComposer' });
    } else if (input === 'u') {
      dispatch({ type: 'undoComment' });
    } else if (input === 's') {
      dispatch({ type: 'submit' });
      app.exit({ type: 'submit', comments: current.comments });
    } else if (input === 'q') {
      exitWithQuit(app.exit, current);
    }
  });

  const visibleRows = useMemo(
    () => visibleTuiRows(state.rows, state.scrollTop, viewportRows),
    [state.rows, state.scrollTop, viewportRows]
  );

  return (
    <Box flexDirection="column" height={size.rows} width={size.columns}>
      <Header model={model} comments={state.comments.length} />
      <Box flexDirection="column" height={viewportRows}>
        {visibleRows.map((row, offset) => (
          <DiffRow
            key={row.id}
            row={row}
            selected={state.scrollTop + offset === state.selectedRowIndex}
            width={size.columns}
          />
        ))}
      </Box>
      <Footer state={state} width={size.columns} />
    </Box>
  );
}

function Header({ model, comments }: { model: TerminalReviewModel; comments: number }) {
  const branch = model.branch ?? 'detached';
  const scope =
    model.scope.mode === 'explicit'
      ? `explicit ${model.scope.requestedBase ?? model.scope.base.ref}`
      : model.scope.mode;
  return (
    <Box flexDirection="column" height={headerHeight}>
      <Text bold color="cyan">
        Gloss review {model.reviewId}
        {model.turnIndex ? ` turn ${model.turnIndex}` : ''}
      </Text>
      <Text dimColor>
        {branch} · {scope} · {model.stats.files} files · +{model.stats.additions} -
        {model.stats.deletions} · {comments} pending comments
      </Text>
      <Text dimColor>{model.url}</Text>
    </Box>
  );
}

function DiffRow({ row, selected, width }: { row: TuiDiffRow; selected: boolean; width: number }) {
  const color =
    row.kind === 'file'
      ? 'cyan'
      : row.kind === 'hunk'
        ? 'yellow'
        : row.diffType === 'add'
          ? 'green'
          : row.diffType === 'delete'
            ? 'red'
            : undefined;
  return (
    <Text
      color={color}
      dimColor={row.kind === 'binary' || row.kind === 'empty'}
      inverse={selected}
      wrap="truncate"
    >
      {formatRowDisplayText(row, width)}
    </Text>
  );
}

function Footer({ state, width }: { state: TuiState; width: number }) {
  const target = state.inlineTarget ? formatInlineTarget(state.inlineTarget) : 'no line selected';
  const status = state.clipboardStatus ?? state.status ?? 'Ready';
  if (state.composer) {
    const title =
      state.composer.kind === 'inline' && state.composer.target
        ? `Inline comment · ${formatInlineTarget(state.composer.target)}`
        : 'General comment';
    const preview = composerPreviewLines(state.composer.text, 3);
    return (
      <Box flexDirection="column" height={composerFooterHeight}>
        <Text color="magenta" bold wrap="truncate">
          {title}
        </Text>
        <Text wrap="truncate">{preview[0] && preview[0].length > 0 ? preview[0] : ' '}</Text>
        <Text wrap="truncate">{preview[1] && preview[1].length > 0 ? preview[1] : ' '}</Text>
        <Text wrap="truncate">{preview[2] && preview[2].length > 0 ? preview[2] : ' '}</Text>
        <Text dimColor wrap="truncate">
          Enter newline · Ctrl+D save · Esc cancel
        </Text>
        <Text dimColor wrap="truncate">
          {truncateFooter(status, width)}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={baseFooterHeight}>
      <Text wrap="truncate">[c Comment] [g General] [u Undo] [s Submit] [q Quit]</Text>
      <Text dimColor wrap="truncate">
        j/k arrows PgUp/PgDn Home/End · wheel scroll · drag copies text
      </Text>
      <Text dimColor wrap="truncate">
        Target: {target}
      </Text>
      <Text dimColor wrap="truncate">
        {truncateFooter(status, width)}
      </Text>
    </Box>
  );
}

function handleComposerInput(input: string, key: Key, dispatch: Dispatch<TuiAction>) {
  if (key.ctrl && input === 'd') {
    dispatch({ type: 'composer.save' });
  } else if (key.escape) {
    dispatch({ type: 'composer.cancel' });
  } else if (key.return) {
    dispatch({ type: 'composer.newline' });
  } else if (key.backspace) {
    dispatch({ type: 'composer.backspace' });
  } else if (key.delete) {
    dispatch({ type: 'composer.delete' });
  } else if (key.leftArrow) {
    dispatch({ type: 'composer.move', direction: 'left' });
  } else if (key.rightArrow) {
    dispatch({ type: 'composer.move', direction: 'right' });
  } else if (key.upArrow) {
    dispatch({ type: 'composer.move', direction: 'up' });
  } else if (key.downArrow) {
    dispatch({ type: 'composer.move', direction: 'down' });
  } else if (key.home) {
    dispatch({ type: 'composer.move', direction: 'home' });
  } else if (key.end) {
    dispatch({ type: 'composer.move', direction: 'end' });
  } else if (isPrintableInput(input)) {
    dispatch({ type: 'composer.insert', value: input });
  }
}

async function handleMouseEvent({
  event,
  state,
  dispatch,
  appExit,
  columns,
  viewportRows,
  dragStartRef
}: {
  event: SgrMouseEvent;
  model: TerminalReviewModel;
  state: TuiState;
  dispatch: Dispatch<TuiAction>;
  appExit: (result?: unknown) => void;
  columns: number;
  viewportRows: number;
  dragStartRef: MutableRefObject<MouseRowPoint | null>;
}): Promise<void> {
  if (event.type === 'wheel') {
    dispatch({ type: 'scroll', delta: event.direction === 'down' ? 3 : -3 });
    return;
  }

  const footerAction = footerActionFor(event.x, event.y, viewportRows, state);
  if (event.type === 'release' && footerAction) {
    runFooterAction(footerAction, state, dispatch, appExit);
    return;
  }

  const rowIndex = rowIndexForMouseY(
    event.y,
    headerHeight,
    state.scrollTop,
    viewportRows,
    state.rows.length
  );
  if (rowIndex === null) {
    return;
  }

  if (event.type === 'press') {
    dragStartRef.current = { rowIndex, column: event.x };
    dispatch({ type: 'selectRow', rowIndex });
    return;
  }

  if (event.type === 'drag') {
    dispatch({ type: 'selectRow', rowIndex });
    return;
  }

  const dragStart = dragStartRef.current;
  dragStartRef.current = null;
  dispatch({ type: 'selectRow', rowIndex });
  if (!dragStart) {
    return;
  }

  const dragEnd = { rowIndex, column: event.x };
  const isDrag =
    dragStart.rowIndex !== dragEnd.rowIndex || Math.abs(dragStart.column - dragEnd.column) > 1;
  if (!isDrag) {
    return;
  }

  const selectedText = selectedTextForRows(state.rows, dragStart, dragEnd, columns);
  if (selectedText.trim().length > 0) {
    try {
      await clipboard.write(selectedText);
      dispatch({ type: 'setClipboardStatus', status: 'Copied selection to clipboard.' });
    } catch (error) {
      dispatch({
        type: 'setClipboardStatus',
        status: `Clipboard copy failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  const target = inlineTargetForRowSelection(state.rows, dragStart.rowIndex, dragEnd.rowIndex);
  if (target) {
    dispatch({ type: 'setInlineTarget', target });
  }
}

type FooterAction = 'comment' | 'general' | 'undo' | 'submit' | 'quit';

function footerActionFor(
  x: number,
  y: number,
  viewportRows: number,
  state: TuiState
): FooterAction | null {
  if (state.composer || y !== headerHeight + viewportRows + 1) {
    return null;
  }
  if (x >= 1 && x <= 11) {
    return 'comment';
  }
  if (x >= 13 && x <= 23) {
    return 'general';
  }
  if (x >= 25 && x <= 32) {
    return 'undo';
  }
  if (x >= 34 && x <= 43) {
    return 'submit';
  }
  if (x >= 45 && x <= 52) {
    return 'quit';
  }
  return null;
}

function runFooterAction(
  action: FooterAction,
  state: TuiState,
  dispatch: Dispatch<TuiAction>,
  appExit: (result?: unknown) => void
): void {
  if (action === 'comment') {
    dispatch({ type: 'openInlineComposer' });
  } else if (action === 'general') {
    dispatch({ type: 'openGeneralComposer' });
  } else if (action === 'undo') {
    dispatch({ type: 'undoComment' });
  } else if (action === 'submit') {
    dispatch({ type: 'submit' });
    appExit({ type: 'submit', comments: state.comments });
  } else {
    exitWithQuit(appExit, state);
  }
}

function exitWithQuit(appExit: (result?: unknown) => void, state: TuiState): void {
  appExit({ type: 'quit', comments: state.comments });
}

function viewportHeight(rows: number, footerHeight: number): number {
  return Math.max(1, rows - headerHeight - footerHeight);
}

function terminalSize(): TerminalSize {
  return {
    columns: process.stdout.columns ?? 100,
    rows: process.stdout.rows ?? 32
  };
}

function isPrintableInput(input: string): boolean {
  if (input.length === 0) {
    return false;
  }
  for (const char of input) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint < 32 || codePoint === 127) {
      return false;
    }
  }
  return true;
}

function truncateFooter(value: string, width: number): string {
  return value.length > width ? value.slice(0, Math.max(0, width - 1)) : value;
}
