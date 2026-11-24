import type { Cell } from "./gridEdits";

export function copyGridCells(rows: Cell[][], csv: boolean) {
  return rows.map((row) => row.map((cell) => {
    const text = cell ?? "";
    return csv && /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(csv ? "," : "\t")).join(csv ? "\r\n" : "\n");
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
