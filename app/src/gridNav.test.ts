import { expect, test } from "vitest";
import { moveCell } from "./gridNav";

const bounds = { rows: 30, cols: 4, page: 7 };
const origin = { row: 8, col: 2 };
test.each([
  ["ArrowUp", false, 7, 2], ["ArrowDown", false, 9, 2],
  ["ArrowLeft", false, 8, 1], ["ArrowRight", false, 8, 3],
  ["Home", false, 8, 0], ["End", false, 8, 3],
  ["Home", true, 0, 0], ["End", true, 29, 3],
  ["PageUp", false, 1, 2], ["PageDown", false, 15, 2],
] as const)("%s mueve o pagina la selección", (key, ctrlKey, row, col) => {
  expect(moveCell(origin, { key, ctrlKey }, bounds)).toEqual({ row, col });
});

test("mantiene la celda dentro de la grilla y deja pasar otras teclas", () => {
  expect(moveCell({ row: 0, col: 0 }, { key: "PageUp" }, bounds)).toEqual({ row: 0, col: 0 });
  expect(moveCell(origin, { key: "F8" }, bounds)).toBeNull();
  expect(moveCell(origin, { key: "Home" }, { ...bounds, rows: 0 })).toBeNull();
});
