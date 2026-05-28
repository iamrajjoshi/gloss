interface KeyboardShortcutEvent {
  key: string;
  metaKey?: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
}

export function isSubmitCommentShortcut(event: KeyboardShortcutEvent): boolean {
  return isMetaEnter(event) && !event.shiftKey;
}

export function isSubmitReviewShortcut(event: KeyboardShortcutEvent): boolean {
  return isMetaEnter(event) && event.shiftKey === true;
}

function isMetaEnter(event: KeyboardShortcutEvent): boolean {
  return (
    event.key === 'Enter' &&
    event.metaKey === true &&
    event.ctrlKey !== true &&
    event.altKey !== true &&
    event.repeat !== true &&
    event.defaultPrevented !== true &&
    event.isComposing !== true &&
    event.nativeEvent?.isComposing !== true
  );
}
