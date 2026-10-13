import { Show, createEffect, on, onCleanup } from "solid-js";
import type { Pane } from "../core/types";
import { config, mgr } from "../core/store";

/**
 * Hosts the active tab's session (a terminal or a chat). The host elements
 * live on the session objects and are never recreated — this component just
 * moves the right one into place when the active tab (or its mode) changes,
 * and detaches it on cleanup (without ever disposing the session, so
 * hidden/zoomed-away tabs keep running).
 */
export function PaneBody(props: { pane: Pane }) {
  let mount!: HTMLDivElement;

  createEffect(
    on(
      () => {
        const id = props.pane.activeId;
        return [id, config.agents.find((a) => a.id === id)?.mode] as const;
      },
      ([activeId]) => {
        mount.replaceChildren();
        if (!activeId) return;
        const def = config.agents.find((a) => a.id === activeId);
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

  return (
    <div class="pane-body">
      <Show when={!props.pane.activeId}>
        <div class="pane-placeholder">Add a terminal with +</div>
      </Show>
      <div class="term-mount" ref={mount} data-testid="term-mount" />
    </div>
  );
}
