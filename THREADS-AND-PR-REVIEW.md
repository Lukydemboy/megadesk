# Megadesk — feature threads & in-app PR review

Handoff doc for two linked features, modelled on T3 Code: every feature is
its own **thread** (a chat on its own branch, ideally its own worktree), and
each thread can open a **review pane** that shows the diff, commits, pushes,
creates the PR and then keeps showing that PR's status. Threads and PRs are
linked by branch, so the sidebar shows `#18 ● open ✓` next to the chat that
produced it. Written for whoever (human or Claude Code) implements it — read
this whole file first, then build it phase by phase.

## Paste into Claude Code

```
Implement phase 1 of THREADS-AND-PR-REVIEW.md. Read the whole file first.
Follow the existing patterns it points at (shells as AgentDefs with a
`kind`, ChatSession as a non-PTY AgentSession, git commands in lib.rs via
platform::command). Stop after the phase and summarize what to verify in
`npm run tauri dev` before moving on.
```

## Target

```
Project (repo)
 ├─ Thread "Add chat mode"       feat/chat-mode      #18 ● open  ✓ checks
 ├─ Thread "Terminal drawer"     feat/term-drawer    #19 ◐ draft
 └─ Thread "Fix resize bug"      fix/resize          #17 ✔ merged
```

Clicking a thread opens its chat. Clicking its PR badge opens the review
pane next to it (⌘-click opens the PR in the browser).

## Why it fits the current architecture

- `SessionMount` (`src/ui/PaneBody.tsx`) doesn't care what a session is: it
  calls `mgr.ensure(def)`, appends `s.host` and starts it. `ChatSession`
  already uses this to put a Solid UI in a tab instead of xterm, so a review
  pane is just a third `AgentSession` implementation.
- Shells are already `AgentDef`s with `kind: "shell"` that are owned by
  their tab. Threads should be `AgentDef`s too, so panes, tabs,
  drag-and-drop, chat resume and terminal drawers all work unchanged.
- Git plumbing (`git_branch`, `git_default_branch`, `git_delete_branch`,
  `resolve_remote`, `pr_url`) already lives in `src-tauri/src/lib.rs`.

## Part 1 — Threads

### Data model (`src/core/types.ts`)

```ts
export interface AgentDef {
  // ...existing
  kind?: "agent" | "shell" | "thread" | "review";
  mode?: "terminal" | "chat" | "review";
  /** Thread/review: the agent it belongs to (project for a thread, thread for a review). */
  parentId?: string;
  /** Thread: the branch this feature lives on. */
  branch?: string;
  /** Thread: worktree dir if isolated; also the thread's `cwd`. */
  worktree?: string;
  /** Thread: linked PR, refreshed from the host. */
  pr?: ThreadPr;
  /** Review: branch to diff against; defaults to the repo's default branch. */
  baseBranch?: string;
  createdAt?: number;
  archived?: boolean;
}

export interface ThreadPr {
  number: number;
  url: string;
  state: "open" | "draft" | "merged" | "closed";
  checks?: "pass" | "fail" | "pending";
  review?: "approved" | "changes_requested" | "review_required";
}
```

The project agent (today's `kind: "agent"`) keeps its `cwd` and is the
template for its threads: command, mode, model, effort and permission mode
are copied into each new thread.

### Isolation: worktrees

Two threads in one checkout would clobber each other's branch. A new thread
therefore defaults to:

```
git worktree add <app-data>/worktrees/<repo>/<slug> -b feat/<slug> <default-branch>
```

That path becomes the thread's `cwd`. Each agent edits its own copy, and the
terminal drawer (keyed by agent id, starting in `def.cwd`) automatically
opens in the right worktree.

Also offer **Local** (main checkout, `git switch -c`) for quick fixes. Only
one Local thread per repo can safely run at a time.

Caveats:
- Keep the worktree path stable. Claude Code stores sessions per cwd, so
  moving it breaks `--resume`.
- Each worktree needs its own `npm install` / build. Later: an optional
  per-project "setup command" that runs in the drawer when a worktree is
  created.

New Rust commands: `git_worktree_add(repo, path, branch, base)` and
`git_worktree_remove(repo, path)` (`git worktree remove --force`, then
`git worktree prune`).

### Titles

Create the thread with a provisional name, e.g. "New thread". After the
first prompt, run `claude -p --model haiku` with that prompt to get a 3–5
word title, then rename the thread. In worktree mode the branch is created
up front, so derive its slug from a short random id, or rename the branch
with `git branch -m` before the first push.

### Sidebar (`src/ui/Sidebar.tsx`)

- Projects become collapsible groups with their threads nested underneath,
  newest first.
- Thread row: status dot, title, PR badge (`#18`, coloured by state, plus a
  checks icon). The attention badge works as it does today.
- A "+" on the project row and ⌘N (in a project's pane) create a thread.
- Archived threads collapse into a "Done" section per project.

### Pane header (`src/ui/PaneHead.tsx`)

For a thread, show its branch and PR badge next to the name, plus a "Review
changes" button that opens or focuses its review pane.

### Lifecycle

When polling sees a thread's PR become `merged`, show a toast: "Archive
thread?". Archiving removes the worktree, deletes the branch
(`git_delete_branch` already exists) and sets `archived: true`. The chat
transcript stays resumable from the Done section.

## Part 2 — Review pane

A tab with `mode: "review"` / `kind: "review"`, owned by its tab like a
shell, with `parentId` = the thread (or agent) whose cwd and branch it
reviews. `SessionManager.ensure` (`src/terminal/sessions.ts`) gets a
`ReviewSession` branch next to the chat one; the component lives in
`src/review/`.

### Backend (`src-tauri/src/review.rs`, registered like `chat.rs`)

All through `platform::command`:

| Command | Runs |
| --- | --- |
| `git_changes(path, base)` | `git diff --merge-base <base> --numstat` + `git status --porcelain=v2` (uncommitted + untracked) |
| `git_file_diff(path, base, file)` | `git diff --merge-base <base> -U3 --no-color -- <file>` (one file at a time keeps big diffs fast) |
| `git_log_range(path, base)` | `git log --format=%s%n%b <base>..HEAD` (prefill the PR body) |
| `git_commit(path, message, files)` | `git add -- <files>` + `git commit -m` |
| `git_push(path, branch)` | `git push -u origin <branch>` |
| `pr_create(path, title, body, base, draft)` | `gh pr create … --json` / parse the printed URL |
| `pr_list(path)` | `gh pr list --state all --json number,url,state,isDraft,headRefName,statusCheckRollup,reviewDecision` |

Use the **`gh` CLI**, not the GitHub REST API: it already handles auth, so
there are no tokens to store and no OAuth flow. If `gh` is missing or the
remote isn't GitHub, fall back to the existing `git_create_pr_url` and open
the browser, as the Branches dialog does today. In-app Bitbucket/GitLab
support (REST + a stored token) is out of scope for v1.

### Diff rendering

Parse the unified diff in TS: hunks are `@@ -a,b +c,d @@` (about 100
lines). Render it in Solid, line-by-line first, side-by-side later, with
Shiki for highlighting. Owning the parser is what makes "send this hunk to
the agent" and inline comments possible later; `diff2html` would ship faster
but get in the way there.

- File list on the left with +/− counts and status (A/M/D/R/untracked).
- Expanding a file fetches its diff. Collapse by default past ~400 lines.

### Layout, top to bottom

1. Branch → base picker (default from `git_default_branch`), Refresh.
2. If there are uncommitted changes: a commit box (message + file checkboxes).
3. File list + diff viewer.
4. Footer:
   - **No PR yet:** title, body (prefilled from `git_log_range`), Draft
     toggle, **Create PR**. Create commits if needed, then pushes, then
     creates the PR, and writes `pr` onto the parent thread.
   - **PR exists:** status card with number + link, state, checks and
     review decision.

### Megadesk extras

- **Draft description:** runs `claude -p` in the repo with the diff and the
  commit log, and fills in the title and body.
- **Ask agent about this hunk:** sends the selected hunk and a question into
  the parent thread's chat via its `ChatSession`.

### Refresh

Refresh when the review pane gets focus, and when the parent chat finishes
a turn (the stream-json `result` event `ChatSession` already receives). Add
a `notify` watcher on `.git/` later if this isn't enough.

## PR ↔ thread linking

The link key is the **branch name**, not the moment of PR creation:

- When the review pane creates a PR, store `pr` on the thread immediately.
- Every ~60s, and when the window gains focus, call `pr_list` **once per
  repo** and match `headRefName` to each thread's `branch`.

This also links PRs the agent opens itself (`gh pr create` inside the chat)
and PRs opened on github.com. Skip polling when `gh` isn't installed or the
remote isn't GitHub.

## Build order

1. **Threads, local only.** Add `kind: "thread"` + `parentId`, the nested
   sidebar, "New thread" (copies the project's settings, `git switch -c`).
2. **Worktrees.** Add `git_worktree_add` / `git_worktree_remove`; worktree
   becomes the default for new threads, with a Local option.
3. **Read-only review pane.** `ReviewSession`, `git_changes`,
   `git_file_diff`, the diff viewer, and a "Review changes" button in the
   pane header. Useful on its own.
4. **Commit / push / create PR** via `gh`, writing `pr` back to the thread.
5. **PR polling + badges** in the sidebar and pane header; auto-titling.
6. **Archive on merge**, Draft description, Ask agent about this hunk.

Add an e2e spec per phase in `e2e/specs/` (see `branches.spec.js` for the
git-repo fixture pattern).

## Open questions

- Worktree root: app data dir (invisible, survives repo moves) or a sibling
  `../<repo>.worktrees/` (easy to open in an editor)? This doc assumes the
  app data dir; `open_in_zed` can make it reachable.
- Should existing single-chat agents migrate into "project + one thread"
  automatically, or stay as they are until the user creates a thread?
