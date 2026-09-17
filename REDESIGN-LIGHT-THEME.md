# Megadesk — light & dark theme redesign

Handoff doc for a visual redesign: warmer, calmer, and off the generic-AI
purple, in both themes. Written for whoever (human or Claude Code)
implements it — read this whole file first, then work through
`src/style.css`.

## Paste into Claude Code

```
Implement the redesign described in REDESIGN-LIGHT-THEME.md. Read the whole
file first, then work through src/style.css top to bottom, applying the new
light AND dark tokens and the shape/shadow/typography rules to every rule
that currently uses the old ones (grep for `var(--ink)` used as a border
color, `var(--shadow)`, `border-radius: 0`, `text-transform: uppercase`, and
font-weight >= 700 to find them all — there are ~50+ spots). Update all
three token blocks: the default :root, the `@media (prefers-color-scheme:
dark)` block, and `:root[data-theme="dark"]` (keep those two in sync with
each other). Don't touch component files (Topbar.tsx, Sidebar.tsx,
PaneHead.tsx, etc.) — they're class-name driven and shouldn't need markup
changes. Run `npm run tauri dev` and check both themes (Settings → theme,
or your OS appearance) as you go.
```

## Why

The current UI is a loud neubrutalist look: 2–3px solid black borders on
everything, hard 0-blur "pressed paper" drop shadows, `border-radius: 0`
everywhere, heavy uppercase labels, and a bright violet accent (`#c17aff`,
the same in both light and dark) that reads as generic "AI tool" purple.
The ask is a light, clear, modern look that still feels like a serious dev
tool — just calmer and more considered — carried through consistently to
dark mode too, not left mismatched. Visual reference mockups (same layout,
new direction, one artboard per theme) are here:
https://claude.ai/artifact/JY1wYhrRU4s9wNjgfJQxoQ — treat them as a tone
reference for shape and color, not a literal spec (it's a marketing mockup,
not wired to real xterm panes or your actual component structure).

Direction: warm paper/charcoal backgrounds, a deep pine-green accent instead
of purple (lightened for dark), soft 1px hairlines instead of thick black
borders, soft blurred elevation instead of hard offset shadows, rounded-not-
square corners, and type weight pulled back from "shouting" to "confident."
Same shape language in both themes — only the color tokens change.

## 1. Colors — replace the token blocks in `src/style.css`

**Default `:root` (light):**

```css
:root {
  --bg: #F1EFE6;
  --panel: #FAF9F3;
  --panel-2: #FFFFFF;
  --ink: #1B211D;
  --border: #E1DED2;   /* was declared but unused — now the hairline color */
  --text: #1B211D;
  --muted: #83897C;
  --accent: #2E6B57;   /* was #c17aff */
  --attn: #C98A33;     /* was #ffd21f */
  --ok: #4C8F63;       /* was #33d17a */
  --danger: #B24A34;   /* was #ff5a52 */
  --term-bg: #14161b;  /* unchanged — terminals stay dark by convention */
  --shadow-sm: 0 1px 2px rgba(27, 33, 29, 0.06);
  --shadow-md: 0 4px 12px rgba(27, 33, 29, 0.08);
  --shadow-lg: 0 20px 48px rgba(27, 33, 29, 0.16), 0 2px 6px rgba(27, 33, 29, 0.06);
  --accent-soft: #E4EEE9;
}
```

**`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"])` and
`:root[data-theme="dark"]` — keep these two identical to each other:**

```css
--bg: #14160F;
--panel: #1B1E17;
--panel-2: #23271F;
--ink: #ECEAE0;
--border: #33372E;
--text: #ECEAE0;
--muted: #9CA296;
--accent: #6FB89B;   /* pine lightened for contrast on dark */
--attn: #D9A257;
--ok: #7BB98F;
--danger: #D57A61;
--term-bg: #14161b;  /* unchanged */
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.35);
--shadow-md: 0 6px 18px rgba(0, 0, 0, 0.42);
--shadow-lg: 0 24px 56px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.3);
--accent-soft: #2C3A32; /* a dark pine-tinted panel tone, not a pale tint */
```

`--shadow-sm/md/lg` replace the old single `--shadow` token (a flat hex used
for hard-offset shadows, different per theme). Remove `--shadow` and every
`var(--shadow)` usage — see §3.

`body.term-light` (the opt-in "light terminal" override, independent of the
UI theme) needs no change.

## 2. Shape scale — add these alongside the color tokens (same in both themes)

```css
--radius-sm: 6px;   /* buttons, tabs, badges, inputs, status dots */
--radius-md: 10px;  /* panes, dialogs, popovers, palette */
```

Replace every `border-radius: 0` with the appropriate one of these two.
Replace every `border: 2px solid var(--ink)` / `border: 3px solid var(--ink)`
used as chrome (not text color) with `border: 1px solid var(--border)`.

## 3. Shadows and pressed states

Every current interactive element uses the same "hard shadow that collapses
on press" pattern:

```css
/* old */
box-shadow: 2px 2px 0 var(--shadow);
transition: transform 0.05s, box-shadow 0.05s, background 0.05s;
/* :active */
transform: translate(2px, 2px);
box-shadow: 0 0 0 var(--shadow);
```

Drop this pattern everywhere — it's the single most "loud/brutalist"
signature in the file, in both themes. Replace with:

- **Small controls** (`.preset-btn`, `.ghost-btn`, `.pane-btn`,
  `.browse-btn`, `.primary-btn`, `.danger-btn`): no resting shadow. Hover →
  background `var(--accent-soft)` (not a solid accent fill). Active/press →
  `transform: scale(0.97)`, no shadow choreography, ~80ms ease transition.
- **Elevated surfaces** (`.pane`, `.dialog`, `.palette`, `.popmenu`,
  `.toast`): resting `box-shadow: var(--shadow-md)`; nothing on
  hover/press — they're not buttons.
- **Selected/active fills** (`.pane-tab.active`, `.palette-row.sel`,
  `.agent-row.attn`, `.pane-tab.attn`): replace a solid `var(--accent)` /
  `var(--attn)` background fill with the soft tint (`var(--accent-soft)` or
  an equivalent `attn` tint) plus `var(--accent)` for the border/text — a
  solid saturated fill reads as loud in the new direction, especially on
  dark where a full-bright pine/amber block would glow.

## 4. Typography (theme-independent)

Base body weight is currently `550` (`src/style.css`, the `body` rule) —
drop it to `440`. Across the file, dial back weights that sit at 700–900 on
non-heading elements (`.agent-name`, `.pane-tab`, `.palette-name`,
`.ghost-btn`, `.preset-btn`) to `560–600`; keep true `700` only for the
handful of things that should still read as headings (`.dialog-title`;
`.field-label` is fine to keep bold since it's already small/quiet).

Drop `text-transform: uppercase` from `.brand`, `.primary-btn`,
`.danger-btn`, and `.dialog-title` — plain sentence/title case reads calmer
and more modern. Keep uppercase + letter-spacing on the small section
labels where it functions as an overline (`.side-title`, `.popmenu-sep`,
`.palette-where`, `.field-label`) — those are fine as-is.

Font stack (`ui-sans-serif, -apple-system, "SF Pro Text", system-ui,
sans-serif`) stays — it's already a system stack, not a generic webfont,
and this is a native desktop app so there's no reason to bundle one.

## 5. What NOT to change

- No component/markup changes — `Topbar.tsx`, `Sidebar.tsx`, `PaneHead.tsx`,
  `PaneBody.tsx`, `Grid.tsx`, the overlays, and `icons.tsx` are all
  class-name-driven off `style.css`; the existing line-icon set is fine and
  matches the new direction (no emoji, no filled glyph tropes).
- `--term-bg` and the xterm theming — terminal panes staying dark by
  default is a reasonable, expected convention in both UI themes; don't
  flip it globally. The existing `body.term-light` opt-in class already
  covers anyone who wants an all-light window.
- No new sidebar grouping, no new components, no behavior changes — this is
  a token/shape/type pass over the existing structure, not a
  re-architecture.

## 6. Checking it

`npm run tauri dev` and eyeball the topbar, sidebar, a 2×2 pane grid, the
`+ Agent` dialog, and the `Cmd/Ctrl+K` command palette — in both light and
dark (toggle via Settings, or your OS appearance if it's on "system") —
those five surfaces cover essentially every class this doc touches.
