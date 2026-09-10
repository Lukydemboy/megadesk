import { invoke } from "@tauri-apps/api/core";
import type { AgentDef, Pane } from "../core/types";
import {
  config,
  mgr,
  saveConfig,
  setFocusedPane,
  setZoomedPane,
  zoomedPane,
} from "../core/store";
import { app, clamp, el, icon, makeGutter } from "./dom";
import {
  PRESETS,
  applyPreset,
  baseName,
  paneCwd,
  toggleZoom,
} from "../core/layout";
import {
  assignAgentToPane,
  closeTab,
  newShellInPane,
  upsertAgent,
} from "../core/agents";
import { DND_TYPE, wireDrop, wireTabDrag } from "./dnd";
import { openAgentDialog, openSettingsDialog } from "./dialogs";

/* ---------- top-level render ---------- */

export function render() {
  app.innerHTML = "";
  app.appendChild(renderTopbar());
  const main = el("div", "main");
  main.appendChild(renderSidebar());
  main.appendChild(renderGrid());
  app.appendChild(main);
  mountSessions();
  updateSidebarBadges();
}

function renderTopbar(): HTMLElement {
  const bar = el("div", "topbar");
  const brand = el("div", "brand");
  brand.textContent = "Megadesk";
  bar.appendChild(brand);

  const presets = el("div", "presets");
  for (const key of Object.keys(PRESETS)) {
    const b = el("button", "preset-btn");
    b.textContent = key;
    b.title = `${key}-pane layout`;
    b.onclick = () => applyPreset(PRESETS[key]);
    presets.appendChild(b);
  }
  bar.appendChild(presets);

  const spacer = el("div", "spacer");
  bar.appendChild(spacer);

  const addBtn = el("button", "ghost-btn");
  addBtn.textContent = "+ Agent";
  addBtn.onclick = () => openAgentDialog();
  bar.appendChild(addBtn);

  const gear = el("button", "ghost-btn icon-btn");
  gear.appendChild(icon("gear"));
  gear.title = "Settings";
  gear.onclick = openSettingsDialog;
  bar.appendChild(gear);

  return bar;
}

function renderSidebar(): HTMLElement {
  const side = el("div", "sidebar");
  const title = el("div", "side-title");
  title.textContent = "Agents";
  side.appendChild(title);

  if (config.agents.length === 0) {
    const empty = el("div", "side-empty");
    empty.textContent = "No agents yet. Add one to get started.";
    side.appendChild(empty);
  }

  for (const def of config.agents) {
    const row = el("div", "agent-row");
    row.dataset.agentId = def.id;
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData(DND_TYPE, def.id);
      e.dataTransfer?.setData("text/plain", def.name);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));

    const dot = el("span", "status-dot");
    row.appendChild(dot);

    const name = el("div", "agent-name");
    name.textContent = def.name;
    row.appendChild(name);

    const badge = el("span", "attn-badge");
    badge.textContent = "!";
    row.appendChild(badge);

    row.onclick = () => assignAgentToPane(def.id);

    const edit = el("button", "row-edit");
    edit.textContent = "✎";
    edit.title = "Edit agent";
    edit.onclick = (ev) => {
      ev.stopPropagation();
      openAgentDialog(def);
    };
    row.appendChild(edit);

    side.appendChild(row);
  }

  return side;
}

function renderGrid(): HTMLElement {
  const grid = el("div", "grid");

  // Zoomed: render only the chosen pane, filling the grid. The other panes'
  // sessions keep running with their hosts detached, exactly like a hidden
  // tab — unzooming re-mounts and repaints them.
  if (zoomedPane) {
    const { ci, pi } = zoomedPane;
    const pane = config.columns[ci]?.panes[pi];
    if (pane) {
      grid.classList.add("zoomed");
      const paneEl = el("div", "pane");
      paneEl.appendChild(renderPaneHead(pane, ci, pi));
      const body = el("div", "pane-body");
      body.dataset.col = String(ci);
      body.dataset.pane = String(pi);
      paneEl.appendChild(body);
      wireDrop(paneEl, pane, ci, pi);
      grid.appendChild(paneEl);
      return grid;
    }
    setZoomedPane(null); // stale indices — fall through to the normal split
  }

  config.columns.forEach((col, ci) => {
    const colEl = el("div", "col");
    colEl.style.flexGrow = String(col.frac);

    col.panes.forEach((pane, pi) => {
      const paneEl = el("div", "pane");
      paneEl.style.flexGrow = String(pane.frac);
      paneEl.appendChild(renderPaneHead(pane, ci, pi));
      const body = el("div", "pane-body");
      body.dataset.col = String(ci);
      body.dataset.pane = String(pi);
      paneEl.appendChild(body);
      colEl.appendChild(paneEl);

      wireDrop(paneEl, pane, ci, pi);

      if (pi < col.panes.length - 1) {
        colEl.appendChild(
          makeGutter("h", (dxy, rect) => {
            const total = col.panes[pi].frac + col.panes[pi + 1].frac;
            const ratio = clamp(
              (dxy - rect.top) / rect.height,
              0.12,
              0.88,
            );
            col.panes[pi].frac = total * ratio;
            col.panes[pi + 1].frac = total * (1 - ratio);
            applyFracs();
          }),
        );
      }
    });

    grid.appendChild(colEl);

    if (ci < config.columns.length - 1) {
      grid.appendChild(
        makeGutter("v", (dxy, rect) => {
          const total = config.columns[ci].frac + config.columns[ci + 1].frac;
          const ratio = clamp((dxy - rect.left) / rect.width, 0.12, 0.88);
          config.columns[ci].frac = total * ratio;
          config.columns[ci + 1].frac = total * (1 - ratio);
          applyFracs();
        }),
      );
    }
  });

  return grid;
}

function renderPaneHead(pane: Pane, ci: number, pi: number): HTMLElement {
  const head = el("div", "pane-head");

  const tabs = el("div", "pane-tabs");
  for (const id of pane.agentIds) {
    const def = config.agents.find((a) => a.id === id);
    if (!def) continue;
    const s = mgr.sessions.get(id);
    const tab = el("div", "pane-tab");
    tab.dataset.agentId = id;
    if (id === pane.activeId) tab.classList.add("active");
    if (s?.attention && id !== pane.activeId) tab.classList.add("attn");

    const tdot = el("span", "status-dot");
    tdot.classList.toggle("on", !!s?.running);
    tdot.classList.toggle("exited", !!s?.exited && !s?.running);
    tab.appendChild(tdot);

    const label = el("span", "pane-tab-name");
    label.textContent = def.name;
    label.title = "Double-click to rename";
    label.ondblclick = (ev) => {
      ev.stopPropagation();
      startTabRename(label, def);
    };
    tab.appendChild(label);

    // Drag a tab within (or across) panes to reorder it.
    wireTabDrag(tab, { ci, pi, id });

    const x = el("button", "pane-tab-x");
    x.textContent = "×";
    x.title = "Close terminal";
    x.onclick = (ev) => {
      ev.stopPropagation();
      closeTab(pane, id);
    };
    tab.appendChild(x);

    tab.onclick = () => {
      if (pane.activeId === id) return;
      pane.activeId = id;
      setFocusedPane({ ci, pi });
      saveConfig();
      render();
    };
    tabs.appendChild(tab);
  }
  head.appendChild(tabs);

  const add = el("button", "pane-btn");
  add.appendChild(icon("plus"));
  add.title = "Add terminal to this pane";
  add.onclick = (ev) => {
    ev.stopPropagation();
    openPaneMenu(add, pane, ci, pi);
  };
  head.appendChild(add);

  if (pane.agentIds.length) {
    const zoom = el("button", "pane-btn");
    zoom.appendChild(icon(zoomedPane ? "unzoom" : "zoom"));
    zoom.title = zoomedPane
      ? "Restore the split (Cmd/Ctrl+Enter)"
      : "Zoom this pane (Cmd/Ctrl+Enter)";
    zoom.onclick = (ev) => {
      ev.stopPropagation();
      toggleZoom({ ci, pi });
    };
    head.appendChild(zoom);

    const zed = el("button", "pane-btn");
    zed.textContent = "z";
    const dir = paneCwd(pane);
    zed.title = `Open ${dir} in Zed`;
    zed.onclick = () => {
      void invoke("open_in_zed", { path: dir });
    };
    head.appendChild(zed);
  }

  const active = pane.activeId;
  if (active && config.agents.some((a) => a.id === active)) {
    const restart = el("button", "pane-btn");
    restart.appendChild(icon("restart"));
    restart.title = "Restart this terminal";
    restart.onclick = () => {
      const sess = mgr.sessions.get(active);
      if (sess) void sess.restart(mgr).then(updateSidebarBadges);
    };
    head.appendChild(restart);

    const stop = el("button", "pane-btn");
    stop.appendChild(icon("stop"));
    stop.title = "Stop this terminal";
    stop.onclick = () => {
      void mgr.sessions.get(active)?.kill();
    };
    head.appendChild(stop);
  }

  return head;
}

/** Swap a tab's label for an input to rename its agent in place. */
function startTabRename(label: HTMLElement, def: AgentDef) {
  const tabEl = label.parentElement as HTMLElement | null;
  if (tabEl) tabEl.draggable = false; // let the input own the pointer

  const input = el("input", "pane-tab-edit");
  input.value = def.name;
  label.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const next = input.value.trim();
    if (save && next && next !== def.name) {
      upsertAgent({ ...def, name: next }); // re-renders
    } else {
      input.replaceWith(label);
      if (tabEl) tabEl.draggable = true;
    }
  };

  input.onblur = () => finish(true);
  input.onkeydown = (e) => {
    e.stopPropagation(); // don't let "[" / "]" cycle tabs while typing
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  };
  // clicks inside the input shouldn't reach the tab's activate/select handler
  input.onclick = (e) => e.stopPropagation();
  input.ondblclick = (e) => e.stopPropagation();
}

function openPaneMenu(anchor: HTMLElement, pane: Pane, ci: number, pi: number) {
  setFocusedPane({ ci, pi });
  const r = anchor.getBoundingClientRect();
  const menu = el("div", "popmenu");
  menu.style.left = `${r.left}px`;
  menu.style.top = `${r.bottom + 4}px`;

  const item = (text: string, fn: () => void) => {
    const b = el("button", "popmenu-item");
    b.textContent = text;
    b.onclick = () => {
      close();
      fn();
    };
    menu.appendChild(b);
  };

  item(`+ Shell in ${baseName(paneCwd(pane))}/`, () => newShellInPane(pane));
  item("+ New agent…", () => openAgentDialog(undefined, pane));

  const close = () => {
    menu.remove();
    document.removeEventListener("mousedown", onDoc, true);
  };
  const onDoc = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) close();
  };
  setTimeout(() => document.addEventListener("mousedown", onDoc, true), 0);
  document.body.appendChild(menu);
}

/* ---------- pane sizing ---------- */

function applyFracs() {
  const cols = app.querySelectorAll<HTMLElement>(".grid > .col");
  config.columns.forEach((col, ci) => {
    const colEl = cols[ci];
    if (!colEl) return;
    colEl.style.flexGrow = String(col.frac);
    const panes = colEl.querySelectorAll<HTMLElement>(":scope > .pane");
    col.panes.forEach((p, pi) => {
      if (panes[pi]) panes[pi].style.flexGrow = String(p.frac);
    });
  });
  resizeVisible();
  saveConfig();
}

let resizeRaf = 0;
function resizeVisible() {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    for (const id of mgr.visibleIds) mgr.sessions.get(id)?.fitAndResize();
  });
}
window.addEventListener("resize", resizeVisible);

/* ---------- session mounting ---------- */

function mountSessions() {
  const visible = new Set<string>();

  // Keep a live Session for every tab in every pane, so a hidden AI agent
  // still streams output and can raise its attention badge.
  for (const col of config.columns)
    for (const p of col.panes) {
      p.agentIds = p.agentIds.filter((id) => config.agents.some((a) => a.id === id));
      if (p.activeId && !p.agentIds.includes(p.activeId)) p.activeId = null;
      if (!p.activeId) p.activeId = p.agentIds[0] ?? null;
      for (const id of p.agentIds) {
        const def = config.agents.find((a) => a.id === id)!;
        mgr.ensure(def);
      }
    }

  app.querySelectorAll<HTMLElement>(".pane-body").forEach((body) => {
    const ci = Number(body.dataset.col);
    const pi = Number(body.dataset.pane);
    const pane = config.columns[ci]?.panes[pi];
    const activeId = pane?.activeId ?? null;
    if (!activeId) {
      body.innerHTML =
        '<div class="pane-placeholder">Add a terminal with +</div>';
      return;
    }
    const s = mgr.sessions.get(activeId);
    if (!s) return;
    visible.add(activeId);
    if (s.host.parentElement !== body) {
      body.innerHTML = "";
      body.appendChild(s.host);
    }
    requestAnimationFrame(() => {
      s.fitAndResize();
      void s.start(mgr).then(updateSidebarBadges);
    });
  });
  mgr.visibleIds = visible;
}

/* ---------- status badges ---------- */

export function updateSidebarBadges() {
  app.querySelectorAll<HTMLElement>(".agent-row").forEach((row) => {
    const id = row.dataset.agentId!;
    const s = mgr.sessions.get(id);
    row.classList.toggle("attn", !!s?.attention);
    const dot = row.querySelector(".status-dot")!;
    dot.classList.toggle("on", !!s?.running);
    dot.classList.toggle("exited", !!s?.exited && !s?.running);
  });
  // refresh pane tab dots + background-tab attention
  app.querySelectorAll<HTMLElement>(".pane-tab").forEach((tab) => {
    const id = tab.dataset.agentId!;
    const s = mgr.sessions.get(id);
    const dot = tab.querySelector(".status-dot")!;
    dot.classList.toggle("on", !!s?.running);
    dot.classList.toggle("exited", !!s?.exited && !s?.running);
    tab.classList.toggle("attn", !!s?.attention && !tab.classList.contains("active"));
  });
}
