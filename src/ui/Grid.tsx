import { For, Show, createSignal } from "solid-js";
import type { Pane } from "../core/types";
import {
  config,
  mutate,
  saveConfig,
  setFocusedPane,
  zoomedPane,
} from "../core/store";
import { addAgentTab } from "../core/agents";
import { DND_TYPE, currentTabDrag, endTabDrag, moveTab } from "./dnd";
import { PaneHead } from "./PaneHead";
import { PaneBody } from "./PaneBody";
import { Gutter, clamp } from "./Gutter";

export function Grid() {
  const zoomedPaneObj = () => {
    const z = zoomedPane();
    return z ? config.columns[z.ci]?.panes[z.pi] : undefined;
  };

  return (
    <div class="grid" classList={{ zoomed: !!zoomedPaneObj() }}>
      <Show when={zoomedPaneObj()} fallback={<SplitGrid />}>
        {(pane) => {
          const z = zoomedPane()!;
          return <PaneView ci={z.ci} pi={z.pi} pane={pane()} zoomed />;
        }}
      </Show>
    </div>
  );
}

function SplitGrid() {
  return (
    <For each={config.columns}>
      {(col, ci) => (
        <>
          <div class="col" style={{ "flex-grow": String(col.frac) }}>
            <For each={col.panes}>
              {(pane, pi) => (
                <>
                  <PaneView ci={ci()} pi={pi()} pane={pane} />
                  <Show when={pi() < col.panes.length - 1}>
                    <Gutter
                      dir="h"
                      onMove={(coord, rect) => {
                        const panes = config.columns[ci()].panes;
                        const total = panes[pi()].frac + panes[pi() + 1].frac;
                        const ratio = clamp(
                          (coord - rect.top) / rect.height,
                          0.12,
                          0.88,
                        );
                        mutate((c) => {
                          const ps = c.columns[ci()].panes;
                          ps[pi()].frac = total * ratio;
                          ps[pi() + 1].frac = total * (1 - ratio);
                        });
                      }}
                      onDone={saveConfig}
                    />
                  </Show>
                </>
              )}
            </For>
          </div>
          <Show when={ci() < config.columns.length - 1}>
            <Gutter
              dir="v"
              onMove={(coord, rect) => {
                const cols = config.columns;
                const total = cols[ci()].frac + cols[ci() + 1].frac;
                const ratio = clamp((coord - rect.left) / rect.width, 0.12, 0.88);
                mutate((c) => {
                  c.columns[ci()].frac = total * ratio;
                  c.columns[ci() + 1].frac = total * (1 - ratio);
                });
              }}
              onDone={saveConfig}
            />
          </Show>
        </>
      )}
    </For>
  );
}

function PaneView(props: {
  ci: number;
  pi: number;
  pane: Pane;
  zoomed?: boolean;
}) {
  const [dropActive, setDropActive] = createSignal(false);
  const isOurDrag = (e: DragEvent) =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(DND_TYPE);
  /** A tab dragged from a *different* pane (same-pane drops are reorders on the tabs). */
  const foreignTabDrag = () => {
    const d = currentTabDrag();
    return d && (d.ci !== props.ci || d.pi !== props.pi) ? d : null;
  };

  return (
    <div
      classList={{ pane: true, "drop-target": dropActive() }}
      style={props.zoomed ? {} : { "flex-grow": String(props.pane.frac) }}
      onDragOver={(e) => {
        if (!isOurDrag(e) && !foreignTabDrag()) return;
        e.preventDefault();
        if (e.dataTransfer)
          e.dataTransfer.dropEffect = isOurDrag(e) ? "copy" : "move";
        setDropActive(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDropActive(false);
      }}
      onDrop={(e) => {
        const tab = foreignTabDrag();
        if (!isOurDrag(e) && !tab) return;
        e.preventDefault();
        setDropActive(false);
        if (tab) {
          endTabDrag();
          moveTab(tab, { ci: props.ci, pi: props.pi }, "", false);
          return;
        }
        const id = e.dataTransfer!.getData(DND_TYPE);
        setFocusedPane({ ci: props.ci, pi: props.pi });
        if (id) addAgentTab({ ci: props.ci, pi: props.pi }, id);
      }}
    >
      <PaneHead ci={props.ci} pi={props.pi} pane={props.pane} />
      <PaneBody pane={props.pane} />
    </div>
  );
}
