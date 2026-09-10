import { Show, createEffect, on, onCleanup } from "solid-js";
import type { Pane } from "../core/types";
import { config, mgr } from "../core/store";

/**
 * Hosts the active tab's terminal. The xterm host elements live on the Session
 * objects and are never recreated — this component just moves the right one
 * into place when the active tab changes, and detaches it on cleanup (without
 * ever disposing the session, so hidden/zoomed-away terminals keep running).
 */
export function PaneBody(props: { pane: Pane }) {
  let mount!: HTMLDivElement;

  createEffect(
    on(
      () => props.pane.activeId,
      (activeId) => {
        mount.replaceChildren();
        if (!activeId) return;
        let s = mgr.sessions.get(activeId);
        if (!s) {
          const def = config.agents.find((a) => a.id === activeId);
          if (!def) return;
          s = mgr.ensure(def);
        }
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
      <div class="term-mount" ref={mount} />
    </div>
  );
}
