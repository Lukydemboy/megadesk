import {
  type AgentDef,
  type Config,
  type Pane,
  type PaneRef,
  DEFAULT_DRAWER_FRAC,
  uid,
} from "./types";
import {
  config,
  focusedPane,
  homeDir,
  mgr,
  mutate,
  saveConfig,
  setFocusedPane,
  shellPath,
} from "./store";
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
  const shells = config.drawers[id]?.ids ?? [];
  mutate((c) => {
    c.agents = c.agents.filter((a) => a.id !== id && !shells.includes(a.id));
    for (const col of c.columns) for (const p of col.panes) removeTabFromPane(p, id);
    delete c.drawers[id];
  });
  mgr.remove(id);
  for (const s of shells) mgr.remove(s);
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

/** Delete a shell entirely: its tab (or drawer tab), its session and its config entry. */
export function disposeShell(id: string) {
  mutate((c) => {
    c.agents = c.agents.filter((a) => a.id !== id);
    for (const col of c.columns) for (const p of col.panes) removeTabFromPane(p, id);
    for (const d of Object.values(c.drawers)) {
      const i = d.ids.indexOf(id);
      if (i < 0) continue;
      d.ids.splice(i, 1);
      if (d.activeId === id) d.activeId = d.ids[Math.min(i, d.ids.length - 1)] ?? null;
      if (!d.ids.length) d.open = false;
    }
  });
  mgr.remove(id);
  saveConfig();
}

/** The agent whose terminal drawer holds shell `id`, if any. */
export function drawerOwner(id: string): string | null {
  for (const [owner, d] of Object.entries(config.drawers))
    if (d.ids.includes(id)) return owner;
  return null;
}

/** The pane's active tab, if it's a project agent (the kind that gets a drawer). */
export function paneAgent(pane: Pane | undefined): AgentDef | undefined {
  const def = config.agents.find((a) => a.id === pane?.activeId);
  return def && def.kind !== "shell" ? def : undefined;
}

/**
 * Close the focused thing (Cmd/Ctrl+W): the drawer terminal the cursor is in,
 * otherwise the focused pane's active tab.
 */
export function closeFocusedTab() {
  const fp = focusedPane();
  const pane = fp && config.columns[fp.ci]?.panes[fp.pi];
  const drawer = config.drawers[pane?.activeId ?? ""];
  const inDrawer = drawer?.open && drawer.activeId;
  if (inDrawer && mgr.sessions.get(inDrawer)?.host.contains(document.activeElement)) {
    disposeShell(inDrawer);
    requestAnimationFrame(() => {
      const next = config.drawers[pane!.activeId!]?.activeId ?? pane!.activeId!;
      mgr.sessions.get(next)?.focus();
    });
    return;
  }
  const id = pane?.activeId;
  if (!fp || !id) return;
  closeTab(fp, id);
}

/** Open a new terminal from the focused pane (Cmd/Ctrl+T). */
export function newTerminalInFocusedPane() {
  const fp = focusedPane();
  if (fp) newTerminalInPane(fp);
}

/**
 * A new terminal for a pane: in the active agent's drawer when there is one,
 * so it starts in that agent's project; otherwise a plain shell tab.
 */
export function newTerminalInPane(ref: PaneRef) {
  const agent = paneAgent(config.columns[ref.ci]?.panes[ref.pi]);
  if (agent) newDrawerTerminal(agent.id);
  else newShellInPane(ref);
}

function shellDef(cwd: string, name: string): AgentDef {
  const shell = shellPath || "zsh";
  return {
    id: uid(),
    name,
    command: shell,
    // Login + interactive, matching a normal terminal window: the pty is
    // already reached via an `exec` from a login shell (see spawn_agent),
    // but that hop is swallowed, so without `-l` here the shell that
    // actually runs is non-login and skips ~/.bash_profile (or zsh's
    // .zprofile/.zlogin) — which is where bash-completion et al. usually
    // get sourced, breaking Tab completion.
    args: ["-i", "-l"],
    cwd,
    kind: "shell",
  };
}

/** Add a shell to an agent's drawer, opened in the agent's project root. */
export function newDrawerTerminal(agentId: string) {
  const agent = config.agents.find((a) => a.id === agentId);
  if (!agent) return;
  const cwd = agent.cwd || config.settings.defaultCwd || homeDir;
  const taken = new Set(
    (config.drawers[agentId]?.ids ?? []).map(
      (id) => config.agents.find((a) => a.id === id)?.name,
    ),
  );
  const base = baseName(shellPath || "zsh");
  let n = 1;
  while (taken.has(`${base} ${n}`)) n++;
  const def = shellDef(cwd, `${base} ${n}`);
  mutate((c) => {
    c.agents.push(def);
    const d = (c.drawers[agentId] ??= {
      ids: [],
      activeId: null,
      open: false,
      frac: DEFAULT_DRAWER_FRAC,
    });
    d.ids.push(def.id);
    d.activeId = def.id;
    d.open = true;
  });
  saveConfig();
  requestAnimationFrame(() => mgr.sessions.get(def.id)?.focus());
}

/** Show or hide an agent's drawer; an empty drawer gets its first terminal. */
export function toggleDrawer(agentId: string) {
  const d = config.drawers[agentId];
  if (!d?.ids.length) return newDrawerTerminal(agentId);
  const open = !d.open;
  mutate((c) => {
    c.drawers[agentId].open = open;
  });
  saveConfig();
  const focusId = open ? d.activeId : agentId;
  requestAnimationFrame(() => focusId && mgr.sessions.get(focusId)?.focus());
}

/** Toggle the focused pane's drawer (Cmd/Ctrl+J). */
export function toggleFocusedDrawer() {
  const fp = focusedPane();
  const agent = fp && paneAgent(config.columns[fp.ci]?.panes[fp.pi]);
  if (agent) toggleDrawer(agent.id);
}

export function selectDrawerTab(agentId: string, id: string) {
  mutate((c) => {
    const d = c.drawers[agentId];
    if (d?.ids.includes(id)) d.activeId = id;
  });
  saveConfig();
  requestAnimationFrame(() => mgr.sessions.get(id)?.focus());
}

/** A plain shell tab in a pane (the pane picker's "+ Shell here"). */
export function newShellInPane(ref: PaneRef) {
  const pane = config.columns[ref.ci]?.panes[ref.pi];
  if (!pane) return;
  const cwd = paneCwd(pane);
  const def = shellDef(cwd, `${baseName(shellPath || "zsh")} · ${baseName(cwd)}`);
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
  const owner = drawerOwner(id);
  if (owner) {
    revealAgent(owner);
    mutate((c) => {
      c.drawers[owner].activeId = id;
      c.drawers[owner].open = true;
    });
    saveConfig();
    requestAnimationFrame(() => mgr.sessions.get(id)?.focus());
    return;
  }
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
  requestAnimationFrame(() => mgr.sessions.get(id)?.focus());
}
