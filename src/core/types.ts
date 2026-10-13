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
  /**
   * "terminal" (the default) runs the command in a PTY. "chat" drives a
   * Claude Code compatible CLI over its stream-json protocol and renders
   * the conversation as chat messages.
   */
  mode?: AgentMode;
  /** Chat mode: Claude Code `--permission-mode` for the session. */
  permissionMode?: ChatPermissionMode;
  /** Chat mode: the Claude Code session to resume on the next launch. */
  sessionId?: string;
}

export type AgentMode = "terminal" | "chat";

export type ChatPermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "bypassPermissions";

export const DEFAULT_CHAT_PERMISSION_MODE: ChatPermissionMode = "acceptEdits";

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

/** Address of a pane in the grid: column index + pane index within it. */
export interface PaneRef {
  ci: number;
  pi: number;
}

export type StartupLayout = "last" | "1" | "2" | "3" | "4";

export type TerminalTheme = "dark" | "light";

/** Colour scheme for the app chrome (topbar, sidebar, panes, dialogs). */
export type UiTheme = "system" | "light" | "dark";

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
  /** Colour scheme for the rest of the UI; "system" follows the OS. */
  uiTheme: UiTheme;
}

export const DEFAULT_TERM_THEME: TerminalTheme = "dark";
export const DEFAULT_UI_THEME: UiTheme = "system";

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
      uiTheme: DEFAULT_UI_THEME,
    },
  };
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
