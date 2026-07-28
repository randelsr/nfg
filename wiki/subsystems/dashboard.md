# Subsystem — dashboard (bare `nfg`)

## Intent

Give bare `nfg` a beautiful, full-screen management surface: browse every catalog asset with live
enabled/disabled state and toggle it in place.

## How the pieces fit

- `src/tui/App.tsx` — Ink root, mounted through **`fullscreen-ink`**'s `withFullScreen` (alternate
  screen buffer, restored on exit). Thin presentation layer over `src/core/service.ts`.
- `src/tui/{Tabs,AssetList,Filter,StatusBar}.tsx` + `theme.ts` — components + palette/glyphs.
  `AssetList` scrolls by reading terminal height (`useStdout`) and rendering a `.slice()` window.
- Mode-gated `useInput` handlers (nav / filter-edit / confirm / help), each with `{ isActive }` so
  keystrokes route to the right mode.
- `src/tui/suspend.ts` — `runSuspended` hands the terminal to `$EDITOR`/git via Ink 7's
  `useApp().suspendTerminal`, bracketed with manual alt-screen enter/exit (since `fullscreen-ink`, not
  Ink, owns the alt screen). This is how the `a` key runs the exact same `commands/add.ts#runAdd`.

## Keymap

`↑/↓` move · space toggle · `tab`/`←→` switch type · `p` scope · `/` filter · `r` refresh ·
`u` update · `a` add · `?` help · `q`/`Ctrl-C` quit. The `?` overlay mirrors this exactly.

## Shaped by

- "Beautiful UX for managing the app" → full-screen dashboard over a stepwise wizard.
- Ink's default `render` not using the alt screen → `fullscreen-ink`.
- Reusing install logic → toggles call `service.ts`; the toggle decides enable-vs-disable from **disk
  state** (`fs.existsSync(targetPathFor(...))`), not the ledger flag — so a hand-placed untracked file
  routes through the delete-confirm instead of a silent overwrite (bug caught + fixed in Phase 3).

## Current state (verified 2026-07-28)

Working. Independently rendered via `ink-testing-library`: initial paint, live space-toggle (writes
through the service layer), filter, tabs, and help overlay all confirmed. Non-TTY invocation falls back
to `list` (respecting `--json`) instead of launching the TUI. `u` runs `runUpdate` + shows the
update-available badge; `a` runs the add flow.

## Open threads

- Interactive behavior is only exercised via `ink-testing-library` frames (no attachable real TTY in CI).

## Links

- [subsystems/install-engine.md](install-engine.md), [subsystems/catalog-and-add.md](catalog-and-add.md).
