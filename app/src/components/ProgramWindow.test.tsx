import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { expect, test, vi } from "vitest";
import { ProgramWindow } from "./ProgramWindow";
import "./ProgramWindow.css";

const parts = [
  { kind: "PACKAGE", source: "PACKAGE PKG_A AS\n  PROCEDURE hello;\nEND;", diagnostics: [] },
  { kind: "PACKAGE BODY", source: "PACKAGE BODY PKG_A AS\nEND;", diagnostics: [] },
];

test("guarda los borradores por parte y abre ambos editores", async () => {
  render(<ProgramWindow parts={parts} readOnly={false} onDirty={vi.fn()} />);
  const editor = screen.getByRole("textbox", { name: "Spec" });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\n-- borrador" } }));
  fireEvent.click(screen.getByRole("button", { name: /^Body/ }));
  expect(screen.getByRole("textbox", { name: "Body" })).toHaveTextContent("PACKAGE BODY");
  fireEvent.click(screen.getByRole("button", { name: /^Spec/ }));
  expect(screen.getByRole("textbox", { name: "Spec" })).toHaveTextContent("-- borrador");
  fireEvent.click(screen.getByRole("button", { name: /Lado a lado/i }));
  expect(screen.getAllByRole("textbox")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: /^Body/ }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Body" })).toHaveFocus());
});

test("muestra fuente de solo lectura y permite navegar al diagnóstico", () => {
  render(<ProgramWindow readOnly onDirty={vi.fn()} parts={[{
    ...parts[0],
    diagnostics: [{ line: 2, column: 3, text: "PLS-00103", warning: false }],
  }]} />);
  const editor = screen.getByRole("textbox", { name: "Spec" });
  expect(editor).toHaveAttribute("contenteditable", "false");
  fireEvent.click(screen.getByRole("button", { name: /PLS-00103/ }));
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  expect(view.state.selection.main.head).toBe(view.state.doc.line(2).from + 2);
});
