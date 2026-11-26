export interface GridPoint { row: number; col: number }
export interface GridRange { anchor: GridPoint; focus: GridPoint }
export interface GridSelection extends GridPoint {
  scope?: "row" | "all";
  ranges?: GridRange[];
}

export function selectRange(selection: GridSelection, focus: GridPoint, mode: "extend" | "add"): GridSelection {
  const ranges = selection.ranges ?? [{ anchor: selection, focus: selection }];
  const last = ranges[ranges.length - 1];
  return {
    ...focus,
    ranges: mode === "add"
      ? [...ranges, { anchor: focus, focus }]
      : [...ranges.slice(0, -1), { anchor: last.anchor, focus }],
  };
}

export function inSelection(selection: GridSelection | null, row: number, col: number): boolean {
  if (!selection) return false;
  if (selection.scope === "all") return true;
  if (selection.scope === "row") return selection.row === row;
  if (!selection.ranges) return selection.row === row && selection.col === col;
  return selection.ranges.some(({ anchor, focus }) =>
    row >= Math.min(anchor.row, focus.row) && row <= Math.max(anchor.row, focus.row) &&
    col >= Math.min(anchor.col, focus.col) && col <= Math.max(anchor.col, focus.col),
  );
}

export function selectedCells<T>(rows: T[][], selection: GridSelection): T[][] {
  if (selection.scope === "all") return rows;
  if (!selection.scope && !selection.ranges) {
    const row = rows[selection.row];
    return row ? [row.slice(selection.col, selection.col + 1)] : [];
  }
  return rows.flatMap((row, index) => {
    const cells = row.filter((_, col) => inSelection(selection, index, col));
    return cells.length ? [cells] : [];
  });
}

interface GridBounds { rows: number; cols: number; page: number }
interface GridKey { key: string; ctrlKey?: boolean; metaKey?: boolean }

export function moveCell(position: GridPoint, event: GridKey, bounds: GridBounds): GridPoint | null {
  if (bounds.rows < 1 || bounds.cols < 1) return null;
  const jump = event.ctrlKey || event.metaKey;
  const page = Math.max(1, bounds.page);
  let { row, col } = position;
  switch (event.key) {
    case "ArrowUp": row -= 1; break;
    case "ArrowDown": row += 1; break;
    case "ArrowLeft": col -= 1; break;
    case "ArrowRight": col += 1; break;
    case "Home": if (jump) row = 0; col = 0; break;
    case "End": if (jump) row = bounds.rows - 1; col = bounds.cols - 1; break;
    case "PageUp": row -= page; break;
    case "PageDown": row += page; break;
    default: return null;
  }
  return {
    row: Math.max(0, Math.min(row, bounds.rows - 1)),
    col: Math.max(0, Math.min(col, bounds.cols - 1)),
  };
}
