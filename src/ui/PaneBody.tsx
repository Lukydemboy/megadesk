import { For, Show, createEffect, on, onCleanup } from "solid-js";
import type { Pane } from "../core/types";
import { config, mgr, mutate, saveConfig } from "../core/store";
import { baseName } from "../core/layout";
import {
  disposeShell,
  newDrawerTerminal,
  paneAgent,
  selectDrawerTab,
  toggleDrawer,
} from "../core/agents";
import { Gutter, clamp } from "./Gutter";
import { Icon } from "./icons";

/**
 * The pane's content: the active tab's session on top and, for a project
 * agent, its terminal drawer docked underneath.
 */
export function PaneBody(props: { pane: Pane }) {
  const agent = () => paneAgent(props.pane);
  const drawer = () => {
    const a = agent();
    const d = a && config.drawers[a.id];
    return d?.open && d.ids.length ? d : undefined;
  };

  return (
    <div class="pane-body">
      <div
        class="pane-main"
        style={{ "flex-grow": String(drawer() ? 1 - drawer()!.frac : 1) }}
      >
        <Show when={!props.pane.activeId}>
          <div class="pane-placeholder">Add a terminal with +</div>
        </Show>
        <SessionMount id={props.pane.activeId} />
      </div>
      <Show when={drawer() && agent()}>
        {(a) => (
          <>
            <Gutter
              dir="h"
              onMove={(coord, rect) => {
                const frac = clamp(1 - (coord - rect.top) / rect.height, 0.12, 0.88);
                mutate((c) => {
                  c.drawers[a().id].frac = frac;
                });
              }}
              onDone={saveConfig}
            />
            <TerminalDrawer agentId={a().id} frac={drawer()!.frac} />
          </>
        )}
      </Show>
    </div>
  );
}

/**
 * Hosts one session (a terminal or a chat). The host elements live on the
 * session objects and are never recreated — this component just moves the
 * right one into place when `id` (or its mode) changes, and detaches it on
 * cleanup (without ever disposing the session, so hidden/zoomed-away tabs
 * keep running).
 */
function SessionMount(props: { id: string | null }) {
  let mount!: HTMLDivElement;

  createEffect(
    on(
      () => {
        const id = props.id;
        return [id, config.agents.find((a) => a.id === id)?.mode] as const;
      },
      ([id]) => {
        mount.replaceChildren();
        if (!id) return;
        const def = config.agents.find((a) => a.id === id);
        if (!def) return;
        const s = mgr.ensure(def);
        mount.appendChild(s.host);
        requestAnimationFrame(() => {
          s.fitAndResize();
          void s.start(mgr);
        });
      },
    ),
  );

  onCleanup(() => mount?.replaceChildren());

  return <div class="term-mount" ref={mount} data-testid="term-mount" />;
}

/** An agent's terminal drawer: shells opened in its project, as tabs. */
function TerminalDrawer(props: { agentId: string; frac: number }) {
  const d = () => config.drawers[props.agentId];
  const cwd = () => config.agents.find((a) => a.id === props.agentId)?.cwd ?? "";

  return (
    <div class="drawer" style={{ "flex-grow": String(props.frac) }}>
      <div
        class="drawer-head"
        onDblClick={(e) => {
          const t = e.target as HTMLElement;
          if (t !== e.currentTarget && !t.classList.contains("drawer-tabs")) return;
          newDrawerTerminal(props.agentId);
        }}
      >
        <span class="drawer-project" title={cwd()}>
          <Icon name="terminal" />
          {baseName(cwd())}
        </span>
        <div class="drawer-tabs">
          <For each={d()?.ids ?? []}>
            {(id) => {
              const def = () => config.agents.find((a) => a.id === id);
              const st = () => mgr.state[id];
              return (
                <Show when={def()}>
                  <div
                    classList={{
                      "drawer-tab": true,
                      active: d()?.activeId === id,
                    }}
                    title={cwd()}
                    onClick={() => selectDrawerTab(props.agentId, id)}
                  >
                    <span class="status-dot" classList={{ on: !!st()?.running }} />
                    <span class="pane-tab-name">{def()!.name}</span>
                    <button
                      class="pane-tab-x"
                      title="Close terminal"
                      onClick={(e) => {
                        e.stopPropagation();
                        disposeShell(id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                </Show>
              );
            }}
          </For>
        </div>
        <button
          class="drawer-btn"
          title="New terminal in this project"
          onClick={() => newDrawerTerminal(props.agentId)}
        >
          <Icon name="plus" />
        </button>
        <button
          class="drawer-btn"
          title="Hide terminals (⌘J)"
          onClick={() => toggleDrawer(props.agentId)}
        >
          <Icon name="chevron-down" />
        </button>
      </div>
      <div class="drawer-body">
        <SessionMount id={d()?.activeId ?? null} />
      </div>
    </div>
  );
}
