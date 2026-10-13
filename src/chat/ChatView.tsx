import {
  For,
  Index,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import type { Attachment, ChatSession } from "./ChatSession";
import type { ChatItem, ToolItem } from "./events";
import {
  CHAT_EFFORTS,
  CHAT_MODELS,
  type ChatEffort,
  DEFAULT_CHAT_EFFORT,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_PERMISSION_MODE,
} from "../core/types";
import { Icon, type IconName } from "../ui/icons";

/*
 * Layout and visual language follow T3 Code's chat: a centred reading
 * column, user turns as soft right-aligned bubbles, assistant text unboxed,
 * tool calls as a compact "work log" (consecutive calls folded into one
 * summary row), a "Worked for …" divider closing each turn, and a rounded
 * floating composer with a round send button.
 */

const marked = new Marked({ gfm: true, async: false });

/** Model output is untrusted (it echoes files and web pages): sanitize it. */
function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text) as string);
}

function Markdown(props: { text: string }) {
  return <div class="md" innerHTML={renderMarkdown(props.text)} />;
}

const MAX_RESULT = 8000;
const clip = (s: string, n = MAX_RESULT) =>
  s.length > n ? s.slice(0, n) + `\n… (${s.length - n} more characters)` : s;

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/* ---------- work log: tool calls and thinking ---------- */

type ThinkingItem = Extract<ChatItem, { kind: "thinking" }>;
type WorkEntry = ToolItem | ThinkingItem;

type Row =
  | { kind: "item"; item: Exclude<ChatItem, WorkEntry> }
  | { kind: "work"; entries: WorkEntry[] };

/** Fold runs of consecutive tool calls / thinking into one work-log row. */
function toRows(items: ChatItem[]): Row[] {
  const rows: Row[] = [];
  for (const it of items) {
    if (it.kind === "tool" || it.kind === "thinking") {
      const last = rows[rows.length - 1];
      if (last?.kind === "work") last.entries.push(it);
      else rows.push({ kind: "work", entries: [it] });
    } else rows.push({ kind: "item", item: it });
  }
  return rows;
}

interface ToolLook {
  icon: IconName;
  /** [finished, in progress] */
  verb: [string, string];
  /** Bucket for the folded group summary. */
  group: keyof typeof GROUP_WORDS | "other";
}

const GROUP_WORDS = {
  command: ["Ran", "command", "commands"],
  read: ["read", "file", "files"],
  edit: ["edited", "file", "files"],
  search: ["searched", "time", "times"],
  web: ["browsed", "page", "pages"],
  agent: ["ran", "agent", "agents"],
  todo: ["updated", "todo list", "todo lists"],
  thought: ["thought", "time", "times"],
} as const;

function toolLook(name: string): ToolLook {
  switch (name) {
    case "Bash":
      return { icon: "terminal", verb: ["Ran", "Running"], group: "command" };
    case "Read":
      return { icon: "file", verb: ["Read", "Reading"], group: "read" };
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return { icon: "pencil", verb: ["Edited", "Editing"], group: "edit" };
    case "Write":
      return { icon: "pencil", verb: ["Wrote", "Writing"], group: "edit" };
    case "Grep":
      return { icon: "search", verb: ["Searched for", "Searching for"], group: "search" };
    case "Glob":
      return { icon: "search", verb: ["Listed", "Listing"], group: "search" };
    case "WebFetch":
      return { icon: "globe", verb: ["Fetched", "Fetching"], group: "web" };
    case "WebSearch":
      return { icon: "globe", verb: ["Searched the web for", "Searching the web for"], group: "web" };
    case "Task":
    case "Agent":
      return { icon: "bot", verb: ["Ran agent", "Running agent"], group: "agent" };
    case "TodoWrite":
      return { icon: "list", verb: ["Updated todos", "Updating todos"], group: "todo" };
    default:
      return { icon: "wrench", verb: [name, name], group: "other" };
  }
}

/** What a tool call acted on: a command, a path, a pattern, a URL… */
function toolTarget(t: ToolItem, cwd: string): string {
  const i = t.input;
  const rel = (p?: string) =>
    p && cwd && p.startsWith(cwd + "/") ? p.slice(cwd.length + 1) : (p ?? "");
  switch (t.name) {
    case "Bash":
      return (i.command ?? "").split("\n")[0];
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
      return rel(i.file_path);
    case "NotebookEdit":
      return rel(i.notebook_path);
    case "Grep":
      return `${i.pattern ?? ""}${i.path ? ` in ${rel(i.path)}` : ""}`;
    case "Glob":
      return i.pattern ?? "";
    case "WebFetch":
      return i.url ?? "";
    case "WebSearch":
      return i.query ?? "";
    case "Task":
    case "Agent":
      return i.description ?? "";
    case "TodoWrite":
      return "";
    default: {
      const first = Object.values(i).find((v) => typeof v === "string");
      return typeof first === "string" ? first : "";
    }
  }
}

/** "Ran 2 commands, read 3 files, edited 1 file" */
function groupSummary(entries: WorkEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const g = e.kind === "thinking" ? "thought" : toolLook(e.name).group;
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [g, n] of counts) {
    if (g === "other") {
      parts.push(`used ${n} ${n === 1 ? "tool" : "tools"}`);
      continue;
    }
    const [verb, one, many] = GROUP_WORDS[g as keyof typeof GROUP_WORDS];
    parts.push(g === "thought" ? `thought ${n === 1 ? "once" : `${n} times`}` : `${verb.toLowerCase()} ${n} ${n === 1 ? one : many}`);
  }
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Diff(props: { before: string; after: string }) {
  return (
    <pre class="chat-pre chat-diff">
      <For each={props.before ? props.before.split("\n") : []}>
        {(l) => <div class="del">- {l}</div>}
      </For>
      <For each={props.after ? props.after.split("\n") : []}>
        {(l) => <div class="add">+ {l}</div>}
      </For>
    </pre>
  );
}

function ToolDetails(props: { tool: ToolItem }) {
  const i = () => props.tool.input;
  const name = () => props.tool.name;
  return (
    <>
      <Switch fallback={<pre class="chat-pre">{clip(JSON.stringify(i(), null, 2))}</pre>}>
        <Match when={name() === "Bash"}>
          <pre class="chat-pre">$ {i().command}</pre>
        </Match>
        <Match when={name() === "Edit"}>
          <Diff before={i().old_string ?? ""} after={i().new_string ?? ""} />
        </Match>
        <Match when={name() === "MultiEdit" && Array.isArray(i().edits)}>
          <For each={i().edits}>
            {(e: any) => <Diff before={e.old_string ?? ""} after={e.new_string ?? ""} />}
          </For>
        </Match>
        <Match when={name() === "Write"}>
          <pre class="chat-pre">{clip(i().content ?? "")}</pre>
        </Match>
        <Match when={name() === "TodoWrite" && Array.isArray(i().todos)}>
          <ul class="chat-todos">
            <For each={i().todos}>
              {(t: any) => (
                <li classList={{ done: t.status === "completed" }}>
                  {t.status === "completed" ? "☑" : t.status === "in_progress" ? "◐" : "☐"}{" "}
                  {t.content}
                </li>
              )}
            </For>
          </ul>
        </Match>
        <Match when={["Read", "Glob", "Grep", "WebSearch", "WebFetch"].includes(name())}>
          {null}
        </Match>
      </Switch>
      <Show when={props.tool.result}>
        {(r) => (
          <pre classList={{ "chat-pre": true, "chat-error": !!props.tool.isError }}>
            {clip(r())}
          </pre>
        )}
      </Show>
    </>
  );
}

/** One line of the work log; click to show its details underneath. */
function WorkEntryRow(props: { entry: WorkEntry; cwd: string; live: boolean }) {
  const [open, setOpen] = createSignal(false);
  const e = props.entry;
  const pending = () => e.kind === "tool" && e.result === undefined && props.live;
  const failed = () => e.kind === "tool" && !!e.isError;
  const look = () => (e.kind === "tool" ? toolLook(e.name) : null);
  const icon = (): IconName => (failed() ? "alert" : (look()?.icon ?? "brain"));

  return (
    <div class="work-row">
      <button
        class="work-line"
        classList={{ failed: failed() }}
        aria-expanded={open()}
        onClick={() => setOpen((v) => !v)}
      >
        <span class="work-icon">
          <Icon name={icon()} />
        </span>
        <span class="work-label" classList={{ shimmer: pending() }}>
          <Show
            when={e.kind === "tool" ? e : null}
            fallback={<span class="work-verb">Thought</span>}
          >
            {(t) => (
              <>
                <span class="work-verb">{look()!.verb[pending() ? 1 : 0]}</span>
                <Show when={toolTarget(t(), props.cwd)}>
                  {(target) => <span class="work-target">{target()}</span>}
                </Show>
              </>
            )}
          </Show>
        </span>
      </button>
      <Show when={open()}>
        <div class="work-details">
          <Show
            when={e.kind === "tool" ? e : null}
            fallback={<div class="work-thinking">{(e as ThinkingItem).text}</div>}
          >
            {(t) => <ToolDetails tool={t()} />}
          </Show>
        </div>
      </Show>
    </div>
  );
}

function WorkGroup(props: { entries: WorkEntry[]; cwd: string; live: boolean }) {
  const [toggled, setToggled] = createSignal<boolean | null>(null);
  // The group still running stays open so you can follow along; finished
  // groups fold to a one-line summary unless you've opened them.
  const open = () => toggled() ?? props.live;
  const failed = () => props.entries.some((e) => e.kind === "tool" && e.isError);

  return (
    <Show
      when={props.entries.length > 1}
      fallback={
        <Show when={props.entries[0]} keyed>
          {(entry) => <WorkEntryRow entry={entry} cwd={props.cwd} live={props.live} />}
        </Show>
      }
    >
      <div class="work-group">
        <button
          class="work-line work-group-head"
          aria-expanded={open()}
          onClick={() => setToggled(!open())}
        >
          <span class="work-icon">
            <Icon name={failed() ? "alert" : "wrench"} />
          </span>
          <span class="work-label" classList={{ shimmer: props.live }}>
            <span class="work-verb">{groupSummary(props.entries)}</span>
          </span>
          <span class="work-chevron" classList={{ open: open() }}>
            <Icon name="chevron" />
          </span>
        </button>
        <Show when={open()}>
          <div class="work-list">
            <For each={props.entries}>
              {(entry) => <WorkEntryRow entry={entry} cwd={props.cwd} live={props.live} />}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}

/* ---------- messages ---------- */

function CopyButton(props: { text: string }) {
  const [copied, setCopied] = createSignal(false);
  return (
    <button
      class="msg-action"
      title="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(props.text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      <Icon name={copied() ? "check" : "copy"} />
    </button>
  );
}

/** Rows are positional (<Index>), so re-key on the item to never show a stale one. */
function ItemRow(props: { item: Exclude<ChatItem, WorkEntry> }) {
  return (
    <Show when={props.item} keyed>
      {(it) => renderItem(it)}
    </Show>
  );
}

function renderItem(it: Exclude<ChatItem, WorkEntry>) {
  switch (it.kind) {
    case "user":
      return (
        <div class="msg-user">
          <div class="msg-bubble">
            <Show when={it.images.length}>
              <div class="msg-images">
                <For each={it.images}>{(src) => <img src={src} alt="" />}</For>
              </div>
            </Show>
            <Show when={it.text}>
              <div class="msg-user-text">{it.text}</div>
            </Show>
          </div>
          <div class="msg-meta">
            <span>{clock(it.at)}</span>
            <Show when={it.text}>
              <CopyButton text={it.text} />
            </Show>
          </div>
        </div>
      );
    case "assistant":
      return (
        <div class="msg-assistant">
          <Markdown text={it.text} />
          <div class="msg-meta">
            <CopyButton text={it.text} />
            <span>{clock(it.at)}</span>
          </div>
        </div>
      );
    case "note":
      return (
        <div class="chat-note" classList={{ error: it.tone === "error" }}>
          <span class="work-icon">
            <Icon name="alert" />
          </span>
          <span>{it.text}</span>
        </div>
      );
    case "turn": {
      const parts = [
        it.durationMs != null ? `Worked for ${duration(it.durationMs)}` : "",
        it.costUsd != null ? `$${it.costUsd.toFixed(2)} session` : "",
      ].filter(Boolean);
      return (
        <Show when={parts.length}>
          <div class="turn-divider">
            <span />
            <p>{parts.join(" · ")}</p>
            <span />
          </div>
        </Show>
      );
    }
  }
}

/** "Working for 12s", ticking while a turn runs. */
function Working(props: { since: number }) {
  const [now, setNow] = createSignal(Date.now());
  const t = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(t));
  return (
    <div class="chat-working">
      <span class="shimmer">Working for {duration(now() - props.since)}</span>
    </div>
  );
}

/* ---------- view ---------- */

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const PERMISSION_LABELS: Record<string, string> = {
  default: "Ask",
  acceptEdits: "Accept edits",
  plan: "Plan",
  bypassPermissions: "Full access",
};

/** "claude-opus-5-5[1m]" → "Opus 5.5 (1M)"; anything else is shown as is. */
function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(id);
  if (!m) return id;
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  return `${family} ${m[2]}${m[3] ? "." + m[3] : ""}${m[4] ? " (1M)" : ""}`;
}

/** Claude Code's names for its models ("opus" → "Opus 5.5"), loaded once. */
const [modelNames, setModelNames] = createSignal<Record<string, string>>({});
let modelNamesLoading = false;

function loadModelNames(command: string) {
  if (modelNamesLoading) return;
  modelNamesLoading = true;
  invoke<{ value: string; displayName: string }[]>("chat_models", { command })
    .then((ms) => setModelNames(Object.fromEntries(ms.map((m) => [m.value, m.displayName]))))
    .catch(() => (modelNamesLoading = false));
}

/** The menu's models, with version numbers once Claude Code reported them. */
function modelOptions() {
  return CHAT_MODELS.map((m) => {
    const oneM = m.value.endsWith("[1m]");
    const name = modelNames()[oneM ? m.value.slice(0, -4) : m.value];
    return name ? { value: m.value, label: oneM ? `${name} (1M context)` : name } : m;
  });
}

/** A composer chip that opens a menu of choices above it. */
function ChipMenu(props: {
  label: string;
  title: string;
  options: { value: string; label: string }[];
  value: string;
  onSelect: (v: string) => void;
  testId?: string;
}) {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;
  const onDown = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) setOpen(false);
  };
  createEffect(() => {
    if (!open()) return;
    document.addEventListener("pointerdown", onDown, true);
    onCleanup(() => document.removeEventListener("pointerdown", onDown, true));
  });
  const pick = (v: string) => {
    setOpen(false);
    props.onSelect(v);
  };
  const Option = (o: { value: string; label: string }) => (
    <button
      class="chip-menu-item"
      classList={{ selected: props.value === o.value }}
      onClick={() => pick(o.value)}
    >
      <span>{o.label}</span>
      <Show when={props.value === o.value}>
        <Icon name="check" />
      </Show>
    </button>
  );
  return (
    <div
      class="chip-menu"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open()) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        class="composer-chip"
        classList={{ active: open() }}
        title={props.title}
        onClick={() => setOpen((o) => !o)}
        data-testid={props.testId}
      >
        {props.label}
        <span class="composer-chip-caret">
          <Icon name="chevron" />
        </span>
      </button>
      <Show when={open()}>
        <div class="chip-menu-pop" role="menu">
          <div class="chip-menu-head">{props.title}</div>
          <For each={props.options}>{(o) => <Option {...o} />}</For>
        </div>
      </Show>
    </div>
  );
}

export function ChatView(props: { session: ChatSession }) {
  const s = props.session;
  const st = s.state;
  const [text, setText] = createSignal("");
  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [dropping, setDropping] = createSignal(false);
  let log!: HTMLDivElement;
  let input!: HTMLTextAreaElement;
  let stick = true;

  const rows = createMemo(() => toRows(st.items));
  const turnStart = createMemo(() => {
    for (let i = st.items.length - 1; i >= 0; i--) {
      const it = st.items[i];
      if (it.kind === "user") return it.at;
    }
    return Date.now();
  });

  // Follow new output while the user is at the bottom; leave them be if
  // they've scrolled up to read.
  createEffect(
    on(
      () => [st.items.length, st.draft, st.busy],
      () => {
        if (stick) requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
      },
    ),
  );

  const autosize = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 240) + "px";
  };

  loadModelNames(s.def.command || "claude");

  // Until Claude Code has reported its model names, fall back to the
  // version of the model that last answered, if it's the one picked.
  const modelLabel = () => {
    const pick = s.def.model ?? DEFAULT_CHAT_MODEL;
    const base = pick.replace(/\[.*\]$/, "");
    const label = modelOptions().find((m) => m.value === pick)?.label ?? pick;
    if (!modelNames()[base] && st.model?.includes(base)) return modelName(st.model);
    return label;
  };

  const canSend = () => !!text().trim() || attachments().length > 0;

  const submit = () => {
    if (!canSend()) return;
    const body = text().trim();
    const files = attachments();
    setText("");
    setAttachments([]);
    queueMicrotask(autosize);
    stick = true;
    void s.send(body, files);
  };

  /** Images become attachments; other files are referenced by path. */
  const addFiles = async (files: File[]) => {
    const paths: string[] = [];
    for (const f of files) {
      try {
        if (IMAGE_TYPES.includes(f.type)) {
          const data = await readAsBase64(f);
          setAttachments((a) => [...a, { name: f.name, mediaType: f.type, data }]);
        } else {
          paths.push(
            await invoke<string>("save_dropped_file", {
              name: f.name || "dropped",
              data: await f.arrayBuffer(),
            }),
          );
        }
      } catch (err) {
        console.error("attach failed", err);
      }
    }
    if (paths.length) {
      setText((t) => (t && !t.endsWith(" ") ? t + " " : t) + paths.join(" ") + " ");
      queueMicrotask(autosize);
    }
    input.focus();
  };

  const hasFiles = (e: DragEvent) =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");

  return (
    <div
      classList={{ chat: true, "file-drop": dropping() }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer!.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropping(false);
        void addFiles(Array.from(e.dataTransfer!.files));
      }}
      onClick={(e) => {
        // Links in model output open in the browser, never in the webview.
        const a = (e.target as HTMLElement).closest("a[href]");
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute("href") ?? "";
        if (/^https?:\/\//i.test(href)) void invoke("open_url", { url: href });
      }}
    >
      <div
        class="chat-log"
        ref={log}
        onScroll={() => {
          stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
        }}
      >
        <div class="chat-column">
          <Show when={!st.items.length && !st.draft}>
            <div class="chat-empty">
              <p class="chat-empty-title">{s.def.name || "Claude"}</p>
              <p>
                Working in <code>{s.def.cwd || "~"}</code>
              </p>
            </div>
          </Show>
          <Index each={rows()}>
            {(row, i) => (
              <Switch>
                <Match when={row().kind === "work" && (row() as Extract<Row, { kind: "work" }>)}>
                  {(w) => (
                    <WorkGroup
                      entries={w().entries}
                      cwd={s.def.cwd}
                      live={st.busy && i === rows().length - 1}
                    />
                  )}
                </Match>
                <Match when={row().kind === "item" && (row() as Extract<Row, { kind: "item" }>)}>
                  {(r) => <ItemRow item={r().item} />}
                </Match>
              </Switch>
            )}
          </Index>
          <Show when={st.draft}>
            <div class="msg-assistant streaming">
              <Markdown text={st.draft} />
            </div>
          </Show>
          <Show when={st.busy && !st.draft}>
            <Working since={turnStart()} />
          </Show>
        </div>
      </div>

      <div class="composer-wrap">
        <div class="composer">
          <Show when={attachments().length}>
            <div class="composer-attachments">
              <For each={attachments()}>
                {(a, i) => (
                  <div class="composer-attachment" title={a.name}>
                    <img src={`data:${a.mediaType};base64,${a.data}`} alt={a.name} />
                    <button
                      class="composer-attachment-x"
                      title="Remove"
                      onClick={() => setAttachments((all) => all.filter((_, j) => j !== i()))}
                    >
                      ×
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <textarea
            ref={(el) => {
              input = el;
              s.input = el;
            }}
            class="composer-input"
            rows={1}
            placeholder={st.items.length ? "Ask for follow-up changes" : "Ask anything"}
            value={text()}
            data-testid="chat-input"
            onInput={(e) => {
              setText(e.currentTarget.value);
              autosize();
            }}
            onKeyDown={(e) => {
              if (e.isComposing) return;
              if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape" && st.busy) {
                e.preventDefault();
                void s.interrupt();
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
                IMAGE_TYPES.includes(f.type),
              );
              if (!files.length) return;
              e.preventDefault();
              void addFiles(files);
            }}
          />
          <div class="composer-bar">
            <div class="composer-chips">
              <ChipMenu
                title="Model"
                label={modelLabel()}
                options={modelOptions()}
                value={s.def.model ?? DEFAULT_CHAT_MODEL}
                onSelect={(v) => void s.setModel(v)}
                testId="chat-model"
              />
              <ChipMenu
                title="Effort"
                label={
                  CHAT_EFFORTS.find((e) => e.value === (s.def.effort ?? DEFAULT_CHAT_EFFORT))!
                    .label
                }
                options={CHAT_EFFORTS}
                value={s.def.effort ?? DEFAULT_CHAT_EFFORT}
                onSelect={(v) => s.setEffort(v as ChatEffort)}
                testId="chat-effort"
              />
              <span class="composer-chip">
                {PERMISSION_LABELS[s.def.permissionMode ?? DEFAULT_CHAT_PERMISSION_MODE]}
              </span>
            </div>
            <Show
              when={st.busy && !canSend()}
              fallback={
                <button
                  class="composer-send"
                  title="Send (Enter)"
                  disabled={!canSend()}
                  onClick={submit}
                  data-testid="chat-send"
                >
                  <Icon name="arrow-up" />
                </button>
              }
            >
              <button
                class="composer-send"
                title="Stop (Esc)"
                onClick={() => void s.interrupt()}
              >
                <Icon name="stop" />
              </button>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
