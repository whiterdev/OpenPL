import { expect, test } from "vitest";
import { programSymbols, type ProgramSymbol } from "./programSymbols";

const find = (symbols: ProgramSymbol[], name: string) =>
  symbols.filter((symbol) => symbol.name === name);
const one = (symbols: ProgramSymbol[], name: string) => {
  const found = find(symbols, name);
  expect(found).toHaveLength(1);
  return found[0];
};

const spec = (members: string) =>
  `CREATE OR REPLACE PACKAGE pkg_ventas IS\n${members}\nEND pkg_ventas;`;
const body = (members: string) =>
  `CREATE OR REPLACE PACKAGE BODY pkg_ventas IS\n${members}\nEND pkg_ventas;`;

test("constante con valor y tipo", () => {
  const symbol = one(programSymbols(spec("  c_max CONSTANT NUMBER := 3;")), "C_MAX");
  expect(symbol).toMatchObject({
    kind: "constant",
    dataType: "NUMBER",
    value: "3",
    scope: null,
  });
});

test("variable con DEFAULT y variable sin valor", () => {
  const symbols = programSymbols(
    spec("  g_modo VARCHAR2(10) DEFAULT 'A';\n  g_total NUMBER;"),
  );
  expect(one(symbols, "G_MODO")).toMatchObject({
    kind: "variable",
    dataType: "VARCHAR2(10)",
    value: "'A'",
  });
  expect(one(symbols, "G_TOTAL")).toMatchObject({
    kind: "variable",
    dataType: "NUMBER",
    value: null,
  });
});

test("firma de función con modos y comentario", () => {
  const symbols = programSymbols(
    spec(
      "  -- Calcula el total\n  FUNCTION calcular(p_id IN NUMBER, p_out OUT VARCHAR2) RETURN NUMBER;",
    ),
  );
  expect(one(symbols, "CALCULAR")).toMatchObject({
    kind: "function",
    signature:
      "FUNCTION calcular(p_id IN NUMBER, p_out OUT VARCHAR2) RETURN NUMBER",
    comment: "Calcula el total",
    definition: false,
  });
  expect(one(symbols, "P_ID")).toMatchObject({
    kind: "parameter",
    container: "CALCULAR",
    dataType: "NUMBER",
  });
  expect(one(symbols, "P_OUT")).toMatchObject({
    kind: "parameter",
    container: "CALCULAR",
    dataType: "VARCHAR2",
  });
});

test("cuerpo de rutina y locales con alcance", () => {
  const source = body("  PROCEDURE p IS v_x NUMBER := 1; BEGIN NULL; END;");
  const symbols = programSymbols(source);
  expect(one(symbols, "P")).toMatchObject({ kind: "procedure", definition: true });
  const local = one(symbols, "V_X");
  expect(local.scope).not.toBeNull();
  expect(local.scope!.from).toBeLessThanOrEqual(source.indexOf(" IS v_x"));
  expect(local.scope!.to).toBeGreaterThanOrEqual(source.indexOf("END;") + 4);
  expect(local.scope!.to).toBeLessThan(source.indexOf("END pkg_ventas"));
});

test("sobrecargas producen dos símbolos", () => {
  const symbols = programSymbols(
    spec("  PROCEDURE p(a NUMBER);\n  PROCEDURE p(a VARCHAR2);"),
  );
  const overloads = find(symbols, "P");
  expect(overloads.map((symbol) => symbol.signature)).toEqual([
    "PROCEDURE p(a NUMBER)",
    "PROCEDURE p(a VARCHAR2)",
  ]);
});

test("record y sus campos", () => {
  const symbols = programSymbols(
    spec("  TYPE t_rec IS RECORD (id NUMBER, nombre VARCHAR2(50));"),
  );
  expect(one(symbols, "T_REC")).toMatchObject({ kind: "type" });
  expect(one(symbols, "ID")).toMatchObject({
    kind: "field",
    container: "T_REC",
    dataType: "NUMBER",
  });
  expect(one(symbols, "NOMBRE")).toMatchObject({
    kind: "field",
    container: "T_REC",
    dataType: "VARCHAR2(50)",
  });
});

test("cursor con parámetros y consulta", () => {
  const symbols = programSymbols(
    spec(
      "  CURSOR c_cli(p_id NUMBER) IS SELECT id, nombre n FROM clientes WHERE id = p_id;",
    ),
  );
  const cursor = one(symbols, "C_CLI");
  expect(cursor.kind).toBe("cursor");
  expect(cursor.query?.startsWith("SELECT id, nombre n FROM clientes")).toBe(true);
});

test("subtype y %TYPE", () => {
  const symbols = programSymbols(
    spec("  SUBTYPE t_monto IS NUMBER(12,2);\n  v_c clientes.id%TYPE;"),
  );
  expect(one(symbols, "T_MONTO")).toMatchObject({
    kind: "subtype",
    dataType: "NUMBER(12,2)",
  });
  expect(one(symbols, "V_C")).toMatchObject({ dataType: "clientes.id%TYPE" });
});

test("FOR de cursor declara su registro", () => {
  const source = body(
    "  CURSOR c_cli(p NUMBER) IS SELECT id FROM clientes;\n  PROCEDURE p IS BEGIN\n    FOR r IN c_cli(1) LOOP NULL; END LOOP;\n  END;",
  );
  const record = one(programSymbols(source), "R");
  expect(record).toMatchObject({ kind: "variable", dataType: "C_CLI%ROWTYPE" });
  expect(record.scope!.from).toBe(source.indexOf("FOR r"));
  expect(record.scope!.to).toBe(source.indexOf("END LOOP;") + "END LOOP;".length);
});

test("bloque anónimo declara locales", () => {
  const source = "DECLARE v NUMBER := 1; BEGIN v := 2; END;";
  const local = one(programSymbols(source), "V");
  expect(local).toMatchObject({ kind: "variable", value: "1" });
  expect(local.scope).toEqual({ from: 0, to: source.length });
});

test("texto incompleto no lanza", () => {
  expect(Array.isArray(programSymbols("PACKAGE BODY x IS PROCEDURE p(a NUMBER"))).toBe(true);
});
