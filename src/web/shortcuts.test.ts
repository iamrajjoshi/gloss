import { describe, expect, it } from 'vitest';
import { isSubmitCommentShortcut, isSubmitReviewShortcut } from './shortcuts';

const metaEnter = {
  key: 'Enter',
  metaKey: true,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  repeat: false,
  isComposing: false
};

describe('web keyboard shortcuts', () => {
  it('matches Command+Enter for comment submission only', () => {
    expect(isSubmitCommentShortcut(metaEnter)).toBe(true);
    expect(isSubmitReviewShortcut(metaEnter)).toBe(false);
  });

  it('matches Command+Shift+Enter for review submission only', () => {
    const event = { ...metaEnter, shiftKey: true };

    expect(isSubmitCommentShortcut(event)).toBe(false);
    expect(isSubmitReviewShortcut(event)).toBe(true);
  });

  it('ignores plain Enter and Shift+Enter', () => {
    expect(isSubmitCommentShortcut({ ...metaEnter, metaKey: false })).toBe(false);
    expect(isSubmitReviewShortcut({ ...metaEnter, metaKey: false })).toBe(false);
    expect(isSubmitCommentShortcut({ ...metaEnter, metaKey: false, shiftKey: true })).toBe(false);
    expect(isSubmitReviewShortcut({ ...metaEnter, metaKey: false, shiftKey: true })).toBe(false);
  });

  it('ignores Ctrl and Alt modified commands', () => {
    expect(isSubmitCommentShortcut({ ...metaEnter, ctrlKey: true })).toBe(false);
    expect(isSubmitReviewShortcut({ ...metaEnter, shiftKey: true, ctrlKey: true })).toBe(false);
    expect(isSubmitCommentShortcut({ ...metaEnter, altKey: true })).toBe(false);
    expect(isSubmitReviewShortcut({ ...metaEnter, shiftKey: true, altKey: true })).toBe(false);
  });

  it('ignores repeated, handled, and composing events', () => {
    expect(isSubmitCommentShortcut({ ...metaEnter, repeat: true })).toBe(false);
    expect(isSubmitReviewShortcut({ ...metaEnter, shiftKey: true, repeat: true })).toBe(false);
    expect(isSubmitCommentShortcut({ ...metaEnter, defaultPrevented: true })).toBe(false);
    expect(isSubmitReviewShortcut({ ...metaEnter, shiftKey: true, defaultPrevented: true })).toBe(
      false
    );
    expect(isSubmitCommentShortcut({ ...metaEnter, isComposing: true })).toBe(false);
    expect(isSubmitReviewShortcut({ ...metaEnter, shiftKey: true, isComposing: true })).toBe(false);
    expect(isSubmitCommentShortcut({ ...metaEnter, nativeEvent: { isComposing: true } })).toBe(
      false
    );
    expect(
      isSubmitReviewShortcut({
        ...metaEnter,
        shiftKey: true,
        nativeEvent: { isComposing: true }
      })
    ).toBe(false);
  });
});
