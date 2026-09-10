import "@xterm/xterm/css/xterm.css";
import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  type Column,
  type Config,
  type Pane,
  type AgentDef,
  type Settings,
  type StartupLayout,
  type TerminalTheme,
  DEFAULT_TERM_FONT,
  defaultConfig,
  uid,
} from "./types";
import { SessionManager } from "./sessions";

let config: Config = defaultConfig();
let mgr: SessionManager;
let homeDir = "";
let shellPath = "";
/** Pane whose terminal was last focused — target for sidebar clicks and tab keys. */
let focusedPane: { ci: number; pi: number } | null = null;
/** Tears down the command palette if it's open; null when it isn't. */
let closePalette: (() => void) | null = null;
/** Pane blown up to fill the grid, or null when the normal split is shown. */
let zoomedPane: { ci: number; pi: number } | null = null;

const app = document.getElementById("app")!;

/* ---------- persistence ---------- */

async function loadConfig() {
  try {
    const raw = await invoke<string>("load_config");
    if (raw) {
      const parsed = JSON.parse(raw) as Config;
      const d = defaultConfig();
      config = { ...d, ...parsed };
      // Keep only settings keys we still recognise, so retired ones (idle
      // timer, sound/notification/badge toggles) don't linger in the file.
      const known = Object.keys(d.settings) as (keyof Settings)[];
      const kept = Object.fromEntries(
        Object.entries(parsed.settings ?? {}).filter(([k]) =>
          known.includes(k as keyof Settings),
        ),
      ) as Partial<Settings>;
      config.settings = { ...d.settings, ...kept };
      if (!config.columns?.length) config.columns = defaultConfig().columns;
      for (const col of config.columns) col.panes = col.panes.map(migratePane);

      // An agent belongs to one pane only. Drop stray duplicates an older
      // build may have left in the saved layout, keeping the first home.
      const placed = new Set<string>();
      for (const col of config.columns)
        for (const p of col.panes) {
          p.agentIds = p.agentIds.filter((id) =>
            placed.has(id) ? false : (placed.add(id), true),
          );
          if (p.activeId && !p.agentIds.includes(p.activeId))
            p.activeId = p.agentIds[0] ?? null;
        }
    }
  } catch (e) {
    console.error("load_config failed", e);
  }
}

let saveTimer: number | undefined;
function saveConfig() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void invoke("save_config", { contents: JSON.stringify(config, null, 2) });
  }, 300);
}

/* ---------- layout helpers ---------- */

/** Normalise a pane from any stored shape (old single-agent or new tabbed). */
function migratePane(p: any): Pane {
  if (Array.isArray(p?.agentIds)) {
    const agentIds: string[] = p.agentIds.filter((x: unknown) => typeof x === "string");
    return {
      agentIds,
      activeId: agentIds.includes(p.activeId) ? p.activeId : agentIds[0] ?? null,
      frac: typeof p.frac === "number" ? p.frac : 1,
    };
  }
  const id: string | null = typeof p?.agentId === "string" ? p.agentId : null;
  return { agentIds: id ? [id] : [], activeId: id, frac: typeof p?.frac === "number" ? p.frac : 1 };
}

/** Every pane's tab list, in reading order, keeping panes grouped. */
function collectGroups(): string[][] {
  return config.columns.flatMap((col) =>
    col.panes.map((p) => p.agentIds.filter((id) => config.agents.some((a) => a.id === id))),
  );
}

function applyPreset(shape: number[]) {
  zoomedPane = null; // pane indices are about to be rebuilt
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

const PRESETS: Record<string, number[]> = {
  "1": [1],
  "2": [1, 1],
  "3": [1, 2],
  "4": [2, 2],
};

/* ---------- agent CRUD ---------- */

function upsertAgent(def: AgentDef) {
  const i = config.agents.findIndex((a) => a.id === def.id);
  if (i >= 0) config.agents[i] = def;
  else config.agents.push(def);
  saveConfig();
  render();
}

function deleteAgent(id: string) {
  config.agents = config.agents.filter((a) => a.id !== id);
  for (const col of config.columns)
    for (const p of col.panes) removeTabFromPane(p, id);
  mgr.remove(id);
  saveConfig();
  render();
}

/** Drop tab `id` from a pane, keeping `activeId` pointed at something real. */
function removeTabFromPane(p: Pane, id: string) {
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
function evictAgentFromOtherPanes(id: string, keep: Pane) {
  for (const col of config.columns)
    for (const p of col.panes) if (p !== keep) removeTabFromPane(p, id);
}

function targetPane(): Pane {
  if (focusedPane) {
    const p = config.columns[focusedPane.ci]?.panes[focusedPane.pi];
    if (p) return p;
  }
  const empty = config.columns.flatMap((c) => c.panes).find((p) => p.agentIds.length === 0);
  return empty ?? config.columns[0].panes[0];
}

/** Add an existing agent as a tab in the focused (or first free) pane. */
function assignAgentToPane(id: string) {
  addAgentTab(targetPane(), id);
}

function addAgentTab(pane: Pane, id: string) {
  if (!config.agents.some((a) => a.id === id)) return;
  evictAgentFromOtherPanes(id, pane);
  if (!pane.agentIds.includes(id)) pane.agentIds.push(id);
  pane.activeId = id;
  saveConfig();
  render();
}

/* ---------- drag & drop: sidebar agent → pane ---------- */

const DND_TYPE = "application/x-megadesk-agent";
const TAB_DND = "application/x-megadesk-tab";

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
  focusedPane = { ci: to.ci, pi: to.pi };
  saveConfig();
  render();
}

function wireDrop(paneEl: HTMLElement, pane: Pane, ci: number, pi: number) {
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
    focusedPane = { ci, pi };
    if (id) addAgentTab(pane, id);
  });
}

/* ---------- rendering ---------- */

function render() {
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
    zoomedPane = null; // stale indices — fall through to the normal split
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
    tab.draggable = true;
    tab.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      dragTab = { ci, pi, id };
      e.dataTransfer?.setData(TAB_DND, id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      tab.classList.add("dragging");
    });
    tab.addEventListener("dragend", () => {
      dragTab = null;
      tabs.querySelectorAll(".pane-tab").forEach((t) =>
        t.classList.remove("dragging", "drop-before", "drop-after"),
      );
    });
    tab.addEventListener("dragover", (e) => {
      if (!dragTab || dragTab.id === id) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const r = tab.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
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
      const r = tab.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      const from = dragTab;
      dragTab = null; // render() below detaches the source; dragend may not fire
      moveTab(from, { ci, pi }, id, after);
    });

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
      focusedPane = { ci, pi };
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

/** Remove a tab; a pane-owned shell with no other home is deleted outright. */
function closeTab(pane: Pane, id: string) {
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

/** Directory a new shell in this pane should open in: reuse a sibling's cwd. */
function paneCwd(pane: Pane): string {
  for (const id of pane.agentIds) {
    const d = config.agents.find((a) => a.id === id);
    if (d?.cwd) return d.cwd;
  }
  return config.settings.defaultCwd || homeDir;
}

function baseName(p: string): string {
  const t = p.replace(/\/+$/, "");
  return t.slice(t.lastIndexOf("/") + 1) || t || "~";
}

function newShellInPane(pane: Pane) {
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

function openPaneMenu(anchor: HTMLElement, pane: Pane, ci: number, pi: number) {
  focusedPane = { ci, pi };
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

/** Blow the focused pane up to fill the grid, or restore the split if it
 *  already is. Purely a view state — not saved to the layout. */
function toggleZoom(target?: { ci: number; pi: number }) {
  if (zoomedPane) {
    zoomedPane = null;
  } else {
    const fp = target ?? focusedPane ?? { ci: 0, pi: 0 };
    if (!config.columns[fp.ci]?.panes[fp.pi]) return;
    zoomedPane = { ci: fp.ci, pi: fp.pi };
    focusedPane = { ...zoomedPane };
  }
  render();
}

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

let resizeRaf = 0;
function resizeVisible() {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    for (const id of mgr.visibleIds) mgr.sessions.get(id)?.fitAndResize();
  });
}
window.addEventListener("resize", resizeVisible);

/* ---------- sidebar badges ---------- */

function updateSidebarBadges() {
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

/* ---------- dialogs ---------- */

function openAgentDialog(existing?: AgentDef, targetPane?: Pane) {
  const editing = !!existing;
  const def: AgentDef = existing
    ? { ...existing, args: [...existing.args] }
    : {
        id: uid(),
        name: "",
        command: "claude",
        args: [],
        cwd: targetPane
          ? paneCwd(targetPane)
          : config.settings.defaultCwd || homeDir,
      };

  const { overlay, body, footer, close } = makeDialog(
    editing ? "Edit agent" : "New agent",
  );

  body.appendChild(field("Name", (i) => {
    i.value = def.name;
    i.placeholder = "e.g. Backend agent";
    i.oninput = () => (def.name = i.value);
  }));
  body.appendChild(field("Command", (i) => {
    i.value = def.command;
    i.placeholder = "claude";
    i.oninput = () => (def.command = i.value);
  }));
  body.appendChild(field("Arguments (space-separated)", (i) => {
    i.value = def.args.join(" ");
    i.placeholder = "--model sonnet";
    i.oninput = () =>
      (def.args = i.value.trim() ? i.value.trim().split(/\s+/) : []);
  }));
  body.appendChild(
    pathField(
      "Working directory",
      def.cwd,
      config.settings.defaultCwd || homeDir,
      (v) => (def.cwd = v),
    ),
  );

  if (editing) {
    const del = el("button", "danger-btn");
    del.textContent = "Delete";
    del.onclick = () => {
      deleteAgent(def.id);
      close();
    };
    footer.appendChild(del);
  }
  const save = el("button", "primary-btn");
  save.textContent = editing ? "Save" : "Add";
  save.onclick = () => {
    if (!def.name.trim()) def.name = def.command || "agent";
    upsertAgent(def);
    if (!editing) {
      if (targetPane) addAgentTab(targetPane, def.id);
      else assignAgentToPane(def.id);
    }
    close();
  };
  footer.appendChild(save);

  document.body.appendChild(overlay);
}

function openSettingsDialog() {
  const s = config.settings;
  const { overlay, body, footer, close } = makeDialog("Settings");

  const note = el("div", "dialog-note");
  note.textContent =
    "The sidebar highlights an agent whose process has exited, with a toast in the corner.";
  body.appendChild(note);

  body.appendChild(
    select(
      "Startup layout",
      [
        { value: "last", label: "Restore last layout" },
        { value: "1", label: "Single pane" },
        { value: "2", label: "Side by side" },
        { value: "3", label: "1 + 2" },
        { value: "4", label: "2 × 2" },
      ],
      s.startupLayout,
      (v) => {
        s.startupLayout = v as StartupLayout;
        saveConfig();
      },
    ),
  );

  body.appendChild(
    pathField("Default working directory", s.defaultCwd, homeDir, (v) => {
      s.defaultCwd = v.trim();
      saveConfig();
    }),
  );

  body.appendChild(
    select(
      "Terminal theme",
      [
        { value: "dark", label: "Dark" },
        { value: "light", label: "Light" },
      ],
      s.terminalTheme,
      (v) => {
        s.terminalTheme = v as TerminalTheme;
        saveConfig();
        applyTerminalTheme();
      },
    ),
  );

  body.appendChild(
    field("Terminal font", (i) => {
      i.value = s.terminalFontFamily;
      i.placeholder = DEFAULT_TERM_FONT;
      i.oninput = () => {
        s.terminalFontFamily = i.value.trim() || DEFAULT_TERM_FONT;
        saveConfig();
        mgr.applyFont();
      };
    }),
  );
  body.appendChild(
    field("Terminal font size (px)", (i) => {
      i.type = "number";
      i.step = "0.5";
      i.value = String(s.terminalFontSize);
      i.oninput = () => {
        const n = Number(i.value);
        if (n >= 6 && n <= 40) {
          s.terminalFontSize = n;
          saveConfig();
          mgr.applyFont();
        }
      };
    }),
  );

  const done = el("button", "primary-btn");
  done.textContent = "Done";
  done.onclick = close;
  footer.appendChild(done);

  document.body.appendChild(overlay);
}

/* ---------- command palette ---------- */

/** Which pane (if any) currently holds this agent as a tab. */
function locateAgent(id: string): { ci: number; pi: number } | null {
  for (let ci = 0; ci < config.columns.length; ci++) {
    const panes = config.columns[ci].panes;
    for (let pi = 0; pi < panes.length; pi++)
      if (panes[pi].agentIds.includes(id)) return { ci, pi };
  }
  return null;
}

/**
 * Bring an agent to the front: activate its tab and focus its pane. An agent
 * that isn't on the grid yet is dropped into the target pane first.
 */
function revealAgent(id: string) {
  if (!config.agents.some((a) => a.id === id)) return;
  const loc = locateAgent(id);
  if (loc) {
    const pane = config.columns[loc.ci].panes[loc.pi];
    pane.activeId = id;
    focusedPane = { ci: loc.ci, pi: loc.pi };
    saveConfig();
    render();
  } else {
    assignAgentToPane(id); // adds it as a tab in the target pane, re-renders
  }
  requestAnimationFrame(() => mgr.sessions.get(id)?.term.focus());
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

function toggleCommandPalette() {
  if (closePalette) closePalette();
  else openCommandPalette();
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

  let items: { def: AgentDef; loc: { ci: number; pi: number } | null }[] = [];
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

  const where = (loc: { ci: number; pi: number } | null) => {
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

/* ---------- tiny DOM utils ---------- */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/* Line-icons (Lucide geometry), sized in CSS and centred by the button's
   flexbox — text glyphs never sat centred across ⚙ / ⟳ / ■. */
const ICONS: Record<string, string> = {
  gear:
    '<circle cx="12" cy="12" r="3.2"/>' +
    '<path d="M12 2.5v3M12 18.5v3M4.2 6.2l2.1 2.1M17.7 15.7l2.1 2.1' +
    'M2.5 12h3M18.5 12h3M4.2 17.8l2.1-2.1M17.7 8.3l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  restart:
    '<path d="M3 11a9 9 0 0 1 15-5.6L21 8"/><path d="M21 3v5h-5"/>' +
    '<path d="M21 13a9 9 0 0 1-15 5.6L3 16"/><path d="M3 21v-5h5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
  zoom:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3' +
    'M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  unzoom:
    '<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3' +
    'M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>',
};

/** An <svg> line-icon element for use inside a button. */
function icon(name: keyof typeof ICONS | string): SVGElement {
  const wrap = el("div");
  wrap.innerHTML =
    `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `${ICONS[name] ?? ""}</svg>`;
  return wrap.firstElementChild as SVGElement;
}

function makeGutter(
  dir: "h" | "v",
  onMove: (coord: number, rect: DOMRect) => void,
): HTMLElement {
  const g = el("div", dir === "h" ? "gutter gutter-h" : "gutter gutter-v");
  g.onmousedown = (e) => {
    e.preventDefault();
    const parent = (dir === "h" ? g.parentElement : g.parentElement)!;
    const rect = parent.getBoundingClientRect();
    document.body.style.cursor = dir === "h" ? "row-resize" : "col-resize";
    const move = (ev: MouseEvent) =>
      onMove(dir === "h" ? ev.clientY : ev.clientX, rect);
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  return g;
}

function field(
  label: string,
  setup: (input: HTMLInputElement) => void,
): HTMLElement {
  const wrap = el("label", "field");
  const span = el("span", "field-label");
  span.textContent = label;
  const input = el("input", "field-input");
  setup(input);
  wrap.appendChild(span);
  wrap.appendChild(input);
  return wrap;
}

/** A path field with a native folder picker alongside the text input. */
function pathField(
  label: string,
  value: string,
  placeholder: string,
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = el("div", "field");
  const span = el("span", "field-label");
  span.textContent = label;

  const row = el("div", "field-row");
  const input = el("input", "field-input");
  input.value = value;
  input.placeholder = placeholder;
  input.oninput = () => onChange(input.value);

  const browse = el("button", "browse-btn");
  browse.type = "button";
  browse.textContent = "Browse…";
  browse.onclick = async () => {
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        title: label,
        defaultPath: input.value.trim() || placeholder || undefined,
      });
      if (typeof picked === "string") {
        input.value = picked;
        onChange(picked);
      }
    } catch (e) {
      console.error("folder picker failed", e);
    }
  };

  row.appendChild(input);
  row.appendChild(browse);
  wrap.appendChild(span);
  wrap.appendChild(row);
  return wrap;
}

function select(
  label: string,
  options: { value: string; label: string }[],
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = el("label", "field");
  const span = el("span", "field-label");
  span.textContent = label;
  const sel = el("select", "field-input");
  for (const o of options) {
    const opt = el("option");
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = value;
  sel.onchange = () => onChange(sel.value);
  wrap.appendChild(span);
  wrap.appendChild(sel);
  return wrap;
}

/** Transient in-app notification, bottom-right, styled like the rest of the UI. */
function showToast(message: string, kind: "info" | "warn" = "info") {
  let host = document.getElementById("toasts");
  if (!host) {
    host = el("div");
    host.id = "toasts";
    document.body.appendChild(host);
  }

  const t = el("div", `toast toast-${kind}`);
  const msg = el("span", "toast-msg");
  msg.textContent = message;
  t.appendChild(msg);

  const x = el("button", "toast-x");
  x.textContent = "×";
  t.appendChild(x);

  let closed = false;
  const dismiss = () => {
    if (closed) return;
    closed = true;
    t.classList.remove("in");
    setTimeout(() => t.remove(), 180);
  };
  x.onclick = dismiss;

  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("in"));
  setTimeout(dismiss, 6000);
}

function makeDialog(title: string) {
  const overlay = el("div", "overlay");
  const dialog = el("div", "dialog");
  const h = el("div", "dialog-title");
  h.textContent = title;
  const body = el("div", "dialog-body");
  const footer = el("div", "dialog-footer");
  const close = () => overlay.remove();
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
  dialog.appendChild(h);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);
  return { overlay, dialog, body, footer, close };
}

/* ---------- boot ---------- */

/** Jump the focused pane to its Nth tab (1-based); 9 means "last tab". */
function selectTabByIndex(n: number) {
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
function cycleTab(dir: number) {
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

/**
 * Push the chosen terminal colour scheme to xterm and to the pane chrome
 * behind it (the `--term-bg` the pane borders sit on).
 */
function applyTerminalTheme() {
  const light = config.settings.terminalTheme === "light";
  document.body.classList.toggle("term-light", light);
  mgr?.applyTheme();
}

/** Nudge the terminal font size and re-apply it live. delta 0 resets. */
function bumpFontSize(delta: number) {
  const s = config.settings;
  const next = delta === 0 ? 12.5 : clamp(s.terminalFontSize + delta, 6, 40);
  if (next === s.terminalFontSize) return;
  s.terminalFontSize = next;
  saveConfig();
  mgr.applyFont();
}

function installKeys() {
  // Capture phase: the focused xterm terminal calls stopPropagation on keys it
  // handles, so a bubble-phase listener never sees Cmd+Enter (and the other
  // chords) while the cursor is in a terminal. Capturing on window runs before
  // the event ever reaches the terminal's textarea, so the shortcuts fire no
  // matter what's focused.
  window.addEventListener(
    "keydown",
    (e) => {
      // Since this runs in the capture phase, ahead of the focused terminal,
      // swallow every key we act on so it can't also reach the pty.
      const claim = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      // Esc leaves a zoomed pane (the palette handles its own Esc first).
      if (e.key === "Escape" && zoomedPane && !closePalette) {
        claim();
        toggleZoom();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // Cmd/Ctrl + K  — open (or close) the jump-to-agent palette
      if (e.key === "k" || e.key === "K") {
        claim();
        toggleCommandPalette();
        return;
      }
      // The palette owns the keyboard while it's open.
      if (closePalette) return;
      // Cmd/Ctrl + Enter  — zoom the focused pane to fill the grid, or restore
      if (e.key === "Enter") {
        claim();
        toggleZoom();
        return;
      }
      // Cmd/Ctrl + ] / [  — switch terminal within the focused pane
      if (e.key === "]" || e.key === "[") {
        claim();
        cycleTab(e.key === "]" ? 1 : -1);
      }
      // Cmd/Ctrl + 1..9  — jump to the Nth tab in the focused pane (9 = last)
      else if (e.key >= "1" && e.key <= "9") {
        claim();
        selectTabByIndex(Number(e.key));
      }
      // Cmd/Ctrl + +/-/0  — terminal font size
      else if (e.key === "=" || e.key === "+") {
        claim();
        bumpFontSize(1);
      } else if (e.key === "-" || e.key === "_") {
        claim();
        bumpFontSize(-1);
      } else if (e.key === "0") {
        claim();
        bumpFontSize(0);
      }
    },
    true,
  );
}

async function boot() {
  await loadConfig();
  applyTerminalTheme();
  try {
    homeDir = await invoke<string>("home_dir");
  } catch {
    homeDir = "";
  }
  try {
    shellPath = await invoke<string>("login_shell");
  } catch {
    shellPath = "";
  }
  mgr = new SessionManager(config.settings);
  mgr.onAttentionChange = updateSidebarBadges;
  mgr.onToast = showToast;
  mgr.onFocusAgent = (id) => {
    config.columns.forEach((col, ci) =>
      col.panes.forEach((p, pi) => {
        if (p.agentIds.includes(id)) focusedPane = { ci, pi };
      }),
    );
  };
  const startup = config.settings.startupLayout;
  if (startup !== "last" && PRESETS[startup]) {
    applyPreset(PRESETS[startup]); // calls render()
  } else {
    render();
  }
  installKeys();
  setInterval(updateSidebarBadges, 1500);
}

void boot();
