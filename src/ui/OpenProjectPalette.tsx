import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { uid } from "../core/types";
import { config, homeDir } from "../core/store";
import { baseName } from "../core/layout";
import { assignAgentToPane, revealAgent, upsertAgent } from "../core/agents";
import { closeProjectPalette, openProjectOpen } from "./overlays";
import { fuzzyScore } from "./CommandPalette";

interface DirEntry {
  name: string;
  path: string;
  git: boolean;
}

interface Row {
  /** "up" climbs to the parent folder; "dir" descends into `path`. */
  kind: "up" | "dir";
  label: string;
  path: string;
  git: boolean;
}

export function OpenProjectPalette() {
  return (
    <Show when={openProjectOpen()}>
      <PaletteBox />
    </Show>
  );
}

const sepOf = (p: string) => (p.includes("\\") && !p.includes("/") ? "\\" : "/");

/** Expand a leading `~` so the typed path can be listed and opened. */
function expandHome(p: string): string {
  return p === "~" || /^~[\\/]/.test(p) ? homeDir + p.slice(1) : p;
}

/** Split typed input into the folder being browsed and the name filter. */
function splitQuery(q: string): { dir: string; filter: string } {
  const i = Math.max(q.lastIndexOf("/"), q.lastIndexOf("\\"));
  return { dir: q.slice(0, i + 1), filter: q.slice(i + 1) };
}

/** The parent of a folder path, or null at a filesystem root. */
function parentOf(dir: string): string | null {
  const t = dir.replace(/[\\/]+$/, "");
  const i = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\"));
  if (i < 0 || t === "" || /^[A-Za-z]:$/.test(t)) return null;
  return t.slice(0, i + 1);
}

function PaletteBox() {
  const start = config.settings.defaultCwd || homeDir;
  const [query, setQuery] = createSignal(start.replace(/[\\/]+$/, "") + sepOf(start));
  const [sel, setSel] = createSignal(0);
  let inputEl!: HTMLInputElement;
  let listEl!: HTMLDivElement;

  const close = closeProjectPalette;
  const split = createMemo(() => splitQuery(expandHome(query())));

  const [listing] = createResource(
    () => split().dir,
    async (dir) => {
      try {
        return { dir, entries: await invoke<DirEntry[]>("list_dirs", { path: dir }) };
      } catch {
        return { dir, entries: null };
      }
    },
  );

  // Keep the previous listing on screen while the next one loads, so the
  // list doesn't flash empty on every keystroke that crosses a slash.
  const entries = () => listing.latest?.entries ?? null;

  const rows = createMemo<Row[]>(() => {
    const list = entries();
    if (!list) return [];
    const { dir, filter } = split();
    const showHidden = filter.startsWith(".");
    const out: Row[] = [];
    const parent = parentOf(dir);
    if (parent && !filter) out.push({ kind: "up", label: "..", path: parent, git: false });
    list
      .filter((d) => showHidden || !d.name.startsWith("."))
      .map((d) => ({ d, score: fuzzyScore(d.name, filter) }))
      .filter((r): r is { d: DirEntry; score: number } => r.score !== null)
      .sort((a, b) => b.score - a.score)
      .forEach(({ d }) =>
        out.push({ kind: "dir", label: d.name, path: d.path, git: d.git }),
      );
    return out;
  });

  createEffect(() => {
    if (sel() >= rows().length) setSel(Math.max(0, rows().length - 1));
  });
  createEffect(() => {
    rows();
    sel();
    listEl?.querySelector(".palette-row.sel")?.scrollIntoView({ block: "nearest" });
  });

  /** Put a folder in the input with a trailing separator, so its children list. */
  const descend = (path: string) => {
    setSel(0);
    setQuery(path.replace(/[\\/]+$/, "") + sepOf(path));
    inputEl.focus();
  };

  /** Open a folder as a project agent, or jump to the one already open. */
  const openFolder = (path: string) => {
    const clean = path.length > 1 ? path.replace(/[\\/]+$/, "") : path;
    close();
    const known = config.agents.find((a) => a.kind !== "shell" && a.cwd === clean);
    if (known) {
      revealAgent(known.id);
      return;
    }
    const def = {
      id: uid(),
      name: baseName(clean),
      command: "claude",
      args: [] as string[],
      cwd: clean,
    };
    upsertAgent(def);
    assignAgentToPane(def.id);
  };

  /** The folder ⌘↵ opens: the highlighted one, else the one being browsed. */
  const openTarget = () => {
    const r = rows()[sel()];
    return r && r.kind === "dir" ? r.path : split().dir;
  };

  const onKey = (e: KeyboardEvent) => {
    if (!["Escape", "ArrowDown", "ArrowUp", "Enter", "Tab"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const row = rows()[sel()];
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, rows().length - 1));
    else if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) openFolder(openTarget());
    else if (e.key === "Enter" || e.key === "Tab") {
      if (row) descend(row.path);
      else if (e.key === "Enter") openFolder(openTarget());
    }
  };

  onMount(() => {
    document.addEventListener("keydown", onKey, true);
    inputEl.focus();
    inputEl.setSelectionRange(query().length, query().length);
  });
  onCleanup(() => document.removeEventListener("keydown", onKey, true));

  return (
    <div
      class="overlay palette-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div class="palette" data-testid="open-project-palette">
        <input
          ref={inputEl}
          class="palette-input"
          type="text"
          placeholder="Type a path to a project folder…"
          spellcheck={false}
          value={query()}
          onInput={(e) => {
            setSel(0);
            setQuery(e.currentTarget.value);
          }}
        />
        <div class="palette-list" ref={listEl}>
          <Show
            when={rows().length}
            fallback={
              <div class="palette-empty">
                {entries() === null && !listing.loading
                  ? "Folder not found"
                  : listing.loading
                    ? ""
                    : "No matching folders"}
              </div>
            }
          >
            <For each={rows()}>
              {(r, i) => (
                <div
                  classList={{ "palette-row": true, sel: i() === sel() }}
                  onMouseEnter={() => setSel(i())}
                  onClick={() => descend(r.path)}
                  onDblClick={() => r.kind === "dir" && openFolder(r.path)}
                >
                  <span class="palette-name">{r.label}</span>
                  <Show when={r.git}>
                    <span class="palette-tag">git</span>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>
        <div class="palette-hint">
          <span>↵ browse</span>
          <span>⇥ complete</span>
          <span>⌘↵ open folder</span>
        </div>
      </div>
    </div>
  );
}
