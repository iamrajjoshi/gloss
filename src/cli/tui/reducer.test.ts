import { describe, expect, it } from 'vitest';
import { makeDiff } from '../../test/factories';
import { createInitialTuiState, tuiReducer } from './reducer';
import { buildTuiRows } from './row-model';

describe('tuiReducer', () => {
  it('navigates through targetable diff rows and keeps selection visible', () => {
    const rows = buildTuiRows(makeDiff({ cwd: '/repo' }));
    let state = createInitialTuiState(rows, 1);

    state = tuiReducer(state, { type: 'navigate', movement: 'home' });
    expect(state.selectedRowIndex).toBe(2);
    state = tuiReducer(state, { type: 'navigate', movement: 'end' });
    expect(state.selectedRowIndex).toBe(2);
    expect(state.scrollTop).toBe(2);
  });

  it('saves and cancels multiline inline comments', () => {
    const rows = buildTuiRows(makeDiff({ cwd: '/repo' }));
    let state = createInitialTuiState(rows, 5);

    state = tuiReducer(state, { type: 'openInlineComposer' });
    state = tuiReducer(state, { type: 'composer.insert', value: 'first line' });
    state = tuiReducer(state, { type: 'composer.newline' });
    state = tuiReducer(state, { type: 'composer.insert', value: 'second line' });
    state = tuiReducer(state, {
      type: 'composer.save',
      id: 'comment-1',
      createdAt: '2026-06-27T12:00:00.000Z'
    });

    expect(state.comments).toHaveLength(1);
    expect(state.comments[0]).toMatchObject({
      kind: 'line',
      body: 'first line\nsecond line',
      filePath: 'app.ts'
    });

    state = tuiReducer(state, { type: 'openInlineComposer' });
    state = tuiReducer(state, { type: 'composer.insert', value: 'discard me' });
    state = tuiReducer(state, { type: 'composer.cancel' });
    expect(state.comments).toHaveLength(1);
    expect(state.composer).toBeNull();
  });

  it('saves general comments, undoes, submits, and quits', () => {
    const rows = buildTuiRows(makeDiff({ cwd: '/repo' }));
    let state = createInitialTuiState(rows, 5);

    state = tuiReducer(state, { type: 'openGeneralComposer' });
    state = tuiReducer(state, { type: 'composer.insert', value: 'overall note' });
    state = tuiReducer(state, {
      type: 'composer.save',
      id: 'general-1',
      createdAt: '2026-06-27T12:00:00.000Z'
    });
    expect(state.comments[0]).toMatchObject({ kind: 'general', body: 'overall note' });

    state = tuiReducer(state, { type: 'undoComment' });
    expect(state.comments).toEqual([]);

    state = tuiReducer(state, { type: 'submit' });
    expect(state.mode).toBe('submitting');
    state = tuiReducer(state, { type: 'quit' });
    expect(state.mode).toBe('quit');
  });
});
