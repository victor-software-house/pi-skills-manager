# pi-skills-manager

Interactive skill manager for [Pi](https://github.com/badlogic/pi). Provides a `/skills` command that lets you enable and disable skills with a `pi config`-style UI.

## Install

```bash
pi install npm:pi-skills-manager
```

## Usage

Run `/skills` inside a Pi session to open the skill selector.

The UI shows all discovered skills grouped by source (packages, user, project) with checkbox toggles. Type to search/filter. Press `space` to toggle, `esc` to close.

After making changes, the extension prompts to reload Pi so the updated skill set takes effect.

## How it works

Uses the same settings-based mechanism as `pi config`:

- Resolves skills via `DefaultPackageManager` with their current enabled state
- On toggle, writes `+`/`-` patterns to `settings.json` via `SettingsManager`
- Handles both auto-discovered (top-level) and package skills
- On reload, `resource-loader` re-evaluates the patterns and rebuilds the system prompt with only enabled skills

No file renaming, no session state. `settings.json` is the single source of truth.

## Keybindings

| Key | Action |
|---|---|
| `up` / `down` | Navigate |
| `pgUp` / `pgDn` | Page navigation |
| `space` / `enter` | Toggle skill |
| type any text | Filter skills |
| `esc` | Close |

## License

MIT
