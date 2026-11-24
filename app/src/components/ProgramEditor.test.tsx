import { describe, expect, it } from "vitest";
import { sql } from "@codemirror/lang-sql";
import { syntaxTree } from "@codemirror/language";
import { oracleDialect } from "../editorReference";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { highlightTree, tags } from "@lezer/highlight";
import { indentKeys, programSyntax } from "./ProgramEditor";

// Vitest vacía los imports ?raw de CSS; el proyecto no tiene @types/node.
type Fs = { readFileSync(path: string, encoding: "utf8"): string };
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): Fs } }).process.getBuiltinModule("node:fs");
const windowCss = fs.readFileSync("src/components/ProgramWindow.css", "utf8");

describe("programSyntax", () => {
  it("los comentarios van en cursiva con --cm", () => {
    const comment = programSyntax.specs.find((spec) => spec.tag === tags.comment);
    expect(comment).toMatchObject({ color: "var(--cm)", fontStyle: "italic" });
  });

  it("resalta comentarios de linea y bloque en SQL real", () => {
    const doc = "-- nota\nselect /* detalle */ 1 from dual";
    const state = EditorState.create({ doc, extensions: [sql({ dialect: oracleDialect })] });
    const comments: string[] = [];
    const commentClass = programSyntax.style([tags.comment]);
    highlightTree(syntaxTree(state), programSyntax, (from, to, classes) => {
      if (classes === commentClass) comments.push(doc.slice(from, to));
    });
    expect(comments).toEqual(["-- nota", "/* detalle */"]);
  });

  it("los comentarios tienen otra clase que las palabras clave", () => {
    const comment = programSyntax.style([tags.comment]);
    expect(comment).toBeTruthy();
    expect(comment).not.toBe(programSyntax.style([tags.keyword]));
  });
});

describe("estilos del editor", () => {
  const rules = (selector: string) =>
    windowCss.split("\n").filter((line) => line.startsWith(".program-editor") && line.includes(selector));

  it("la selección usa --sel sin !important", () => {
    const selection = rules(".cm-selectionBackground");
    expect(selection.length).toBeGreaterThan(0);
    expect(selection.join("\n")).toContain("var(--sel)");
    expect(selection.join("\n")).not.toContain("!important");
    expect(rules(".cm-focused").join("\n")).toContain("var(--sel)");
  });

  it("las coincidencias usan --selMatch", () => {
    expect(rules(".cm-selectionMatch").join("\n")).toContain("var(--selMatch)");
  });

  it("la línea activa es translúcida", () => {
    expect(rules(".cm-activeLine").join("\n")).toContain("var(--activeLine)");
  });
});

function press(key: "Tab" | "Shift-Tab", doc: string, selection: EditorSelection) {
  let state = EditorState.create({ doc, selection });
  const target = { get state() { return state; }, dispatch: (tr: Transaction) => { state = tr.state; } };
  const binding = indentKeys.find((item) => item.key === "Tab");
  const run = key === "Shift-Tab" ? binding?.shift : binding?.run;
  expect(run).toBeDefined();
  const handled = run!(target as unknown as EditorView);
  return { handled, doc: state.doc.toString() };
}

describe("indentKeys", () => {
  it("Tab con el cursor inserta dos espacios", () => {
    const result = press("Tab", "begin\nnull;", EditorSelection.single(6));
    expect(result.handled).toBe(true);
    expect(result.doc).toBe("begin\n  null;");
  });

  it("Tab con tres líneas seleccionadas las indenta", () => {
    const result = press("Tab", "a\nb\nc", EditorSelection.single(0, 5));
    expect(result.handled).toBe(true);
    expect(result.doc).toBe("  a\n  b\n  c");
  });

  it("Shift-Tab quita la indentación", () => {
    const result = press("Shift-Tab", "  a\n  b", EditorSelection.single(0, 7));
    expect(result.handled).toBe(true);
    expect(result.doc).toBe("a\nb");
  });
});
