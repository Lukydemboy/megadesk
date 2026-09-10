import { createEffect, on, onMount } from "solid-js";
import {
  config,
  mgr,
  mutate,
  setZoomedPane,
  zoomedPane,
} from "../core/store";
import { Topbar } from "./Topbar";
import { Sidebar } from "./Sidebar";
import { Grid } from "./Grid";
import { AgentDialog } from "./AgentDialog";
import { SettingsDialog } from "./SettingsDialog";
import { CommandPalette } from "./CommandPalette";
import { Toasts } from "./Toasts";

let resizeRaf = 0;
export function resizeVisible() {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    for (const id of mgr.visibleIds) mgr.sessions.get(id)?.fitAndResize();
  });
}

export function App() {
  // Prune tabs whose agent no longer exists; keep activeId pointed at something.
  createEffect(() => {
    const ids = new Set(config.agents.map((a) => a.id));
    const bad = config.columns.some((col) =>
      col.panes.some(
        (p) =>
          p.agentIds.some((id) => !ids.has(id)) ||
          (p.activeId && !p.agentIds.includes(p.activeId)) ||
          (!p.activeId && p.agentIds.length > 0),
      ),
    );
    if (!bad) return;
    mutate((c) => {
      for (const col of c.columns)
        for (const p of col.panes) {
          p.agentIds = p.agentIds.filter((id) => ids.has(id));
          if (p.activeId && !p.agentIds.includes(p.activeId)) p.activeId = null;
          if (!p.activeId) p.activeId = p.agentIds[0] ?? null;
        }
    });
  });

  // Keep a live Session for every tab in every pane, so a hidden agent still
  // streams output and can raise its attention badge.
  createEffect(() => {
    for (const col of config.columns)
      for (const p of col.panes)
        for (const id of p.agentIds) {
          const def = config.agents.find((a) => a.id === id);
          if (def) mgr.ensure(def);
        }
  });

  // Track which terminals are on screen; reflow them when that set changes.
  createEffect(() => {
    const visible = new Set<string>();
    const z = zoomedPane();
    if (z) {
      const id = config.columns[z.ci]?.panes[z.pi]?.activeId;
      if (id) visible.add(id);
    } else {
      for (const col of config.columns)
        for (const p of col.panes) if (p.activeId) visible.add(p.activeId);
    }
    mgr.visibleIds = visible;
    resizeVisible();
  });

  // Drop a zoom that points at a pane that no longer exists.
  createEffect(() => {
    const z = zoomedPane();
    if (z && !config.columns[z.ci]?.panes[z.pi]) setZoomedPane(null);
  });

  // Reflow visible terminals whenever pane fractions change.
  createEffect(
    on(
      () =>
        config.columns
          .map((c) => `${c.frac}:${c.panes.map((p) => p.frac).join(",")}`)
          .join("|"),
      () => resizeVisible(),
      { defer: true },
    ),
  );

  onMount(() => window.addEventListener("resize", resizeVisible));

  return (
    <>
      <Topbar />
      <div class="main">
        <Sidebar />
        <Grid />
      </div>
      <AgentDialog />
      <SettingsDialog />
      <CommandPalette />
      <Toasts />
    </>
  );
}
