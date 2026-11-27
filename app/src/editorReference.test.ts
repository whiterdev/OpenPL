import { EditorState } from "@codemirror/state";
import { sql } from "@codemirror/lang-sql";
import { expect, test } from "vitest";
import { editorPath, editorReference, oracleDialect } from "./editorReference";

function reference(source: string, word: string) {
  const state = EditorState.create({
    doc: source,
    extensions: [sql({ dialect: oracleDialect })],
  });
  return editorReference(state, source.lastIndexOf(word) + 1);
}

test("reconoce el objeto al pulsar sobre el esquema o el nombre", () => {
  const source = "select * from hr . ventas";
  expect(reference(source, "hr")).toEqual({ owner: "HR", name: "VENTAS" });
  expect(reference(source, "ventas")).toEqual({ owner: "HR", name: "VENTAS" });
  expect(reference("select * from ventas", "ventas")).toEqual({
    owner: null,
    name: "VENTAS",
  });
});

test("preserva los nombres Oracle entre comillas", () => {
  expect(
    reference('select * from "Mi Esquema"."Tabla Mixta"', "Tabla"),
  ).toEqual({
    owner: "Mi Esquema",
    name: "Tabla Mixta",
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

function path(source: string, word: string) {
  const state = EditorState.create({
    doc: source,
    extensions: [sql({ dialect: oracleDialect })],
  });
  return editorPath(state, source.indexOf(word) + 1);
}

test("tres partes con el cursor en la del medio", () => {
  const source = "x := hr.pkg_ventas.calcular(1);";
  expect(path(source, "pkg_ventas")).toEqual({
    parts: ["HR", "PKG_VENTAS", "CALCULAR"],
    index: 1,
    from: source.indexOf("pkg_ventas"),
    to: source.indexOf("pkg_ventas") + "pkg_ventas".length,
  });
});

test("campo de registro tras índice", () => {
  expect(path("x := t_tab(i).nombre;", "nombre")).toMatchObject({
    parts: ["T_TAB", "NOMBRE"],
    index: 1,
  });
  expect(path("x := t_tab(i).nombre;", "t_tab")).toMatchObject({
    parts: ["T_TAB", "NOMBRE"],
    index: 0,
  });
});

test("comillas conservan mayúsculas", () => {
  expect(path('x := "MiPaquete".calcular;', "calcular")).toMatchObject({
    parts: ["MiPaquete", "CALCULAR"],
    index: 1,
  });
});

test("bind y cuatro partes devuelven null", () => {
  expect(path("x := :p_id;", "p_id")).toBeNull();
  expect(path("x := a.b.c.d;", "b")).toBeNull();
});

test("una llamada con argumentos no se une al nombre siguiente", () => {
  expect(path("calcular(v_x) ;", "v_x")).toMatchObject({ parts: ["V_X"], index: 0 });
});
