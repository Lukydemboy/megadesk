import type { IBufferCell, IDisposable, ILink, Terminal } from "@xterm/xterm";

/**
 * Custom link provider used instead of @xterm/addon-web-links.
 *
 * The stock addon only joins a link across rows when xterm's own soft-wrap
 * flag (`isWrapped`) says the next row continues the current one. Agent
 * CLIs commonly do their own text wrapping (e.g. TUI frameworks that wrap
 * at the reported terminal width and emit a hard line break), which
 * produces two "unwrapped" rows that visually look wrapped but aren't
 * flagged as such — the stock addon then only matches the URL fragment on
 * one row and drops the rest.
 *
 * Instead of trusting `isWrapped`, this provider treats any row whose last
 * cell is non-blank as "possibly continues onto the next row" and stitches
 * such rows together before running the URL regex, so both real soft-wraps
 * and CLI-side hard-wraps are reconstructed correctly.
 */

const URL_REGEX =
  /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~\[\]`()<>]/;

const MAX_WINDOW_ROWS = 40;

interface CellPos {
  /** 1-based buffer row. */
  y: number;
  /** 0-based column. */
  x: number;
}

function rowReachesEdge(term: Terminal, rowIndex0: number, scratch: IBufferCell): boolean {
  const line = term.buffer.active.getLine(rowIndex0);
  if (!line) return false;
  const last = line.getCell(term.cols - 1, scratch);
  if (!last) return false;
  const ch = last.getChars();
  return ch !== "" && ch !== " ";
}

function collectWindow(
  term: Terminal,
  startRow0: number,
): { text: string; positions: CellPos[] } {
  const buf = term.buffer.active;
  const cols = term.cols;
  const scratch = buf.getNullCell();

  let top = startRow0;
  let bottom = startRow0;

  while (top > 0 && startRow0 - top < MAX_WINDOW_ROWS && rowReachesEdge(term, top - 1, scratch)) {
    top--;
  }
  while (bottom - top < MAX_WINDOW_ROWS && rowReachesEdge(term, bottom, scratch) && buf.getLine(bottom + 1)) {
    bottom++;
  }

  let text = "";
  const positions: CellPos[] = [];
  for (let row = top; row <= bottom; row++) {
    const line = buf.getLine(row);
    if (!line) continue;
    for (let col = 0; col < cols; col++) {
      const cell = line.getCell(col, scratch);
      if (!cell || cell.getWidth() === 0) continue; // wide-char continuation cell
      const ch = cell.getChars() || " ";
      for (let k = 0; k < ch.length; k++) positions.push({ y: row + 1, x: col });
      text += ch;
    }
  }
  return { text, positions };
}

export function registerWrappingLinkProvider(
  term: Terminal,
  onActivate: (event: MouseEvent, uri: string) => void,
): IDisposable {
  return term.registerLinkProvider({
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
      const { text, positions } = collectWindow(term, bufferLineNumber - 1);
      const links: ILink[] = [];
      const re = new RegExp(URL_REGEX.source, "g");
      let match: RegExpExecArray | null;
      while ((match = re.exec(text))) {
        const uri = match[0];
        const startPos = positions[match.index];
        if (!startPos) continue;
        const endIdx = match.index + uri.length;
        let endPos = positions[endIdx];
        if (!endPos) {
          const lastPos = positions[endIdx - 1];
          if (!lastPos) continue;
          endPos = { y: lastPos.y, x: lastPos.x + 1 };
        }
        // Only report the link on rows it actually touches; xterm calls
        // provideLinks per-row and re-asks neighbouring rows as needed.
        if (bufferLineNumber < startPos.y || bufferLineNumber > endPos.y) continue;
        links.push({
          text: uri,
          range: {
            start: { x: startPos.x + 1, y: startPos.y },
            end: { x: endPos.x + 1, y: endPos.y },
          },
          activate(event: MouseEvent) {
            onActivate(event, uri);
          },
        });
      }
      callback(links.length ? links : undefined);
    },
  });
}
