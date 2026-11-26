import type { Cell } from "./gridEdits";
import { identifier } from "./routineTest";
import type { SqlColumn } from "./types";

interface CellOptions {
  format: "csv" | "tsv";
  headers?: readonly string[];
  nullAs?: string;
}

export function serializeCells(rows: readonly (readonly Cell[])[], options: CellOptions) {
  const { format, headers, nullAs = "" } = options;
  const csv = format === "csv";
  const delimiter = csv ? "," : "\t";
  const escape = (text: string) => text.includes(delimiter) || /["\t\r\n]/.test(text)
    ? '"' + text.replace(/"/g, '""') + '"' : text;
  const records = headers ? [headers, ...rows] : rows;
  return records.map((row) => row.map((cell) => escape(cell ?? nullAs)).join(delimiter))
    .join(csv ? "\r\n" : "\n");
}

export function copyGridCells(rows: Cell[][], csv: boolean, options: Omit<CellOptions, "format"> = {}) {
  return serializeCells(rows, { ...options, format: csv ? "csv" : "tsv" });
}

export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && !started) {
      quoted = started = true;
    } else if (char === "\t" || char === "\n" || char === "\r") {
      row.push(field);
      field = "";
      started = false;
      if (char !== "\t") {
        rows.push(row);
        row = [];
        if (char === "\r" && text[i + 1] === "\n") i++;
      }
    } else {
      field += char;
      started = true;
    }
  }
  if (started || row.length || !rows.length) rows.push([...row, field]);
  return rows;
}

function literal(value: Cell, column: SqlColumn): string {
  if (value === null) return "NULL";
  if (column.numeric && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return value;
  const quoted = "'" + value.replace(/'/g, "''") + "'";
  const type = column.type_name.toUpperCase();
  if (type === "DATE" || type.startsWith("TIMESTAMP")) {
    let format = value.startsWith("-") ? "SYYYY-MM-DD" : "YYYY-MM-DD";
    if (value.includes(":")) format += " HH24:MI:SS";
    if (value.includes(".")) format += ".FF";
    const zoned = / [+-]\d{2}:\d{2}$/.test(value);
    if (zoned) format += " TZH:TZM";
    const convert = type === "DATE" ? "TO_DATE" : zoned ? "TO_TIMESTAMP_TZ" : "TO_TIMESTAMP";
    return convert + "(" + quoted + ", '" + format + "')";
  }
  return quoted;
}

export function copyAsInsert(table: string | readonly string[], columns: readonly SqlColumn[], rows: readonly (readonly Cell[])[]) {
  const name = (typeof table === "string" ? table.split(".") : table).map(identifier).join(".");
  const names = columns.map((column) => identifier(column.name)).join(", ");
  return rows.map((row) => {
    const values = columns.map((column, index) => literal(row[index] ?? null, column));
    return "INSERT INTO " + name + " (" + names + ") VALUES (" + values.join(", ") + ");";
  }).join("\n");
}

export function withBom(csv: string): string {
  return csv.startsWith("\ufeff") ? csv : "\ufeff" + csv;
}

export type GridTotal = "count" | "sum" | "min" | "max" | "average";

export function gridTotal(values: Iterable<Cell>, operation: GridTotal) {
  let total = 0n;
  let places = 0;
  let count = 0;
  for (const value of values) {
    if (value === null) continue;
    count++;
    if (operation === "count") continue;
    const parsed = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(value.trim());
    if (!parsed || !(parsed[2] || parsed[3])) return null;
    const fraction = parsed[3] ?? "";
    const scale = fraction.length - Number(parsed[4] ?? 0);
    if (Math.abs(scale) > 400) return null;
    const digits = BigInt(parsed[1] + parsed[2] + fraction);
    const nextPlaces = Math.max(places, scale);
    const previous = total * 10n ** BigInt(nextPlaces - places);
    const current = digits * 10n ** BigInt(nextPlaces - scale);
    if (operation === "min") total = count === 1 || current < previous ? current : previous;
    else if (operation === "max") total = count === 1 || current > previous ? current : previous;
    else total = previous + current;
    places = nextPlaces;
  }
  if (operation === "count") return String(count);
  if (!count) return null;
  if (operation === "average") {
    const divisor = BigInt(count);
    const scaled = total * 10n ** 12n;
    const rounded = (scaled < 0n ? -scaled : scaled) + divisor / 2n;
    total = (scaled < 0n ? -rounded : rounded) / divisor;
    places += 12;
  }
  if (!places) return total.toString();
  const digits = (total < 0n ? -total : total).toString().padStart(places + 1, "0");
  const fraction = digits.slice(-places).replace(/0+$/, "");
  return (total < 0n ? "-" : "") + digits.slice(0, -places) + (fraction ? `.${fraction}` : "");
}
