import { createEffect, on, onMount, Show } from "solid-js";
import {
  config,
  mgr,
  mutate,
  setZoomedPane,
  sidebarVisible,
  zoomedPane,
} from "../core/store";
import { Topbar } from "./Topbar";
import { Sidebar } from "./Sidebar";
import { Grid } from "./Grid";
import { AgentDialog } from "./AgentDialog";
import { AgentPicker } from "./AgentPicker";
import { SettingsDialog } from "./SettingsDialog";
import { CommandPalette } from "./CommandPalette";
import { BranchesDialog } from "./BranchesDialog";
import { ResetToMainDialog } from "./ResetToMainDialog";
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
    ) ||
      Object.entries(config.drawers).some(
        ([owner, d]) =>
          !ids.has(owner) ||
          d.ids.some((id) => !ids.has(id)) ||
          (d.activeId && !d.ids.includes(d.activeId)),
      );
    if (!bad) return;
    mutate((c) => {
      for (const col of c.columns)
        for (const p of col.panes) {
          p.agentIds = p.agentIds.filter((id) => ids.has(id));
          if (p.activeId && !p.agentIds.includes(p.activeId)) p.activeId = null;
          if (!p.activeId) p.activeId = p.agentIds[0] ?? null;
        }
      for (const [owner, d] of Object.entries(c.drawers)) {
        if (!ids.has(owner)) {
          delete c.drawers[owner];
          continue;
        }
        d.ids = d.ids.filter((id) => ids.has(id));
        if (!d.activeId || !d.ids.includes(d.activeId)) d.activeId = d.ids[0] ?? null;
        if (!d.ids.length) d.open = false;
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
    for (const d of Object.values(config.drawers))
      for (const id of d.ids) {
        const def = config.agents.find((a) => a.id === id);
        if (def) mgr.ensure(def);
      }
  });

  // Track which terminals are on screen; reflow them when that set changes.
  createEffect(() => {
    const visible = new Set<string>();
    const show = (id: string | null | undefined) => {
      if (!id) return;
      visible.add(id);
      const d = config.drawers[id];
      if (d?.open && d.activeId) visible.add(d.activeId);
    };
    const z = zoomedPane();
    if (z) show(config.columns[z.ci]?.panes[z.pi]?.activeId);
    else for (const col of config.columns) for (const p of col.panes) show(p.activeId);
    mgr.visibleIds = visible;
    resizeVisible();
  });

  // Drop a zoom that points at a pane that no longer exists.
  createEffect(() => {
    const z = zoomedPane();
    if (z && !config.columns[z.ci]?.panes[z.pi]) setZoomedPane(null);
  });

  // Reflow visible terminals whenever pane or drawer sizes change.
  createEffect(
    on(
      () =>
        config.columns
          .map((c) => `${c.frac}:${c.panes.map((p) => p.frac).join(",")}`)
          .join("|") +
        Object.values(config.drawers)
          .map((d) => `${d.open}:${d.frac}`)
          .join(","),
      () => resizeVisible(),
      { defer: true },
    ),
  );

  onMount(() => window.addEventListener("resize", resizeVisible));

  // The grid's available width changes when the sidebar is hidden/shown.
  createEffect(on(sidebarVisible, () => resizeVisible(), { defer: true }));

  return (
    <>
      <Topbar />
      <div class="main">
        <Show when={sidebarVisible()}>
          <Sidebar />
        </Show>
        <Grid />
      </div>
      <AgentDialog />
      <AgentPicker />
      <SettingsDialog />
      <CommandPalette />
      <BranchesDialog />
      <ResetToMainDialog />
      <Toasts />
    </>
  );
}
