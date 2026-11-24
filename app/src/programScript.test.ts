import { expect, test } from "vitest";
import { prepareProgramScript } from "./programScript";

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
