export type MouseButton = 'left' | 'middle' | 'right' | 'unknown';

export type SgrMouseEvent =
  | { type: 'press'; button: MouseButton; x: number; y: number }
  | { type: 'drag'; button: MouseButton; x: number; y: number }
  | { type: 'release'; button: MouseButton; x: number; y: number }
  | { type: 'wheel'; direction: 'up' | 'down'; x: number; y: number };

const esc = String.fromCharCode(27);
const sgrMousePattern = new RegExp(`${esc}\\[<(\\d+);(\\d+);(\\d+)([Mm])`, 'g');

export class SgrMouseParser {
  private buffer = '';

  push(input: string): SgrMouseEvent[] {
    this.buffer += input;
    const events: SgrMouseEvent[] = [];
    let consumedThrough = 0;
    sgrMousePattern.lastIndex = 0;

    for (
      let match = sgrMousePattern.exec(this.buffer);
      match;
      match = sgrMousePattern.exec(this.buffer)
    ) {
      const event = eventFromMatch(match);
      if (event) {
        events.push(event);
      }
      consumedThrough = match.index + match[0].length;
    }

    if (consumedThrough > 0) {
      this.buffer = this.buffer.slice(consumedThrough);
    }
    if (this.buffer.length > 32 && !this.buffer.includes('\u001B[<')) {
      this.buffer = '';
    }

    return events;
  }
}

export function enableSgrMouse(stdout: NodeJS.WriteStream): void {
  stdout.write('\u001B[?1000h\u001B[?1002h\u001B[?1006h');
}

export function disableSgrMouse(stdout: NodeJS.WriteStream): void {
  stdout.write('\u001B[?1006l\u001B[?1002l\u001B[?1000l');
}

function eventFromMatch(match: RegExpExecArray): SgrMouseEvent | null {
  const code = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  const final = match[4];
  if (!Number.isFinite(code) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  if ((code & 64) === 64) {
    return {
      type: 'wheel',
      direction: (code & 1) === 1 ? 'down' : 'up',
      x,
      y
    };
  }

  if (final === 'm') {
    return {
      type: 'release',
      button: buttonFromCode(code),
      x,
      y
    };
  }

  if ((code & 32) === 32) {
    return {
      type: 'drag',
      button: buttonFromCode(code),
      x,
      y
    };
  }

  return {
    type: 'press',
    button: buttonFromCode(code),
    x,
    y
  };
}

function buttonFromCode(code: number): MouseButton {
  switch (code & 3) {
    case 0:
      return 'left';
    case 1:
      return 'middle';
    case 2:
      return 'right';
    default:
      return 'unknown';
  }
}
