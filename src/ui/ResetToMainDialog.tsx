import { Show, createResource, createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { closeResetToMainDialog, resetToMainDialog } from "./overlays";
import { Dialog } from "./controls";
import { showToast } from "./Toasts";

export function ResetToMainDialog() {
  return (
    <Show when={resetToMainDialog()} keyed>
      {(state) => <ResetToMainDialogBody cwd={state.cwd} branch={state.branch} />}
    </Show>
  );
}

function ResetToMainDialogBody(props: { cwd: string; branch: string }) {
  const [defaultBranch] = createResource(
    () => props.cwd,
    (path) => invoke<string | null>("git_default_branch", { path }),
  );
  const [busy, setBusy] = createSignal(false);

  const alreadyOnDefault = () => !!defaultBranch() && defaultBranch() === props.branch;

  const confirm = async () => {
    const target = defaultBranch();
    if (!target || alreadyOnDefault()) return;
    setBusy(true);
    try {
      await invoke("git_switch_branch", { path: props.cwd, branch: target });
      await invoke("git_delete_branch", { path: props.cwd, branch: props.branch });
      closeResetToMainDialog();
    } catch (e) {
      showToast(`Couldn't reset to "${target}": ${e}`, "warn");
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Reset to main"
      onClose={() => !busy() && closeResetToMainDialog()}
      footer={
        <>
          <button
            class="secondary-btn"
            onClick={closeResetToMainDialog}
            disabled={busy()}
          >
            Cancel
          </button>
          <button
            class="danger-btn"
            onClick={() => void confirm()}
            disabled={busy() || defaultBranch.loading || !defaultBranch() || alreadyOnDefault()}
          >
            {busy() ? "Resetting…" : "Reset and delete"}
          </button>
        </>
      }
    >
      <Show
        when={!defaultBranch.loading}
        fallback={<div class="dialog-note">Looking up the default branch…</div>}
      >
        <Show
          when={defaultBranch()}
          fallback={
            <div class="dialog-note">
              Couldn't find a "main" or "master" branch to reset to.
            </div>
          }
        >
          {(target) => (
            <Show
              when={!alreadyOnDefault()}
              fallback={<div class="dialog-note">You're already on "{target()}".</div>}
            >
              <p class="dialog-note">
                This will switch to <strong>{target()}</strong> and permanently delete
                the local branch <strong>{props.branch}</strong>. This can't be undone.
              </p>
            </Show>
          )}
        </Show>
      </Show>
    </Dialog>
  );
}
