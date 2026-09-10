# Megadesk

Many AI agents, one window. Megadesk runs each agent as a real terminal
session (a PTY) and tiles them in a resizable split grid, so you can drive
several agents at once without hunting through windows and tabs.

It is **not** tied to any project — each agent has its own command and working
directory, and your layout is saved between launches.

## What an "agent" is

An agent is any command-line program, run in a pseudo-terminal and rendered
with xterm.js. The command is launched through your login shell, so tools on
your `PATH` (like `claude`) just work. Examples:

| Name           | Command  | Args             | Working dir            |
| -------------- | -------- | ---------------- | ---------------------- |
| Backend agent  | `claude` |                  | `~/code/api`           |
| Frontend agent | `claude` | `--model sonnet` | `~/code/web`           |
| Scratch shell  | `zsh`    |                  | `~`                    |

The **Working directory** field has a **Browse…** button that opens a native
folder picker, so you can point an agent at a project without typing the path.

## Layout

- Top bar: `1` / `2` / `3` / `4` pick a pane layout (single, side-by-side,
  1+2, and 2×2). Assigned agents are kept and redistributed.
- Drag the gutters between panes to resize.
- **Each pane holds a row of terminal tabs.** Click a tab to switch; the
  hidden ones keep running and keep their scrollback, and a background tab
  lights up when it needs attention. `Cmd/Ctrl + ]` / `[` cycles the tabs in
  the pane you're typing in, and `Cmd/Ctrl + 1`…`8` jumps straight to that
  tab (`Cmd/Ctrl + 9` is the last one). **Double-click a tab's name to rename it**
  (Enter to save, Esc to cancel) — this renames the underlying agent.
  **Drag a tab** to reorder it within its pane, or onto another pane to
  move it there.
- **`Cmd/Ctrl + Enter`** (or the ⤢ button in the pane header) zooms the
  focused pane to fill the whole grid so you can read a long agent response;
  press it again or hit `Esc` to drop back to the split. The other panes
  keep running while hidden. It's a view toggle — your saved layout is
  untouched.
- The pane's `+` button adds a terminal: **Shell in `<dir>`/** opens your
  login shell in the same working directory as the pane's other terminal
  (so an AI agent and a plain shell for the same project sit side by side),
  or define a new one. (Existing agents are added by dragging them in from
  the sidebar.)
- Closing a tab (`×`) just removes it from the pane; a shell you opened from
  `+` is disposed with it.
- `z` in the pane header opens that pane's working directory in Zed
  (`zed <dir>`, resolved through your login shell).
- Sidebar lists every agent; click one to add it as a tab in the focused
  pane, or **drag it onto any pane** to drop it there. `✎` edits or deletes it.
- **`Cmd/Ctrl + K`** opens a jump-to-agent palette: type part of a name,
  `↑`/`↓` to pick, `Enter` to jump straight to that agent — its pane is
  focused, its tab activated, and the terminal takes the cursor. An agent
  that isn't on the grid yet is dropped into the focused pane. `Esc` closes.
- **Drop a file (an image, say) onto a terminal** and its path is typed into
  that agent — handy for feeding a screenshot to `claude`. The bytes are
  copied into a cache dir first, so it works even for images dragged straight
  out of a browser.
- **URLs an agent prints are clickable** — `http(s)://` links open in your
  default browser (the webview has nowhere to render a page).
- **Shift+Enter** in a terminal inserts a newline instead of submitting
  (sent as `ESC` + `CR`, exactly what Claude Code's `/terminal-setup` binds
  Shift+Enter to) — no `/terminal-setup` needed.

## Attention

When an agent's process exits, the sidebar highlights it and a toast slides in
at the bottom-right — so you know which pane to look at. It does not flag the
pane you're actively typing in.

Settings (⚙):

- **Startup layout** — restore the saved layout (default) or always open on
  a fixed pane preset; agents are kept and redistributed.
- **Default working directory** — prefilled for new agents and new shells
  when no sibling terminal suggests one.
- **Terminal font** — CSS font-family stack for every terminal (defaults to
  MonoLisa, falling back to the system monospace stack).
- **Terminal font size** — in px; `Cmd/Ctrl` `+` / `-` adjusts it live and
  `Cmd/Ctrl 0` resets it.

## Develop

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

Config is stored at
`~/Library/Application Support/com.megadesk.app/megadesk.json`.
