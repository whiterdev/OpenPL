import type { SqlColumn } from "./types";

interface TableOptions {
  linesize: number;
  pagesize: number;
  heading: boolean;
}

export function formatTable(
  columns: readonly SqlColumn[],
  rows: readonly (readonly (string | null)[])[],
  { linesize, pagesize, heading }: TableOptions,
): string[] {
  if (!columns.length || !rows.length) return [];
  const limit = Math.max(1, Math.floor(linesize));
  const pageSize = pagesize >= 1 ? Math.floor(pagesize) : rows.length;
  const cell = (value: string | null | undefined) => (value ?? "").replace(/[\r\n\t]+/g, " ");
  const widths = columns.map(({ name }, index) =>
    rows.reduce((width, row) => Math.min(limit, Math.max(width, cell(row[index]).length)),
      Math.min(limit, Math.max(1, name.length))),
  );
  const gap = "  ";
  const groups: number[][] = [[]];
  let groupWidth = 0;
  for (const [index, width] of widths.entries()) {
    if (groupWidth && groupWidth + gap.length + width > limit) {
      groups.push([]);
      groupWidth = 0;
    }
    groups[groups.length - 1].push(index);
    groupWidth += (groupWidth ? gap.length : 0) + width;
  }

  function clipped(text: string, width: number) {
    return text.length > width ? text.slice(0, width - 1) + "…" : text;
  }

  const lines: string[] = [];
  for (let from = 0; from < rows.length; from += pageSize) {
    const page = rows.slice(from, from + pageSize);
    for (const group of groups) {
      if (heading) {
        lines.push(group.map((index) => clipped(columns[index].name, widths[index]).padEnd(widths[index])).join(gap).trimEnd());
        lines.push(group.map((index) => "-".repeat(widths[index])).join(gap));
      }
      for (const row of page) {
        lines.push(group.map((index) => {
          const width = widths[index];
          const text = clipped(cell(row[index]), width);
          return columns[index].numeric ? text.padStart(width) : text.padEnd(width);
        }).join(gap).trimEnd());
      }
    }
  }
  return lines;
}

export function feedbackLine(count: number): string {
  if (count === 0) return "ninguna fila seleccionada.";
  if (count === 1) return "1 fila seleccionada.";
  return count + " filas seleccionadas.";
}
