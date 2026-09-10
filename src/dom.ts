import { open } from "@tauri-apps/plugin-dialog";

/* ---------- tiny DOM utils ---------- */

/** The single mount point for the whole UI. */
export const app = document.getElementById("app")!;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/* Line-icons (Lucide geometry), sized in CSS and centred by the button's
   flexbox — text glyphs never sat centred across ⚙ / ⟳ / ■. */
const ICONS: Record<string, string> = {
  gear:
    '<circle cx="12" cy="12" r="3.2"/>' +
    '<path d="M12 2.5v3M12 18.5v3M4.2 6.2l2.1 2.1M17.7 15.7l2.1 2.1' +
    'M2.5 12h3M18.5 12h3M4.2 17.8l2.1-2.1M17.7 8.3l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  restart:
    '<path d="M3 11a9 9 0 0 1 15-5.6L21 8"/><path d="M21 3v5h-5"/>' +
    '<path d="M21 13a9 9 0 0 1-15 5.6L3 16"/><path d="M3 21v-5h5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
  zoom:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3' +
    'M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  unzoom:
    '<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3' +
    'M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>',
};

/** An <svg> line-icon element for use inside a button. */
export function icon(name: keyof typeof ICONS | string): SVGElement {
  const wrap = el("div");
  wrap.innerHTML =
    `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `${ICONS[name] ?? ""}</svg>`;
  return wrap.firstElementChild as SVGElement;
}

export function makeGutter(
  dir: "h" | "v",
  onMove: (coord: number, rect: DOMRect) => void,
): HTMLElement {
  const g = el("div", dir === "h" ? "gutter gutter-h" : "gutter gutter-v");
  g.onmousedown = (e) => {
    e.preventDefault();
    const parent = g.parentElement!;
    const rect = parent.getBoundingClientRect();
    document.body.style.cursor = dir === "h" ? "row-resize" : "col-resize";
    const move = (ev: MouseEvent) =>
      onMove(dir === "h" ? ev.clientY : ev.clientX, rect);
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  return g;
}

/* ---------- form controls ---------- */

export function field(
  label: string,
  setup: (input: HTMLInputElement) => void,
): HTMLElement {
  const wrap = el("label", "field");
  const span = el("span", "field-label");
  span.textContent = label;
  const input = el("input", "field-input");
  setup(input);
  wrap.appendChild(span);
  wrap.appendChild(input);
  return wrap;
}

/** A path field with a native folder picker alongside the text input. */
export function pathField(
  label: string,
  value: string,
  placeholder: string,
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = el("div", "field");
  const span = el("span", "field-label");
  span.textContent = label;

  const row = el("div", "field-row");
  const input = el("input", "field-input");
  input.value = value;
  input.placeholder = placeholder;
  input.oninput = () => onChange(input.value);

  const browse = el("button", "browse-btn");
  browse.type = "button";
  browse.textContent = "Browse…";
  browse.onclick = async () => {
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        title: label,
        defaultPath: input.value.trim() || placeholder || undefined,
      });
      if (typeof picked === "string") {
        input.value = picked;
        onChange(picked);
      }
    } catch (e) {
      console.error("folder picker failed", e);
    }
  };

  row.appendChild(input);
  row.appendChild(browse);
  wrap.appendChild(span);
  wrap.appendChild(row);
  return wrap;
}

export function select(
  label: string,
  options: { value: string; label: string }[],
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = el("label", "field");
  const span = el("span", "field-label");
  span.textContent = label;
  const sel = el("select", "field-input");
  for (const o of options) {
    const opt = el("option");
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = value;
  sel.onchange = () => onChange(sel.value);
  wrap.appendChild(span);
  wrap.appendChild(sel);
  return wrap;
}

/* ---------- overlays ---------- */

/** Transient in-app notification, bottom-right, styled like the rest of the UI. */
export function showToast(message: string, kind: "info" | "warn" = "info") {
  let host = document.getElementById("toasts");
  if (!host) {
    host = el("div");
    host.id = "toasts";
    document.body.appendChild(host);
  }

  const t = el("div", `toast toast-${kind}`);
  const msg = el("span", "toast-msg");
  msg.textContent = message;
  t.appendChild(msg);

  const x = el("button", "toast-x");
  x.textContent = "×";
  t.appendChild(x);

  let closed = false;
  const dismiss = () => {
    if (closed) return;
    closed = true;
    t.classList.remove("in");
    setTimeout(() => t.remove(), 180);
  };
  x.onclick = dismiss;

  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("in"));
  setTimeout(dismiss, 6000);
}

export function makeDialog(title: string) {
  const overlay = el("div", "overlay");
  const dialog = el("div", "dialog");
  const h = el("div", "dialog-title");
  h.textContent = title;
  const body = el("div", "dialog-body");
  const footer = el("div", "dialog-footer");
  const close = () => overlay.remove();
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
  dialog.appendChild(h);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);
  return { overlay, dialog, body, footer, close };
}
