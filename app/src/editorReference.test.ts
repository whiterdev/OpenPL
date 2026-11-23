import { EditorState } from "@codemirror/state";
import { sql } from "@codemirror/lang-sql";
import { expect, test } from "vitest";
import { editorReference, oracleDialect } from "./editorReference";

function reference(source: string, word: string) {
  const state = EditorState.create({ doc: source, extensions: [sql({ dialect: oracleDialect })] });
  return editorReference(state, source.lastIndexOf(word) + 1);
}

test("reconoce el objeto al pulsar sobre el esquema o el nombre", () => {
  const source = "select * from hr . ventas";
  expect(reference(source, "hr")).toEqual({ owner: "HR", name: "VENTAS" });
  expect(reference(source, "ventas")).toEqual({ owner: "HR", name: "VENTAS" });
  expect(reference("select * from ventas", "ventas")).toEqual({ owner: null, name: "VENTAS" });
});

test("preserva los nombres Oracle entre comillas", () => {
  expect(reference('select * from "Mi Esquema"."Tabla Mixta"', "Tabla")).toEqual({
    owner: "Mi Esquema", name: "Tabla Mixta",
  });
});

test.each([
  ["select 'ventas' from dual", "ventas"],
  ["select q'[ventas]' from dual", "ventas"],
  ["select * from dual -- ventas", "ventas"],
  ["/* ventas */ select * from dual", "ventas"],
  ["select * from ventas@remota", "ventas"],
  ["select * from ventas@remota", "remota"],
  ["select * from ventas   ", "   "],
  ["select :ventas from dual", "ventas"],
])("omite referencias ajenas al catálogo local en %s", (source, token) => {
  expect(reference(source, token)).toBeNull();
});
