import { describe, expect, it } from 'vitest';
import { SgrMouseParser } from './mouse';

const esc = String.fromCharCode(27);

describe('SgrMouseParser', () => {
  it('parses SGR press, drag, release, and wheel events', () => {
    const parser = new SgrMouseParser();

    expect(parser.push(`${esc}[<0;4;5M${esc}[<32;4;6M${esc}[<0;4;6m`)).toEqual([
      { type: 'press', button: 'left', x: 4, y: 5 },
      { type: 'drag', button: 'left', x: 4, y: 6 },
      { type: 'release', button: 'left', x: 4, y: 6 }
    ]);
    expect(parser.push(`${esc}[<64;10;3M${esc}[<65;10;4M`)).toEqual([
      { type: 'wheel', direction: 'up', x: 10, y: 3 },
      { type: 'wheel', direction: 'down', x: 10, y: 4 }
    ]);
  });

  it('handles fragmented escape sequences', () => {
    const parser = new SgrMouseParser();

    expect(parser.push(`${esc}[<0;`)).toEqual([]);
    expect(parser.push('2;3M')).toEqual([{ type: 'press', button: 'left', x: 2, y: 3 }]);
  });
});
