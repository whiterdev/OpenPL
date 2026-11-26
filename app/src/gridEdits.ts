// Cambios pendientes de la grilla editable. Las filas leídas llevan el ROWID en la columna 0.
import type { RowChange } from "./types";

export type Cell = string | null;

export function pendingDiscardMessage(count: number): string {
  return count === 1
    ? "Hay 1 cambio sin aplicar. ¿Descartar?"
    : `Hay ${count} cambios sin aplicar. ¿Descartar?`;
}

export type RowEdit =
  { kind: "update"; values: Record<number, Cell> } | { kind: "delete" };

export interface Pending {
  /** Por índice de fila leída. */
  edits: Record<number, RowEdit>;
  /** Filas nuevas, con valores por columna visible. */
  inserts: Cell[][];
}

export const emptyPending = (): Pending => ({ edits: {}, inserts: [] });

export const pendingCount = (p: Pending) =>
  Object.keys(p.edits).length + p.inserts.length;

/** `names[c]`: columna de la tabla que corresponde a la columna visible `c`, o null si no se edita. */
export function buildChanges(
  rows: Cell[][],
  names: (string | null)[],
  pending: Pending,
) {
  const changes: RowChange[] = [];
  const rowsOf: number[] = [];
  const pick = (cells: Cell[]) => {
    const out: Record<string, Cell> = {};
    names.forEach((name, c) => {
      if (name) out[name] = cells[c];
    });
    return out;
  };
  Object.keys(pending.edits)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((index) => {
      const edit = pending.edits[index];
      const [rowid, ...cells] = rows[index];
      const original = pick(cells);
      if (edit.kind === "delete") {
        changes.push({ kind: "Delete", rowid: rowid ?? "", original });
      } else {
        const merged = cells.map((cell, c) =>
          c in edit.values ? edit.values[c] : cell,
        );
        changes.push({
          kind: "Update",
          rowid: rowid ?? "",
          original,
          values: pick(merged),
        });
      }
      rowsOf.push(index);
    });
  pending.inserts.forEach((cells, i) => {
    changes.push({ kind: "Insert", values: pick(cells) });
    rowsOf.push(rows.length + i);
  });
  return { changes, rowsOf };
}

/** Filas tras aplicar: sin las borradas, con los valores nuevos y las insertadas al final. */
export function appliedRows(
  rows: Cell[][],
  pending: Pending,
  inserted: string[],
): Cell[][] {
  const kept: Cell[][] = [];
  rows.forEach((row, index) => {
    const edit = pending.edits[index];
    if (edit?.kind === "delete") return;
    if (edit?.kind === "update") {
      kept.push(
        row.map((cell, raw) =>
          raw > 0 && raw - 1 in edit.values ? edit.values[raw - 1] : cell,
        ),
      );
    } else {
      kept.push(row);
    }
  });
  pending.inserts.forEach((cells, i) =>
    kept.push([inserted[i] ?? null, ...cells]),
  );
  return kept;
}
