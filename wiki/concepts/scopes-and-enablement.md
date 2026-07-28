# Concept — scopes, enablement, and the ledger

## Scopes

- **global** — `~/.claude/…`. The default; the cross-device baseline that follows you everywhere.
- **project** — `<project>/.claude/…`. Targeted with `-p/--project`; the project root is the nearest
  ancestor of cwd containing `.git`, `.claude`, or `package.json`. `--project` with no project errors.

Asset paths per scope (`src/core/installer.ts#targetPathFor`): skills install as a **directory**
(`skills/<name>/` incl. supporting files); agents/commands as a single `.md`
(`agents/<name>.md`, `commands/<name>.md`).

### Asset formats (Claude Code ground truth)

This is the format nfg's `src/templates/` scaffold and `src/core/frontmatter.ts` validation target.
nfg only enforces the **required** frontmatter per type; the optional fields are Claude Code's.

- **Skill** — directory `skills/<name>/SKILL.md` (+ optional `scripts/`, `references/`).
  Frontmatter: `name`, `description` (required); optional `allowed-tools`, `model`,
  `disable-model-invocation`, …
- **Agent** — single `agents/<name>.md`. Frontmatter: `name`, `description` (required);
  optional `tools`, `model`, …
- **Command** — single `commands/<name>.md`. Frontmatter: `description` (required). **Legacy form:**
  Claude Code has folded commands into skills, but the loose `commands/*.md` file still works, so nfg
  keeps `command` as a first-class type rather than dropping it.

## Enablement = presence-of-file

Claude Code activates an asset because its file exists in a `.claude` directory — there is no
per-asset "disabled" flag. So `nfg enable` copies the file in and `nfg disable` removes it. This is the
mechanic the whole loose-file model rests on
([decisions/0001-loose-file-over-native-plugins.md](../decisions/0001-loose-file-over-native-plugins.md)).

## The ledger

Because the filesystem can't tell an nfg-installed file from a hand-placed one, nfg keeps an **install
ledger** at `~/.config/nfg/state.json` (schema `version: 1`). Each entry records `type`, `name`,
`scope`, `projectPath`, `targetPath`, `sourceSha` (the catalog commit it came from), a `checksum`, and
`installedAt`. Key format: `global:type/name` or `project:<projectRoot>:type/name`.

The `checksum` is the safety mechanism: `isLocallyModified` rehashes the installed copy and compares.
- unchanged → `update` may refresh it from the catalog freely
- changed → `update` **skips + reports** (or, under `--force`, backs it up first)
- present-but-not-in-ledger → **untracked**: `disable` requires `--yes` before deleting

## nfg's config (`~/.config/nfg/config.json`)

The ledger's sibling — nfg's own settings, created with defaults on first run (`src/core/config.ts`).
Neither file is git-tracked; both live under `~/.config/nfg/` (overridable via `$XDG_CONFIG_HOME`).

- `repo` — `<owner>/<repo>` slug of the monorepo (placeholder `OWNER/nfg` until a real remote exists)
- `clonePath` — where the CLI repo lives / runs from (defaults to the resolved repo root)
- `updateCadence` — `daily` | `weekly` | `manual` (drives the launchd schedule + the on-invoke throttle)
- `editor` — editor for `nfg add` (defaults to `$EDITOR`, else `vi`)
- `lastCheck` — ISO timestamp of the last staleness check, or `null` (the throttle anchor)
- `catalogRef` — catalog git sha last synced, or `null`
- `updateAvailable` — persisted boolean the dashboard badge / CLI hint read

## Shadowing / precedence

When the same name is installed at both scopes, `src/core/service.ts` emits a note about which one
Claude Code actually loads (skills favor global, agents favor project). `doctor` surfaces conflicts.
