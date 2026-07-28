import type { useApp } from 'ink';

type SuspendTerminal = ReturnType<typeof useApp>['suspendTerminal'];

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const EXIT_ALT_SCREEN = '\x1b[?1049l';

/**
 * Hand the real terminal over to `fn` (e.g. `nfg add`'s `$EDITOR`/clack
 * prompts/git subprocess) for the duration of the call, then hand it back
 * to Ink -- this is what lets the dashboard's `a` key launch the exact same
 * `commands/add.ts#runAdd` the CLI uses, without freezing or corrupting the
 * terminal.
 *
 * Confirmed via context7 against the installed ink@7.1.0: `useApp()` exposes
 * a documented `suspendTerminal(callback)` ("Terminal Suspension" in Ink's
 * own docs) that turns off raw mode and pauses Ink's render loop around
 * `callback`, then forces a full redraw + restores input on return -- this
 * is the officially supported way to hand stdio to a child process from
 * inside an Ink app, not a workaround.
 *
 * What `suspendTerminal` does NOT do here: toggle the alternate-screen
 * buffer. That's because this dashboard enters the alt screen via
 * `fullscreen-ink`'s own raw ANSI write at launch (`\x1b[?1049h` in
 * `withFullScreen`), not via Ink's native `alternateScreen` render option --
 * so Ink's internal alternate-screen flag is false, and its suspend/resume
 * logic has nothing to toggle. We bracket the alt screen ourselves to
 * compensate: exit it immediately before `fn` runs (so the editor and any
 * git/clack output the CLI's own `runAdd` produces land on the user's
 * normal scrollback, not hidden inside the dashboard's alternate buffer)
 * and re-enter it immediately after, so Ink's forced full redraw on resume
 * draws into the same alternate-screen buffer fullscreen-ink set up at
 * startup rather than painting over the user's normal terminal content.
 */
export async function runSuspended<T>(suspendTerminal: SuspendTerminal, fn: () => Promise<T>): Promise<T> {
  let result!: T;
  await suspendTerminal(async () => {
    process.stdout.write(EXIT_ALT_SCREEN);
    try {
      result = await fn();
    } finally {
      process.stdout.write(ENTER_ALT_SCREEN);
    }
  });
  return result;
}
