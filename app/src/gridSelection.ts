import type { Cell } from "./gridEdits";

export function copyGridCells(rows: Cell[][], csv: boolean) {
  return rows.map((row) => row.map((cell) => {
    const text = cell ?? "";
    return csv && /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(csv ? "," : "\t")).join(csv ? "\r\n" : "\n");
}

export function sumGridNumbers(values: Iterable<Cell>) {
  let total = 0n;
  let places = 0;
  let hasValue = false;
  for (const value of values) {
    if (value === null) continue;
    const parsed = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(value.trim());
    if (!parsed || !(parsed[2] || parsed[3])) return null;
    const fraction = parsed[3] ?? "";
    const scale = fraction.length - Number(parsed[4] ?? 0);
    if (Math.abs(scale) > 400) return null;
    const digits = BigInt(parsed[1] + parsed[2] + fraction);
    const nextPlaces = Math.max(places, scale);
    total = total * 10n ** BigInt(nextPlaces - places) + digits * 10n ** BigInt(nextPlaces - scale);
    places = nextPlaces;
    hasValue = true;
  }
  if (!hasValue) return null;
  if (!places) return total.toString();
  const digits = (total < 0n ? -total : total).toString().padStart(places + 1, "0");
  const fraction = digits.slice(-places).replace(/0+$/, "");
  return (total < 0n ? "-" : "") + digits.slice(0, -places) + (fraction ? `.${fraction}` : "");
}
