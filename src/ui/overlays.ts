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
export const [agentPicker, setAgentPicker] = createSignal<PaneRef | null>(null);
export const [settingsOpen, setSettingsOpen] = createSignal(false);
export const [paletteOpen, setPaletteOpen] = createSignal(false);
export const [branchesDialog, setBranchesDialog] = createSignal<string | null>(null);

export function openAgentDialog(existing?: AgentDef, targetPane?: PaneRef) {
  setAgentDialog({ existing, targetPane });
}
export function closeAgentDialog() {
  setAgentDialog(null);
}
export function openAgentPicker(targetPane: PaneRef) {
  setAgentPicker(targetPane);
}
export function closeAgentPicker() {
  setAgentPicker(null);
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
export function openBranchesDialog(cwd: string) {
  setBranchesDialog(cwd);
}
export function closeBranchesDialog() {
  setBranchesDialog(null);
}
