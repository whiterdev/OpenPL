type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Color no válido: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb) {
  return "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

function luminance(hex: string) {
  const [r, g, b] = parseHex(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Relación de contraste WCAG 2.x entre dos colores hex opacos (1 a 21). */
export function contrastRatio(hexA: string, hexB: string): number {
  const [hi, lo] = [luminance(hexA), luminance(hexB)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Resuelve un color hex o rgba() sobre un fondo opaco y devuelve el hex resultante. */
export function flatten(color: string, background: string): string {
  const rgba = color.trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (!rgba) return toHex(parseHex(color));
  const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
  const bg = parseHex(background);
  return toHex([0, 1, 2].map((i) => Number(rgba[i + 1]) * alpha + bg[i] * (1 - alpha)) as Rgb);
}
