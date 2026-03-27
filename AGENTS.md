# pi-skills-manager

Interactive skill manager for Pi. Provides a `/skills` command.

## Architecture

**Archetype:** Operator control-surface extension (command + TUI).

Single extension file at `extensions/index.ts`. No build step -- jiti loads TypeScript directly.

### How toggle works

Uses the same mechanism as `pi config`:

1. `DefaultPackageManager.resolve()` discovers all skills with `enabled: boolean` state
2. Enabled state is determined by `+`/`-` patterns in `settings.json` evaluated via `isEnabledByOverrides()`
3. On toggle, writes `+pattern` or `-pattern` to the appropriate settings array:
   - Top-level skills: `settings.skills` via `SettingsManager.setSkillPaths()` / `setProjectSkillPaths()`
   - Package skills: `packages[].skills` via `SettingsManager.setPackages()` / `setProjectPackages()`
4. On `/reload`, `resource-loader` re-evaluates patterns and rebuilds the system prompt with only enabled skills

No file renaming, no `appendEntry`, no session state. `settings.json` is the single source of truth.

### Mode awareness

- Interactive mode: full TUI with grouped entries, checkboxes, search/filter, scroll
- Non-interactive (print/RPC/JSON) and `/skills list`: plain text listing with `[x]`/`[ ]` status

### Reload behavior

After changes, prompts the user to reload. Uses `ctx.reload(); return;` (treat reload as terminal).

No lifecycle events needed -- state lives in settings.json, not in memory or session entries.

## Patterns and conventions

### Reuse Pi's public API

Use exported utilities instead of reimplementing them. Concrete examples in this codebase:

- `getAgentDir()` from `@mariozechner/pi-coding-agent` -- returns `~/.pi/agent`
- `SettingsManager.create(cwd, agentDir)` for reading/writing settings
- `DefaultPackageManager` for resolving resources with enabled/disabled state
- `DynamicBorder`, `rawKeyHint()` from `@mariozechner/pi-coding-agent` for TUI chrome
- `Container`, `Spacer`, `Input`, `matchesKey()`, `getKeybindings()`, `truncateToWidth()`, `visibleWidth()` from `@mariozechner/pi-tui`

**Always check the installed Pi version before adding imports:**

```bash
bun -e "import { VERSION } from '@mariozechner/pi-coding-agent'; console.log(VERSION)"
```

### Known duplication (not exported by Pi)

The toggle logic (`toggleTopLevel`, `togglePackage`, pattern resolution, `stripPrefix`) and the grouping logic (`buildGroups`, `getGroupLabel`) are internal to Pi's `ResourceList` / `ConfigSelectorComponent`. They are NOT part of the public API and must be reimplemented. Accept ~120 lines of duplication here.

### Checkbox-list pattern inside `ctx.ui.custom()`

The TUI uses a manually-composed checkbox list (not `SettingsList`), matching the same pattern as Pi's built-in `pi config`. Key components:

- `Input` for type-ahead search
- `Container` + `Spacer` + `DynamicBorder` for layout
- `rawKeyHint()` for the header hint bar
- Manual render loop with `filteredItems`, `selectedIndex`, scroll windowing

### Keybinding layering

Inside `handleInput`, intercept keys in this order:

1. Navigation (up/down/pageUp/pageDown via `getKeybindings()`)
2. Cancel (Escape via `tui.select.cancel`, Ctrl+C via `matchesKey`)
3. Mode keys (Tab for view cycling via `matchesKey`)
4. Toggle (Space or Enter)
5. Fall through to `searchInput.handleInput(data)`

`Input` does not consume Tab or other control characters, so intercepting them before the fall-through is safe.

### Scoped search

Search defaults to matching `displayName` only (the skill name). Prefix tokens widen the scope:

- `/query` matches against the full filesystem path
- `@query` matches against the package source name

This avoids the over-broad matching that occurs when path components are included in the default search.

### View modes

Tab cycles through three view modes. The current mode is shown in the footer:

- **By source** -- grouped by origin/scope/source (default, matches `pi config` layout)
- **A-Z** -- flat alphabetical, no group headers
- **Active first** -- flat, enabled items float to top

View mode is runtime-only state -- resets when the panel closes. No persistence needed.

When toggling a skill in "Active first" mode, the list rebuilds immediately so the item moves to its correct position.

### Flat-list rebuilding

The `groups` array is the canonical data source. Each view mode has a dedicated builder function that produces a `FlatEntry[]` from the groups. The search filter operates on the flat list, not on the groups directly. Changing view mode or toggling a skill calls `rebuildForMode()`, which rebuilds the flat list and re-applies the current search query.

### Non-interactive fallback

`/skills list` and `!ctx.hasUI` both produce plain text output with `[x]`/`[ ]` markers. No TUI dependency in that path.

## Dev workflow

- Install: `bun install`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Format: `bun run lint:fix`
- Conventional commits enforced via commitlint + lefthook

## Coding guidelines

- Tabs, double quotes, semicolons (biome)
- Strict TS: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- No `any`, no non-null assertions, no unsafe type assertions
- `node:` protocol for Node.js imports
- Peer dependencies only for Pi core packages

## Release

- semantic-release on `main` with npm trusted publishing (OIDC, no npm token)
- `@semantic-release/git` commits version bumps back to git
- Commit prefixes: `fix:` (patch), `feat:` (minor), `feat!:` (major, public API breaks only)
- `chore:`, `docs:`, `refactor:` produce no version bump
