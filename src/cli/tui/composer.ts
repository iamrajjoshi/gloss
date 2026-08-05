export interface ComposerState {
  body: string;
  cursor: number;
}

export function emptyComposer(): ComposerState {
  return { body: '', cursor: 0 };
}

export function insertComposerText(state: ComposerState, value: string): ComposerState {
  if (value.length === 0) {
    return state;
  }
  return {
    body: `${state.body.slice(0, state.cursor)}${value}${state.body.slice(state.cursor)}`,
    cursor: state.cursor + value.length
  };
}

export function insertComposerNewline(state: ComposerState): ComposerState {
  return insertComposerText(state, '\n');
}

export function backspaceComposer(state: ComposerState): ComposerState {
  if (state.cursor === 0) {
    return state;
  }
  const chars = Array.from(state.body);
  const beforeCursor = Array.from(state.body.slice(0, state.cursor));
  const nextCursor = beforeCursor.slice(0, -1).join('').length;
  const removeIndex = beforeCursor.length - 1;
  chars.splice(removeIndex, 1);
  return {
    body: chars.join(''),
    cursor: nextCursor
  };
}

export function deleteComposer(state: ComposerState): ComposerState {
  if (state.cursor >= state.body.length) {
    return state;
  }
  const before = state.body.slice(0, state.cursor);
  const afterChars = Array.from(state.body.slice(state.cursor));
  afterChars.shift();
  return {
    body: `${before}${afterChars.join('')}`,
    cursor: state.cursor
  };
}

export function moveComposerCursor(
  state: ComposerState,
  direction: 'left' | 'right' | 'home' | 'end'
): ComposerState {
  if (direction === 'home') {
    return { ...state, cursor: lineStartOffset(state.body, state.cursor) };
  }
  if (direction === 'end') {
    return { ...state, cursor: lineEndOffset(state.body, state.cursor) };
  }
  if (direction === 'left') {
    return { ...state, cursor: previousOffset(state.body, state.cursor) };
  }
  return { ...state, cursor: nextOffset(state.body, state.cursor) };
}

export function moveComposerCursorVertically(
  state: ComposerState,
  direction: 'up' | 'down'
): ComposerState {
  const lineStart = lineStartOffset(state.body, state.cursor);
  const column = state.cursor - lineStart;
  if (direction === 'up') {
    if (lineStart === 0) {
      return state;
    }
    const previousEnd = lineStart - 1;
    const previousStart = lineStartOffset(state.body, previousEnd);
    return {
      ...state,
      cursor: Math.min(previousStart + column, previousEnd)
    };
  }

  const currentEnd = lineEndOffset(state.body, state.cursor);
  if (currentEnd >= state.body.length) {
    return state;
  }
  const nextStart = currentEnd + 1;
  const nextEnd = lineEndOffset(state.body, nextStart);
  return {
    ...state,
    cursor: Math.min(nextStart + column, nextEnd)
  };
}

export function composerPreviewLines(state: ComposerState, maxLines: number): string[] {
  const lines = state.body.length === 0 ? [''] : state.body.split('\n');
  return lines.slice(Math.max(0, lines.length - maxLines));
}

function previousOffset(value: string, cursor: number): number {
  if (cursor === 0) {
    return 0;
  }
  return Array.from(value.slice(0, cursor)).slice(0, -1).join('').length;
}

function nextOffset(value: string, cursor: number): number {
  if (cursor >= value.length) {
    return value.length;
  }
  const current = value.slice(0, cursor);
  const nextChar = Array.from(value.slice(cursor))[0] ?? '';
  return current.length + nextChar.length;
}

function lineStartOffset(value: string, cursor: number): number {
  const previousNewline = value.lastIndexOf('\n', Math.max(0, cursor - 1));
  return previousNewline === -1 ? 0 : previousNewline + 1;
}

function lineEndOffset(value: string, cursor: number): number {
  const nextNewline = value.indexOf('\n', cursor);
  return nextNewline === -1 ? value.length : nextNewline;
}
