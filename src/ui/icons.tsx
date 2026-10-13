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
  more:
    '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/>' +
    '<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>' +
    '<circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  open:
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
  copy:
    '<rect x="9" y="9" width="12" height="12" rx="1.5"/>' +
    '<path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  trash:
    '<path d="M4 7h16"/><path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7"/>' +
    '<path d="M6 7l1 13.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1L18 7"/>' +
    '<path d="M10 11v6M14 11v6"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  pr:
    '<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="6" r="2.4"/>' +
    '<path d="M6 8.4V15.6"/><path d="M18 8.4V13a3.5 3.5 0 0 1-3.5 3.5H13"/>' +
    '<path d="M11.5 14.5 13 16.5l-1.5 2"/>',
  /* chat work log */
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  file:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  pencil:
    '<path d="M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2 3 21l4.8-.8z"/><path d="m15 5 4 4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/>' +
    '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  brain:
    '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>' +
    '<path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>' +
    '<path d="M12 5v13"/>',
  list: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
  bot:
    '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4H8"/>' +
    '<path d="M2 14h1M21 14h1M9 13v2M15 13v2"/>',
  wrench:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  drawer: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15h18"/>',
  "arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
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
