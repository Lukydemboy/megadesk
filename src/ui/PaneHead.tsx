import {
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import { Portal } from "solid-js/web";
import { invoke } from "@tauri-apps/api/core";
import type { Pane } from "../core/types";
import {
  config,
  mgr,
  mutate,
  saveConfig,
  setFocusedPane,
  zoomedPane,
} from "../core/store";
import { paneCwd, toggleZoom } from "../core/layout";
import { closeTab, upsertAgent } from "../core/agents";
import { openAgentPicker, openBranchesDialog } from "./overlays";
import { showToast } from "./Toasts";
import { Icon } from "./icons";
import {
  TAB_DND,
  beginTabDrag,
  currentTabDrag,
  endTabDrag,
  moveTab,
} from "./dnd";

export function PaneHead(props: { ci: number; pi: number; pane: Pane }) {
  const activeDef = () =>
    props.pane.activeId
      ? config.agents.find((a) => a.id === props.pane.activeId)
      : undefined;

  return (
    <div class="pane-head">
      <div class="pane-tabs">
        <For each={props.pane.agentIds}>
          {(id) => (
            <Show when={config.agents.some((a) => a.id === id)}>
              <PaneTab ci={props.ci} pi={props.pi} pane={props.pane} id={id} />
            </Show>
          )}
        </For>
      </div>

      <Show when={props.pane.agentIds.length}>
        <PaneBranch pane={props.pane} />
      </Show>
      <PaneActions ci={props.ci} pi={props.pi} pane={props.pane} activeDef={activeDef} />
    </div>
  );
}

const BRANCH_POLL_MS = 2000;

function PaneBranch(props: { pane: Pane }) {
  const cwd = () => paneCwd(props.pane);
  const [branch, { refetch }] = createResource(cwd, (path) =>
    invoke<string | null>("git_branch", { path }),
  );

  const timer = setInterval(() => void refetch(), BRANCH_POLL_MS);
  onCleanup(() => clearInterval(timer));

  const [open, setOpen] = createSignal(false);
  let anchor!: HTMLButtonElement;
  const [pos, setPos] = createSignal({ left: 0, top: 0 });

  const [recent] = createResource(
    () => (open() ? cwd() : undefined),
    (path) => invoke<string[]>("git_recent_branches", { path }),
  );

  const close = () => {
    setOpen(false);
    document.removeEventListener("mousedown", onDoc, true);
  };
  const onDoc = (e: MouseEvent) => {
    if (!(e.target instanceof Node) || !menuEl?.contains(e.target)) close();
  };
  let menuEl: HTMLDivElement | undefined;

  onCleanup(() => document.removeEventListener("mousedown", onDoc, true));

  const toggle = () => {
    if (open()) return close();
    const r = anchor.getBoundingClientRect();
    setPos({ left: r.right, top: r.bottom + 4 });
    setOpen(true);
    setTimeout(() => document.addEventListener("mousedown", onDoc, true), 0);
  };

  const copyBranch = async () => {
    const name = branch();
    if (!name) return;
    try {
      await navigator.clipboard.writeText(name);
      showToast(`Copied "${name}"`);
    } catch {
      showToast("Couldn't copy branch name", "warn");
    }
    close();
  };

  const switchTo = async (target: string) => {
    close();
    try {
      await invoke("git_switch_branch", { path: cwd(), branch: target });
      void refetch();
    } catch (e) {
      showToast(`Couldn't switch to "${target}": ${e}`, "warn");
    }
  };

  return (
    <Show when={branch()}>
      <button
        ref={anchor}
        class="pane-branch"
        title={`Branch of ${cwd()} — click to switch`}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        ⎇ {branch()}
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={menuEl}
            class="popmenu"
            style={{ left: `${pos().left}px`, top: `${pos().top}px`, transform: "translateX(-100%)" }}
          >
            <button class="popmenu-item" onClick={() => void copyBranch()}>
              <Icon name="copy" />
              Copy branch name
            </button>
            <div class="popmenu-sep">Switch to</div>
            <Show
              when={!recent.loading}
              fallback={<div class="popmenu-item popmenu-empty">Loading…</div>}
            >
              <For each={recent()}>
                {(name) => (
                  <button
                    class="popmenu-item"
                    onClick={() => void switchTo(name)}
                  >
                    {name}
                  </button>
                )}
              </For>
              <Show when={recent()?.length === 0}>
                <div class="popmenu-item popmenu-empty">No other branches</div>
              </Show>
            </Show>
            <div class="popmenu-sep-line" />
            <button
              class="popmenu-item"
              onClick={() => {
                close();
                openBranchesDialog(cwd());
              }}
            >
              <Icon name="gear" />
              Manage branches…
            </button>
          </div>
        </Portal>
      </Show>
    </Show>
  );
}

function PaneActions(props: {
  ci: number;
  pi: number;
  pane: Pane;
  activeDef: () => ReturnType<typeof config.agents.find>;
}) {
  const [open, setOpen] = createSignal(false);
  let anchor!: HTMLButtonElement;
  const [pos, setPos] = createSignal({ left: 0, top: 0 });

  const close = () => {
    setOpen(false);
    document.removeEventListener("mousedown", onDoc, true);
  };
  const onDoc = (e: MouseEvent) => {
    if (!(e.target instanceof Node) || !menuEl?.contains(e.target)) close();
  };
  let menuEl: HTMLDivElement | undefined;

  onCleanup(() => document.removeEventListener("mousedown", onDoc, true));

  const toggle = () => {
    if (open()) return close();
    setFocusedPane({ ci: props.ci, pi: props.pi });
    const r = anchor.getBoundingClientRect();
    setPos({ left: r.right, top: r.bottom + 4 });
    setOpen(true);
    setTimeout(() => document.addEventListener("mousedown", onDoc, true), 0);
  };

  return (
    <>
      <button
        ref={anchor}
        class="pane-btn"
        title="Pane actions"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        <Icon name="more" />
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={menuEl}
            class="popmenu"
            style={{ left: `${pos().left}px`, top: `${pos().top}px`, transform: "translateX(-100%)" }}
          >
            <button
              class="popmenu-item"
              onClick={() => {
                close();
                openAgentPicker({ ci: props.ci, pi: props.pi });
              }}
            >
              <Icon name="plus" />
              Add agent…
            </button>
            <Show when={props.pane.agentIds.length}>
              <button
                class="popmenu-item"
                onClick={() => {
                  close();
                  toggleZoom({ ci: props.ci, pi: props.pi });
                }}
              >
                <Icon name={zoomedPane() ? "unzoom" : "zoom"} />
                {zoomedPane() ? "Restore the split" : "Zoom this pane"}
              </button>
              <button
                class="popmenu-item"
                onClick={() => {
                  close();
                  void invoke("open_in_zed", { path: paneCwd(props.pane) });
                }}
              >
                <Icon name="open" />
                Open in Zed
              </button>
            </Show>
            <Show when={props.activeDef()}>
              {(def) => (
                <>
                  <button
                    class="popmenu-item"
                    onClick={() => {
                      close();
                      const s = mgr.sessions.get(def().id);
                      if (s) void s.restart(mgr);
                    }}
                  >
                    <Icon name="restart" />
                    Restart this terminal
                  </button>
                  <button
                    class="popmenu-item"
                    onClick={() => {
                      close();
                      void mgr.sessions.get(def().id)?.kill();
                    }}
                  >
                    <Icon name="stop" />
                    Stop this terminal
                  </button>
                </>
              )}
            </Show>
          </div>
        </Portal>
      </Show>
    </>
  );
}

function PaneTab(props: { ci: number; pi: number; pane: Pane; id: string }) {
  const def = () => config.agents.find((a) => a.id === props.id)!;
  const st = () => mgr.state[props.id];
  const isActive = () => props.pane.activeId === props.id;

  const [editing, setEditing] = createSignal(false);
  const [edge, setEdge] = createSignal<"before" | "after" | null>(null);
  let inputEl: HTMLInputElement | undefined;
  let tabEl!: HTMLDivElement;

  createEffect(() => {
    if (editing() && inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  });

  const finishRename = (save: boolean) => {
    if (!editing()) return;
    const next = inputEl?.value.trim() ?? "";
    setEditing(false);
    if (save && next && next !== def().name) upsertAgent({ ...def(), name: next });
  };

  const edgeFromEvent = (e: DragEvent) => {
    const r = tabEl.getBoundingClientRect();
    return e.clientX > r.left + r.width / 2 ? "after" : "before";
  };

  return (
    <div
      ref={tabEl}
      classList={{
        "pane-tab": true,
        active: isActive(),
        attn: !!st()?.attention && !isActive(),
        "drop-before": edge() === "before",
        "drop-after": edge() === "after",
      }}
      draggable={!editing()}
      onClick={() => {
        ((window as any).__diag ??= []).push({
          t: "tab click",
          propsId: props.id,
          propsName: def()?.name,
          isActive: isActive(),
          paneActiveId: props.pane.activeId,
          paneAgentIds: [...props.pane.agentIds],
          allAgents: config.agents.map((a) => ({ id: a.id, name: a.name })),
        });
        if (isActive()) return;
        mutate((c) => {
          c.columns[props.ci].panes[props.pi].activeId = props.id;
        });
        ((window as any).__diag ??= []).push({
          t: "tab click after mutate",
          paneActiveId: props.pane.activeId,
        });
        setFocusedPane({ ci: props.ci, pi: props.pi });
        saveConfig();
      }}
      onDragStart={(e) => {
        e.stopPropagation();
        beginTabDrag({ ci: props.ci, pi: props.pi, id: props.id });
        e.dataTransfer?.setData(TAB_DND, props.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        tabEl.classList.add("dragging");
      }}
      onDragEnd={() => {
        endTabDrag();
        tabEl.classList.remove("dragging");
        setEdge(null);
      }}
      onDragOver={(e) => {
        const drag = currentTabDrag();
        if (!drag || drag.id === props.id) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        setEdge(edgeFromEvent(e));
      }}
      onDragLeave={() => setEdge(null)}
      onDrop={(e) => {
        const drag = currentTabDrag();
        if (!drag || drag.id === props.id) return;
        e.preventDefault();
        e.stopPropagation();
        const after = edgeFromEvent(e) === "after";
        setEdge(null);
        endTabDrag();
        moveTab(drag, { ci: props.ci, pi: props.pi }, props.id, after);
      }}
    >
      <span
        class="status-dot"
        classList={{
          on: !!st()?.running,
          exited: !!st()?.exited && !st()?.running,
        }}
      />
      <Show
        when={!editing()}
        fallback={
          <input
            ref={inputEl}
            class="pane-tab-edit"
            value={def().name}
            onClick={(e) => e.stopPropagation()}
            onDblClick={(e) => e.stopPropagation()}
            onBlur={() => finishRename(true)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                finishRename(true);
              } else if (e.key === "Escape") {
                e.preventDefault();
                finishRename(false);
              }
            }}
          />
        }
      >
        <span
          class="pane-tab-name"
          title="Double-click to rename"
          onDblClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {def().name}
        </span>
      </Show>
      <button
        class="pane-tab-x"
        title="Close terminal"
        onClick={(e) => {
          e.stopPropagation();
          closeTab({ ci: props.ci, pi: props.pi }, props.id);
        }}
      >
        ×
      </button>
    </div>
  );
}

