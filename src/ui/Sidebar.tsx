import { For, Show, createMemo } from "solid-js";
import { config, mgr } from "../core/store";
import { assignAgentToPane, disposeShell, revealAgent } from "../core/agents";
import { openAgentDialog } from "./overlays";
import { DND_TYPE } from "./dnd";

export function Sidebar() {
  const agents = createMemo(() => config.agents.filter((a) => a.kind !== "shell"));
  const shells = createMemo(() => config.agents.filter((a) => a.kind === "shell"));
  return (
    <div class="sidebar">
      <div class="side-title">Agents</div>
      <Show when={agents().length === 0}>
        <div class="side-empty">No agents yet. Add one to get started.</div>
      </Show>
      <For each={agents()}>
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
      <Show when={shells().length > 0}>
        <div class="side-title side-title-gap">Shells</div>
        <For each={shells()}>
          {(def) => {
            const st = () => mgr.state[def.id];
            return (
              <div class="agent-row" onClick={() => revealAgent(def.id)}>
                <span class="status-dot" classList={{ on: !!st()?.running }} />
                <div class="agent-name">{def.name}</div>
                <button
                  class="row-edit"
                  title="Close shell"
                  onClick={(e) => {
                    e.stopPropagation();
                    disposeShell(def.id);
                  }}
                >
                  ×
                </button>
              </div>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
