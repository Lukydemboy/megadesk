import { createSignal } from "solid-js";
import type { AgentDef, PaneRef } from "../core/types";

/* ---------- which overlay is open ---------- */

export interface AgentDialogState {
  existing?: AgentDef;
  targetPane?: PaneRef;
}

export const [agentDialog, setAgentDialog] = createSignal<AgentDialogState | null>(
  null,
);
export const [settingsOpen, setSettingsOpen] = createSignal(false);
export const [paletteOpen, setPaletteOpen] = createSignal(false);

export function openAgentDialog(existing?: AgentDef, targetPane?: PaneRef) {
  setAgentDialog({ existing, targetPane });
}
export function closeAgentDialog() {
  setAgentDialog(null);
}
export function openSettingsDialog() {
  setSettingsOpen(true);
}
export function isPaletteOpen() {
  return paletteOpen();
}
export function toggleCommandPalette() {
  setPaletteOpen((v) => !v);
}
