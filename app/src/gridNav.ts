export interface GridPoint { row: number; col: number }

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
