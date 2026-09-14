import { For, Show } from "solid-js";
import type { PaneRef } from "../core/types";
import { config, mgr } from "../core/store";
import { locateAgent, paneLabel } from "../core/layout";
import { addAgentTab, newShellInPane } from "../core/agents";
import {
  agentPicker,
  closeAgentPicker,
  openAgentDialog,
} from "./overlays";
import { Dialog } from "./controls";

export function AgentPicker() {
  return (
    <Show when={agentPicker()} keyed>
      {(target) => <AgentPickerBody target={target} />}
    </Show>
  );
}

function AgentPickerBody(props: { target: PaneRef }) {
  const choose = (id: string) => {
    addAgentTab(props.target, id);
    closeAgentPicker();
  };

  return (
    <Dialog
      title="Add agent to pane"
      onClose={closeAgentPicker}
      footer={
        <>
          <button
            class="primary-btn"
            onClick={() => {
              newShellInPane(props.target);
              closeAgentPicker();
            }}
          >
            + Shell here
          </button>
          <button
            class="primary-btn"
            onClick={() => {
              closeAgentPicker();
              openAgentDialog(undefined, props.target);
            }}
          >
            + New agent…
          </button>
        </>
      }
    >
      <Show
        when={config.agents.length}
        fallback={<div class="dialog-note">No agents yet — create one below.</div>}
      >
        <div class="palette-list">
          <For each={config.agents}>
            {(def) => {
              const st = () => mgr.state[def.id];
              return (
                <div class="palette-row" onClick={() => choose(def.id)}>
                  <span
                    class="status-dot"
                    classList={{
                      on: !!st()?.running,
                      exited: !!st()?.exited && !st()?.running,
                    }}
                  />
                  <span class="palette-name">{def.name}</span>
                  <span class="palette-where">{paneLabel(locateAgent(def.id))}</span>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </Dialog>
  );
}
