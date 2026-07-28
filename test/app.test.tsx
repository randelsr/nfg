import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../src/tui/App.js';
import * as selfupdate from '../src/core/selfupdate.js';
import type { RunUpdateResult } from '../src/core/selfupdate.js';
import * as addCommand from '../src/commands/add.js';
import { setupSandbox, type Sandbox } from './helpers/fixtures.js';

// The `u` key drives `core/selfupdate.ts#runUpdate` -- its own throttle/
// pull/rebuild/resync logic is unit- and integration-tested in depth by
// test/selfupdate.test.ts and test/selfupdate.integration.test.ts. This
// file's job is only to prove the dashboard's *wiring* (busy state,
// re-entrancy guard, result toast, post-update reload), so `runUpdate` is
// mocked here -- this also means these tests never shell out to a real
// `gh`/`git` subprocess at all.
vi.mock('../src/core/selfupdate.js', async () => {
  const actual = await vi.importActual<typeof import('../src/core/selfupdate.js')>('../src/core/selfupdate.js');
  return { ...actual, runUpdate: vi.fn() };
});

// Same idea for the `a` key's `commands/add.ts#runAdd` -- its own scaffold/
// $EDITOR/validate/commit/push/enable-offer logic is unit-tested in depth by
// test/add.test.ts. This file only proves the dashboard's wiring (the
// name-entry prompt, delegating to runAdd with the right args, the result
// toast, reload). `ASSET_NAME_PATTERN` is kept real (via importActual) since
// App.tsx imports it too, for the same kebab-case validation the CLI uses.
vi.mock('../src/commands/add.js', async () => {
  const actual = await vi.importActual<typeof import('../src/commands/add.js')>('../src/commands/add.js');
  return { ...actual, runAdd: vi.fn() };
});

// `runSuspended` wraps Ink's real `useApp().suspendTerminal()` plus raw
// ANSI alt-screen writes to the real process.stdout (see tui/suspend.ts) --
// neither of those is something a unit test should exercise for real (the
// former needs a genuine TTY-ish handoff, the latter would leak escape
// codes into the test runner's own terminal). Mocked to just invoke its
// callback directly, so `runAdd` still runs (mocked above) without any of
// the terminal-suspension machinery actually firing.
vi.mock('../src/tui/suspend.js', () => ({
  runSuspended: vi.fn((_suspendTerminal: unknown, fn: () => Promise<unknown>) => fn()),
}));

function emptyUpdateResult(overrides: Partial<RunUpdateResult> = {}): RunUpdateResult {
  return {
    cliUpdated: false,
    from: null,
    to: null,
    npmCiRan: false,
    buildRan: false,
    reexeced: false,
    authenticated: true,
    assetsUpdated: [],
    assetsSkipped: [],
    backups: [],
    messages: [],
    ...overrides,
  };
}

/**
 * Component/integration tests for the Ink dashboard, per
 * phase_3_description.md's "Testing a TUI" requirement. `ink-testing-library`
 * renders against fake stdin/stdout streams (no real TTY needed) -- we drive
 * it with raw key sequences via `stdin.write(...)` and assert on
 * `lastFrame()`.
 *
 * Ink's keypress parsing/re-render is not synchronous with `stdin.write()`
 * (it goes through the stream's 'data' event and a React state update), so
 * every keypress here is followed by a `vi.waitFor` on the expected frame
 * content rather than reading `lastFrame()` immediately.
 *
 * Safety: every test runs inside `setupSandbox()` (temp $HOME/$XDG_CONFIG_HOME
 * + a fixture catalog via $NFG_REPO_ROOT), same as every Phase 2 test, so
 * nothing ever touches the real ~/.claude or ~/.config/nfg. Tests that
 * exercise the 'project' scope additionally mock `process.cwd()` to a
 * sandboxed project directory -- App.tsx resolves project scope from
 * `process.cwd()`, and that must never resolve to this repo's own root.
 */

const UP = '\x1B[A';
const DOWN = '\x1B[B';
const LEFT = '\x1B[D';
const RIGHT = '\x1B[C';
const ESC = '\x1B';
const BACKSPACE = '\x7F';

type Stdin = { write: (data: string) => void };

/** Write a key sequence and wait for `condition` to hold against the
 * latest frame -- see the file-level comment on why this can't be a
 * synchronous `stdin.write` + `lastFrame()` read. */
async function press(stdin: Stdin, data: string, lastFrame: () => string | undefined, condition: (frame: string) => boolean): Promise<void> {
  stdin.write(data);
  await vi.waitFor(
    () => {
      if (!condition(lastFrame() ?? '')) throw new Error(`condition not met for frame: ${lastFrame()}`);
    },
    // A little more headroom than vi.waitFor's 1000ms default -- the Phase
    // 4 `u` (runUpdate) tests chain a mocked-promise resolution through an
    // extra React state transition on top of Ink's own async render flush.
    // Costs nothing when the condition is met early (waitFor polls and
    // returns as soon as it passes).
    { timeout: 2000 },
  );
}

describe('tui/App', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = setupSandbox();
    // `runUpdate` is mocked once for the whole file (vi.mock's factory runs
    // once); explicitly reset its call history/implementation before every
    // test rather than relying on afterEach's vi.restoreAllMocks() to have
    // done it -- restoreAllMocks() targets vi.spyOn spies, and empirically
    // does not reliably clear call counts for a bare vi.fn() defined inside
    // a vi.mock() factory, which would otherwise leak call counts from one
    // test's assertions into the next.
    vi.mocked(selfupdate.runUpdate).mockReset();
    vi.mocked(addCommand.runAdd).mockReset();
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  it('renders the initial dashboard: brand, scope, tabs, and the fixture skills', () => {
    const { lastFrame, unmount } = render(<App />);
    const frame = lastFrame();

    expect(frame).toContain('nfg');
    expect(frame).toContain('global');
    expect(frame).toContain('Skills');
    expect(frame).toContain('Agents');
    expect(frame).toContain('Commands');
    // Default tab is "skill" -- the fixture catalog has next-phase + multi-file.
    expect(frame).toContain('next-phase');
    expect(frame).toContain('multi-file');
    // Not-yet-installed rows show the disabled glyph.
    expect(frame).toContain('○');
    unmount();
  });

  it('moves the selection with the down/up arrows', async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    const before = lastFrame();

    await press(stdin, DOWN, lastFrame, (f) => f !== before);
    const afterDown = lastFrame();
    expect(afterDown).toContain('›');
    expect(afterDown).not.toEqual(before);

    await press(stdin, UP, lastFrame, (f) => f === before);
    unmount();
  });

  it('tab switches the active asset type from Skills to Agents', async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    expect(lastFrame()).toContain('next-phase');

    await press(stdin, '\t', lastFrame, (f) => f.includes('code-reviewer'));
    expect(lastFrame()).not.toContain('next-phase');
    unmount();
  });

  it('left/right arrows also cycle asset types', async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, RIGHT, lastFrame, (f) => f.includes('code-reviewer')); // agents
    await press(stdin, RIGHT, lastFrame, (f) => f.includes('changelog')); // commands
    await press(stdin, LEFT, lastFrame, (f) => f.includes('code-reviewer')); // back to agents
    unmount();
  });

  it('space installs the selected (not-yet-installed) skill and the row flips to enabled', async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    expect(lastFrame()).toContain('○'); // rows sort alphabetically -- "multi-file" is selected by default

    await press(stdin, ' ', lastFrame, (f) => f.includes('Enabled skill "multi-file"'));
    expect(lastFrame()).toContain('●');

    const targetPath = path.join(sandbox.home, '.claude', 'skills', 'multi-file', 'SKILL.md');
    expect(fs.existsSync(targetPath)).toBe(true);
    unmount();
  });

  it('space disables an already-installed asset', async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, ' ', lastFrame, (f) => f.includes('Enabled skill "multi-file"'));

    await press(stdin, ' ', lastFrame, (f) => f.includes('Disabled skill "multi-file"'));

    const targetPath = path.join(sandbox.home, '.claude', 'skills', 'multi-file', 'SKILL.md');
    expect(fs.existsSync(targetPath)).toBe(false);
    unmount();
  });

  it('/ enters filter mode and narrows the list to matching names', async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    expect(lastFrame()).toContain('multi-file');

    await press(stdin, '/', lastFrame, (f) => f.includes('Filter:'));
    await press(stdin, 'next', lastFrame, (f) => f.includes('Filter: next'));
    const frame = lastFrame();
    expect(frame).toContain('next-phase');
    expect(frame).not.toContain('multi-file');
    unmount();
  });

  it('filter mode gates navigation keys -- typing does not move the selection or switch tabs', async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, '/', lastFrame, (f) => f.includes('Filter:'));
    await press(stdin, 'p', lastFrame, (f) => f.includes('Filter: p')); // would toggle scope if nav were still active
    expect(lastFrame()).toContain('global'); // scope did not change to project
    unmount();
  });

  it('Escape while editing stops editing but keeps the filter applied; Escape again clears it', async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, '/', lastFrame, (f) => f.includes('Filter:'));
    await press(stdin, 'next', lastFrame, (f) => f.includes('Filter: next'));
    await press(stdin, ESC, lastFrame, (f) => f.includes('"next"'));

    let frame = lastFrame();
    expect(frame).toContain('next-phase');
    expect(frame).not.toContain('multi-file');
    expect(frame).not.toContain('Filter: next'); // no longer in edit mode

    await press(stdin, ESC, lastFrame, (f) => f.includes('multi-file'));
    frame = lastFrame();
    expect(frame).toContain('multi-file'); // filter cleared, full list back
    unmount();
  });

  it('backspace edits the filter query', async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, '/', lastFrame, (f) => f.includes('Filter:'));
    await press(stdin, 'nextx', lastFrame, (f) => f.includes('Filter: nextx'));
    await press(stdin, BACKSPACE, lastFrame, (f) => f.includes('Filter: next') && !f.includes('nextx'));
    unmount();
  });

  it('? opens the help overlay listing the keymap, and closes on Escape', async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, '?', lastFrame, (f) => f.includes('keyboard shortcuts'));
    expect(lastFrame()).toContain('Toggle enable/disable');

    await press(stdin, ESC, lastFrame, (f) => !f.includes('keyboard shortcuts'));
    expect(lastFrame()).toContain('Skills');
    unmount();
  });

  it('p is a no-op with an info toast when no project is detected in cwd', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(sandbox.home);
    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, 'p', lastFrame, (f) => f.includes('No project detected'));
    expect(lastFrame()).toContain('global');
    unmount();
    cwdSpy.mockRestore();
  });

  it('p toggles to project scope when cwd is inside a project, and the list reflects per-scope state', async () => {
    const projectRoot = path.join(sandbox.home, 'work', 'my-project');
    fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);

    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, ' ', lastFrame, (f) => f.includes('Enabled skill "multi-file"')); // enable at global first

    await press(stdin, 'p', lastFrame, (f) => f.includes('project'));
    // Same asset at project scope was never installed -- shows disabled.
    expect(lastFrame()).toContain('○');
    unmount();
    cwdSpy.mockRestore();
  });

  it('r refreshes from disk and shows a toast', async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, 'r', lastFrame, (f) => f.includes('Refreshed from disk'));
    unmount();
  });

  it('a opens a name prompt for the active tab; Enter delegates to runAdd and shows a result toast', async () => {
    let resolveAdd!: () => void;
    vi.mocked(addCommand.runAdd).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAdd = resolve;
      }),
    );

    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, 'a', lastFrame, (f) => f.includes('Add skill:'));

    await press(stdin, 'review-pr', lastFrame, (f) => f.includes('Add skill: review-pr'));
    stdin.write('\r');
    await vi.waitFor(() => {
      if (vi.mocked(addCommand.runAdd).mock.calls.length === 0) throw new Error('runAdd has not been called yet');
    });
    expect(addCommand.runAdd).toHaveBeenCalledWith('skill', 'review-pr', { project: false, global: true });
    // The prompt closes immediately (before runAdd resolves) -- back to the
    // normal Filter line, not left showing the now-stale name input.
    expect(lastFrame()).toContain('Press / to filter');

    resolveAdd();
    await press(stdin, '', lastFrame, (f) => f.includes('Finished adding skill "review-pr"'));
    unmount();
  });

  it('a validates kebab-case before ever calling runAdd, and lets the user correct it', async () => {
    vi.mocked(addCommand.runAdd).mockResolvedValue(undefined);

    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, 'a', lastFrame, (f) => f.includes('Add skill:'));

    await press(stdin, 'Not Valid!', lastFrame, (f) => f.includes('Add skill: Not Valid!'));
    stdin.write('\r');
    await press(stdin, '', lastFrame, (f) => f.includes('Invalid name'));
    expect(addCommand.runAdd).not.toHaveBeenCalled();
    // Still in the prompt -- the invalid text is untouched, so it can be edited.
    expect(lastFrame()).toContain('Add skill: Not Valid!');
    unmount();
  });

  it('a can be cancelled with Escape, leaving runAdd uncalled', async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, 'a', lastFrame, (f) => f.includes('Add skill:'));
    await press(stdin, 'partial', lastFrame, (f) => f.includes('Add skill: partial'));

    await press(stdin, ESC, lastFrame, (f) => f.includes('Press / to filter'));
    expect(addCommand.runAdd).not.toHaveBeenCalled();
    unmount();
  });

  it('a reports a runAdd failure (e.g. a catalog name collision) as an error toast', async () => {
    vi.mocked(addCommand.runAdd).mockRejectedValue(new Error('agent "code-reviewer" already exists in the catalog'));

    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, RIGHT, lastFrame, (f) => f.includes('code-reviewer')); // switch to the Agents tab
    await press(stdin, 'a', lastFrame, (f) => f.includes('Add agent:'));
    await press(stdin, 'code-reviewer', lastFrame, (f) => f.includes('Add agent: code-reviewer'));
    stdin.write('\r');

    await press(stdin, '', lastFrame, (f) => f.includes('already exists in the catalog'));
    expect(addCommand.runAdd).toHaveBeenCalledWith('agent', 'code-reviewer', { project: false, global: true });
    unmount();
  });

  it('u calls runUpdate(self+assets), showing a busy toast then a result toast, and reloads', async () => {
    // A same-tick-resolving mock (mockResolvedValue, or even a single
    // setImmediate deferral) lets the whole busy -> result state
    // transition collapse into a window Ink never gets a chance to flush
    // an intermediate frame for. Holding the promise open until we
    // explicitly resolve it (same pattern as the re-entrancy test below)
    // is what makes the busy toast reliably observable here.
    let resolveUpdate!: (result: RunUpdateResult) => void;
    vi.mocked(selfupdate.runUpdate).mockReturnValue(
      new Promise<RunUpdateResult>((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, 'u', lastFrame, (f) => f.includes('Updating nfg + assets'));

    resolveUpdate(emptyUpdateResult());
    await press(stdin, '', lastFrame, (f) => f.includes('already up to date') && f.includes('Assets already up to date'));

    expect(selfupdate.runUpdate).toHaveBeenCalledWith({ self: true, assets: true, force: false });
    unmount();
  });

  it('u is a no-op while an update is already running (re-entrancy guard)', async () => {
    let resolveUpdate!: (result: RunUpdateResult) => void;
    vi.mocked(selfupdate.runUpdate).mockReturnValue(
      new Promise<RunUpdateResult>((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, 'u', lastFrame, (f) => f.includes('Updating nfg + assets'));
    await press(stdin, 'u', lastFrame, (f) => f.includes('already running'));
    expect(selfupdate.runUpdate).toHaveBeenCalledTimes(1); // the second press never called it again

    // Let the original (mocked) update actually resolve before unmounting
    // -- otherwise its `.finally`/`reload()` continuation would still be
    // pending when afterEach tears the sandbox down.
    resolveUpdate(emptyUpdateResult());
    await press(stdin, '', lastFrame, (f) => f.includes('already up to date'));
    unmount();
  });

  it('q quits the app -- no further re-renders happen once it has unmounted', async () => {
    const { lastFrame, stdin, frames, unmount } = render(<App />);
    await press(stdin, 'q', lastFrame, () => true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const countAfterQuit = frames.length;
    // The component tree (and its useInput listeners) is gone once
    // useApp().exit() unmounts it, so further input produces no new frame.
    stdin.write(DOWN);
    stdin.write(' ');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(frames.length).toBe(countAfterQuit);
    unmount();
  });

  it('space on an untracked (hand-placed) file shows an inline confirm before deleting it', async () => {
    // Hand-place a command file nfg never installed (no ledger entry) at
    // the exact path `enable`/`disable` would target.
    const handPlaced = path.join(sandbox.home, '.claude', 'commands', 'changelog.md');
    fs.mkdirSync(path.dirname(handPlaced), { recursive: true });
    fs.writeFileSync(handPlaced, '---\ndescription: hand placed\n---\nbody\n');

    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, RIGHT, lastFrame, (f) => f.includes('code-reviewer')); // agents
    await press(stdin, RIGHT, lastFrame, (f) => f.includes('changelog')); // commands

    // The untracked guard surfaces as an inline confirm bar (StatusBar's
    // confirmText), not a toast -- disableAsset returns 'untracked-blocked'
    // and App.tsx intercepts it before ever reaching a toast message.
    await press(stdin, ' ', lastFrame, (f) => f.includes('Delete untracked command "changelog"?'));
    expect(fs.existsSync(handPlaced)).toBe(true); // not deleted yet

    await press(stdin, 'y', lastFrame, (f) => f.includes('Removed untracked'));
    expect(fs.existsSync(handPlaced)).toBe(false);
    unmount();
  });

  it('confirm can be cancelled with n, leaving the untracked file in place', async () => {
    const handPlaced = path.join(sandbox.home, '.claude', 'commands', 'changelog.md');
    fs.mkdirSync(path.dirname(handPlaced), { recursive: true });
    fs.writeFileSync(handPlaced, '---\ndescription: hand placed\n---\nbody\n');

    const { lastFrame, stdin, unmount } = render(<App />);
    await press(stdin, RIGHT, lastFrame, (f) => f.includes('code-reviewer'));
    await press(stdin, RIGHT, lastFrame, (f) => f.includes('changelog'));

    await press(stdin, ' ', lastFrame, (f) => f.includes('Delete untracked command "changelog"?'));
    await press(stdin, 'n', lastFrame, (f) => !f.includes('Delete untracked'));
    expect(fs.existsSync(handPlaced)).toBe(true);
    unmount();
  });
});
