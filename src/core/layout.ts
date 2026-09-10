import { type Column, type Pane, type PaneRef } from "./types";
import {
  config,
  focusedPane,
  homeDir,
  mgr,
  render,
  saveConfig,
  setFocusedPane,
  setZoomedPane,
  zoomedPane,
} from "./store";

/* ---------- presets ---------- */

export const PRESETS: Record<string, number[]> = {
  "1": [1],
  "2": [1, 1],
  "3": [1, 2],
  "4": [2, 2],
};

/** Every pane's tab list, in reading order, keeping panes grouped. */
function collectGroups(): string[][] {
  return config.columns.flatMap((col) =>
    col.panes.map((p) => p.agentIds.filter((id) => config.agents.some((a) => a.id === id))),
  );
}

export function applyPreset(shape: number[]) {
  setZoomedPane(null); // pane indices are about to be rebuilt
  const groups = collectGroups();
  const paneTotal = shape.reduce((a, b) => a + b, 0);
  // Fold any groups beyond the new pane count into the last pane.
  while (groups.length > paneTotal && groups.length > 1) {
    const tail = groups.pop()!;
    groups[groups.length - 1].push(...tail);
  }
  let cursor = 0;
  config.columns = shape.map((paneCount): Column => ({
    frac: 1 / shape.length,
    panes: Array.from({ length: paneCount }, () => {
      const agentIds = groups[cursor++] ?? [];
      return { agentIds, activeId: agentIds[0] ?? null, frac: 1 / paneCount };
    }),
  }));
  saveConfig();
  render();
}

/* ---------- pane lookup ---------- */

export function targetPane(): Pane {
  if (focusedPane) {
    const p = config.columns[focusedPane.ci]?.panes[focusedPane.pi];
    if (p) return p;
  }
  const empty = config.columns.flatMap((c) => c.panes).find((p) => p.agentIds.length === 0);
  return empty ?? config.columns[0].panes[0];
}

/** Which pane (if any) currently holds this agent as a tab. */
export function locateAgent(id: string): PaneRef | null {
  for (let ci = 0; ci < config.columns.length; ci++) {
    const panes = config.columns[ci].panes;
    for (let pi = 0; pi < panes.length; pi++)
      if (panes[pi].agentIds.includes(id)) return { ci, pi };
  }
  return null;
}

/** Directory a new shell in this pane should open in: reuse a sibling's cwd. */
export function paneCwd(pane: Pane): string {
  for (const id of pane.agentIds) {
    const d = config.agents.find((a) => a.id === id);
    if (d?.cwd) return d.cwd;
  }
  return config.settings.defaultCwd || homeDir;
}

export function baseName(p: string): string {
  const t = p.replace(/\/+$/, "");
  return t.slice(t.lastIndexOf("/") + 1) || t || "~";
}

/* ---------- zoom & tab navigation ---------- */

/** Blow the focused pane up to fill the grid, or restore the split if it
 *  already is. Purely a view state — not saved to the layout. */
export function toggleZoom(target?: PaneRef) {
  if (zoomedPane) {
    setZoomedPane(null);
  } else {
    const fp = target ?? focusedPane ?? { ci: 0, pi: 0 };
    if (!config.columns[fp.ci]?.panes[fp.pi]) return;
    setZoomedPane({ ci: fp.ci, pi: fp.pi });
    setFocusedPane({ ci: fp.ci, pi: fp.pi });
  }
  render();
}

/** Jump the focused pane to its Nth tab (1-based); 9 means "last tab". */
export function selectTabByIndex(n: number) {
  const fp = focusedPane;
  const pane = fp && config.columns[fp.ci]?.panes[fp.pi];
  if (!pane || !pane.agentIds.length) return;
  const i = n === 9 ? pane.agentIds.length - 1 : Math.min(n - 1, pane.agentIds.length - 1);
  const id = pane.agentIds[i];
  if (!id || id === pane.activeId) return;
  pane.activeId = id;
  saveConfig();
  render();
  requestAnimationFrame(() => mgr.sessions.get(id)?.term.focus());
}

/** Cycle the focused pane's active tab. dir: +1 next, -1 previous. */
export function cycleTab(dir: number) {
  const fp = focusedPane;
  const pane = fp && config.columns[fp.ci]?.panes[fp.pi];
  if (!pane || pane.agentIds.length < 2) return;
  const cur = pane.activeId ? pane.agentIds.indexOf(pane.activeId) : 0;
  const next = (cur + dir + pane.agentIds.length) % pane.agentIds.length;
  pane.activeId = pane.agentIds[next];
  saveConfig();
  render();
  requestAnimationFrame(() => {
    if (pane.activeId) mgr.sessions.get(pane.activeId)?.term.focus();
  });
}
