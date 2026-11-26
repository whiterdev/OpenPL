import { afterEach, expect, test, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { foldable, foldGutter } from "@codemirror/language";
import { programFoldRanges } from "./programStructure";
import { programFolding } from "./programFolding";

vi.mock("./programStructure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./programStructure")>();
  return { ...actual, programFoldRanges: vi.fn(actual.programFoldRanges) };
});

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

test("un rango cuyo inicio o fin cae en texto borrado deja de plegar sin romper", () => {
  const source = "BEGIN\n  IF a THEN\n    x := 1;\n    NULL;\n  END IF;\nEND;";
  const state = EditorState.create({ doc: source, extensions: [programFolding] });
  const sinInicio = state.update({
    changes: { from: source.indexOf("IF a"), to: source.indexOf("\n    x") },
  }).state;
  expect(foldable(sinInicio, sinInicio.doc.line(2).from, sinInicio.doc.line(2).to)).toBeNull();
  expect(foldable(sinInicio, 0, 5)).not.toBeNull();
  const vacio = state.update({ changes: { from: 0, to: source.length } }).state;
  expect(foldable(vacio, 0, 0)).toBeNull();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

test("tipear en un paquete grande no recalcula el plegado por tecla y lo recalcula tras la pausa", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const source = `BEGIN\n${"  IF a THEN\n    NULL;\n  END IF;\n".repeat(6667)}END;`;
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: source, extensions: [programFolding, foldGutter()] }),
  });
  const calls = vi.mocked(programFoldRanges);
  calls.mockClear();

  const typed = "  LOOP\n    NULL;\n  END LOOP;\n";
  let at = view.state.doc.line(2).from;
  for (const key of typed) {
    view.dispatch({ changes: { from: at, insert: key }, selection: { anchor: at + 1 } });
    at += 1;
  }
  const loop = () => view.state.doc.line(2);
  expect(calls).not.toHaveBeenCalled();
  expect(foldable(view.state, loop().from, loop().to)).toBeNull();
  expect(foldable(view.state, view.state.doc.line(5).from, view.state.doc.line(5).to)).not.toBeNull();

  vi.advanceTimersByTime(149);
  expect(calls).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(calls).toHaveBeenCalledTimes(1);
  const range = foldable(view.state, loop().from, loop().to);
  expect(range && view.state.doc.lineAt(range.to + 1).text.trim()).toBe("END LOOP;");
  view.destroy();
});
