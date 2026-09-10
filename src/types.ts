export interface AgentDef {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  /**
   * "shell" marks a plain terminal spawned via the pane's "+" menu. It is
   * owned by its tab: closing the tab deletes it. "agent" (the default) is a
   * user-defined entry that lives in the sidebar and outlives its panes.
   */
  kind?: "agent" | "shell";
}

export interface Pane {
  /** Terminals living in this pane, shown as tabs. */
  agentIds: string[];
  /** Which tab is currently visible. */
  activeId: string | null;
  frac: number;
}

export interface Column {
  frac: number;
  panes: Pane[];
}

export type StartupLayout = "last" | "1" | "2" | "3" | "4";

export type TerminalTheme = "dark" | "light";

export interface Settings {
  /** Pane layout to apply on launch; "last" keeps the saved layout. */
  startupLayout: StartupLayout;
  /** Working directory prefilled for new agents (falls back to home). */
  defaultCwd: string;
  /** CSS font-family stack for the terminals. */
  terminalFontFamily: string;
  /** Terminal font size in px. */
  terminalFontSize: number;
  /** Colour scheme for the terminals (and the pane chrome behind them). */
  terminalTheme: TerminalTheme;
}

export const DEFAULT_TERM_THEME: TerminalTheme = "dark";

export const DEFAULT_TERM_FONT =
  '"MonoLisa", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
export const DEFAULT_TERM_FONT_SIZE = 12.5;

export interface Config {
  version: 1;
  agents: AgentDef[];
  columns: Column[];
  settings: Settings;
}

export function defaultConfig(): Config {
  return {
    version: 1,
    agents: [],
    columns: [{ frac: 1, panes: [{ agentIds: [], activeId: null, frac: 1 }] }],
    settings: {
      startupLayout: "last",
      defaultCwd: "",
      terminalFontFamily: DEFAULT_TERM_FONT,
      terminalFontSize: DEFAULT_TERM_FONT_SIZE,
      terminalTheme: DEFAULT_TERM_THEME,
    },
  };
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
