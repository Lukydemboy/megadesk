import { createStore, type SetStoreFunction } from "solid-js/store";
import { render } from "solid-js/web";
import { invoke } from "@tauri-apps/api/core";
import {
  type AgentDef,
  type ChatEffort,
  DEFAULT_CHAT_EFFORT,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_PERMISSION_MODE,
  DEFAULT_TERM_FONT,
  type Settings,
} from "../core/types";
import type { AgentSession, SessionManager } from "../terminal/sessions";
import { type ChatState, applyEvent, emptyChat, noteItem } from "./events";
import { ChatView } from "./ChatView";

/** An image attached to the next message. */
export interface Attachment {
  name: string;
  mediaType: string;
  /** base64 without the data: prefix */
  data: string;
}

/**
 * A chat-mode agent. The Claude Code process is started lazily, on the first
 * message, so restored chat tabs cost nothing until they're used; a saved
 * session id lets it pick the conversation back up with `--resume`.
 */
export class ChatSession implements AgentSession {
  readonly mode = "chat";
  def: AgentDef;
  host: HTMLDivElement;
  running = false;
  exited = false;
  starting = false;
  attention = false;
  manager?: SessionManager;

  state: ChatState;
  private setState: SetStoreFunction<ChatState>;
  /** The composer textarea, set by ChatView. */
  input?: HTMLTextAreaElement;
  private loaded = false;
  private spawning?: Promise<void>;
  /** Spawn flags changed; restart (resuming) before the next message. */
  private stale = false;
  private disposeView: () => void;

  constructor(def: AgentDef, settings?: Settings) {
    this.def = def;
    const [state, setState] = createStore<ChatState>(emptyChat());
    this.state = state;
    this.setState = setState;
    this.host = document.createElement("div");
    this.host.className = "chat-host";
    if (settings) this.applyFont(settings);
    this.disposeView = render(() => <ChatView session={this} />, this.host);
  }

  private touch() {
    this.manager?.sync(this.def.id);
  }

  /** Rebuild the chat from the backend (if still running) or the saved session. */
  async start(mgr: SessionManager) {
    if (this.loaded) return;
    this.loaded = true;
    this.starting = true;
    mgr.sync(this.def.id);
    try {
      const alive = await invoke<boolean>("chat_running", { id: this.def.id });
      if (alive) {
        const log = await invoke<string[] | null>("chat_log", { id: this.def.id });
        for (const line of log ?? []) this.apply(line);
        this.running = true;
      } else if (this.def.sessionId) {
        const lines = await invoke<string[]>("chat_history", {
          sessionId: this.def.sessionId,
        });
        for (const line of lines) this.apply(line);
        this.setState({ busy: false, sessionId: this.def.sessionId });
      }
    } catch (err) {
      this.setState("items", (items) => [...items, noteItem(String(err), "error")]);
    } finally {
      this.starting = false;
      mgr.sync(this.def.id);
    }
  }

  private ensureProcess(): Promise<void> {
    if (this.running) return Promise.resolve();
    this.spawning ??= (async () => {
      try {
        await invoke("spawn_chat", {
          opts: {
            id: this.def.id,
            command: this.def.command || "claude",
            args: this.def.args,
            cwd: this.def.cwd || null,
            permission_mode: this.def.permissionMode ?? DEFAULT_CHAT_PERMISSION_MODE,
            resume: this.state.sessionId ?? this.def.sessionId ?? null,
            model: this.def.model ?? DEFAULT_CHAT_MODEL,
            effort: this.def.effort ?? DEFAULT_CHAT_EFFORT,
          },
        });
        this.running = true;
        this.exited = false;
        this.stale = false;
        this.touch();
      } finally {
        this.spawning = undefined;
      }
    })();
    return this.spawning;
  }

  /** Send a user message, starting Claude Code first if needed. */
  async send(text: string, attachments: Attachment[] = []) {
    const content = attachments.length
      ? [
          ...attachments.map((a) => ({
            type: "image",
            source: { type: "base64", media_type: a.mediaType, data: a.data },
          })),
          ...(text ? [{ type: "text", text }] : []),
        ]
      : text;
    try {
      // Never cut a running turn short; a queued message keeps the old flags.
      if (this.stale && this.running && !this.state.busy) await this.stop();
      await this.ensureProcess();
      await invoke("send_chat", { id: this.def.id, content });
    } catch (err) {
      this.setState("items", (items) => [
        ...items,
        noteItem(`Couldn't start ${this.def.command || "claude"}: ${err}`, "error"),
      ]);
    }
  }

  /** Switch model; a running chat switches in place from the next request. */
  async setModel(model: string) {
    this.manager?.onChatPrefs(this.def.id, { model });
    if (!this.running) return;
    try {
      await invoke("control_chat", {
        id: this.def.id,
        request: { subtype: "set_model", model },
      });
    } catch {
      this.stale = true;
    }
  }

  /**
   * Change effort. Claude Code can't switch every level at runtime, so a
   * running chat restarts with `--resume` before the next message.
   */
  setEffort(effort: ChatEffort) {
    this.manager?.onChatPrefs(this.def.id, { effort });
    if (this.running) this.stale = true;
  }

  /** Stop the current turn but keep the conversation going. */
  async interrupt() {
    if (this.running) await invoke("interrupt_chat", { id: this.def.id });
  }

  private apply(line: string) {
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    applyEvent(this.setState, ev);
    return ev;
  }

  onLine(line: string) {
    const ev = this.apply(line);
    if (ev?.type === "system" && ev.subtype === "init" && ev.session_id) {
      if (ev.session_id !== this.def.sessionId)
        this.manager?.onChatSessionId(this.def.id, ev.session_id);
    }
    if (ev?.type === "result" && !this.host.contains(document.activeElement)) {
      this.attention = true;
      this.touch();
    }
  }

  onStderr(text: string) {
    this.setState("items", (items) => [...items, noteItem(text, "error")]);
  }

  onExit(code: number | null) {
    this.running = false;
    if (this.state.busy) {
      this.setState("busy", false);
      this.setState("draft", "");
      this.setState("items", (items) => [
        ...items,
        noteItem(`Claude exited${code != null ? ` (code ${code})` : ""}`, "error"),
      ]);
      this.attention = true;
      this.manager?.onToast(`${this.def.name} — process exited`, "warn");
    }
    this.touch();
  }

  async kill() {
    if (this.running) await invoke("kill_chat", { id: this.def.id });
  }

  /** Kill the process and wait (briefly) for it to exit. */
  private async stop() {
    await this.kill();
    for (let i = 0; i < 20 && this.running; i++)
      await new Promise((r) => setTimeout(r, 100));
  }

  /** Start a fresh conversation. */
  async restart(mgr: SessionManager) {
    await this.stop();
    this.setState(emptyChat());
    this.attention = false;
    mgr.onChatSessionId(this.def.id, undefined);
    mgr.sync(this.def.id);
    this.focus();
  }

  focus() {
    this.input?.focus();
  }

  clearAttention(mgr: SessionManager) {
    if (this.attention) {
      this.attention = false;
      mgr.sync(this.def.id);
    }
  }

  fitAndResize() {}

  /** Code blocks use the terminal font. */
  applyFont(settings: Settings) {
    this.host.style.setProperty(
      "--chat-mono",
      settings.terminalFontFamily || DEFAULT_TERM_FONT,
    );
  }

  /** The chat follows the UI theme, not the terminal one. */
  applyTheme() {}

  dispose() {
    void this.kill();
    this.disposeView();
  }
}
