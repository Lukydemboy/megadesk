import { type AgentDef, type Pane, uid } from "./types";
import {
  config,
  mgr,
  render,
  saveConfig,
  setFocusedPane,
  shellPath,
} from "./store";
import { baseName, locateAgent, paneCwd, targetPane } from "./layout";

/* ---------- agent CRUD ---------- */

export function upsertAgent(def: AgentDef) {
  const i = config.agents.findIndex((a) => a.id === def.id);
  if (i >= 0) config.agents[i] = def;
  else config.agents.push(def);
  saveConfig();
  render();
}

export function deleteAgent(id: string) {
  config.agents = config.agents.filter((a) => a.id !== id);
  for (const col of config.columns)
    for (const p of col.panes) removeTabFromPane(p, id);
  mgr.remove(id);
  saveConfig();
  render();
}

/* ---------- tab placement ---------- */

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
export function evictAgentFromOtherPanes(id: string, keep: Pane) {
  for (const col of config.columns)
    for (const p of col.panes) if (p !== keep) removeTabFromPane(p, id);
}

/** Add an existing agent as a tab in the focused (or first free) pane. */
export function assignAgentToPane(id: string) {
  addAgentTab(targetPane(), id);
}

export function addAgentTab(pane: Pane, id: string) {
  if (!config.agents.some((a) => a.id === id)) return;
  evictAgentFromOtherPanes(id, pane);
  if (!pane.agentIds.includes(id)) pane.agentIds.push(id);
  pane.activeId = id;
  saveConfig();
  render();
}

/** Remove a tab; a pane-owned shell with no other home is deleted outright. */
export function closeTab(pane: Pane, id: string) {
  removeTabFromPane(pane, id);
  const def = config.agents.find((a) => a.id === id);
  const elsewhere = config.columns.some((c) =>
    c.panes.some((p) => p.agentIds.includes(id)),
  );
  if (def?.kind === "shell" && !elsewhere) {
    config.agents = config.agents.filter((a) => a.id !== id);
    mgr.remove(id);
  }
  saveConfig();
  render();
}

export function newShellInPane(pane: Pane) {
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
  config.agents.push(def);
  pane.agentIds.push(def.id);
  pane.activeId = def.id;
  saveConfig();
  render();
}

/**
 * Bring an agent to the front: activate its tab and focus its pane. An agent
 * that isn't on the grid yet is dropped into the target pane first.
 */
export function revealAgent(id: string) {
  if (!config.agents.some((a) => a.id === id)) return;
  const loc = locateAgent(id);
  if (loc) {
    const pane = config.columns[loc.ci].panes[loc.pi];
    pane.activeId = id;
    setFocusedPane({ ci: loc.ci, pi: loc.pi });
    saveConfig();
    render();
  } else {
    assignAgentToPane(id); // adds it as a tab in the target pane, re-renders
  }
  requestAnimationFrame(() => mgr.sessions.get(id)?.term.focus());
}
