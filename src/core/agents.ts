import { type AgentDef, type Config, type Pane, type PaneRef, uid } from "./types";
import { config, mgr, mutate, saveConfig, setFocusedPane, shellPath } from "./store";
import { baseName, locateAgent, paneCwd, targetPaneRef } from "./layout";

/* ---------- agent CRUD ---------- */

export function upsertAgent(def: AgentDef) {
  mutate((c) => {
    const i = c.agents.findIndex((a) => a.id === def.id);
    if (i >= 0) c.agents[i] = def;
    else c.agents.push(def);
  });
  saveConfig();
}

export function deleteAgent(id: string) {
  mutate((c) => {
    c.agents = c.agents.filter((a) => a.id !== id);
    for (const col of c.columns) for (const p of col.panes) removeTabFromPane(p, id);
  });
  mgr.remove(id);
  saveConfig();
}

/* ---------- tab placement (draft helpers — call only inside `mutate`) ---------- */

/** Drop tab `id` from a pane, keeping `activeId` pointed at something real. */
export function removeTabFromPane(p: Pane, id: string) {
  const i = p.agentIds.indexOf(id);
  if (i < 0) return;
  p.agentIds.splice(i, 1);
  if (p.activeId === id)
    p.activeId = p.agentIds[Math.min(i, p.agentIds.length - 1)] ?? null;
}

/**
 * An agent lives in exactly one pane (one live terminal, one host element), so
 * placing it somewhere means removing it from every other pane it sat in.
 */
export function evictAgentFromOtherPanes(c: Config, id: string, keep: Pane) {
  for (const col of c.columns)
    for (const p of col.panes) if (p !== keep) removeTabFromPane(p, id);
}

/* ---------- tab placement (public) ---------- */

/** Add an existing agent as a tab in the focused (or first free) pane. */
export function assignAgentToPane(id: string) {
  addAgentTab(targetPaneRef(), id);
}

export function addAgentTab(ref: PaneRef, id: string) {
  mutate((c) => {
    if (!c.agents.some((a) => a.id === id)) return;
    const pane = c.columns[ref.ci]?.panes[ref.pi];
    if (!pane) return;
    evictAgentFromOtherPanes(c, id, pane);
    if (!pane.agentIds.includes(id)) pane.agentIds.push(id);
    pane.activeId = id;
  });
  saveConfig();
}

/** Remove a tab; a pane-owned shell with no other home is deleted outright. */
export function closeTab(ref: PaneRef, id: string) {
  let disposed = false;
  mutate((c) => {
    const pane = c.columns[ref.ci]?.panes[ref.pi];
    if (pane) removeTabFromPane(pane, id);
    const def = c.agents.find((a) => a.id === id);
    const elsewhere = c.columns.some((col) =>
      col.panes.some((p) => p.agentIds.includes(id)),
    );
    if (def?.kind === "shell" && !elsewhere) {
      c.agents = c.agents.filter((a) => a.id !== id);
      disposed = true;
    }
  });
  if (disposed) mgr.remove(id);
  saveConfig();
}

export function newShellInPane(ref: PaneRef) {
  const pane = config.columns[ref.ci]?.panes[ref.pi];
  if (!pane) return;
  const cwd = paneCwd(pane);
  const shell = shellPath || "zsh";
  const def: AgentDef = {
    id: uid(),
    name: `${baseName(shell)} · ${baseName(cwd)}`,
    command: shell,
    args: ["-i"],
    cwd,
    kind: "shell",
  };
  mutate((c) => {
    c.agents.push(def);
    const p = c.columns[ref.ci]?.panes[ref.pi];
    if (!p) return;
    p.agentIds.push(def.id);
    p.activeId = def.id;
  });
  saveConfig();
}

/**
 * Bring an agent to the front: activate its tab and focus its pane. An agent
 * that isn't on the grid yet is dropped into the target pane first.
 */
export function revealAgent(id: string) {
  if (!config.agents.some((a) => a.id === id)) return;
  const loc = locateAgent(id);
  if (loc) {
    mutate((c) => {
      c.columns[loc.ci].panes[loc.pi].activeId = id;
    });
    setFocusedPane({ ci: loc.ci, pi: loc.pi });
    saveConfig();
  } else {
    assignAgentToPane(id); // adds it as a tab in the target pane
  }
  requestAnimationFrame(() => mgr.sessions.get(id)?.term.focus());
}
