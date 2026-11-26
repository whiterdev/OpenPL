import { expect, test } from "vitest";
import { copyAsInsert, copyGridCells, parseTsv, serializeCells, withBom } from "./gridSelection";
import type { SqlColumn } from "./types";

test("TSV conserva tabulaciones, saltos y comillas al copiar y pegar", () => {
  const rows = [["a\tb", 'c"d', "e\r\nf"], ["x", "", null]];
  const tsv = copyGridCells(rows, false);
  expect(tsv).toBe('"a\tb"\t"c""d"\t"e\r\nf"\nx\t\t');
  expect(parseTsv(tsv)).toEqual([rows[0], ["x", "", ""]]);
});

test("CSV incluye encabezados y un texto configurable para NULL", () => {
  expect(serializeCells([["a,b", null]], {
    format: "csv", headers: ["COD", "VALOR"], nullAs: "NULL",
  })).toBe('COD,VALOR\r\n"a,b",NULL');
  expect(withBom("texto")).toBe("\ufefftexto");
  expect(withBom("\ufefftexto")).toBe("\ufefftexto");
});

test("parseTsv conserva filas vacías interiores y acepta CRLF final", () => {
  expect(parseTsv("a\tb\r\n\r\nc\td\r\n")).toEqual([["a", "b"], [""], ["c", "d"]]);
});

test("genera texto INSERT con identificadores, nulos y fechas", () => {
  const columns: SqlColumn[] = [
    { name: "ID", numeric: true, lob: false, type_name: "NUMBER" },
    { name: "Nombre", numeric: false, lob: false, type_name: "VARCHAR2" },
    { name: "ALTA", numeric: false, lob: false, type_name: "DATE" },
    { name: "MARCA", numeric: false, lob: false, type_name: "TIMESTAMP(6)" },
    { name: "COMENTARIO", numeric: false, lob: false, type_name: "VARCHAR2" },
  ];
  expect(copyAsInsert(["HR", "Clientes"], columns, [
    ["7", "O'Neil", "2026-11-24 10:20:30", "2026-11-24 10:20:30.12", null],
  ])).toBe("INSERT INTO HR.\"Clientes\" (ID, \"Nombre\", ALTA, MARCA, COMENTARIO) VALUES " +
    "(7, 'O''Neil', TO_DATE('2026-11-24 10:20:30', 'YYYY-MM-DD HH24:MI:SS'), " +
    "TO_TIMESTAMP('2026-11-24 10:20:30.12', 'YYYY-MM-DD HH24:MI:SS.FF'), NULL);");
});
