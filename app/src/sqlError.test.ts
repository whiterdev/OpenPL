import { expect, test } from "vitest";
import { formatConsoleError, locateError } from "./sqlError";

test("convierte el offset UTF-8 en columna y conserva el fragmento", () => {
  const sql = "SELECT 'á😀', missing\nFROM dual";
  const offset = new TextEncoder().encode(sql.slice(0, sql.indexOf("missing"))).length;
  expect(locateError(sql, { message: "", offset })).toEqual({
    line: 1, column: 14, snippet: "SELECT 'á😀', missing", caret: "             ^",
  });
});

test.each(["line 2, column 3", "línea 2, columna 3"])("interpreta la posición de ORA-06550: %s", (message) => {
  const loc = locateError("BEGIN\r\n  broken;\r\nEND;", { message, offset: null });
  expect(loc).toEqual({ line: 2, column: 3, snippet: "  broken;", caret: "  ^" });
  expect(formatConsoleError("ORA-06550", message, loc)).toEqual([
    `ORA-06550: ${message}`, "Línea 2, columna 3", "  broken;", "  ^",
  ]);
});

test("sin posición verificable devuelve null", () => {
  expect(locateError("SELECT 1", { message: "Error", offset: null })).toBeNull();
  expect(locateError("SELECT 1", { message: "line 4, column 99", offset: 200 })).toBeNull();
});
