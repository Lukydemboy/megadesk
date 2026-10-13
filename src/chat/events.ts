import { produce, type SetStoreFunction } from "solid-js/store";

/**
 * Turns Claude Code's stream-json events (and the entries of a saved
 * session transcript, which share the user/assistant shapes) into a flat
 * list of chat items.
 */

export interface ToolItem {
  kind: "tool";
  key: number;
  toolId: string;
  name: string;
  input: Record<string, any>;
  result?: string;
  isError?: boolean;
}

export type ChatItem =
  | { kind: "user"; key: number; text: string; images: string[]; at: number }
  | { kind: "assistant"; key: number; text: string; at: number }
  | { kind: "thinking"; key: number; text: string }
  | ToolItem
  | { kind: "note"; key: number; text: string; tone: "info" | "error" }
  | { kind: "turn"; key: number; durationMs?: number; costUsd?: number };

export interface ChatState {
  items: ChatItem[];
  /** Assistant text streaming in, before its finished message arrives. */
  draft: string;
  /** A turn is in progress. */
  busy: boolean;
  sessionId?: string;
  model?: string;
}

export const emptyChat = (): ChatState => ({ items: [], draft: "", busy: false });

let nextKey = 1;
const key = () => nextKey++;

type Block = Record<string, any>;

const blocks = (content: unknown): Block[] =>
  typeof content === "string"
    ? [{ type: "text", text: content }]
    : Array.isArray(content)
      ? content
      : [];

/** Plain text of a tool_result's content (a string or text/image blocks). */
function resultText(content: unknown): string {
  return blocks(content)
    .map((b) => (b.type === "text" ? b.text : b.type === "image" ? "[image]" : ""))
    .filter(Boolean)
    .join("\n");
}

export function noteItem(text: string, tone: "info" | "error" = "info"): ChatItem {
  return { kind: "note", key: key(), text, tone };
}

/** Apply one parsed event to the chat state. */
export function applyEvent(set: SetStoreFunction<ChatState>, ev: any) {
  const at = Date.parse(ev?.timestamp ?? "") || Date.now();
  set(
    produce((s) => {
      switch (ev?.type) {
        case "system":
          if (ev.subtype === "init") {
            s.sessionId = ev.session_id ?? s.sessionId;
            s.model = ev.model ?? s.model;
          }
          break;

        case "stream_event": {
          const e = ev.event;
          if (e?.type === "message_start") s.draft = "";
          else if (e?.type === "content_block_delta" && e.delta?.type === "text_delta")
            s.draft += e.delta.text ?? "";
          break;
        }

        case "assistant":
          for (const b of blocks(ev.message?.content)) {
            if (b.type === "text" && b.text?.trim()) {
              s.items.push({ kind: "assistant", key: key(), text: b.text, at });
              s.draft = "";
            } else if (b.type === "thinking" && b.thinking?.trim()) {
              s.items.push({ kind: "thinking", key: key(), text: b.thinking });
            } else if (b.type === "tool_use") {
              s.items.push({
                kind: "tool",
                key: key(),
                toolId: b.id,
                name: b.name ?? "tool",
                input: b.input ?? {},
              });
            }
          }
          break;

        case "user": {
          const texts: string[] = [];
          const images: string[] = [];
          for (const b of blocks(ev.message?.content)) {
            if (b.type === "text" && b.text) texts.push(b.text);
            else if (b.type === "image" && b.source?.type === "base64")
              images.push(`data:${b.source.media_type};base64,${b.source.data}`);
            else if (b.type === "tool_result") {
              for (let i = s.items.length - 1; i >= 0; i--) {
                const it = s.items[i];
                if (it.kind === "tool" && it.toolId === b.tool_use_id) {
                  it.result = resultText(b.content);
                  it.isError = !!b.is_error;
                  break;
                }
              }
            }
          }
          if (texts.length || images.length) {
            s.items.push({ kind: "user", key: key(), text: texts.join("\n"), images, at });
            s.busy = true;
          }
          break;
        }

        case "result":
          s.busy = false;
          s.draft = "";
          if (ev.subtype !== "success" || ev.is_error) {
            const why =
              typeof ev.result === "string" && ev.result
                ? ev.result
                : (ev.errors?.join?.("\n") ?? ev.subtype ?? "error");
            s.items.push(noteItem(why, "error"));
          }
          for (const d of ev.permission_denials ?? []) {
            s.items.push(
              noteItem(
                `Permission denied: ${d.tool_name}. Change the agent's permission mode to allow it.`,
                "error",
              ),
            );
          }
          s.items.push({
            kind: "turn",
            key: key(),
            durationMs: ev.duration_ms,
            costUsd: ev.total_cost_usd,
          });
          break;
      }
    }),
  );
}
