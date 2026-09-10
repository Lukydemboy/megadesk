import "@xterm/xterm/css/xterm.css";
import "./style.css";
import { render } from "solid-js/web";
import { invoke } from "@tauri-apps/api/core";
import { SessionManager } from "./terminal/sessions";
import {
  applyTerminalTheme,
  config,
  loadConfig,
  setFocusedPane,
  setHomeDir,
  setMgr,
  setShellPath,
} from "./core/store";
import { PRESETS, applyPreset } from "./core/layout";
import { App } from "./ui/app";
import { installKeys } from "./ui/keys";
import { showToast } from "./ui/Toasts";

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
  if (startup !== "last" && PRESETS[startup]) applyPreset(PRESETS[startup]);

  render(() => <App />, document.getElementById("app")!);
  installKeys();
}

void boot();
