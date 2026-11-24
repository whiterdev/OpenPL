import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { expect, test, vi } from "vitest";
import { ProgramWindow } from "./ProgramWindow";
import { api } from "../api";
import "./ProgramWindow.css";

const parts = [
  { kind: "PACKAGE", source: "PACKAGE PKG_A AS\n  PROCEDURE hello;\nEND;", diagnostics: [], last_ddl_time: null },
  { kind: "PACKAGE BODY", source: "PACKAGE BODY PKG_A AS\nEND;", diagnostics: [], last_ddl_time: null },
];

test("detecta un cambio remoto en el mismo segundo y conserva el borrador", async () => {
  const spec = { ...parts[0], last_ddl_time: "2026-01-01T12:00:00" };
  const lookup = vi.fn().mockResolvedValue([{ ...spec, source: "PACKAGE PKG_A AS\nEND; -- cambio externo" }]);
  render(<ProgramWindow parts={[spec]} readOnly={false} onDirty={vi.fn()} readCurrentProgram={lookup} />);
  const editor = screen.getByRole("textbox", { name: "Spec" });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\n-- borrador" } }));

  fireEvent.click(screen.getByRole("button", { name: /Comparar con Oracle/ }));
  const panel = await screen.findByRole("region", { name: "Comparación de Spec" });
  expect(await within(panel).findByText("Cambio en Oracle")).toBeInTheDocument();
  expect(await within(panel).findByRole("textbox", { name: "Borrador local" })).toHaveTextContent("-- borrador");
  expect(within(panel).getByRole("textbox", { name: "Oracle" })).toHaveTextContent("-- cambio externo");
  fireEvent.click(within(panel).getByRole("button", { name: "Cerrar comparación" }));
  expect(editor).toHaveTextContent("-- borrador");
});

test("la comparación informa cuando el Body sigue ausente", async () => {
  const missing = { kind: "PACKAGE BODY", source: "", diagnostics: [], last_ddl_time: null };
  render(<ProgramWindow parts={[parts[0], missing]} readOnly onDirty={vi.fn()}
    readCurrentProgram={vi.fn().mockResolvedValue([parts[0]])} />);
  fireEvent.click(screen.getByRole("button", { name: /^Body/ }));
  fireEvent.click(screen.getByRole("button", { name: /Comparar con Oracle/ }));
  const panel = await screen.findByRole("region", { name: "Comparación de Body" });
  expect(await within(panel).findByText("Fuente no disponible en Oracle")).toBeInTheDocument();
});

test("detecta un cambio de LAST_DDL_TIME aun con texto idéntico", async () => {
  const spec = { ...parts[0], last_ddl_time: "2026-01-01T12:00:00" };
  const lookup = vi.fn().mockResolvedValue([{ ...spec, last_ddl_time: "2026-01-01T12:01:00" }]);
  render(<ProgramWindow parts={[spec]} readOnly onDirty={vi.fn()} readCurrentProgram={lookup} />);
  fireEvent.click(screen.getByRole("button", { name: /Comparar con Oracle/ }));
  expect(await screen.findByText("Cambio en Oracle")).toBeInTheDocument();
  expect(screen.getByText("Sin diferencias de texto")).toBeInTheDocument();
});

test("un error de lectura conserva el editor abierto", async () => {
  const lookup = vi.fn().mockRejectedValue("Disconnected");
  render(<ProgramWindow parts={[parts[0]]} readOnly onDirty={vi.fn()} readCurrentProgram={lookup} />);
  fireEvent.click(screen.getByRole("button", { name: /Comparar con Oracle/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Sesión desconectada");
  fireEvent.click(screen.getByRole("button", { name: "Cerrar comparación" }));
  expect(screen.getByRole("textbox", { name: "Spec" })).toHaveTextContent("PACKAGE PKG_A");
});

test("clic derecho resuelve y describe una tabla de la sesión del programa", async () => {
  const object = { owner: "HR", name: "VENTAS", object_type: "Table", status: "Valid", last_ddl_time: "" } as const;
  const lookup = vi.spyOn(api, "editorObject").mockResolvedValue(object);
  const describe = vi.spyOn(api, "describeColumns").mockResolvedValue([{ name: "ID", data_type: "NUMBER", nullable: false }]);
  vi.spyOn(EditorView.prototype, "posAndSideAtCoords").mockReturnValue({ pos: 16, assoc: 1 });
  try {
    render(<ProgramWindow parts={[{ kind: "SQL", source: "select * from ventas", diagnostics: [], last_ddl_time: null }]}
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
