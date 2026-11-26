import { expect, test } from "vitest";
import { feedbackLine, formatTable } from "./sqlplusFormat";
import type { SqlColumn } from "./types";

const columns: SqlColumn[] = [
  { name: "ID", type_name: "NUMBER", numeric: true, lob: false },
  { name: "NOMBRE", type_name: "VARCHAR2", numeric: false, lob: false },
];
const rows = [["10", "Ana"], ["2", null]];

test("alinea los números y representa NULL con un campo vacío", () => {
  expect(formatTable(columns, rows, { linesize: 80, pagesize: 0, heading: true })).toEqual([
    "ID  NOMBRE", "--  ------", "10  Ana", " 2",
  ]);
});

test("repite encabezados por página y divide las columnas en tramos", () => {
  expect(formatTable(columns, rows, { linesize: 8, pagesize: 1, heading: true })).toEqual([
    "ID", "--", "10", "NOMBRE", "------", "Ana",
    "ID", "--", " 2", "NOMBRE", "------", "",
  ]);
});

test("limita el ancho y permite ocultar encabezados", () => {
  expect(formatTable(columns, [["10", "abcdefgh"]], { linesize: 5, pagesize: 0, heading: false })).toEqual([
    "10", "abcd…",
  ]);
});

test.each([[0, "ninguna fila seleccionada."], [1, "1 fila seleccionada."], [2, "2 filas seleccionadas."]])(
  "formatea el total de %s filas",
  (count, expected) => expect(feedbackLine(count)).toBe(expected),
);
