import { Show } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { type AgentDef, uid } from "../core/types";
import { config, homeDir } from "../core/store";
import { paneCwd } from "../core/layout";
import {
  addAgentTab,
  assignAgentToPane,
  deleteAgent,
  upsertAgent,
} from "../core/agents";
import { type AgentDialogState, agentDialog, closeAgentDialog } from "./overlays";
import { Dialog, PathField, TextField } from "./controls";

export function AgentDialog() {
  return (
    <Show when={agentDialog()} keyed>
      {(state) => <AgentDialogForm state={state} />}
    </Show>
  );
}

function AgentDialogForm(props: { state: AgentDialogState }) {
  const existing = props.state.existing;
  const editing = !!existing;
  const target = props.state.targetPane;

  const [def, setDef] = createStore<AgentDef>(
    existing
      ? { ...existing, args: [...existing.args] }
      : {
          id: uid(),
          name: "",
          command: "claude",
          args: [],
          cwd: target
            ? paneCwd(config.columns[target.ci]?.panes[target.pi])
            : config.settings.defaultCwd || homeDir,
        },
  );

  const save = () => {
    const finalDef: AgentDef = {
      ...unwrap(def),
      name: def.name.trim() || def.command || "agent",
      args: [...def.args],
    };
    upsertAgent(finalDef);
    if (!editing) {
      if (target) addAgentTab(target, finalDef.id);
      else assignAgentToPane(finalDef.id);
    }
    closeAgentDialog();
  };

  return (
    <Dialog
      title={editing ? "Edit agent" : "New agent"}
      onClose={closeAgentDialog}
      footer={
        <>
          <Show when={editing}>
            <button
              class="danger-btn"
              onClick={() => {
                deleteAgent(def.id);
                closeAgentDialog();
              }}
            >
              Delete
            </button>
          </Show>
          <button class="primary-btn" onClick={save}>
            {editing ? "Save" : "Add"}
          </button>
        </>
      }
    >
      <TextField
        label="Name"
        value={def.name}
        placeholder="e.g. Backend agent"
        onInput={(v) => setDef("name", v)}
      />
      <TextField
        label="Command"
        value={def.command}
        placeholder="claude"
        onInput={(v) => setDef("command", v)}
      />
      <TextField
        label="Arguments (space-separated)"
        value={def.args.join(" ")}
        placeholder="--model sonnet"
        onInput={(v) => setDef("args", v.trim() ? v.trim().split(/\s+/) : [])}
      />
      <PathField
        label="Working directory"
        value={def.cwd}
        placeholder={config.settings.defaultCwd || homeDir}
        onChange={(v) => setDef("cwd", v)}
      />
    </Dialog>
  );
}
