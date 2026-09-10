import type { AgentDef, PaneRef } from "../core/types";
import { config, mgr } from "../core/store";
import { el } from "./dom";
import { locateAgent } from "../core/layout";
import { revealAgent } from "../core/agents";

/** Tears down the command palette if it's open; null when it isn't. */
let closePalette: (() => void) | null = null;

export function isPaletteOpen() {
  return closePalette !== null;
}

export function toggleCommandPalette() {
  if (closePalette) closePalette();
  else openCommandPalette();
}

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

function openCommandPalette() {
  if (closePalette) return;

  const overlay = el("div", "overlay palette-overlay");
  const box = el("div", "palette");
  const input = el("input", "palette-input");
  input.type = "text";
  input.placeholder = "Jump to agent…";
  input.spellcheck = false;
  const list = el("div", "palette-list");
  box.appendChild(input);
  box.appendChild(list);
  overlay.appendChild(box);

  let items: { def: AgentDef; loc: PaneRef | null }[] = [];
  let sel = 0;

  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    closePalette = null;
  };
  closePalette = close;

  const choose = (i: number) => {
    const it = items[i];
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

  const paint = () => {
    list.querySelectorAll(".palette-row").forEach((r, i) => {
      r.classList.toggle("sel", i === sel);
    });
    list.querySelector(".palette-row.sel")?.scrollIntoView({ block: "nearest" });
  };

  const refresh = () => {
    const q = input.value.trim();
    items = config.agents
      .map((def) => ({ def, score: fuzzyScore(def.name, q) }))
      .filter((r): r is { def: AgentDef; score: number } => r.score !== null)
      .sort((a, b) => b.score - a.score)
      .map(({ def }) => ({ def, loc: locateAgent(def.id) }));
    if (sel >= items.length) sel = Math.max(0, items.length - 1);

    list.innerHTML = "";
    if (!items.length) {
      const empty = el("div", "palette-empty");
      empty.textContent = config.agents.length ? "No match" : "No agents yet";
      list.appendChild(empty);
      return;
    }
    items.forEach((it, i) => {
      const row = el("div", "palette-row");
      if (i === sel) row.classList.add("sel");
      const s = mgr.sessions.get(it.def.id);
      const dot = el("span", "status-dot");
      dot.classList.toggle("on", !!s?.running);
      dot.classList.toggle("exited", !!s?.exited && !s?.running);
      dot.classList.toggle("attn", !!s?.attention);
      row.appendChild(dot);
      const name = el("span", "palette-name");
      name.textContent = it.def.name;
      row.appendChild(name);
      const loc = el("span", "palette-where");
      loc.textContent = where(it.loc);
      row.appendChild(loc);
      row.onmouseenter = () => {
        sel = i;
        paint();
      };
      row.onclick = () => choose(i);
      list.appendChild(row);
    });
  };

  const onKey = (e: KeyboardEvent) => {
    if (!["Escape", "ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation(); // keep these keys away from the global shortcuts
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") {
      sel = Math.min(sel + 1, items.length - 1);
      paint();
    } else if (e.key === "ArrowUp") {
      sel = Math.max(sel - 1, 0);
      paint();
    } else if (e.key === "Enter") choose(sel);
  };

  input.oninput = () => {
    sel = 0;
    refresh();
  };
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
  document.addEventListener("keydown", onKey, true);

  document.body.appendChild(overlay);
  refresh();
  input.focus();
}
