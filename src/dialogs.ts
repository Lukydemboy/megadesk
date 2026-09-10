import {
  type AgentDef,
  type Pane,
  type StartupLayout,
  type TerminalTheme,
  DEFAULT_TERM_FONT,
  uid,
} from "./types";
import { applyTerminalTheme, config, homeDir, mgr, saveConfig } from "./store";
import { el, field, makeDialog, pathField, select } from "./dom";
import { paneCwd } from "./layout";
import {
  addAgentTab,
  assignAgentToPane,
  deleteAgent,
  upsertAgent,
} from "./agents";

export function openAgentDialog(existing?: AgentDef, targetPane?: Pane) {
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

export function openSettingsDialog() {
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
