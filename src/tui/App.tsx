import fs from 'node:fs';
import path from 'node:path';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { useScreenSize, withFullScreen } from 'fullscreen-ink';
import type { AssetType } from '../core/frontmatter.js';
import { targetPathFor } from '../core/installer.js';
import { findProjectRoot, globalClaudeDir, homeDir } from '../core/paths.js';
import { resolveScope, type ScopeKind } from '../core/scope.js';
import { buildListing, disableAsset, enableAsset, type DisableOutcome, type EnableOutcome, type ListRow } from '../core/service.js';
import { loadConfig } from '../core/config.js';
import { runUpdate, type RunUpdateResult } from '../core/selfupdate.js';
import { ASSET_NAME_PATTERN, runAdd } from '../commands/add.js';
import { ASSET_TYPES, assetTypeLabel, colors, glyphs, layout } from './theme.js';
import { AssetList, rowKey, useSpinnerFrame } from './AssetList.js';
import { Tabs } from './Tabs.js';
import { Filter } from './Filter.js';
import { StatusBar, type Toast } from './StatusBar.js';
import { runSuspended } from './suspend.js';

/**
 * Bare `nfg`'s full-screen dashboard. Keymap (kept in sync with
 * `HelpOverlay` below and the README):
 *
 *   up/down       move selection
 *   space         toggle enable/disable of the selected asset (active scope)
 *   tab / <- ->   switch asset type (skills/agents/commands)
 *   p             toggle scope (global <-> detected project)
 *   /             enter filter mode; Enter/Esc stops editing, Esc again clears
 *   r             refresh listing from disk
 *   u             run `nfg update` (self + assets) with a spinner, then refresh
 *   a             add a new asset -- prompts for a name, then suspends the
 *                 dashboard to run the real `nfg add` flow ($EDITOR, commit,
 *                 push, offer-to-enable) on the actual terminal
 *   ?             toggle this help overlay
 *   q / Ctrl-C    quit (alternate screen buffer restores the terminal)
 *
 * State is a thin presentation layer over `src/core/service.ts`'s
 * `buildListing`/`enableAsset`/`disableAsset` -- no install/ledger logic
 * lives here (see phase_2_completed.md's "service-function boundary").
 */

interface ConfirmState {
  type: AssetType;
  name: string;
  scope: ScopeKind;
}

function tildify(absolutePath: string): string {
  const home = homeDir();
  return absolutePath.startsWith(home) ? `~${absolutePath.slice(home.length)}` : absolutePath;
}

function scopeLabel(scopeKind: ScopeKind, projectRoot: string | null): string {
  if (scopeKind === 'global') return `${tildify(globalClaudeDir())} (global)`;
  if (!projectRoot) return 'no project detected';
  return `${tildify(path.join(projectRoot, '.claude'))} (project)`;
}

function matchesQuery(row: ListRow, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return row.name.toLowerCase().includes(q) || (row.description ?? '').toLowerCase().includes(q);
}

function enableToast(outcome: EnableOutcome, scopeKind: ScopeKind): Toast {
  const label = `${outcome.asset.type} "${outcome.asset.name}"`;
  let text: string;
  if (outcome.status === 'installed') text = `Enabled ${label} (${scopeKind}).`;
  else if (outcome.status === 'up-to-date') text = `${label} already enabled and up to date.`;
  else text = `Refreshed ${label} -- catalog had newer content.`;
  if (outcome.shadowNote) text += ` ${outcome.shadowNote}`;
  return { text, tone: 'success' };
}

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : '(unknown)';
}

/** Human summary for the `u` key's `runUpdate` result -- mirrors
 * `commands/update.ts#printUpdateHuman` but condensed to one toast line. */
function updateResultToast(result: RunUpdateResult): Toast {
  if (result.reexeced) {
    return { text: 'nfg rebuilt itself -- press u again to finish under the new build.', tone: 'info' };
  }

  const parts: string[] = [];
  parts.push(result.cliUpdated ? `nfg updated to ${shortSha(result.to)}.` : 'nfg CLI already up to date.');
  if (result.assetsUpdated.length > 0) {
    const forced = result.assetsUpdated.filter((e) => e.backupPath !== null).length;
    parts.push(`${result.assetsUpdated.length} asset(s) refreshed${forced ? ` (${forced} forced, backed up)` : ''}.`);
  }
  if (result.assetsSkipped.length > 0) {
    parts.push(`${result.assetsSkipped.length} skipped (locally modified).`);
  }
  if (result.assetsUpdated.length === 0 && result.assetsSkipped.length === 0) {
    parts.push('Assets already up to date.');
  }
  if (result.messages.length > 0) parts.push(result.messages[0]!);

  return { text: parts.join(' '), tone: result.assetsSkipped.length > 0 ? 'info' : 'success' };
}

function disableToast(outcome: DisableOutcome): Toast {
  const label = `${outcome.type} "${outcome.name}"`;
  switch (outcome.status) {
    case 'removed':
      return { text: `Disabled ${label}.`, tone: 'success' };
    case 'already-removed':
      return { text: `${label} was already gone -- cleared the stale entry.`, tone: 'info' };
    case 'not-installed':
      return { text: `${label} is not installed -- nothing to do.`, tone: 'info' };
    case 'untracked-removed':
      return { text: `Removed untracked ${label} -- nfg did not install it.`, tone: 'success' };
    case 'untracked-blocked':
      return { text: `${label} isn't tracked by nfg.`, tone: 'error' };
  }
}

/** Singular label for the add-name prompt ("skill", not "Skills"). */
function assetTypeSingular(type: AssetType): string {
  return assetTypeLabel(type).toLowerCase().replace(/s$/, '');
}

/** Renders in the same chrome slot as `Filter` while `a`'s name prompt is
 * active, so the dashboard's fixed line-count layout never shifts. */
function AddPromptLine({ type, value }: { type: AssetType; value: string }) {
  return (
    <Text>
      <Text color={colors.accent}>Add {assetTypeSingular(type)}: </Text>
      <Text>{value}</Text>
      <Text color={colors.accent}>▏</Text>
      <Text color={colors.muted}> (Enter to scaffold, Esc to cancel)</Text>
    </Text>
  );
}

function HelpOverlay() {
  const rows: Array<[string, string]> = [
    ['up/down', 'Move selection'],
    ['space', 'Toggle enable/disable in the active scope'],
    ['tab, <- / ->', 'Switch asset type (skills/agents/commands)'],
    ['p', 'Toggle scope: global <-> detected project'],
    ['/', 'Filter (Enter/Esc stop editing, Esc again clears)'],
    ['r', 'Refresh the listing from disk'],
    ['u', 'Run nfg update (self + assets) -- shows a spinner, then refreshes'],
    ['a', 'Add a new asset: prompts for a name, then runs $EDITOR/commit/push'],
    ['?', 'Toggle this help overlay'],
    ['q, Ctrl-C', 'Quit'],
  ];
  const keyWidth = Math.max(...rows.map(([key]) => key.length));

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={colors.accent} padding={1}>
      <Text bold color={colors.brand}>
        nfg -- keyboard shortcuts
      </Text>
      <Box marginTop={1} flexDirection="column">
        {rows.map(([key, description]) => (
          <Text key={key}>
            <Text color={colors.accent}>{key.padEnd(keyWidth)}</Text>
            <Text color={colors.muted}>  {description}</Text>
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={colors.muted}>Press ? or Esc to close.</Text>
      </Box>
    </Box>
  );
}

export function App() {
  const { exit, suspendTerminal } = useApp();
  const { height: rawHeight, width: rawWidth } = useScreenSize();
  const termHeight = rawHeight ?? 24;
  const termWidth = rawWidth ?? 80;
  const tooSmall = termWidth < layout.minWidth || termHeight < layout.minHeight;
  const listHeight = Math.max(1, termHeight - layout.chromeLines);

  const [cwd] = useState(() => process.cwd());
  const projectRoot = useMemo(() => findProjectRoot(cwd), [cwd]);
  const canUseProject = projectRoot !== null;
  const scopeKinds = useMemo<ScopeKind[]>(() => (canUseProject ? ['global', 'project'] : ['global']), [canUseProject]);

  const [allRows, setAllRows] = useState<ListRow[]>(() => buildListing({ scopes: scopeKinds, cwd }));
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(() => loadConfig().updateAvailable);
  const reload = useCallback(() => {
    setAllRows(buildListing({ scopes: scopeKinds, cwd }));
    // Also re-read the persisted "update available" marker -- it may have
    // been written by the on-invoke background staleness check
    // (selfupdate.ts#refreshStalenessMarker) since the dashboard opened.
    setUpdateAvailable(loadConfig().updateAvailable);
  }, [scopeKinds, cwd]);

  const [activeScope, setActiveScope] = useState<ScopeKind>('global');
  const [activeTypeIndex, setActiveTypeIndex] = useState(0);
  const activeType = ASSET_TYPES[activeTypeIndex]!;

  const [filterQuery, setFilterQuery] = useState('');
  const [filterEditing, setFilterEditing] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [helpVisible, setHelpVisible] = useState(false);
  const [updating, setUpdating] = useState(false);
  const updateSpinnerFrame = useSpinnerFrame(updating);
  const [addPrompt, setAddPrompt] = useState<{ type: AssetType } | null>(null);
  const [addNameInput, setAddNameInput] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const scopedRows = useMemo(
    () => allRows.filter((r) => r.scope === activeScope && r.type === activeType),
    [allRows, activeScope, activeType],
  );
  const filteredRows = useMemo(() => {
    return [...scopedRows.filter((r) => matchesQuery(r, filterQuery))].sort((a, b) => a.name.localeCompare(b.name));
  }, [scopedRows, filterQuery]);
  const safeSelectedIndex = filteredRows.length === 0 ? 0 : Math.min(selectedIndex, filteredRows.length - 1);

  const emptyMessage = useMemo(() => {
    const typeLabel = assetTypeLabel(activeType).toLowerCase();
    if (scopedRows.length === 0) {
      return `No ${typeLabel} in the catalog for ${activeScope} scope yet.`;
    }
    if (filterQuery) {
      return `No ${typeLabel} match "${filterQuery}". Press Esc to clear the filter.`;
    }
    return `No ${typeLabel} found.`;
  }, [scopedRows.length, filterQuery, activeType, activeScope]);

  const toggleScope = useCallback(() => {
    if (activeScope === 'global') {
      if (!canUseProject) {
        setToast({ text: 'No project detected in the current directory -- staying on global scope.', tone: 'info' });
        return;
      }
      setActiveScope('project');
    } else {
      setActiveScope('global');
    }
    setSelectedIndex(0);
  }, [activeScope, canUseProject]);

  const nextType = useCallback(() => {
    setActiveTypeIndex((i) => (i + 1) % ASSET_TYPES.length);
    setSelectedIndex(0);
  }, []);
  const prevType = useCallback(() => {
    setActiveTypeIndex((i) => (i - 1 + ASSET_TYPES.length) % ASSET_TYPES.length);
    setSelectedIndex(0);
  }, []);

  const toggleSelected = useCallback(async () => {
    const row = filteredRows[safeSelectedIndex];
    if (!row || busyKey) return;
    const key = rowKey(row);
    setBusyKey(key);
    try {
      const scope = resolveScope({ project: row.scope === 'project' }, cwd);
      // Decide enable vs. disable from what's actually on disk, not just
      // `row.installed` (which only reflects the *ledger*): a hand-placed
      // file nfg never installed still occupies the target path, and
      // toggling it must go through disableAsset's untracked guard (inline
      // confirm below) rather than enableAsset silently overwriting it.
      const occupied = fs.existsSync(targetPathFor(row.type, row.name, scope.claudeDir));
      if (occupied) {
        const outcome = disableAsset(row.type, row.name, scope, { yes: false });
        if (outcome.status === 'untracked-blocked') {
          setBusyKey(null);
          setConfirm({ type: row.type, name: row.name, scope: row.scope });
          return;
        }
        reload();
        setToast(disableToast(outcome));
      } else {
        const outcome = await enableAsset(row.type, row.name, scope, { cwd });
        reload();
        setToast(enableToast(outcome, row.scope));
      }
    } catch (err) {
      setToast({ text: (err as Error).message, tone: 'error' });
    } finally {
      setBusyKey(null);
    }
  }, [filteredRows, safeSelectedIndex, busyKey, cwd, reload]);

  const runDashboardUpdate = useCallback(async () => {
    if (updating) return;
    setUpdating(true);
    setToast({ text: 'Updating nfg + assets…', tone: 'info' });
    try {
      const result = await runUpdate({ self: true, assets: true, force: false });
      reload();
      setToast(updateResultToast(result));
    } catch (err) {
      setToast({ text: (err as Error).message, tone: 'error' });
    } finally {
      setUpdating(false);
    }
  }, [updating, reload]);

  /** Runs the exact same `commands/add.ts#runAdd` the CLI's `nfg add` uses,
   * with the real terminal handed over via `runSuspended` (see
   * tui/suspend.ts) for the duration -- $EDITOR, the description/enable
   * clack prompts, and the git commit/push all behave identically to a
   * plain `nfg add <type> <name>` invocation. Only `type`/`name` are
   * gathered up front, via the dashboard's own lightweight text-entry mode
   * (below) rather than another clack prompt, since collecting them doesn't
   * need real stdio -- no reason to suspend the terminal before there's
   * actually something that needs it. */
  const runAddFlow = useCallback(
    async (type: AssetType, name: string) => {
      setAdding(true);
      try {
        await runSuspended(suspendTerminal, () =>
          runAdd(type, name, { project: activeScope === 'project', global: activeScope === 'global' }),
        );
        setToast({ text: `Finished adding ${type} "${name}".`, tone: 'success' });
      } catch (err) {
        setToast({ text: (err as Error).message, tone: 'error' });
      } finally {
        setAdding(false);
        reload();
      }
    },
    [activeScope, reload, suspendTerminal],
  );

  const confirmDelete = useCallback(() => {
    if (!confirm) return;
    try {
      const scope = resolveScope({ project: confirm.scope === 'project' }, cwd);
      const outcome = disableAsset(confirm.type, confirm.name, scope, { yes: true });
      reload();
      setToast(disableToast(outcome));
    } catch (err) {
      setToast({ text: (err as Error).message, tone: 'error' });
    } finally {
      setConfirm(null);
    }
  }, [confirm, cwd, reload]);

  const navActive = !filterEditing && !confirm && !helpVisible && !addPrompt;

  useInput(
    (input, key) => {
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(Math.max(0, filteredRows.length - 1), i + 1));
        return;
      }
      if (key.tab || key.rightArrow) {
        nextType();
        return;
      }
      if (key.leftArrow) {
        prevType();
        return;
      }
      if (input === ' ') {
        if (updating || adding) return;
        void toggleSelected();
        return;
      }
      if (input === 'p') {
        toggleScope();
        return;
      }
      if (input === '/') {
        setFilterEditing(true);
        return;
      }
      if (key.escape && filterQuery) {
        setFilterQuery('');
        setSelectedIndex(0);
        return;
      }
      if (input === 'r') {
        reload();
        setToast({ text: 'Refreshed from disk.', tone: 'info' });
        return;
      }
      if (input === 'u') {
        if (updating || busyKey || adding) {
          setToast({ text: 'An update is already running…', tone: 'info' });
          return;
        }
        void runDashboardUpdate();
        return;
      }
      if (input === 'a') {
        if (updating || busyKey || adding) {
          setToast({ text: 'Busy -- try again in a moment.', tone: 'info' });
          return;
        }
        setAddPrompt({ type: activeType });
        setAddNameInput('');
        return;
      }
      if (input === '?') {
        setHelpVisible(true);
        return;
      }
      if (input === 'q' || (key.ctrl && input === 'c')) {
        exit();
      }
    },
    { isActive: navActive },
  );

  useInput(
    (input, key) => {
      if (key.return || key.escape) {
        setFilterEditing(false);
        return;
      }
      if (key.backspace || key.delete) {
        setFilterQuery((q) => q.slice(0, -1));
        setSelectedIndex(0);
        return;
      }
      if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;
      if (input) {
        setFilterQuery((q) => q + input);
        setSelectedIndex(0);
      }
    },
    { isActive: filterEditing },
  );

  useInput(
    (input, key) => {
      if (!addPrompt) return; // unreachable given isActive, but keeps TS narrowed below
      if (key.return) {
        const name = addNameInput.trim();
        if (!ASSET_NAME_PATTERN.test(name)) {
          setToast({ text: 'Invalid name -- use kebab-case (lowercase letters, digits, hyphens).', tone: 'error' });
          return;
        }
        const { type } = addPrompt;
        setAddPrompt(null);
        void runAddFlow(type, name);
        return;
      }
      if (key.escape) {
        setAddPrompt(null);
        setAddNameInput('');
        return;
      }
      if (key.backspace || key.delete) {
        setAddNameInput((q) => q.slice(0, -1));
        return;
      }
      if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;
      if (input) setAddNameInput((q) => q + input);
    },
    { isActive: addPrompt !== null },
  );

  useInput(
    (input, key) => {
      if (input === 'y' || key.return) {
        confirmDelete();
        return;
      }
      if (input === 'n' || key.escape) {
        setConfirm(null);
      }
    },
    { isActive: confirm !== null },
  );

  useInput(
    (input, key) => {
      if (input === '?' || key.escape || input === 'q') {
        setHelpVisible(false);
      }
    },
    { isActive: helpVisible },
  );

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      {tooSmall ? (
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <Text color={colors.warn}>
            Terminal too small ({termWidth}x{termHeight}). Resize to at least {layout.minWidth}x{layout.minHeight}, or
            press q to quit.
          </Text>
        </Box>
      ) : helpVisible ? (
        <HelpOverlay />
      ) : (
        <>
          <Box justifyContent="space-between">
            <Text>
              <Text bold color={colors.brand}>
                nfg
              </Text>
              <Text color={colors.muted}> · {scopeLabel(activeScope, projectRoot)}</Text>
            </Text>
            {updating ? (
              <Text color={colors.accent}>{updateSpinnerFrame} updating…</Text>
            ) : adding ? (
              <Text color={colors.accent}>handing off to the terminal…</Text>
            ) : (
              updateAvailable && (
                <Text color={colors.warn}>
                  {glyphs.updateAvailable} update available -- press u
                </Text>
              )
            )}
          </Box>
          <Tabs activeIndex={activeTypeIndex} />
          {addPrompt ? (
            <AddPromptLine type={addPrompt.type} value={addNameInput} />
          ) : (
            <Filter query={filterQuery} editing={filterEditing} />
          )}
          <AssetList
            rows={filteredRows}
            selectedIndex={safeSelectedIndex}
            height={listHeight}
            emptyMessage={emptyMessage}
            busyKey={busyKey}
          />
          <StatusBar
            canUseProject={canUseProject}
            toast={toast}
            confirmText={
              confirm ? `Delete untracked ${confirm.type} "${confirm.name}"? nfg did not install it. (y/n)` : null
            }
          />
        </>
      )}
    </Box>
  );
}

/** Mounts `<App/>` through fullscreen-ink's alternate-screen wrapper, waits
 * for `useApp().exit()` to be called, then resolves once the terminal has
 * been restored (fullscreen-ink's `waitUntilExit` awaits that cleanup). */
export async function runDashboard(): Promise<void> {
  const screen = withFullScreen(<App />);
  await screen.start();
  await screen.waitUntilExit();
}
