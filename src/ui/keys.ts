import { bumpFontSize, zoomedPane } from "../core/store";
import { cycleTab, selectTabByIndex, toggleZoom } from "../core/layout";
import { isPaletteOpen, toggleCommandPalette } from "./overlays";

export function installKeys() {
  // Capture phase: the focused xterm terminal calls stopPropagation on keys it
  // handles, so a bubble-phase listener never sees Cmd+Enter (and the other
  // chords) while the cursor is in a terminal. Capturing on window runs before
  // the event ever reaches the terminal's textarea, so the shortcuts fire no
  // matter what's focused.
  window.addEventListener(
    "keydown",
    (e) => {
      // Since this runs in the capture phase, ahead of the focused terminal,
      // swallow every key we act on so it can't also reach the pty.
      const claim = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      // Esc leaves a zoomed pane (the palette handles its own Esc first).
      if (e.key === "Escape" && zoomedPane() && !isPaletteOpen()) {
        claim();
        toggleZoom();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // Cmd/Ctrl + K  — open (or close) the jump-to-agent palette
      if (e.key === "k" || e.key === "K") {
        claim();
        toggleCommandPalette();
        return;
      }
      // The palette owns the keyboard while it's open.
      if (isPaletteOpen()) return;
      // Cmd/Ctrl + Enter  — zoom the focused pane to fill the grid, or restore
      if (e.key === "Enter") {
        claim();
        toggleZoom();
        return;
      }
      // Cmd/Ctrl + ] / [  — switch terminal within the focused pane
      if (e.key === "]" || e.key === "[") {
        claim();
        cycleTab(e.key === "]" ? 1 : -1);
      }
      // Cmd/Ctrl + 1..9  — jump to the Nth tab in the focused pane (9 = last)
      else if (e.key >= "1" && e.key <= "9") {
        claim();
        selectTabByIndex(Number(e.key));
      }
      // Cmd/Ctrl + +/-/0  — terminal font size
      else if (e.key === "=" || e.key === "+") {
        claim();
        bumpFontSize(1);
      } else if (e.key === "-" || e.key === "_") {
        claim();
        bumpFontSize(-1);
      } else if (e.key === "0") {
        claim();
        bumpFontSize(0);
      }
    },
    true,
  );
}
