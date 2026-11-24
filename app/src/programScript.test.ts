import { expect, test } from "vitest";
import { compileStatement, prepareProgramScript } from "./programScript";

const target = { owner: "Mi Esquema", name: "Ventas Mixtas" };

test("califica la parte abierta y añade un solo terminador de script", () => {
  const script = prepareProgramScript(
    'CREATE OR REPLACE EDITIONABLE PACKAGE BODY "Ventas Mixtas" AS\nEND;\n/\n',
    "PACKAGE BODY",
    target,
  );
  expect(script).toContain(
    'CREATE OR REPLACE EDITIONABLE PACKAGE BODY "Mi Esquema"."Ventas Mixtas" AS',
  );
  expect(script).toMatch(/END;\n\/\n/);
  expect(script.match(/^\/$/gm)).toHaveLength(1);
  expect(script).toContain(
    'SHOW ERRORS PACKAGE BODY "Mi Esquema"."Ventas Mixtas"',
  );
});

test.each([
  ['CREATE OR REPLACE PACKAGE "Ventas Mixtas" AS\nEND;', "PACKAGE BODY"],
  ["CREATE OR REPLACE PACKAGE OTRO AS\nEND;", "PACKAGE"],
  ['CREATE OR REPLACE PACKAGE HR."Ventas Mixtas" AS\nEND;', "PACKAGE"],
  [
    'CREATE OR REPLACE PACKAGE "Ventas Mixtas" AS\nEND;\n/\nSELECT 1 FROM dual;',
    "PACKAGE",
  ],
])(
  "rechaza encabezados y separadores que no corresponden a la parte",
  (source, kind) => {
    expect(() => prepareProgramScript(source, kind, target)).toThrow();
  },
);

const hr = { owner: "HR", name: "PKG_VENTAS" };

test.each([
  [
    "CREATE OR REPLACE PACKAGE pkg_ventas AS\n  PROCEDURE alta;\nEND;\n/\n",
    "PACKAGE",
    'CREATE OR REPLACE PACKAGE "HR"."PKG_VENTAS" AS\n  PROCEDURE alta;\nEND;',
  ],
  [
    "create or replace package body HR.pkg_ventas as\r\n  procedure alta is begin null; end;\r\nend;\r\n",
    "PACKAGE BODY",
    'create or replace package body "HR"."PKG_VENTAS" as\n  procedure alta is begin null; end;\nend;',
  ],
  [
    "CREATE OR REPLACE PROCEDURE pkg_ventas(p NUMBER) IS\nBEGIN\n  NULL;\nEND;",
    "PROCEDURE",
    'CREATE OR REPLACE PROCEDURE "HR"."PKG_VENTAS"(p NUMBER) IS\nBEGIN\n  NULL;\nEND;',
  ],
  [
    "CREATE OR REPLACE EDITIONABLE FUNCTION pkg_ventas RETURN NUMBER IS\nBEGIN\n  RETURN 1;\nEND;\n/",
    "FUNCTION",
    'CREATE OR REPLACE EDITIONABLE FUNCTION "HR"."PKG_VENTAS" RETURN NUMBER IS\nBEGIN\n  RETURN 1;\nEND;',
  ],
  [
    "CREATE OR REPLACE TRIGGER pkg_ventas\nBEFORE INSERT ON clientes FOR EACH ROW\nBEGIN\n  :new.id := 1;\nEND;",
    "TRIGGER",
    'CREATE OR REPLACE TRIGGER "HR"."PKG_VENTAS"\nBEFORE INSERT ON clientes FOR EACH ROW\nBEGIN\n  :new.id := 1;\nEND;',
  ],
])("compileStatement califica %s sin líneas de SQL*Plus", (source, kind, expected) => {
  const statement = compileStatement(source, kind, hr);
  expect(statement).toBe(expected);
  expect(statement).not.toMatch(/^\s*\/\s*$/m);
  expect(statement).not.toMatch(/SET DEFINE|SHOW ERRORS/);
  expect(statement.endsWith(";")).toBe(true);
});

test("compileStatement rechaza un encabezado de otro objeto", () => {
  expect(() =>
    compileStatement("CREATE OR REPLACE PACKAGE OTRO AS\nEND;", "PACKAGE", hr),
  ).toThrow("El encabezado no coincide con el objeto abierto.");
});
