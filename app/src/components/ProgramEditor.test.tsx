import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { indentKeys } from "./ProgramEditor";

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
  it("Tab con el cursor inserta un tabulador", () => {
    const result = press("Tab", "begin\nnull;", EditorSelection.single(6));
    expect(result.handled).toBe(true);
    expect(result.doc).toBe("begin\n\tnull;");
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
