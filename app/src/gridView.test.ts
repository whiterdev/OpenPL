import { expect, test } from "vitest";
import { viewIndexes } from "./gridView";
import type { SqlColumn } from "./types";

const columns: SqlColumn[] = [
  { name: "NUM", numeric: true, lob: false, type_name: "NUMBER" },
  { name: "TXT", numeric: false, lob: false, type_name: "VARCHAR2" },
];
const rows = [["10", "Beta"], [null, "alfabeto"], ["2", "Alfa"], ["2", "Zeta"]];

test("ordena números y deja los nulos al final en ambas direcciones", () => {
  expect(viewIndexes(rows, columns, { sort: { column: 0, direction: "asc" }, filters: {} })).toEqual([2, 3, 0, 1]);
  expect(viewIndexes(rows, columns, { sort: { column: 0, direction: "desc" }, filters: {} })).toEqual([0, 2, 3, 1]);
});

test("filtra por texto sin distinguir mayúsculas y devuelve índices de origen", () => {
  expect(viewIndexes(rows, columns, { filters: { 1: "ALFA" } })).toEqual([1, 2]);
  expect(viewIndexes(rows, columns, { filters: { 1: "ALFA" }, sort: { column: 1, direction: "asc" } })).toEqual([2, 1]);
});
