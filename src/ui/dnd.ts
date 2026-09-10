import type { Pane } from "../core/types";
import { config, render, saveConfig, setFocusedPane } from "../core/store";
import { addAgentTab, evictAgentFromOtherPanes } from "../core/agents";

export const DND_TYPE = "application/x-megadesk-agent";
export const TAB_DND = "application/x-megadesk-tab";

/** The tab currently being dragged for reordering, if any. */
let dragTab: { ci: number; pi: number; id: string } | null = null;

/**
 * Move a dragged tab so it sits before/after `anchorId` in the target pane.
 * Works within a pane (reorder) and across panes (move).
 */
function moveTab(
  from: { ci: number; pi: number; id: string },
  to: { ci: number; pi: number },
  anchorId: string,
  after: boolean,
) {
  const src = config.columns[from.ci]?.panes[from.pi];
  const dst = config.columns[to.ci]?.panes[to.pi];
  if (!src || !dst) return;

  const si = src.agentIds.indexOf(from.id);
  if (si < 0) return;
  src.agentIds.splice(si, 1);

  let ti = dst.agentIds.indexOf(anchorId);
  if (ti < 0) ti = dst.agentIds.length;
  else if (after) ti += 1;
  dst.agentIds.splice(ti, 0, from.id);

  // The tab now lives in dst; drop any copies still sitting in other panes.
  evictAgentFromOtherPanes(from.id, dst);

  // Repair any active-tab pointer left dangling by a cross-pane move.
  for (const p of new Set([src, dst])) {
    if (p.activeId && !p.agentIds.includes(p.activeId))
      p.activeId = p.agentIds[0] ?? null;
    if (!p.activeId) p.activeId = p.agentIds[0] ?? null;
  }
  setFocusedPane({ ci: to.ci, pi: to.pi });
  saveConfig();
  render();
}

/* ---------- sidebar agent → pane ---------- */

export function wireDrop(paneEl: HTMLElement, pane: Pane, ci: number, pi: number) {
  const isOurDrag = (e: DragEvent) =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(DND_TYPE);

  paneEl.addEventListener("dragover", (e) => {
    if (!isOurDrag(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
    paneEl.classList.add("drop-target");
  });
  paneEl.addEventListener("dragleave", (e) => {
    if (!paneEl.contains(e.relatedTarget as Node)) paneEl.classList.remove("drop-target");
  });
  paneEl.addEventListener("drop", (e) => {
    if (!isOurDrag(e)) return;
    e.preventDefault();
    paneEl.classList.remove("drop-target");
    const id = e.dataTransfer!.getData(DND_TYPE);
    setFocusedPane({ ci, pi });
    if (id) addAgentTab(pane, id);
  });
}

/* ---------- tab reordering ---------- */

/** Wire one pane tab for drag-to-reorder within a pane and drag-to-move across panes. */
export function wireTabDrag(
  tab: HTMLElement,
  ref: { ci: number; pi: number; id: string },
) {
  const { id } = ref;
  const edge = (e: DragEvent) => {
    const r = tab.getBoundingClientRect();
    return e.clientX > r.left + r.width / 2;
  };

  tab.draggable = true;
  tab.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    dragTab = { ...ref };
    e.dataTransfer?.setData(TAB_DND, id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    tab.classList.add("dragging");
  });
  tab.addEventListener("dragend", () => {
    dragTab = null;
    tab.parentElement
      ?.querySelectorAll(".pane-tab")
      .forEach((t) => t.classList.remove("dragging", "drop-before", "drop-after"));
  });
  tab.addEventListener("dragover", (e) => {
    if (!dragTab || dragTab.id === id) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const after = edge(e);
    tab.classList.toggle("drop-after", after);
    tab.classList.toggle("drop-before", !after);
  });
  tab.addEventListener("dragleave", () => {
    tab.classList.remove("drop-before", "drop-after");
  });
  tab.addEventListener("drop", (e) => {
    if (!dragTab || dragTab.id === id) return;
    e.preventDefault();
    e.stopPropagation();
    const from = dragTab;
    dragTab = null; // render() below detaches the source; dragend may not fire
    moveTab(from, { ci: ref.ci, pi: ref.pi }, id, edge(e));
  });
}
