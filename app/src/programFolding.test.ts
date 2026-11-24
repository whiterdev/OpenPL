import { EditorState } from "@codemirror/state";
import { foldable } from "@codemirror/language";
import { expect, test } from "vitest";
import { programFolding } from "./programFolding";

function foldedLines(source: string, opener: string) {
  const state = EditorState.create({
    doc: source,
    extensions: [programFolding],
  });
  const line = state.doc.lineAt(source.indexOf(opener));
  const range = foldable(state, line.from, line.to);
  if (!range) return null;
  return {
    from: state.doc.lineAt(range.from).number,
    closes: state.doc.lineAt(range.to + 1).text.trim(),
  };
}

test("pliega el paquete, las cabeceras de rutinas y sus bloques anidados", () => {
  const source = `CREATE OR REPLACE PACKAGE BODY PKG_A AS
    PROCEDURE externa IS
      PROCEDURE interna IS
      BEGIN
        NULL;
      END interna;
    BEGIN
      FOR i IN 1..3 LOOP
        IF i > 1 THEN
          CASE i
            WHEN 2 THEN NULL;
            ELSE NULL;
          END CASE;
        END IF;
      END LOOP;
    END externa;
  END PKG_A;`;
  expect(foldedLines(source, "PACKAGE BODY")).toEqual({
    from: 1,
    closes: "END PKG_A;",
  });
  expect(foldedLines(source, "PROCEDURE externa")).toEqual({
    from: 2,
    closes: "END externa;",
  });
  expect(foldedLines(source, "PROCEDURE interna")).toEqual({
    from: 3,
    closes: "END interna;",
  });
  expect(foldedLines(source, "FOR i")).toEqual({
    from: 8,
    closes: "END LOOP;",
  });
  expect(foldedLines(source, "IF i")).toEqual({ from: 9, closes: "END IF;" });
  expect(foldedLines(source, "CASE i")).toEqual({
    from: 10,
    closes: "END CASE;",
  });
});

test("conserva el cierre de DECLARE y omite comentarios, literales y bloques incompletos", () => {
  const source = `DECLARE
    v_texto VARCHAR2(80) := q'[BEGIN falso
    END falso;]';
    -- IF falso THEN
  BEGIN
    NULL;
  END;`;
  expect(foldedLines(source, "DECLARE")).toEqual({ from: 1, closes: "END;" });
  expect(foldedLines(source, "BEGIN falso")).toBeNull();
  expect(foldedLines(source, "IF falso")).toBeNull();
  expect(foldedLines("BEGIN\nIF flag THEN\nNULL;\nEND;", "BEGIN")).toBeNull();
});

test("pliega el Spec y la inicialización del Body sin confundir CASE SQL con END del programa", () => {
  expect(
    foldedLines("PACKAGE PKG_A AS\n  g_total NUMBER;\nEND;", "PACKAGE"),
  ).toEqual({ from: 1, closes: "END;" });
  const source =
    "PACKAGE BODY PKG_A AS\nBEGIN\n  g_total := CASE\n    WHEN flag THEN 1\n    ELSE 0 END;\nEND PKG_A;";
  expect(foldedLines(source, "PACKAGE BODY")).toEqual({
    from: 1,
    closes: "END PKG_A;",
  });
  expect(foldedLines(source, "BEGIN")).toEqual({
    from: 2,
    closes: "END PKG_A;",
  });
});

test("mantiene separados IF y las directivas de compilación condicional", () => {
  const source = `BEGIN
  $IF $$modo_prueba $THEN
    IF visible THEN
      NULL;
    END IF;
  $END
END;`;
  expect(foldedLines(source, "$IF")).toEqual({ from: 2, closes: "$END" });
  expect(foldedLines(source, "IF visible")).toEqual({
    from: 3,
    closes: "END IF;",
  });
  expect(foldedLines(source, "BEGIN")).toEqual({ from: 1, closes: "END;" });
});

test("recalcula el plegado cuando el borrador cambia", () => {
  const initial = EditorState.create({
    doc: "BEGIN\n  NULL;\nEND;",
    extensions: [programFolding],
  });
  expect(foldable(initial, 0, 5)).not.toBeNull();
  const edit = initial.update({
    changes: { from: initial.doc.line(3).from, to: initial.doc.length },
  });
  expect(foldable(edit.state, 0, 5)).toBeNull();
});
