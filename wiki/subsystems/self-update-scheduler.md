# Subsystem — self-update & launchd scheduler

## Intent

Keep both the CLI and the enabled assets current, automatically, without ever clobbering a local edit —
and run it on a schedule even when `nfg` isn't invoked.

## How the pieces fit

- `src/core/selfupdate.ts`
  - `checkForUpdates()` — throttled by `config.updateCadence` vs `lastCheck`; compares local HEAD to
    `origin/HEAD`; **never throws** (no clone / no remote / offline all degrade to "no update"). Persists
    an `updateAvailable` marker.
  - `refreshStalenessMarker()` — the on-invoke hook (called from `cli.ts`): fires a **fully detached**
    `git fetch` (`{detached:true, cleanup:false, stdio:'ignore'}` + `.unref()`) so it never blocks a
    command; a no-op when there's no remote.
  - `runUpdate({self,assets,force})` — `gh auth` sanity → `git pull --ff-only` → `npm ci` if the
    lockfile changed / `npm run build` if `src/**` changed → **re-exec** under `NFG_REEXECED=1` (loop
    guard) if the CLI rebuilt → asset re-sync. Guarded by a stale-tolerant lock (`update.lock`, 30-min
    window) so a launchd run and a manual run can't collide.
  - Asset re-sync matrix: already-current → skip; unmodified → reinstall + rehash + bump `sourceSha`;
    locally modified → skip + report, unless `force` → back up to `~/.config/nfg/backups/<ts>/` then
    overwrite.
- `src/core/scheduler.ts` — generates `~/Library/LaunchAgents/com.nfg.update.plist` running
  `nfg update --self --assets --quiet` daily (`StartCalendarInterval` 09:00; logs to
  `~/.config/nfg/update.log`). `installAgent`/`uninstallAgent`/`agentStatus` via
  `launchctl bootstrap`/`bootout` (with `load`/`unload` fallback). **`NFG_LAUNCH_AGENTS_DIR` and the
  label are env-overridable** so tests never touch real launchd.
- `src/commands/{update,schedule}.ts` — the CLI surface.

## Shaped by

- "Self-updates on a schedule" → launchd job + on-invoke staleness check.
- "Never lose local edits" → checksum-gated re-sync with backups.
- Testability/safety → every `launchctl`/`git` call goes through overridable wrappers.

## Current state (verified 2026-07-28)

Working and tested (mocked `launchctl`/`git` + a real temp-repo integration test). `update --check`
degrades gracefully with no remote; a sandboxed `schedule install → status → uninstall` cycle produces
the correct plist and removes it, with the **real launchd session confirmed untouched**. The private
remote `randelsr/nfg` now exists, so `nfg update --check` runs a real comparison (currently up to date);
the daily launchd schedule (`com.nfg.update`) is installed and loaded on the primary machine.

## Open threads

- `update --check` runs a real remote comparison now that `randelsr/nfg` exists; a full `nfg update`
  pull + asset re-sync against the live remote hasn't been needed yet (local `main` == `origin/main`).
- launchd-only (macOS); no Linux/systemd equivalent ([ideas.md](../ideas.md)).

## Links

- [decisions/0003-node-git-esbuild-runtime.md](../decisions/0003-node-git-esbuild-runtime.md),
  [decisions/0002-single-monorepo-catalog.md](../decisions/0002-single-monorepo-catalog.md).
