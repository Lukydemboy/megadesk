import { For } from "solid-js";
import { PRESETS, applyPreset } from "../core/layout";
import { openAgentDialog, openSettingsDialog } from "./overlays";
import { Icon } from "./icons";

export function Topbar() {
  return (
    <div class="topbar">
      <div class="brand">Megadesk</div>
      <div class="presets">
        <For each={Object.keys(PRESETS)}>
          {(key) => (
            <button
              class="preset-btn"
              title={`${key}-pane layout`}
              onClick={() => applyPreset(PRESETS[key])}
            >
              {key}
            </button>
          )}
        </For>
      </div>
      <div class="spacer" />
      <button class="ghost-btn" onClick={() => openAgentDialog()}>
        + Agent
      </button>
      <button
        class="ghost-btn icon-btn"
        title="Settings"
        onClick={() => openSettingsDialog()}
      >
        <Icon name="gear" />
      </button>
    </div>
  );
}
