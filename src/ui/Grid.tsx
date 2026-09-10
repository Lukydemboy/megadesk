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
import { DND_TYPE } from "./dnd";
import { PaneHead } from "./PaneHead";
import { PaneBody } from "./PaneBody";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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

  return (
    <div
      classList={{ pane: true, "drop-target": dropActive() }}
      style={props.zoomed ? {} : { "flex-grow": String(props.pane.frac) }}
      onDragOver={(e) => {
        if (!isOurDrag(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        setDropActive(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDropActive(false);
      }}
      onDrop={(e) => {
        if (!isOurDrag(e)) return;
        e.preventDefault();
        setDropActive(false);
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

function Gutter(props: {
  dir: "h" | "v";
  onMove: (coord: number, rect: DOMRect) => void;
  onDone: () => void;
}) {
  let g!: HTMLDivElement;
  const down = (e: MouseEvent) => {
    e.preventDefault();
    const rect = g.parentElement!.getBoundingClientRect();
    document.body.style.cursor = props.dir === "h" ? "row-resize" : "col-resize";
    const move = (ev: MouseEvent) =>
      props.onMove(props.dir === "h" ? ev.clientY : ev.clientX, rect);
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      props.onDone();
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  return (
    <div
      ref={g}
      class={props.dir === "h" ? "gutter gutter-h" : "gutter gutter-v"}
      onMouseDown={down}
    />
  );
}
