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
/** CLIs often wrap a few columns short of the real edge (padding/margins). */
const EDGE_SLACK = 12;

interface CellPos {
  /** 1-based buffer row. */
  y: number;
  /** 0-based column. */
  x: number;
}

interface RowInfo {
  /** Cells as [char, col] with trailing blanks dropped. */
  cells: Array<[string, number]>;
  /** Index into `cells` of the first non-blank cell. */
  first: number;
  /** Last non-blank column, or -1 for an empty row. */
  lastCol: number;
  reachesEdge: boolean;
  /** Last whitespace-delimited token of the row. */
  lastToken: string;
  /** True if the row holds a single token with no inner whitespace. */
  singleToken: boolean;
}

function readRow(term: Terminal, row0: number, scratch: IBufferCell): RowInfo | undefined {
  const line = term.buffer.active.getLine(row0);
  if (!line) return undefined;
  const cells: Array<[string, number]> = [];
  for (let col = 0; col < term.cols; col++) {
    const cell = line.getCell(col, scratch);
    if (!cell || cell.getWidth() === 0) continue; // wide-char continuation cell
    cells.push([cell.getChars() || " ", col]);
  }
  let end = cells.length;
  while (end > 0 && cells[end - 1][0] === " ") end--;
  cells.length = end;
  let first = 0;
  while (first < cells.length && cells[first][0] === " ") first++;
  const text = cells.slice(first).map((c) => c[0]).join("");
  const lastCol = end > 0 ? cells[end - 1][1] : -1;
  return {
    cells,
    first,
    lastCol,
    reachesEdge: lastCol === term.cols - 1,
    lastToken: text.split(/\s+/).pop() ?? "",
    singleToken: text.length > 0 && !/\s/.test(text),
  };
}

function collectWindow(
  term: Terminal,
  startRow0: number,
): { text: string; positions: CellPos[] } {
  const buf = term.buffer.active;
  const scratch = buf.getNullCell();
  const cache = new Map<number, RowInfo | undefined>();
  const info = (r: number) => {
    if (!cache.has(r)) cache.set(r, readRow(term, r, scratch));
    return cache.get(r);
  };

  // Does row r continue onto row r+1? A row at the buffer edge always does
  // (real or CLI-side wrap). A row that stops just short of the edge only
  // does when it ends in a URL fragment, to avoid gluing unrelated prose.
  const continues = (r: number, depth = 0): boolean => {
    const row = info(r);
    const next = info(r + 1);
    if (!row || !next || next.lastCol < 0) return false;
    if (row.reachesEdge) return true;
    if (row.lastCol < term.cols - 1 - EDGE_SLACK) return false;
    if (/https?:\/\//i.test(row.lastToken)) return true;
    return row.singleToken && depth < MAX_WINDOW_ROWS && r > 0 && continues(r - 1, depth + 1);
  };

  let top = startRow0;
  let bottom = startRow0;
  while (top > 0 && startRow0 - top < MAX_WINDOW_ROWS && continues(top - 1)) top--;
  while (bottom - top < MAX_WINDOW_ROWS && continues(bottom)) bottom++;

  let text = "";
  const positions: CellPos[] = [];
  for (let row = top; row <= bottom; row++) {
    const r = info(row);
    if (!r) continue;
    // Rows that follow a join drop their indentation; the first row keeps
    // its leading blanks so link columns stay correct.
    const from = row === top ? 0 : r.first;
    for (let i = from; i < r.cells.length; i++) {
      const [ch, col] = r.cells[i];
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
