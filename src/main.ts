import "@xterm/xterm/css/xterm.css";
import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { SessionManager } from "./sessions";
import {
  applyTerminalTheme,
  config,
  loadConfig,
  setFocusedPane,
  setHomeDir,
  setMgr,
  setRenderer,
  setShellPath,
} from "./store";
import { PRESETS, applyPreset } from "./layout";
import { render, updateSidebarBadges } from "./view";
import { installKeys } from "./keys";
import { showToast } from "./dom";

setRenderer(render);

async function boot() {
  await loadConfig();
  applyTerminalTheme();
  try {
    setHomeDir(await invoke<string>("home_dir"));
  } catch {
    setHomeDir("");
  }
  try {
    setShellPath(await invoke<string>("login_shell"));
  } catch {
    setShellPath("");
  }

  const m = new SessionManager(config.settings);
  m.onAttentionChange = updateSidebarBadges;
  m.onToast = showToast;
  m.onFocusAgent = (id) => {
    config.columns.forEach((col, ci) =>
      col.panes.forEach((p, pi) => {
        if (p.agentIds.includes(id)) setFocusedPane({ ci, pi });
      }),
    );
  };
  setMgr(m);

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
