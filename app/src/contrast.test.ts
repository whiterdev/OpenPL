import { describe, expect, it } from "vitest";
import { contrastRatio, flatten } from "./contrast";

// Vitest vacía los imports ?raw de CSS; el proyecto no tiene @types/node.
type Fs = { readFileSync(path: string, encoding: "utf8"): string };
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): Fs } }).process.getBuiltinModule("node:fs");
const themeCss = fs.readFileSync("src/theme.css", "utf8");

function token(name: string) {
  const match = themeCss.match(new RegExp(`--${name}:\\s*([^;]+);`));
  expect(match, `falta --${name} en theme.css`).not.toBeNull();
  return match![1].trim();
}

describe("contrastRatio", () => {
  it("negro sobre blanco es 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("no depende del orden", () => {
    expect(contrastRatio("#ffffff", "#777777")).toBeCloseTo(contrastRatio("#777777", "#ffffff"), 10);
  });

  it("#777777 sobre blanco queda apenas debajo de 4.5", () => {
    const ratio = contrastRatio("#777777", "#ffffff");
    expect(ratio).toBeCloseTo(4.48, 2);
    expect(ratio).toBeLessThan(4.5);
  });

  it("acepta hex de tres dígitos", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 5);
  });
});

describe("flatten", () => {
  it("deja igual un hex opaco", () => {
    expect(flatten("#c99a3b", "#212327")).toBe("#c99a3b");
  });

  it("mezcla rgba con el fondo", () => {
    expect(flatten("rgba(255, 255, 255, 0.5)", "#000000")).toBe("#808080");
  });
});

describe("tema", () => {
  it("los comentarios contrastan 4.5:1 sobre el fondo del editor", () => {
    expect(contrastRatio(token("cm"), token("s0"))).toBeGreaterThanOrEqual(4.5);
  });

  it("los comentarios contrastan 4.5:1 sobre la línea activa", () => {
    const activeLine = flatten(token("activeLine"), token("s0"));
    expect(contrastRatio(token("cm"), activeLine)).toBeGreaterThanOrEqual(4.5);
  });

  it("los comentarios contrastan 4.5:1 en las líneas cambiadas de la comparación", () => {
    expect(contrastRatio(token("cm"), token("errSoft"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("cm"), token("okSoft"))).toBeGreaterThanOrEqual(4.5);
  });

  it("el texto se lee sobre la selección", () => {
    const selection = flatten(token("sel"), flatten(token("activeLine"), token("s0")));
    expect(contrastRatio(token("text"), selection)).toBeGreaterThanOrEqual(4.5);
  });

  it("la selección y las coincidencias usan colores distintos", () => {
    expect(token("selMatch")).not.toBe(token("sel"));
  });
});
