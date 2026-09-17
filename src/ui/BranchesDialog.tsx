import { For, Show, createResource, createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { branchesDialog, closeBranchesDialog } from "./overlays";
import { Dialog } from "./controls";
import { Icon } from "./icons";
import { showToast } from "./Toasts";

interface BranchInfo {
  name: string;
  current: boolean;
  commitTime: number;
  commitHash: string;
  commitSubject: string;
}

/** "3h ago", "5d ago", falling back to a date once it's old enough to matter. */
function relativeTime(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

export function BranchesDialog() {
  return (
    <Show when={branchesDialog()} keyed>
      {(cwd) => <BranchesDialogBody cwd={cwd} />}
    </Show>
  );
}

function BranchesDialogBody(props: { cwd: string }) {
  const [branches, { refetch }] = createResource(
    () => props.cwd,
    (path) => invoke<BranchInfo[]>("git_all_branches", { path }),
  );

  const [pendingDelete, setPendingDelete] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);

  const checkout = async (branch: string) => {
    setBusy(branch);
    try {
      await invoke("git_switch_branch", { path: props.cwd, branch });
      void refetch();
    } catch (e) {
      showToast(`Couldn't switch to "${branch}": ${e}`, "warn");
    } finally {
      setBusy(null);
    }
  };

  const deleteBranch = async (branch: string) => {
    if (pendingDelete() !== branch) {
      setPendingDelete(branch);
      return;
    }
    setPendingDelete(null);
    setBusy(branch);
    try {
      await invoke("git_delete_branch", { path: props.cwd, branch });
      void refetch();
    } catch (e) {
      showToast(`Couldn't delete "${branch}": ${e}`, "warn");
    } finally {
      setBusy(null);
    }
  };

  const openInSource = async (branch: string) => {
    try {
      const url = await invoke<string | null>("git_branch_source_url", {
        path: props.cwd,
        branch,
      });
      if (!url) {
        showToast("No recognized remote to open this branch in", "warn");
        return;
      }
      await invoke("open_url", { url });
    } catch (e) {
      showToast(`Couldn't open branch in source: ${e}`, "warn");
    }
  };

  const createPr = async (branch: string) => {
    try {
      const url = await invoke<string | null>("git_create_pr_url", {
        path: props.cwd,
        branch,
      });
      if (!url) {
        showToast("No recognized remote to open a PR on", "warn");
        return;
      }
      await invoke("open_url", { url });
    } catch (e) {
      showToast(`Couldn't open PR creation page: ${e}`, "warn");
    }
  };

  return (
    <Dialog
      title="Manage branches"
      onClose={closeBranchesDialog}
      wide
      footer={
        <button class="primary-btn" onClick={closeBranchesDialog}>
          Done
        </button>
      }
    >
      <Show
        when={!branches.loading}
        fallback={<div class="dialog-note">Loading branches…</div>}
      >
        <div class="branch-list">
          <For each={branches()}>
            {(b) => (
              <div class="branch-row">
                <div class="branch-row-main">
                  <div class="branch-name">
                    {b.name}
                    <Show when={b.current}>
                      <span class="branch-current-badge">current</span>
                    </Show>
                  </div>
                  <div class="branch-meta">
                    <Show when={b.commitSubject} fallback="No commits">
                      {b.commitSubject} · {relativeTime(b.commitTime)}
                    </Show>
                  </div>
                </div>
                <div class="branch-row-actions">
                  <button
                    class="branch-action-btn"
                    title="Open branch in source"
                    onClick={() => void openInSource(b.name)}
                  >
                    <Icon name="open" />
                  </button>
                  <button
                    class="branch-action-btn"
                    title="Create pull request"
                    onClick={() => void createPr(b.name)}
                  >
                    <Icon name="pr" />
                  </button>
                  <button
                    class="branch-action-btn"
                    title={b.current ? "Already checked out" : `Check out "${b.name}"`}
                    disabled={b.current || busy() === b.name}
                    onClick={() => void checkout(b.name)}
                  >
                    <Icon name="check" />
                  </button>
                  <button
                    classList={{
                      "branch-action-btn": true,
                      danger: pendingDelete() === b.name,
                    }}
                    title={
                      b.current
                        ? "Can't delete the checked-out branch"
                        : pendingDelete() === b.name
                          ? "Click again to confirm"
                          : `Delete "${b.name}"`
                    }
                    disabled={b.current || busy() === b.name}
                    onClick={() => void deleteBranch(b.name)}
                    onBlur={() =>
                      setPendingDelete((cur) => (cur === b.name ? null : cur))
                    }
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
            )}
          </For>
          <Show when={branches()?.length === 0}>
            <div class="dialog-note">No local branches found.</div>
          </Show>
        </div>
      </Show>
    </Dialog>
  );
}
