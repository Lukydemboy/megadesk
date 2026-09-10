import { createStore, type SetStoreFunction } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { AgentDef, Settings, TerminalTheme } from "../core/types";
import {
  DEFAULT_TERM_FONT,
  DEFAULT_TERM_FONT_SIZE,
  DEFAULT_TERM_THEME,
} from "../core/types";

import type { ITheme } from "@xterm/xterm";

const DARK_THEME: ITheme = {
  background: "#14161b",
  foreground: "#e8e4d8",
  cursor: "#ffd21f",
  selectionBackground: "#ffd21f55",
  black: "#1c1f26",
  brightBlack: "#5c6370",
  red: "#e06c75",
  green: "#98c379",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#abb2bf",
};

const LIGHT_THEME: ITheme = {
  background: "#ffffff",
  foreground: "#1c1f26",
  cursor: "#7a3fb8",
  cursorAccent: "#ffffff",
  selectionBackground: "#c17aff44",
  black: "#1c1f26",
  brightBlack: "#8a8577",
  red: "#c62d24",
  green: "#3f7f3f",
  yellow: "#b07000",
  blue: "#2364b8",
  magenta: "#a233c0",
  cyan: "#1f8a99",
  white: "#3b3f4a",
  brightWhite: "#14161b",
};

export const TERM_THEMES: Record<TerminalTheme, ITheme> = {
  dark: DARK_THEME,
  light: LIGHT_THEME,
};

const themeFor = (settings?: Settings): ITheme =>
  TERM_THEMES[settings?.terminalTheme ?? DEFAULT_TERM_THEME] ?? DARK_THEME;

/** Backslash-escape a path the way a terminal does when you drag a file in. */
function escapePath(p: string): string {
  return p.replace(/[\s"'`\\$&!|;<>()*?\[\]{}#]/g, (c) => "\\" + c);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class Session {
  def: AgentDef;
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  running = false;
  exited = false;
  starting = false;
  attention = false;
  /** Set by SessionManager.ensure; lets a Session publish its own state. */
  manager?: SessionManager;

  /** Mirror running/exited/attention/starting into the manager's reactive store. */
  private touch() {
    this.manager?.sync(this.def.id);
  }

  constructor(def: AgentDef, settings?: Settings) {
    this.def = def;
    this.term = new Terminal({
      fontFamily: settings?.terminalFontFamily || DEFAULT_TERM_FONT,
      fontSize: settings?.terminalFontSize || DEFAULT_TERM_FONT_SIZE,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 10000,
      theme: themeFor(settings),
      allowProposedApi: true,
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault();
        void invoke("open_url", { url: uri }).catch((e) =>
          console.error("open_url failed", uri, e),
        );
      }),
    );
    this.host = document.createElement("div");
    this.host.className = "term-host";
    this.term.open(this.host);
    this.term.onData((d) => {
      if (this.running) void invoke("write_agent", { id: this.def.id, data: d });
    });

    // Shift+Enter → ESC + CR (\x1b\r). xterm normally sends a bare CR for
    // Shift+Enter, identical to Enter, so a chat REPL like Claude Code can't
    // tell them apart and submits. ESC+CR is exactly what Claude Code's
    // `/terminal-setup` binds Shift+Enter to for "insert newline".
    this.term.attachCustomKeyEventHandler((e) => {
      if (
        e.type === "keydown" &&
        e.key === "Enter" &&
        e.shiftKey &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        if (this.running)
          void invoke("write_agent", { id: this.def.id, data: "\x1b\r" });
        return false; // stop xterm from also emitting a bare CR
      }
      return true;
    });

    this.wireFileDrop();
  }

  /**
   * Let the user drop files (images, mostly) straight onto the terminal:
   * the bytes are saved to a cache dir and the resulting path is typed into
   * the pty, the way a native terminal inserts a dragged file's path.
   */
  private wireFileDrop() {
    const hasFiles = (e: DragEvent) =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");

    this.host.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer!.dropEffect = "copy";
      this.host.classList.add("file-drop");
    });
    this.host.addEventListener("dragleave", (e) => {
      if (!this.host.contains(e.relatedTarget as Node))
        this.host.classList.remove("file-drop");
    });
    this.host.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this.host.classList.remove("file-drop");
      const files = Array.from(e.dataTransfer!.files);
      if (files.length) void this.typeDroppedFiles(files);
    });
  }

  private async typeDroppedFiles(files: File[]) {
    const paths: string[] = [];
    for (const f of files) {
      try {
        // Tauri v2 transfers an ArrayBuffer arg as raw bytes -> Rust Vec<u8>.
        paths.push(
          await invoke<string>("save_dropped_file", {
            name: f.name || "dropped",
            data: await f.arrayBuffer(),
          }),
        );
      } catch (err) {
        console.error("save_dropped_file failed", err);
      }
    }
    if (!paths.length || !this.running) return;
    const text = paths.map(escapePath).join(" ") + " ";
    await invoke("write_agent", { id: this.def.id, data: text });
    this.term.focus();
  }

  markOutput(mgr: SessionManager) {
    if (!this.exited && !this.attention) return;
    this.exited = false;
    this.attention = false;
    mgr.sync(this.def.id);
  }

  clearAttention(mgr: SessionManager) {
    if (this.attention) {
      this.attention = false;
      mgr.sync(this.def.id);
    }
  }

  /** Swap the terminal's colour scheme live. */
  applyTheme(settings: Settings) {
    this.term.options.theme = themeFor(settings);
  }

  /** Push the current font settings into xterm and reflow. */
  applyFont(settings: Settings) {
    this.term.options.fontFamily =
      settings.terminalFontFamily || DEFAULT_TERM_FONT;
    this.term.options.fontSize =
      settings.terminalFontSize || DEFAULT_TERM_FONT_SIZE;
    this.fitAndResize();
  }

  fitAndResize() {
    if (!this.host.isConnected || this.host.clientWidth === 0) return;
    try {
      this.fit.fit();
    } catch {
      return;
    }
    if (this.running) {
      void invoke("resize_agent", {
        id: this.def.id,
        cols: this.term.cols,
        rows: this.term.rows,
      });
    }
  }

  /**
   * Bring the pane's terminal live. If the backend still has this agent
   * running (the app outlived a closed window), reattach to it and repaint
   * instead of spawning a second process.
   */
  async start(mgr: SessionManager) {
    if (this.running || this.exited || this.starting) return;
    this.starting = true;
    mgr.sync(this.def.id);
    try {
      const alive = await invoke<boolean>("agent_running", { id: this.def.id });
      if (!alive) {
        await this.spawn();
        return;
      }

      let snap: string | null = null;
      try {
        snap = await invoke<string | null>("agent_snapshot", { id: this.def.id });
      } catch {
        /* no snapshot: the resize nudge below still forces a repaint */
      }
      this.term.reset();
      if (snap) this.term.write(b64ToBytes(snap));
      this.running = true;
      this.exited = false;
      mgr.sync(this.def.id);

      // Match the pty to the current pane size and force the child to
      // redraw: SIGWINCH only fires on a real size change, so nudge the
      // row count down and back.
      if (this.host.isConnected && this.host.clientWidth > 0) {
        try {
          this.fit.fit();
        } catch {
          /* ignore */
        }
      }
      const { cols, rows } = this.term;
      await invoke("resize_agent", {
        id: this.def.id,
        cols,
        rows: Math.max(1, rows - 1),
      });
      await invoke("resize_agent", { id: this.def.id, cols, rows });
    } finally {
      this.starting = false;
      mgr.sync(this.def.id);
    }
  }

  async spawn() {
    if (this.running) return;
    this.fit.fit();
    this.exited = false;
    await invoke("spawn_agent", {
      opts: {
        id: this.def.id,
        command: this.def.command,
        args: this.def.args,
        cwd: this.def.cwd || null,
        cols: this.term.cols || 80,
        rows: this.term.rows || 24,
      },
    });
    this.running = true;
    this.touch();
  }

  async kill() {
    if (!this.running) return;
    await invoke("kill_agent", { id: this.def.id });
  }

  async restart(mgr: SessionManager) {
    if (this.running) {
      await this.kill();
      await new Promise((r) => setTimeout(r, 250));
    }
    this.term.reset();
    this.running = false;
    this.exited = false;
    await this.spawn();
    mgr.sync(this.def.id);
  }

  dispose() {
    void this.kill();
    this.term.dispose();
  }
}

export interface SessionState {
  running: boolean;
  exited: boolean;
  attention: boolean;
  starting: boolean;
}

export class SessionManager {
  sessions = new Map<string, Session>();
  settings: Settings;
  activeAgentId: string | null = null;
  visibleIds = new Set<string>();

  /** Reactive mirror of each Session's runtime flags, keyed by agent id. */
  state: Record<string, SessionState>;
  private setState: SetStoreFunction<Record<string, SessionState>>;

  onFocusAgent: (id: string) => void = () => {};
  onToast: (message: string, kind?: "info" | "warn") => void = () => {};

  constructor(settings: Settings) {
    this.settings = settings;
    const [state, setState] = createStore<Record<string, SessionState>>({});
    this.state = state;
    this.setState = setState;
    window.addEventListener("focus", () => {
      if (this.activeAgentId)
        this.sessions.get(this.activeAgentId)?.clearAttention(this);
    });

    void listen<{ id: string; b64: string }>("agent:output", (e) => {
      const s = this.sessions.get(e.payload.id);
      if (!s) return;
      s.term.write(b64ToBytes(e.payload.b64));
      s.markOutput(this);
    });
    void listen<{ id: string; code: number | null }>("agent:exit", (e) => {
      const s = this.sessions.get(e.payload.id);
      if (!s) return;
      s.running = false;
      s.exited = true;
      s.term.write(
        `\r\n\x1b[90m— process exited${
          e.payload.code != null ? ` (code ${e.payload.code})` : ""
        } —\x1b[0m\r\n`,
      );
      s.attention = true;
      this.sync(e.payload.id);
      this.onToast(`${s.def.name} — process exited`, "warn");
    });
  }

  /** Publish one session's runtime flags into the reactive `state` store. */
  sync(id: string) {
    const s = this.sessions.get(id);
    if (!s) {
      this.setState(id, undefined!);
      return;
    }
    this.setState(id, {
      running: s.running,
      exited: s.exited,
      attention: s.attention,
      starting: s.starting,
    });
  }

  ensure(def: AgentDef): Session {
    let s = this.sessions.get(def.id);
    if (!s) {
      s = new Session(def, this.settings);
      s.manager = this;
      s.term.textarea?.addEventListener("focus", () => {
        this.activeAgentId = def.id;
        s!.clearAttention(this);
        this.onFocusAgent(def.id);
      });
      this.sessions.set(def.id, s);
      this.sync(def.id);
    } else {
      s.def = def;
    }
    return s;
  }

  remove(id: string) {
    this.sessions.get(id)?.dispose();
    this.sessions.delete(id);
    this.sync(id);
  }

  /** Re-apply terminal font settings to every live session. */
  applyFont() {
    for (const s of this.sessions.values()) s.applyFont(this.settings);
  }

  /** Re-apply the terminal colour scheme to every live session. */
  applyTheme() {
    for (const s of this.sessions.values()) s.applyTheme(this.settings);
  }
}
