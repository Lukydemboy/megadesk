import { invoke } from "@tauri-apps/api/core";
import {
  type Config,
  type Pane,
  type PaneRef,
  type Settings,
  defaultConfig,
} from "./types";
import type { SessionManager } from "../terminal/sessions";

/* ---------- shared runtime state ---------- */

export let config: Config = defaultConfig();
/** The one SessionManager; created during boot, before the first render. */
export let mgr: SessionManager = null as unknown as SessionManager;
export let homeDir = "";
export let shellPath = "";
/** Pane whose terminal was last focused — target for sidebar clicks and tab keys. */
export let focusedPane: PaneRef | null = null;
/** Pane blown up to fill the grid, or null when the normal split is shown. */
export let zoomedPane: PaneRef | null = null;

export function setMgr(m: SessionManager) {
  mgr = m;
}
export function setHomeDir(v: string) {
  homeDir = v;
}
export function setShellPath(v: string) {
  shellPath = v;
}
export function setFocusedPane(p: PaneRef | null) {
  focusedPane = p;
}
export function setZoomedPane(p: PaneRef | null) {
  zoomedPane = p;
}

/* ---------- render bus ---------- */

let renderer: () => void = () => {};
/** Wire the view's render function in once, from main. */
export function setRenderer(fn: () => void) {
  renderer = fn;
}
/** Repaint the whole app. Feature modules call this after mutating `config`. */
export function render() {
  renderer();
}

/* ---------- persistence ---------- */

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

export async function loadConfig() {
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
export function saveConfig() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void invoke("save_config", { contents: JSON.stringify(config, null, 2) });
  }, 300);
}

/* ---------- live settings ---------- */

/**
 * Push the chosen terminal colour scheme to xterm and to the pane chrome
 * behind it (the `--term-bg` the pane borders sit on).
 */
export function applyTerminalTheme() {
  const light = config.settings.terminalTheme === "light";
  document.body.classList.toggle("term-light", light);
  mgr?.applyTheme();
}

/** Nudge the terminal font size and re-apply it live. delta 0 resets. */
export function bumpFontSize(delta: number) {
  const s = config.settings;
  const next =
    delta === 0 ? 12.5 : Math.max(6, Math.min(40, s.terminalFontSize + delta));
  if (next === s.terminalFontSize) return;
  s.terminalFontSize = next;
  saveConfig();
  mgr.applyFont();
}
