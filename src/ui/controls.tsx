import { For, type JSX } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";

/* ---------- dialog shell ---------- */

export function Dialog(props: {
  title: string;
  onClose: () => void;
  children: JSX.Element;
  footer: JSX.Element;
}) {
  return (
    <div
      class="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div class="dialog">
        <div class="dialog-title">{props.title}</div>
        <div class="dialog-body">{props.children}</div>
        <div class="dialog-footer">{props.footer}</div>
      </div>
    </div>
  );
}

/* ---------- form controls ---------- */

export function Field(props: { label: string; children: JSX.Element }) {
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      {props.children}
    </label>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  type?: string;
  step?: string;
}) {
  return (
    <Field label={props.label}>
      <input
        class="field-input"
        type={props.type ?? "text"}
        step={props.step}
        value={props.value}
        placeholder={props.placeholder ?? ""}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
    </Field>
  );
}

/** A path field with a native folder picker alongside the text input. */
export function PathField(props: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  let input!: HTMLInputElement;
  const browse = async () => {
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        title: props.label,
        defaultPath: input.value.trim() || props.placeholder || undefined,
      });
      if (typeof picked === "string") props.onChange(picked);
    } catch (e) {
      console.error("folder picker failed", e);
    }
  };
  return (
    <div class="field">
      <span class="field-label">{props.label}</span>
      <div class="field-row">
        <input
          ref={input}
          class="field-input"
          value={props.value}
          placeholder={props.placeholder}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
        <button type="button" class="browse-btn" onClick={browse}>
          Browse…
        </button>
      </div>
    </div>
  );
}

export function SelectField(props: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={props.label}>
      <select
        class="field-input"
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
      >
        <For each={props.options}>
          {(o) => <option value={o.value}>{o.label}</option>}
        </For>
      </select>
    </Field>
  );
}
