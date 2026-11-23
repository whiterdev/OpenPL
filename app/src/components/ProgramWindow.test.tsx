import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { expect, test, vi } from "vitest";
import { ProgramWindow } from "./ProgramWindow";
import { api } from "../api";
import "./ProgramWindow.css";

const parts = [
  { kind: "PACKAGE", source: "PACKAGE PKG_A AS\n  PROCEDURE hello;\nEND;", diagnostics: [] },
  { kind: "PACKAGE BODY", source: "PACKAGE BODY PKG_A AS\nEND;", diagnostics: [] },
];

test("clic derecho resuelve y describe una tabla de la sesión del programa", async () => {
  const object = { owner: "HR", name: "VENTAS", object_type: "Table", status: "Valid", last_ddl_time: "" } as const;
  const lookup = vi.spyOn(api, "editorObject").mockResolvedValue(object);
  const describe = vi.spyOn(api, "describeColumns").mockResolvedValue([{ name: "ID", data_type: "NUMBER", nullable: false }]);
  vi.spyOn(EditorView.prototype, "posAndSideAtCoords").mockReturnValue({ pos: 16, assoc: 1 });
  try {
    render(<ProgramWindow parts={[{ kind: "SQL", source: "select * from ventas", diagnostics: [] }]}
      readOnly onDirty={vi.fn()} catalog={{ sessionId: "s1", owner: "HR", openProgram: vi.fn() }} />);
    fireEvent.contextMenu(screen.getByRole("textbox", { name: "Fuente" }), { clientX: 100, clientY: 100 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Describir" }));
    expect(lookup).toHaveBeenCalledWith("s1", { owner: null, name: "VENTAS" }, "HR");
    expect(describe).toHaveBeenCalledWith("s1", "HR", "VENTAS");
    expect(await screen.findByRole("cell", { name: "ID" })).toBeInTheDocument();
  } finally {
    vi.restoreAllMocks();
  }
});

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
