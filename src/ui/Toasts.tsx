import { For } from "solid-js";
import { createStore } from "solid-js/store";

interface Toast {
  id: number;
  message: string;
  kind: "info" | "warn";
  shown: boolean;
}

const [toasts, setToasts] = createStore<Toast[]>([]);
let nextId = 1;

function dismiss(id: number) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i < 0) return;
  setToasts(i, "shown", false);
  setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 180);
}

/** Transient in-app notification, bottom-right, styled like the rest of the UI. */
export function showToast(message: string, kind: "info" | "warn" = "info") {
  const id = nextId++;
  setToasts(toasts.length, { id, message, kind, shown: false });
  requestAnimationFrame(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) setToasts(i, "shown", true);
  });
  setTimeout(() => dismiss(id), 6000);
}

export function Toasts() {
  return (
    <div id="toasts">
      <For each={toasts}>
        {(t) => (
          <div
            classList={{
              toast: true,
              "toast-warn": t.kind === "warn",
              in: t.shown,
            }}
          >
            <span class="toast-msg">{t.message}</span>
            <button class="toast-x" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
