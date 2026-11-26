import type { Cell } from "./gridEdits";
import type { SqlColumn } from "./types";

export interface GridSort { column: number; direction: "asc" | "desc" }

interface GridView {
  sort?: GridSort;
  filters: Readonly<Record<number, string>>;
}

export function viewIndexes(rows: readonly (readonly Cell[])[], columns: readonly SqlColumn[], view: GridView): number[] {
  const filters = Object.entries(view.filters)
    .filter(([, value]) => value.length > 0)
    .map(([column, value]) => [Number(column), value.toLocaleLowerCase()] as const);
  const visible: number[] = [];
  rows.forEach((row, index) => {
    if (filters.every(([column, value]) => row[column]?.toLocaleLowerCase().includes(value))) visible.push(index);
  });
  const sort = view.sort;
  if (!sort) return visible;
  const { column, direction } = sort;
  const numeric = columns[column]?.numeric;
  return visible.sort((a, b) => {
    const left = rows[a][column];
    const right = rows[b][column];
    if (left == null || right == null) return Number(left == null) - Number(right == null);
    const numberOrder = numeric ? Number(left) - Number(right) : NaN;
    const order = Number.isNaN(numberOrder)
      ? left.localeCompare(right, undefined, { sensitivity: "base" }) : numberOrder;
    return direction === "asc" ? order : -order;
  });
}
