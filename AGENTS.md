# pi-skills-manager

Interactive skill manager for Pi. Provides a `/skills` command.

## Architecture

**Archetype:** Operator control-surface extension (command + TUI).

Single extension file at `extensions/index.ts`. No build step — jiti loads TypeScript directly.

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

No lifecycle events needed — state lives in settings.json, not in memory or session entries.

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
