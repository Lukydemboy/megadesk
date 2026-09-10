import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import type { AgentDef, PaneRef } from "../core/types";
import { config, mgr } from "../core/store";
import { locateAgent } from "../core/layout";
import { revealAgent } from "../core/agents";
import { paletteOpen, setPaletteOpen } from "./overlays";

/**
 * Subsequence match with light scoring: contiguous runs and word-boundary
 * hits rank higher, shorter names break ties. `null` means no match.
 */
function fuzzyScore(text: string, query: string): number | null {
  if (!query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const c of q) {
    const hit = t.indexOf(c, ti);
    if (hit < 0) return null;
    if (hit === ti) {
      streak += 1;
      score += 2 + streak;
    } else {
      streak = 0;
      score += 1;
    }
    if (hit === 0 || !/[a-z0-9]/i.test(t[hit - 1])) score += 3;
    ti = hit + 1;
  }
  return score - (t.length - q.length) * 0.05;
}

export function CommandPalette() {
  return (
    <Show when={paletteOpen()}>
      <PaletteBox />
    </Show>
  );
}

function PaletteBox() {
  const [query, setQuery] = createSignal("");
  const [sel, setSel] = createSignal(0);
  let inputEl!: HTMLInputElement;
  let listEl!: HTMLDivElement;

  const close = () => setPaletteOpen(false);

  const items = createMemo<{ def: AgentDef; loc: PaneRef | null }[]>(() => {
    const q = query().trim();
    return config.agents
      .map((def) => ({ def, score: fuzzyScore(def.name, q) }))
      .filter((r): r is { def: AgentDef; score: number } => r.score !== null)
      .sort((a, b) => b.score - a.score)
      .map(({ def }) => ({ def, loc: locateAgent(def.id) }));
  });

  createEffect(() => {
    if (sel() >= items().length) setSel(Math.max(0, items().length - 1));
  });
  createEffect(() => {
    items();
    sel();
    listEl
      ?.querySelector(".palette-row.sel")
      ?.scrollIntoView({ block: "nearest" });
  });

  const choose = (i: number) => {
    const it = items()[i];
    if (!it) return;
    close();
    revealAgent(it.def.id);
  };

  const where = (loc: PaneRef | null) => {
    if (!loc) return "off grid";
    const cols = config.columns.length > 1;
    const rows = config.columns[loc.ci].panes.length > 1;
    if (cols && rows) return `col ${loc.ci + 1} · pane ${loc.pi + 1}`;
    if (cols) return `col ${loc.ci + 1}`;
    if (rows) return `pane ${loc.pi + 1}`;
    return "grid";
  };

  const onKey = (e: KeyboardEvent) => {
    if (!["Escape", "ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown")
      setSel((s) => Math.min(s + 1, items().length - 1));
    else if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
    else if (e.key === "Enter") choose(sel());
  };

  onMount(() => {
    document.addEventListener("keydown", onKey, true);
    inputEl.focus();
  });
  onCleanup(() => document.removeEventListener("keydown", onKey, true));

  return (
    <div
      class="overlay palette-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div class="palette">
        <input
          ref={inputEl}
          class="palette-input"
          type="text"
          placeholder="Jump to agent…"
          spellcheck={false}
          value={query()}
          onInput={(e) => {
            setSel(0);
            setQuery(e.currentTarget.value);
          }}
        />
        <div class="palette-list" ref={listEl}>
          <Show
            when={items().length}
            fallback={
              <div class="palette-empty">
                {config.agents.length ? "No match" : "No agents yet"}
              </div>
            }
          >
            <For each={items()}>
              {(it, i) => {
                const st = () => mgr.state[it.def.id];
                return (
                  <div
                    classList={{ "palette-row": true, sel: i() === sel() }}
                    onMouseEnter={() => setSel(i())}
                    onClick={() => choose(i())}
                  >
                    <span
                      class="status-dot"
                      classList={{
                        on: !!st()?.running,
                        exited: !!st()?.exited && !st()?.running,
                        attn: !!st()?.attention,
                      }}
                    />
                    <span class="palette-name">{it.def.name}</span>
                    <span class="palette-where">{where(it.loc)}</span>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
}
