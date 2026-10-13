export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** A drag handle between two flex siblings; `onMove` gets the pointer
 *  coordinate along the drag axis and the parent's rect. */
export function Gutter(props: {
  dir: "h" | "v";
  onMove: (coord: number, rect: DOMRect) => void;
  onDone: () => void;
}) {
  let g!: HTMLDivElement;
  const down = (e: MouseEvent) => {
    e.preventDefault();
    const rect = g.parentElement!.getBoundingClientRect();
    document.body.style.cursor = props.dir === "h" ? "row-resize" : "col-resize";
    const move = (ev: MouseEvent) =>
      props.onMove(props.dir === "h" ? ev.clientY : ev.clientX, rect);
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      props.onDone();
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  return (
    <div
      ref={g}
      class={props.dir === "h" ? "gutter gutter-h" : "gutter gutter-v"}
      onMouseDown={down}
    />
  );
}
