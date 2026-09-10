import { mutate, saveConfig, setFocusedPane } from "../core/store";
import { evictAgentFromOtherPanes } from "../core/agents";

export const DND_TYPE = "application/x-megadesk-agent";
export const TAB_DND = "application/x-megadesk-tab";

export interface TabRef {
  ci: number;
  pi: number;
  id: string;
}

/** The tab currently being dragged for reordering, if any (transient, non-reactive). */
let dragTab: TabRef | null = null;

export function beginTabDrag(ref: TabRef) {
  dragTab = { ...ref };
}
export function endTabDrag() {
  dragTab = null;
}
export function currentTabDrag(): TabRef | null {
  return dragTab;
}

/**
 * Move a dragged tab so it sits before/after `anchorId` in the target pane.
 * Works within a pane (reorder) and across panes (move).
 */
export function moveTab(
  from: TabRef,
  to: { ci: number; pi: number },
  anchorId: string,
  after: boolean,
) {
  mutate((c) => {
    const src = c.columns[from.ci]?.panes[from.pi];
    const dst = c.columns[to.ci]?.panes[to.pi];
    if (!src || !dst) return;

    const si = src.agentIds.indexOf(from.id);
    if (si < 0) return;
    src.agentIds.splice(si, 1);

    let ti = dst.agentIds.indexOf(anchorId);
    if (ti < 0) ti = dst.agentIds.length;
    else if (after) ti += 1;
    dst.agentIds.splice(ti, 0, from.id);

    // The tab now lives in dst; drop any copies still sitting in other panes.
    evictAgentFromOtherPanes(c, from.id, dst);

    // Repair any active-tab pointer left dangling by a cross-pane move.
    for (const p of new Set([src, dst])) {
      if (p.activeId && !p.agentIds.includes(p.activeId))
        p.activeId = p.agentIds[0] ?? null;
      if (!p.activeId) p.activeId = p.agentIds[0] ?? null;
    }
  });
  setFocusedPane({ ci: to.ci, pi: to.pi });
  saveConfig();
}
