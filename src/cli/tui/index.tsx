import { render } from 'ink';
import type { ReactElement } from 'react';
import { TerminalReviewApp, type TerminalReviewExit, type TerminalReviewModel } from './App';
import { disableSgrMouse, enableSgrMouse } from './mouse';

const enterAlternateScreen = '\u001B[?1049h\u001B[?25l';
const exitAlternateScreen = '\u001B[?25h\u001B[?1049l';

export async function runTerminalReview(
  model: TerminalReviewModel,
  streams: {
    stdin?: NodeJS.ReadStream;
    stdout?: NodeJS.WriteStream;
    stderr?: NodeJS.WriteStream;
  } = {}
): Promise<TerminalReviewExit> {
  const stdin = streams.stdin ?? process.stdin;
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;
  let instance: ReturnType<typeof render> | null = null;

  stdout.write(enterAlternateScreen);
  enableSgrMouse(stdout);
  try {
    instance = render(appElement(model), {
      stdin,
      stdout,
      stderr,
      exitOnCtrlC: false,
      patchConsole: false,
      maxFps: 30
    });
    const result = (await instance.waitUntilExit()) as TerminalReviewExit | undefined;
    return result ?? { type: 'quit', comments: [] };
  } finally {
    instance?.unmount();
    disableSgrMouse(stdout);
    stdout.write(exitAlternateScreen);
  }
}

function appElement(model: TerminalReviewModel): ReactElement {
  return <TerminalReviewApp model={model} />;
}

export type { TerminalReviewExit, TerminalReviewModel };
