import { ulid } from 'ulid';
import type { Comment } from '../../shared/types';
import {
  backspaceComposer,
  type ComposerState,
  deleteComposer,
  emptyComposer,
  insertComposerNewline,
  insertComposerText,
  moveComposerCursor,
  moveComposerCursorVertically
} from './composer';
import {
  formatInlineTarget,
  type InlineCommentTarget,
  lineTargetForRow,
  type TuiDiffRow
} from './row-model';

export type ComposerKind = 'inline' | 'general';
type NavigationMovement = 'up' | 'down' | 'pageUp' | 'pageDown' | 'home' | 'end';

export interface ActiveComposer {
  kind: ComposerKind;
  target: InlineCommentTarget | null;
  text: ComposerState;
}

export interface TuiState {
  rows: TuiDiffRow[];
  selectedRowIndex: number;
  scrollTop: number;
  viewportHeight: number;
  comments: Comment[];
  composer: ActiveComposer | null;
  inlineTarget: InlineCommentTarget | null;
  status: string | null;
  clipboardStatus: string | null;
  mode: 'review' | 'submitting' | 'quit';
}

export type TuiAction =
  | { type: 'setViewportHeight'; height: number }
  | { type: 'selectRow'; rowIndex: number }
  | { type: 'navigate'; movement: NavigationMovement }
  | { type: 'scroll'; delta: number }
  | { type: 'setInlineTarget'; target: InlineCommentTarget | null }
  | { type: 'openInlineComposer' }
  | { type: 'openGeneralComposer' }
  | { type: 'composer.insert'; value: string }
  | { type: 'composer.newline' }
  | { type: 'composer.backspace' }
  | { type: 'composer.delete' }
  | { type: 'composer.move'; direction: 'left' | 'right' | 'up' | 'down' | 'home' | 'end' }
  | { type: 'composer.cancel' }
  | { type: 'composer.save'; id?: string; createdAt?: string }
  | { type: 'undoComment' }
  | { type: 'submit' }
  | { type: 'quit' }
  | { type: 'setStatus'; status: string | null }
  | { type: 'setClipboardStatus'; status: string | null };

export function createInitialTuiState(rows: TuiDiffRow[], viewportHeight: number): TuiState {
  const selectedRowIndex = firstTargetableRow(rows);
  return {
    rows,
    selectedRowIndex,
    scrollTop: clampScrollTop(selectedRowIndex, rows.length, viewportHeight),
    viewportHeight: Math.max(1, viewportHeight),
    comments: [],
    composer: null,
    inlineTarget: lineTargetForRow(rows[selectedRowIndex]),
    status: null,
    clipboardStatus: null,
    mode: 'review'
  };
}

export function tuiReducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case 'setViewportHeight': {
      const viewportHeight = Math.max(1, action.height);
      return {
        ...state,
        viewportHeight,
        scrollTop: ensureRowVisible(state.scrollTop, state.selectedRowIndex, viewportHeight)
      };
    }
    case 'selectRow':
      return selectRow(state, action.rowIndex);
    case 'navigate':
      return navigate(state, action.movement);
    case 'scroll':
      return scroll(state, action.delta);
    case 'setInlineTarget':
      return {
        ...state,
        inlineTarget: action.target,
        status: action.target ? `Target ${formatInlineTarget(action.target)}` : state.status
      };
    case 'openInlineComposer': {
      const target = state.inlineTarget ?? lineTargetForRow(state.rows[state.selectedRowIndex]);
      if (!target) {
        return { ...state, status: 'Select a changed line before adding an inline comment.' };
      }
      return {
        ...state,
        composer: { kind: 'inline', target, text: emptyComposer() },
        status: `Commenting on ${formatInlineTarget(target)}`
      };
    }
    case 'openGeneralComposer':
      return {
        ...state,
        composer: { kind: 'general', target: null, text: emptyComposer() },
        status: 'Writing general feedback'
      };
    case 'composer.insert':
      return updateComposer(state, (composer) => ({
        ...composer,
        text: insertComposerText(composer.text, action.value)
      }));
    case 'composer.newline':
      return updateComposer(state, (composer) => ({
        ...composer,
        text: insertComposerNewline(composer.text)
      }));
    case 'composer.backspace':
      return updateComposer(state, (composer) => ({
        ...composer,
        text: backspaceComposer(composer.text)
      }));
    case 'composer.delete':
      return updateComposer(state, (composer) => ({
        ...composer,
        text: deleteComposer(composer.text)
      }));
    case 'composer.move':
      return updateComposer(state, (composer) => ({
        ...composer,
        text:
          action.direction === 'up' || action.direction === 'down'
            ? moveComposerCursorVertically(composer.text, action.direction)
            : moveComposerCursor(composer.text, action.direction)
      }));
    case 'composer.cancel':
      return { ...state, composer: null, status: 'Comment cancelled' };
    case 'composer.save':
      return saveComposer(state, action.id ?? ulid(), action.createdAt ?? new Date().toISOString());
    case 'undoComment':
      if (state.comments.length === 0) {
        return { ...state, status: 'No unsent comments to remove.' };
      }
      return {
        ...state,
        comments: state.comments.slice(0, -1),
        status: 'Removed last unsent comment.'
      };
    case 'submit':
      return { ...state, mode: 'submitting', status: 'Submitting review...' };
    case 'quit':
      return { ...state, mode: 'quit', status: 'Review left pending.' };
    case 'setStatus':
      return { ...state, status: action.status };
    case 'setClipboardStatus':
      return { ...state, clipboardStatus: action.status };
  }
}

function navigate(state: TuiState, movement: NavigationMovement): TuiState {
  if (state.composer) {
    return state;
  }

  const page = Math.max(1, state.viewportHeight - 1);
  const nextIndex =
    movement === 'up'
      ? state.selectedRowIndex - 1
      : movement === 'down'
        ? state.selectedRowIndex + 1
        : movement === 'pageUp'
          ? state.selectedRowIndex - page
          : movement === 'pageDown'
            ? state.selectedRowIndex + page
            : movement === 'home'
              ? 0
              : state.rows.length - 1;
  return selectRow(state, nearestSelectableRow(state.rows, nextIndex, state.selectedRowIndex));
}

function scroll(state: TuiState, delta: number): TuiState {
  if (state.composer) {
    return state;
  }
  const scrollTop = clamp(
    delta + state.scrollTop,
    0,
    maxScrollTop(state.rows.length, state.viewportHeight)
  );
  const selectedRowIndex = clamp(
    state.selectedRowIndex,
    scrollTop,
    Math.min(state.rows.length - 1, scrollTop + state.viewportHeight - 1)
  );
  return {
    ...state,
    scrollTop,
    selectedRowIndex,
    inlineTarget: lineTargetForRow(state.rows[selectedRowIndex]) ?? state.inlineTarget
  };
}

function selectRow(state: TuiState, rowIndex: number): TuiState {
  const selectedRowIndex = clamp(rowIndex, 0, Math.max(0, state.rows.length - 1));
  return {
    ...state,
    selectedRowIndex,
    scrollTop: ensureRowVisible(state.scrollTop, selectedRowIndex, state.viewportHeight),
    inlineTarget: lineTargetForRow(state.rows[selectedRowIndex]) ?? state.inlineTarget
  };
}

function updateComposer(
  state: TuiState,
  update: (composer: ActiveComposer) => ActiveComposer
): TuiState {
  if (!state.composer) {
    return state;
  }
  return { ...state, composer: update(state.composer) };
}

function saveComposer(state: TuiState, id: string, createdAt: string): TuiState {
  const composer = state.composer;
  const body = composer?.text.body.trim() ?? '';
  if (!composer || body.length === 0) {
    return { ...state, composer: null, status: 'Empty comment discarded.' };
  }

  const target = composer.target;
  const comment: Comment =
    composer.kind === 'general'
      ? {
          kind: 'general',
          id,
          body,
          createdAt
        }
      : {
          kind: 'line',
          id,
          filePath: requiredTarget(target).filePath,
          side: requiredTarget(target).side,
          startLine: Math.min(requiredTarget(target).startLine, requiredTarget(target).endLine),
          endLine: Math.max(requiredTarget(target).startLine, requiredTarget(target).endLine),
          body,
          originalSnippet: requiredTarget(target).originalSnippet,
          createdAt
        };

  return {
    ...state,
    comments: [...state.comments, comment],
    composer: null,
    status: `Saved ${composer.kind === 'general' ? 'general' : 'inline'} comment.`
  };
}

function requiredTarget(target: InlineCommentTarget | null): InlineCommentTarget {
  if (!target) {
    throw new Error('Inline composer is missing a target');
  }
  return target;
}

function firstTargetableRow(rows: TuiDiffRow[]): number {
  const index = rows.findIndex((row) => row.targetable);
  return index === -1 ? 0 : index;
}

function nearestSelectableRow(rows: TuiDiffRow[], desiredIndex: number, fallback: number): number {
  if (rows.length === 0) {
    return 0;
  }
  const clamped = clamp(desiredIndex, 0, rows.length - 1);
  if (rows[clamped]?.targetable) {
    return clamped;
  }

  const direction = desiredIndex >= fallback ? 1 : -1;
  for (let index = clamped; index >= 0 && index < rows.length; index += direction) {
    if (rows[index]?.targetable) {
      return index;
    }
  }
  for (let index = clamped; index >= 0 && index < rows.length; index -= direction) {
    if (rows[index]?.targetable) {
      return index;
    }
  }
  return clamped;
}

function ensureRowVisible(scrollTop: number, rowIndex: number, viewportHeight: number): number {
  if (rowIndex < scrollTop) {
    return rowIndex;
  }
  if (rowIndex >= scrollTop + viewportHeight) {
    return rowIndex - viewportHeight + 1;
  }
  return scrollTop;
}

function clampScrollTop(rowIndex: number, rowCount: number, viewportHeight: number): number {
  return clamp(rowIndex, 0, maxScrollTop(rowCount, viewportHeight));
}

function maxScrollTop(rowCount: number, viewportHeight: number): number {
  return Math.max(0, rowCount - Math.max(1, viewportHeight));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
