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

export type IconName = keyof typeof ICONS;

/** An <svg> line-icon for use inside a button. */
export function Icon(props: { name: IconName }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      innerHTML={ICONS[props.name] ?? ""}
    />
  );
}
