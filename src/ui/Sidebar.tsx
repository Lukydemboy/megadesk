import { For, Show } from "solid-js";
import { config, mgr } from "../core/store";
import { assignAgentToPane } from "../core/agents";
import { openAgentDialog } from "./overlays";
import { DND_TYPE } from "./dnd";

export function Sidebar() {
  return (
    <div class="sidebar">
      <div class="side-title">Agents</div>
      <Show when={config.agents.length === 0}>
        <div class="side-empty">No agents yet. Add one to get started.</div>
      </Show>
      <For each={config.agents}>
        {(def) => {
          const st = () => mgr.state[def.id];
          return (
            <div
              class="agent-row"
              classList={{ attn: !!st()?.attention }}
              draggable={true}
              onDragStart={(e) => {
                e.dataTransfer?.setData(DND_TYPE, def.id);
                e.dataTransfer?.setData("text/plain", def.name);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
                e.currentTarget.classList.add("dragging");
              }}
              onDragEnd={(e) => e.currentTarget.classList.remove("dragging")}
              onClick={() => assignAgentToPane(def.id)}
            >
              <span
                class="status-dot"
                classList={{
                  on: !!st()?.running,
                  exited: !!st()?.exited && !st()?.running,
                }}
              />
              <div class="agent-name">{def.name}</div>
              <span class="attn-badge">!</span>
              <button
                class="row-edit"
                title="Edit agent"
                onClick={(e) => {
                  e.stopPropagation();
                  openAgentDialog(def);
                }}
              >
                ✎
              </button>
            </div>
          );
        }}
      </For>
    </div>
  );
}
