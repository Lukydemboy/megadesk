import { Show } from "solid-js";
import {
  type StartupLayout,
  type TerminalTheme,
  DEFAULT_TERM_FONT,
} from "../core/types";
import {
  applyTerminalTheme,
  config,
  homeDir,
  mgr,
  saveConfig,
  setConfig,
} from "../core/store";
import { settingsOpen, setSettingsOpen } from "./overlays";
import { Dialog, PathField, SelectField, TextField } from "./controls";

export function SettingsDialog() {
  const close = () => setSettingsOpen(false);
  const s = () => config.settings;

  return (
    <Show when={settingsOpen()}>
      <Dialog
        title="Settings"
        onClose={close}
        footer={
          <button class="primary-btn" onClick={close}>
            Done
          </button>
        }
      >
        <div class="dialog-note">
          The sidebar highlights an agent whose process has exited, with a toast
          in the corner.
        </div>

        <SelectField
          label="Startup layout"
          options={[
            { value: "last", label: "Restore last layout" },
            { value: "1", label: "Single pane" },
            { value: "2", label: "Side by side" },
            { value: "3", label: "1 + 2" },
            { value: "4", label: "2 × 2" },
          ]}
          value={s().startupLayout}
          onChange={(v) => {
            setConfig("settings", "startupLayout", v as StartupLayout);
            saveConfig();
          }}
        />

        <PathField
          label="Default working directory"
          value={s().defaultCwd}
          placeholder={homeDir}
          onChange={(v) => {
            setConfig("settings", "defaultCwd", v.trim());
            saveConfig();
          }}
        />

        <SelectField
          label="Terminal theme"
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
          ]}
          value={s().terminalTheme}
          onChange={(v) => {
            setConfig("settings", "terminalTheme", v as TerminalTheme);
            saveConfig();
            applyTerminalTheme();
          }}
        />

        <TextField
          label="Terminal font"
          value={s().terminalFontFamily}
          placeholder={DEFAULT_TERM_FONT}
          onInput={(v) => {
            setConfig("settings", "terminalFontFamily", v.trim() || DEFAULT_TERM_FONT);
            saveConfig();
            mgr.applyFont();
          }}
        />

        <TextField
          label="Terminal font size (px)"
          type="number"
          step="0.5"
          value={String(s().terminalFontSize)}
          onInput={(v) => {
            const n = Number(v);
            if (n >= 6 && n <= 40) {
              setConfig("settings", "terminalFontSize", n);
              saveConfig();
              mgr.applyFont();
            }
          }}
        />
      </Dialog>
    </Show>
  );
}
