import { createSignal } from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import {
  type Config,
  type Pane,
  type PaneRef,
  type Settings,
  defaultConfig,
} from "./types";
import type { SessionManager } from "../terminal/sessions";

/* ---------- reactive config ---------- */

const [config, setConfig] = createStore<Config>(defaultConfig());
export { config, setConfig };

/** Mutate `config` with a mutable draft, the way the old code mutated it directly. */
export function mutate(recipe: (c: Config) => void) {
  setConfig(produce(recipe));
}

/* ---------- shared runtime state ---------- */

/** The one SessionManager; created during boot, before the first render. */
export let mgr: SessionManager = null as unknown as SessionManager;
export let homeDir = "";
export let shellPath = "";

/** Pane whose terminal was last focused — target for sidebar clicks and tab keys. */
export const [focusedPane, setFocusedPane] = createSignal<PaneRef | null>(null);
/** Pane blown up to fill the grid, or null when the normal split is shown. */
export const [zoomedPane, setZoomedPane] = createSignal<PaneRef | null>(null);

export function setMgr(m: SessionManager) {
  mgr = m;
}
export function setHomeDir(v: string) {
  homeDir = v;
}
export function setShellPath(v: string) {
  shellPath = v;
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
    if (!raw) return;
    const parsed = JSON.parse(raw) as Config;
    const d = defaultConfig();
    const next: Config = { ...d, ...parsed };
    // Keep only settings keys we still recognise, so retired ones (idle
    // timer, sound/notification/badge toggles) don't linger in the file.
    const known = Object.keys(d.settings) as (keyof Settings)[];
    const kept = Object.fromEntries(
      Object.entries(parsed.settings ?? {}).filter(([k]) =>
        known.includes(k as keyof Settings),
      ),
    ) as Partial<Settings>;
    next.settings = { ...d.settings, ...kept };
    if (!next.columns?.length) next.columns = defaultConfig().columns;
    for (const col of next.columns) col.panes = col.panes.map(migratePane);

    // An agent belongs to one pane only. Drop stray duplicates an older
    // build may have left in the saved layout, keeping the first home.
    const placed = new Set<string>();
    for (const col of next.columns)
      for (const p of col.panes) {
        p.agentIds = p.agentIds.filter((id) =>
          placed.has(id) ? false : (placed.add(id), true),
        );
        if (p.activeId && !p.agentIds.includes(p.activeId))
          p.activeId = p.agentIds[0] ?? null;
      }

    setConfig(reconcile(next));
  } catch (e) {
    console.error("load_config failed", e);
  }
}

let saveTimer: number | undefined;
export function saveConfig() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void invoke("save_config", {
      contents: JSON.stringify(unwrap(config), null, 2),
    });
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
  const cur = config.settings.terminalFontSize;
  const next =
    delta === 0 ? 12.5 : Math.max(6, Math.min(40, cur + delta));
  if (next === cur) return;
  setConfig("settings", "terminalFontSize", next);
  saveConfig();
  mgr.applyFont();
}
