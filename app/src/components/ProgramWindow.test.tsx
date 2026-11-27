import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { Text } from "@codemirror/state";
import { foldedRanges } from "@codemirror/language";
import { undo } from "@codemirror/commands";
import { createRef, useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ProgramWindow, type ProgramActions } from "./ProgramWindow";
import { api } from "../api";
import { handleShortcut } from "../keymap";
import type { ProgramPart } from "../types";
import "./ProgramWindow.css";

const parts = [
  { kind: "PACKAGE", source: "PACKAGE PKG_A AS\n  PROCEDURE hello;\nEND;", diagnostics: [], last_ddl_time: null },
  { kind: "PACKAGE BODY", source: "PACKAGE BODY PKG_A AS\nEND;", diagnostics: [], last_ddl_time: null },
];

test("Spec y Body son pestañas que marcan la seleccionada y se recorren con flechas", () => {
  render(<ProgramWindow parts={parts} readOnly onDirty={vi.fn()} />);
  const list = within(screen.getByRole("tablist", { name: "Partes del programa" }));
  const spec = list.getByRole("tab", { name: /^Spec/ });
  const body = list.getByRole("tab", { name: /^Body/ });
  expect(spec).toHaveAttribute("aria-selected", "true");
  expect(body).toHaveAttribute("aria-selected", "false");
  expect(spec).not.toHaveAttribute("aria-pressed");
  expect(spec.querySelector(".kbd")).not.toBeEmptyDOMElement();
  expect(body.querySelector(".kbd")).not.toBeEmptyDOMElement();
  expect(spec).toHaveAttribute("tabindex", "0");
  expect(body).toHaveAttribute("tabindex", "-1");

  fireEvent.keyDown(spec, { key: "ArrowRight" });
  expect(body).toHaveAttribute("aria-selected", "true");
  expect(spec).toHaveAttribute("aria-selected", "false");
  expect(body).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Body" })).toBeInTheDocument();

  fireEvent.keyDown(body, { key: "ArrowRight" });
  expect(spec).toHaveAttribute("aria-selected", "true");
  expect(spec).toHaveFocus();
  fireEvent.keyDown(spec, { key: "ArrowLeft" });
  expect(body).toHaveAttribute("aria-selected", "true");

  const sideBySide = screen.getByRole("button", { name: "Lado a lado" });
  expect(sideBySide).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(sideBySide);
  expect(sideBySide).toHaveAttribute("aria-pressed", "true");
});

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
  fireEvent.click(screen.getByRole("tab", { name: /^Body/ }));
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

test("la barra de un objeto solo ofrece Comparar con Oracle, sin Guardar ni Preparar compilación", () => {
  const ref = createRef<ProgramActions>();
  render(<ProgramWindow ref={ref} parts={parts} readOnly={false} onDirty={vi.fn()}
    readCurrentProgram={vi.fn()} compilationTarget={{ owner: "HR", name: "PKG_A" }} />);
  expect(screen.queryByRole("button", { name: /Guardar/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Preparar compilación/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /Comparar/ })).toHaveLength(1);
  expect(ref.current?.execute).toBeUndefined();
  expect(ref.current?.compareProgram).toBeTypeOf("function");
});

test("comparar un objeto muestra el diff sin ofrecer guardar un script", async () => {
  const original = { ...parts[0], source: "CREATE OR REPLACE PACKAGE PKG_A AS\nEND;", last_ddl_time: "2026-01-01T12:00:00" };
  const reader = vi.fn().mockResolvedValue([{ ...original, source: original.source + " -- remoto" }]);
  const save = vi.spyOn(api, "saveProgramFile").mockResolvedValue("x.sql");
  try {
    render(<ProgramWindow parts={[original]} readOnly={false} onDirty={vi.fn()}
      readCurrentProgram={reader} compilationTarget={{ owner: "HR", name: "PKG_A" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Comparar con Oracle/ }));
    const panel = await screen.findByRole("region", { name: "Comparación de Spec" });
    expect(await within(panel).findByText("Cambio en Oracle")).toBeInTheDocument();
    expect(within(panel).getByRole("textbox", { name: "Oracle" })).toHaveTextContent("-- remoto");
    expect(within(panel).queryByRole("button", { name: /Guardar/ })).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  } finally {
    save.mockRestore();
  }
});

test("Guardar escribe el contenido del editor en un archivo .sql", async () => {
  const ref = createRef<ProgramActions>();
  const save = vi.spyOn(api, "saveProgramFile").mockResolvedValue("pkg_a.sql");
  try {
    render(<ProgramWindow ref={ref} parts={parts} readOnly={false} onDirty={vi.fn()}
      readCurrentProgram={vi.fn()} compilationTarget={{ owner: "HR", name: "PKG_A" }} />);
    const view = EditorView.findFromDOM(screen.getByRole("textbox", { name: "Spec" }).closest<HTMLElement>(".cm-editor")!)!;
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\n-- local" } }));
    act(() => ref.current?.save?.());
    expect(await screen.findByText("Archivo guardado")).toBeInTheDocument();
    expect(save).toHaveBeenCalledWith(`${parts[0].source}\n-- local`, "sql", null);
  } finally {
    save.mockRestore();
  }
});

test("cerrar la comparación ignora una respuesta pendiente", async () => {
  const original = { ...parts[0], source: "CREATE OR REPLACE PACKAGE PKG_A AS\nEND;", last_ddl_time: "2026-01-01T12:00:00" };
  let respond!: (parts: ProgramPart[]) => void;
  const pending = new Promise<ProgramPart[]>((resolve) => { respond = resolve; });
  render(<ProgramWindow parts={[original]} readOnly={false} onDirty={vi.fn()}
    readCurrentProgram={() => pending} compilationTarget={{ owner: "HR", name: "PKG_A" }} />);
  fireEvent.click(screen.getByRole("button", { name: /Comparar con Oracle/ }));
  expect(screen.getByText("Leyendo Oracle…")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar comparación" }));
  await act(async () => respond([{ ...original, source: original.source + " -- remoto" }]));
  expect(screen.queryByRole("region", { name: "Comparación de Spec" })).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Spec" })).toHaveTextContent("PACKAGE PKG_A");
});

test("clic derecho resuelve y describe una tabla de la sesión del programa", async () => {
  const object = { owner: "HR", name: "VENTAS", object_type: "Table", status: "Valid", last_ddl_time: "" } as const;
  const lookup = vi.spyOn(api, "editorObject").mockResolvedValue(object);
  const describe = vi.spyOn(api, "describeColumns").mockResolvedValue([{ name: "ID", data_type: "NUMBER", nullable: false }]);
  vi.spyOn(EditorView.prototype, "posAndSideAtCoords").mockReturnValue({ pos: 16, assoc: 1 });
  try {
    render(<ProgramWindow parts={[{ kind: "SQL", source: "select * from ventas", diagnostics: [], last_ddl_time: null }]}
      readOnly onReadOnlyChange={vi.fn()} onDirty={vi.fn()} catalog={{ sessionId: "s1", owner: "HR", openProgram: vi.fn() }} />);
    fireEvent.contextMenu(screen.getByRole("textbox", { name: "Fuente" }), { clientX: 100, clientY: 100 });
    expect(screen.getByRole("menuitemcheckbox", { name: "Solo lectura", checked: true })).toHaveFocus();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Describir" }));
    expect(lookup).toHaveBeenCalledWith("s1", { owner: null, name: "VENTAS" }, "HR");
    expect(describe).toHaveBeenCalledWith("s1", "HR", "VENTAS");
    expect(await screen.findByRole("cell", { name: "ID" })).toBeInTheDocument();
  } finally {
    vi.restoreAllMocks();
  }
});

test("completa objetos con la sesión del programa y cambia con ella", async () => {
  const objects = vi.spyOn(api, "completeObjects").mockResolvedValue([{ owner: "HR", name: "VENTAS", object_type: "TABLE" }]);
  const ref = createRef<ProgramActions>();
  const source = { kind: "SQL", source: "select * from ven", diagnostics: [], last_ddl_time: null };
  try {
    const { rerender } = render(<ProgramWindow ref={ref} parts={[source]} readOnly={false} onDirty={vi.fn()}
      catalog={{ sessionId: "s1", owner: "HR", openProgram: vi.fn() }} />);
    const view = EditorView.findFromDOM(screen.getByRole("textbox", { name: "Fuente" }).closest<HTMLElement>(".cm-editor")!)!;
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));
    act(() => ref.current?.complete?.());
    expect(await screen.findByRole("option", { name: /VENTAS/ })).toBeInTheDocument();
    expect(objects).toHaveBeenCalledWith("s1", null, "VEN", "HR", "relations");

    rerender(<ProgramWindow ref={ref} parts={[source]} readOnly={false} onDirty={vi.fn()}
      catalog={{ sessionId: "s2", owner: "QA", openProgram: vi.fn() }} />);
    act(() => ref.current?.complete?.());
    await waitFor(() => expect(objects).toHaveBeenLastCalledWith("s2", null, "VEN", "QA", "relations"));
  } finally {
    vi.restoreAllMocks();
  }
});

test("la caché de completado separa tablas de cualquier objeto", async () => {
  const objects = vi.spyOn(api, "completeObjects").mockResolvedValue([{ owner: "HR", name: "VENTAS", object_type: "TABLE" }]);
  const ref = createRef<ProgramActions>();
  const source = { kind: "SQL", source: "select * from ven", diagnostics: [], last_ddl_time: null };
  try {
    render(<ProgramWindow ref={ref} parts={[source]} readOnly={false} onDirty={vi.fn()}
      catalog={{ sessionId: "s1", owner: "HR", openProgram: vi.fn() }} />);
    const view = EditorView.findFromDOM(screen.getByRole("textbox", { name: "Fuente" }).closest<HTMLElement>(".cm-editor")!)!;
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));
    act(() => ref.current?.complete?.());
    await waitFor(() => expect(objects).toHaveBeenCalledWith("s1", null, "VEN", "HR", "relations"));
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "begin ven" },
      selection: { anchor: "begin ven".length } }));
    act(() => ref.current?.complete?.());
    await waitFor(() => expect(objects).toHaveBeenLastCalledWith("s1", null, "VEN", "HR", "any"));
  } finally {
    vi.restoreAllMocks();
  }
});

test("en solo lectura no ofrece completar", () => {
  const ref = createRef<ProgramActions>();
  render(<ProgramWindow ref={ref} parts={parts} readOnly onDirty={vi.fn()}
    catalog={{ sessionId: "s1", owner: "HR", openProgram: vi.fn() }} />);
  expect(ref.current?.complete).toBeUndefined();
});

test("la estructura muestra una línea por entrada y se puede ensanchar", () => {
  localStorage.removeItem("openpl.outlineWidth");
  const spec = ["PACKAGE PKG_A AS", "  PROCEDURE registrar(p_id NUMBER, p_nombre VARCHAR2, p_fecha DATE);", "END;"].join("\n");
  render(<ProgramWindow readOnly onDirty={vi.fn()} parts={[{ ...parts[0], source: spec }]} />);
  const outline = screen.getByRole("complementary", { name: "Estructura" });
  const entry = within(outline).getByRole("button", { name: /registrar/ });
  expect(entry).toHaveAttribute("title", "Procedimiento · registrar(p_id NUMBER, p_nombre VARCHAR2, p_fecha DATE)");
  expect(entry.querySelector(".program-outline-name")).toHaveTextContent("registrar(");
  expect(entry).toHaveAccessibleName(/^Procedimiento registrar\(/);
  expect(entry.querySelector(".decl-badge")).toHaveTextContent("P");

  const handle = screen.getByRole("separator", { name: "Ancho de Estructura" });
  expect(handle).toHaveAttribute("aria-valuenow", "240");
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(handle).toHaveAttribute("aria-valuenow", "256");
  expect(outline.style.width).toBe("256px");
  fireEvent.pointerDown(handle, { clientX: 300, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 400, pointerId: 1 });
  fireEvent.pointerUp(window, { pointerId: 1 });
  expect(handle).toHaveAttribute("aria-valuenow", "356");
  fireEvent.pointerMove(window, { clientX: 900, pointerId: 1 });
  expect(handle).toHaveAttribute("aria-valuenow", "356");
  fireEvent.keyDown(handle, { key: "Home" });
  expect(handle).toHaveAttribute("aria-valuenow", "140");
  fireEvent.doubleClick(handle);
  expect(handle).toHaveAttribute("aria-valuenow", "240");
  expect(localStorage.getItem("openpl.outlineWidth")).toBe("240");
});

test("guarda los borradores por parte y abre ambos editores", async () => {
  render(<ProgramWindow parts={parts} readOnly={false} onDirty={vi.fn()} />);
  const editor = screen.getByRole("textbox", { name: "Spec" });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\n-- borrador" } }));
  fireEvent.click(screen.getByRole("tab", { name: /^Body/ }));
  expect(screen.getByRole("textbox", { name: "Body" })).toHaveTextContent("PACKAGE BODY");
  fireEvent.click(screen.getByRole("tab", { name: /^Spec/ }));
  expect(screen.getByRole("textbox", { name: "Spec" })).toHaveTextContent("-- borrador");
  fireEvent.click(screen.getByRole("button", { name: /Lado a lado/i }));
  expect(screen.getAllByRole("textbox")).toHaveLength(2);
  fireEvent.click(screen.getByRole("tab", { name: /^Body/ }));
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

test("el panel distingue las sobrecargas y F12 permite seleccionar su declaración", async () => {
  const spec = "PACKAGE PKG_A AS\n  g_total NUMBER;\n  PROCEDURE registrar(p_id NUMBER);\nEND;";
  const body = "PACKAGE BODY PKG_A AS\n  PROCEDURE registrar(p_id NUMBER) IS BEGIN NULL; END;\n"
    + "  PROCEDURE registrar(p_id VARCHAR2) IS BEGIN NULL; END;\nBEGIN\n  registrar(1);\nEND;";
  const ref = createRef<ProgramActions>();
  render(<ProgramWindow readOnly onDirty={vi.fn()} ref={ref}
    parts={[{ ...parts[0], source: spec }, { ...parts[1], source: body }]} />);
  const outline = within(screen.getByRole("complementary", { name: "Estructura" }));
  expect(outline.getByRole("button", { name: /g_total.*Público/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: /^Body/ }));
  const editor = screen.getByRole("textbox", { name: "Body" });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  expect(outline.getByRole("button", { name: /registrar\(p_id NUMBER\).*Público/ })).toBeInTheDocument();
  fireEvent.click(outline.getByRole("button", { name: /registrar\(p_id VARCHAR2\).*Privado/ }));
  expect(view.state.selection.main.head).toBe(body.indexOf("registrar(p_id VARCHAR2"));
  act(() => view.dispatch({ selection: { anchor: body.lastIndexOf("registrar(") + 1 } }));
  act(() => ref.current!.goToDeclaration!());
  const menu = within(await screen.findByRole("menu", { name: "Declaraciones de REGISTRAR" }));
  fireEvent.click(menu.getByRole("menuitem", { name: /Spec.*registrar\(p_id NUMBER\)/ }));
  const selected = screen.getByRole("textbox", { name: "Spec" });
  const specView = EditorView.findFromDOM(selected.closest<HTMLElement>(".cm-editor")!)!;
  expect(specView.state.selection.main.head).toBe(spec.indexOf("registrar("));
});

test("el editor de solo lectura pliega y despliega sin modificar la fuente", () => {
  const source = "PACKAGE PKG_A AS\n  g_total NUMBER;\nEND;";
  const ref = createRef<ProgramActions>();
  const dirty = vi.fn();
  render(<ProgramWindow readOnly onDirty={dirty} ref={ref} parts={[{ ...parts[0], source }]} />);
  const editor = screen.getByRole("textbox", { name: "Spec" });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => ref.current!.foldBlock!());
  expect(foldedRanges(view.state).size).toBe(1);
  act(() => ref.current!.unfoldBlock!());
  expect(foldedRanges(view.state).size).toBe(0);

  act(() => ref.current!.foldBlock!());
  fireEvent.click(screen.getByRole("button", { name: "Variable g_total" }));
  expect(foldedRanges(view.state).size).toBe(0);
  expect(view.state.selection.main.head).toBe(source.indexOf("g_total"));
  expect(view.state.doc.toString()).toBe(source);
  expect(dirty).not.toHaveBeenCalled();
});

const compiled = {
  kind: "PACKAGE",
  source: "CREATE OR REPLACE PACKAGE PKG_A AS\n  PROCEDURE hello;\nEND;",
  diagnostics: [],
  last_ddl_time: "2026-01-01T12:00:00",
};
const hrTarget = { owner: "HR", name: "PKG_A" };
const compiledStatement = 'CREATE OR REPLACE PACKAGE "HR"."PKG_A" AS\n  PROCEDURE hello;\nEND;';

function compiler(run = vi.fn().mockResolvedValue(undefined)) {
  return { run, cancel: vi.fn(), production: false };
}

test("Compilar (F8) compila la pestaña activa sin recrear el editor", async () => {
  const ref = createRef<ProgramActions>();
  const compile = compiler();
  const reader = vi.fn()
    .mockResolvedValueOnce([compiled])
    .mockResolvedValueOnce([{ ...compiled, last_ddl_time: "2026-01-01T12:05:00" }]);
  render(<ProgramWindow ref={ref} parts={[compiled]} readOnly={false} onDirty={vi.fn()}
    readCurrentProgram={reader} compilationTarget={hrTarget} compile={compile} />);
  const editor = screen.getByRole("textbox", { name: "Spec" });
  const button = screen.getByRole("button", { name: /^Compilar/ });
  expect(button.querySelector(".kbd")).toHaveTextContent("F8");

  await act(async () => ref.current?.execute?.());
  expect(compile.run).toHaveBeenCalledWith(compiledStatement);
  expect(await screen.findByText("Compilado")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Spec" })).toBe(editor);
  expect(reader).toHaveBeenCalledTimes(2);
});

test("compilar guarda la parte activa y conserva cambios pendientes en la otra", async () => {
  const ref = createRef<ProgramActions>();
  const onDirty = vi.fn();
  const program = parts.map((part) => ({ ...part, source: "CREATE OR REPLACE " + part.source }));
  const compile = compiler();
  render(<ProgramWindow ref={ref} parts={program} readOnly={false} onDirty={onDirty}
    readCurrentProgram={vi.fn().mockResolvedValue(program)} compilationTarget={hrTarget} compile={compile} />);
  function edit(label: string) {
    const view = EditorView.findFromDOM(screen.getByRole("textbox", { name: label }).closest<HTMLElement>(".cm-editor")!)!;
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\n-- cambio" } }));
  }
  edit("Spec");
  fireEvent.click(screen.getByRole("tab", { name: /Body/ }));
  edit("Body");
  await act(async () => ref.current?.execute?.());
  expect(onDirty).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("tab", { name: /Spec/ }));
  await act(async () => ref.current?.execute?.());
  expect(compile.run).toHaveBeenCalledTimes(2);
  expect(onDirty).toHaveBeenLastCalledWith(false);
});

test("un error de compilación llena Problemas y marca el editor", async () => {
  const ref = createRef<ProgramActions>();
  const compile = compiler(vi.fn().mockRejectedValue({
    Db: { code: "ORA-24344", kind: "Other", message: "compilado con errores" },
  }));
  const reader = vi.fn()
    .mockResolvedValueOnce([compiled])
    .mockResolvedValueOnce([{
      ...compiled,
      last_ddl_time: "2026-01-01T12:05:00",
      diagnostics: [{ line: 2, column: 3, text: "PLS-00103: símbolo inesperado", warning: false }],
    }]);
  render(<ProgramWindow ref={ref} parts={[compiled]} readOnly={false} onDirty={vi.fn()}
    readCurrentProgram={reader} compilationTarget={hrTarget} compile={compile} />);
  const editor = screen.getByRole("textbox", { name: "Spec" });

  await act(async () => ref.current?.execute?.());
  expect(await screen.findByText("Compilado con 1 error")).toBeInTheDocument();
  const problems = within(screen.getByLabelText("Problemas"));
  expect(problems.getByText("2:3")).toBeInTheDocument();
  expect(problems.getByText(/PLS-00103/)).toBeInTheDocument();
  await waitFor(() => expect(editor.querySelector(".cm-lintRange-error")).toBeInTheDocument());
  expect(screen.getByRole("textbox", { name: "Spec" })).toBe(editor);
});

test("en producción pide confirmación antes de compilar", async () => {
  const ref = createRef<ProgramActions>();
  const compile = { ...compiler(), production: true };
  const reader = vi.fn().mockResolvedValue([compiled]);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    render(<ProgramWindow ref={ref} parts={[compiled]} readOnly={false} onDirty={vi.fn()}
      readCurrentProgram={reader} compilationTarget={hrTarget} compile={compile} />);
    await act(async () => ref.current?.execute?.());
    expect(confirm).toHaveBeenCalledWith("¿Compilar PKG_A en producción?");
    expect(compile.run).not.toHaveBeenCalled();
  } finally {
    confirm.mockRestore();
  }
});

test("si Oracle cambió el objeto pide confirmación y después usa la marca nueva", async () => {
  const ref = createRef<ProgramActions>();
  const compile = compiler();
  const remote = { ...compiled, last_ddl_time: "2026-01-01T12:01:00" };
  const after = { ...compiled, last_ddl_time: "2026-01-01T12:02:00" };
  const reader = vi.fn()
    .mockResolvedValueOnce([remote])
    .mockResolvedValueOnce([remote])
    .mockResolvedValueOnce([after])
    .mockResolvedValueOnce([after])
    .mockResolvedValueOnce([after]);
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  try {
    render(<ProgramWindow ref={ref} parts={[compiled]} readOnly={false} onDirty={vi.fn()}
      readCurrentProgram={reader} compilationTarget={hrTarget} compile={compile} />);
    await act(async () => ref.current?.execute?.());
    expect(confirm).toHaveBeenCalledWith("PKG_A cambió en Oracle. ¿Compilar igual?");
    expect(compile.run).not.toHaveBeenCalled();

    await act(async () => ref.current?.execute?.());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(compile.run).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Compilado")).toBeInTheDocument();

    await act(async () => ref.current?.execute?.());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(compile.run).toHaveBeenCalledTimes(2);
  } finally {
    confirm.mockRestore();
  }
});

test("Detener solo se habilita mientras compila y cancela la compilación", async () => {
  const ref = createRef<ProgramActions>();
  let fail: (reason: unknown) => void = () => {};
  const compile = compiler(vi.fn(() => new Promise((_, reject) => { fail = reject; })));
  render(<ProgramWindow ref={ref} parts={[compiled]} readOnly={false} onDirty={vi.fn()}
    readCurrentProgram={vi.fn().mockResolvedValue([compiled])} compilationTarget={hrTarget} compile={compile} />);
  const stop = screen.getByRole("button", { name: /^Detener/ });
  expect(stop).toBeDisabled();
  expect(stop.querySelector(".kbd")).not.toBeEmptyDOMElement();

  fireEvent.click(screen.getByRole("button", { name: /^Compilar/ }));
  await waitFor(() => expect(stop).toBeEnabled());
  expect(screen.getByRole("button", { name: /^Compilar/ })).toBeDisabled();
  fireEvent.click(stop);
  expect(compile.cancel).toHaveBeenCalledTimes(1);
  await act(async () => fail({ Db: { code: "ORA-01013", kind: "Other", message: "cancelado" } }));
  expect(await screen.findByText("Compilación detenida")).toBeInTheDocument();
  expect(stop).toBeDisabled();
});

test("Solo lectura permite alternar la edicion sin recrear el editor ni perder cambios", () => {
  function Window() {
    const [readOnly, setReadOnly] = useState(true);
    return <ProgramWindow parts={parts} readOnly={readOnly} onReadOnlyChange={setReadOnly} onDirty={vi.fn()} />;
  }
  render(<Window />);
  const editor = screen.getByRole("textbox", { name: "Spec" });
  expect(editor).toHaveAttribute("aria-readonly", "true");
  fireEvent.contextMenu(editor);
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Solo lectura", checked: true }));
  expect(editor).toHaveAttribute("aria-readonly", "false");
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => view.dispatch({ changes: { from: 0, insert: "-- nota\n" } }));
  fireEvent.contextMenu(editor);
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Solo lectura", checked: false }));
  expect(editor).toHaveAttribute("aria-readonly", "true");
  expect(view.state.doc.toString()).toBe("-- nota\n" + parts[0].source);
});

test("ofrece Probar para una rutina publica del paquete", () => {
  const onTestRoutine = vi.fn();
  render(<ProgramWindow parts={parts} readOnly onDirty={vi.fn()} onTestRoutine={onTestRoutine} />);
  fireEvent.contextMenu(screen.getByRole("button", { name: /hello/i }));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Probar/ }));
  expect(onTestRoutine).toHaveBeenCalledWith("HELLO", 0, 0);
});

test("el clic derecho en la fuente ofrece Probar sin buscar un objeto homonimo", () => {
  const onTestRoutine = vi.fn();
  const lookup = vi.spyOn(api, "editorObject");
  const coords = vi.spyOn(EditorView.prototype, "posAndSideAtCoords")
    .mockReturnValue({ pos: parts[0].source.indexOf("hello") + 1, assoc: 1 });
  try {
    render(<ProgramWindow parts={parts} readOnly onReadOnlyChange={vi.fn()} onDirty={vi.fn()} onTestRoutine={onTestRoutine}
      catalog={{ sessionId: "s1", owner: "HR", openProgram: vi.fn() }} />);
    fireEvent.contextMenu(screen.getByRole("textbox", { name: "Spec" }), { clientX: 20, clientY: 30 });
    expect(screen.getByRole("menuitemcheckbox", { name: "Solo lectura", checked: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Probar/ }));
    expect(onTestRoutine).toHaveBeenCalledWith("HELLO", 20, 30);
    expect(lookup).not.toHaveBeenCalled();
  } finally {
    coords.mockRestore();
    lookup.mockRestore();
  }
});

test("el menú del editor suma Solo lectura a las acciones de edición en un único menú", () => {
  const onReadOnlyChange = vi.fn();
  render(<ProgramWindow parts={parts} readOnly onReadOnlyChange={onReadOnlyChange} onDirty={vi.fn()} />);
  const editor = screen.getByRole("textbox", { name: "Spec" });
  fireEvent.contextMenu(editor, { clientX: 40, clientY: 50 });
  const menus = screen.getAllByRole("menu", { name: "Editor" });
  expect(menus).toHaveLength(1);
  expect(within(menus[0]).getByRole("menuitemcheckbox", { name: "Solo lectura", checked: true })).toHaveFocus();
  expect(within(menus[0]).getByRole("menuitem", { name: /^Seleccionar todo/ })).toBeEnabled();
  expect(within(menus[0]).getByRole("menuitem", { name: /^Pegar/ })).toBeDisabled();
  fireEvent.click(within(menus[0]).getByRole("menuitemcheckbox", { name: "Solo lectura" }));
  expect(onReadOnlyChange).toHaveBeenCalledWith(false);
  expect(editor).toHaveFocus();
});

test("sin Solo lectura el editor igual ofrece sus acciones", () => {
  render(<ProgramWindow parts={parts} readOnly={false} onDirty={vi.fn()} />);
  fireEvent.contextMenu(screen.getByRole("textbox", { name: "Spec" }), { clientX: 40, clientY: 50 });
  const menu = screen.getByRole("menu", { name: "Editor" });
  expect(within(menu).queryByRole("menuitemcheckbox", { name: "Solo lectura" })).not.toBeInTheDocument();
  expect(within(menu).getByRole("menuitem", { name: /^Pegar/ })).toHaveFocus();
});

const viewOf = (name: string) =>
  EditorView.findFromDOM(screen.getByRole("textbox", { name }).closest<HTMLElement>(".cm-editor")!)!;

function ActivationHost({ active, dialog = false }: { active: boolean; dialog?: boolean }) {
  return (
    <>
      <input aria-label="Afuera" />
      {dialog && <div role="dialog" aria-modal="true" aria-label="Aviso"><button>Aceptar</button></div>}
      <ProgramWindow parts={parts} readOnly onDirty={vi.fn()} active={active} />
    </>
  );
}

test("al activarse la pestaña, el editor de la parte seleccionada recibe el foco", () => {
  const { rerender } = render(<ActivationHost active={false} />);
  fireEvent.keyDown(screen.getByRole("tab", { name: /^Spec/ }), { key: "ArrowRight" });
  screen.getByRole("textbox", { name: "Afuera" }).focus();
  rerender(<ActivationHost active />);
  expect(screen.getByRole("textbox", { name: "Body" })).toHaveFocus();
});

test("al activarse no le quita el foco a un diálogo abierto", () => {
  const { rerender } = render(<ActivationHost active={false} dialog />);
  const accept = screen.getByRole("button", { name: "Aceptar" });
  accept.focus();
  rerender(<ActivationHost active dialog />);
  expect(accept).toHaveFocus();
});

test("al activarse respeta el foco que ya está dentro de la ventana", () => {
  const { rerender } = render(<ActivationHost active={false} />);
  const sideBySide = screen.getByRole("button", { name: "Lado a lado" });
  sideBySide.focus();
  rerender(<ActivationHost active />);
  expect(sideBySide).toHaveFocus();
});

test("cerrar la descripción devuelve el foco al editor", async () => {
  const object = { owner: "HR", name: "VENTAS", object_type: "Table", status: "Valid", last_ddl_time: "" } as const;
  vi.spyOn(api, "editorObject").mockResolvedValue(object);
  vi.spyOn(api, "describeColumns").mockResolvedValue([{ name: "ID", data_type: "NUMBER", nullable: false }]);
  vi.spyOn(EditorView.prototype, "posAndSideAtCoords").mockReturnValue({ pos: 16, assoc: 1 });
  try {
    render(<ProgramWindow parts={[{ kind: "SQL", source: "select * from ventas", diagnostics: [], last_ddl_time: null }]}
      readOnly onDirty={vi.fn()} catalog={{ sessionId: "s1", owner: "HR", openProgram: vi.fn() }} />);
    fireEvent.contextMenu(screen.getByRole("textbox", { name: "Fuente" }), { clientX: 100, clientY: 100 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Describir" }));
    const close = await screen.findByRole("button", { name: "Cerrar descripción" });
    close.focus();
    fireEvent.click(close);
    expect(screen.getByRole("textbox", { name: "Fuente" })).toHaveFocus();
  } finally {
    vi.restoreAllMocks();
  }
});

test("recargar con el mismo texto conserva el editor", () => {
  const { rerender } = render(<ProgramWindow parts={parts} readOnly={false} onDirty={vi.fn()} />);
  const view = viewOf("Spec");
  rerender(<ProgramWindow parts={parts.map((entry) => ({ ...entry }))} readOnly={false} onDirty={vi.fn()} />);
  expect(viewOf("Spec")).toBe(view);
});

test("recargar con texto nuevo de Oracle lo muestra y se puede deshacer", () => {
  const onDirty = vi.fn();
  const { rerender } = render(<ProgramWindow parts={parts} readOnly={false} onDirty={onDirty} />);
  const view = viewOf("Spec");
  const remote = "PACKAGE PKG_A AS\n  PROCEDURE hello;\n  PROCEDURE bye;\nEND;";
  rerender(<ProgramWindow parts={[{ ...parts[0], source: remote }, parts[1]]} readOnly={false} onDirty={onDirty} />);
  expect(viewOf("Spec")).toBe(view);
  expect(view.state.doc.toString()).toBe(remote);
  expect(screen.getByRole("button", { name: /Procedimiento bye/ })).toBeInTheDocument();
  expect(onDirty).not.toHaveBeenLastCalledWith(true);
  act(() => { undo(view); });
  expect(view.state.doc.toString()).toBe(parts[0].source);
});

test("recargar no pisa un borrador con cambios locales", () => {
  const { rerender } = render(<ProgramWindow parts={parts} readOnly={false} onDirty={vi.fn()} />);
  const view = viewOf("Spec");
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\n-- borrador" } }));
  rerender(<ProgramWindow parts={[{ ...parts[0], source: "PACKAGE PKG_A AS\nEND; -- remoto" }, parts[1]]}
    readOnly={false} onDirty={vi.fn()} />);
  expect(viewOf("Spec").state.doc.toString()).toBe(parts[0].source + "\n-- borrador");
});

describe("paquete grande", () => {
  const big = {
    kind: "PACKAGE",
    source: ["PACKAGE PKG_A AS", ...Array.from({ length: 20000 }, (_, i) => `  -- línea ${i}`), "END;"].join("\n"),
    diagnostics: [],
    last_ddl_time: null,
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Solo cuenta las conversiones de la ventana y su editor; plegado y completado tienen su propio costo.
  function conversionsFrom(...files: string[]) {
    const calls: string[] = [];
    const original = Text.prototype.toString;
    vi.spyOn(Text.prototype, "toString").mockImplementation(function (this: Text) {
      const stack = new Error().stack ?? "";
      if (files.some((file) => stack.includes(file))) calls.push(stack);
      return original.call(this);
    });
    return calls;
  }

  function type(view: EditorView, from: number, pieces: string[]) {
    for (const insert of pieces) {
      act(() => { view.dispatch({ changes: { from, insert }, userEvent: "input.type" }); });
      from += insert.length;
    }
  }

  test("tipear no convierte el documento y la estructura se recalcula tras una pausa", () => {
    vi.useFakeTimers();
    render(<ProgramWindow parts={[big, parts[1]]} readOnly={false} onDirty={vi.fn()} />);
    const view = viewOf("Spec");
    const outline = screen.getByRole("complementary", { name: "Estructura" });
    const conversions = conversionsFrom("ProgramWindow.tsx", "ProgramEditor.tsx");
    type(view, view.state.doc.line(1).to + 1, ["  PROCEDURE ", "bye", ";", "\n"]);
    expect(conversions).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(149); });
    expect(within(outline).queryByRole("button", { name: /Procedimiento bye/ })).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(within(outline).getByRole("button", { name: /Procedimiento bye/ })).toBeInTheDocument();
  });

  test("onDirty solo avisa cuando pasa de limpio a sucio y vuelta", () => {
    const onDirty = vi.fn();
    render(<ProgramWindow parts={[big, parts[1]]} readOnly={false} onDirty={onDirty} />);
    const view = viewOf("Spec");
    const end = view.state.doc.length;
    type(view, end, ["x", "y", "z"]);
    act(() => { view.dispatch({ changes: { from: end, to: end + 3 } }); });
    expect(onDirty.mock.calls).toEqual([[true], [false]]);
  });

  test("F8 apenas se tipea compila el texto nuevo sin esperar la pausa", async () => {
    vi.useFakeTimers();
    const ref = createRef<ProgramActions>();
    const compile = compiler();
    render(<ProgramWindow ref={ref} parts={[compiled]} readOnly={false} onDirty={vi.fn()}
      readCurrentProgram={vi.fn().mockResolvedValue([compiled])} compilationTarget={hrTarget} compile={compile} />);
    const view = viewOf("Spec");
    type(view, view.state.doc.length, ["\n", "-- nuevo"]);
    await act(async () => ref.current?.execute?.());
    expect(compile.run).toHaveBeenCalledWith(`${compiledStatement}\n-- nuevo`);
  });

  test("Guardar y Comparar apenas se tipea usan el texto nuevo", async () => {
    vi.useFakeTimers();
    const ref = createRef<ProgramActions>();
    const save = vi.spyOn(api, "saveProgramFile").mockResolvedValue("pkg_a.sql");
    render(<ProgramWindow ref={ref} parts={[parts[0]]} readOnly={false} onDirty={vi.fn()}
      readCurrentProgram={vi.fn().mockResolvedValue([parts[0]])} />);
    const view = viewOf("Spec");
    type(view, view.state.doc.length, ["\n", "-- local"]);
    await act(async () => ref.current?.save?.());
    expect(save).toHaveBeenCalledWith(`${parts[0].source}\n-- local`, "sql", null);
    await act(async () => ref.current?.compareProgram?.());
    const panel = screen.getByRole("region", { name: "Comparación de Spec" });
    expect(within(panel).getByRole("textbox", { name: "Borrador local" })).toHaveTextContent("-- local");
  });
});

describe("búsqueda y reemplazo desde ProgramActions", () => {
  const keyEvent = (key: string, mods: Partial<KeyboardEventInit> = {}) =>
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });

  test("Ctrl+R y Ctrl+H abren Reemplazar, y en solo lectura quedan deshabilitados", () => {
    const ref = createRef<ProgramActions>();
    const { rerender } = render(<ProgramWindow ref={ref} parts={[parts[0]]} readOnly={false} onDirty={vi.fn()} />);

    act(() => {
      handleShortcut(keyEvent("r", { ctrlKey: true }), ref.current!);
    });
    expect(screen.getByRole("textbox", { name: "Reemplazar con" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    act(() => {
      handleShortcut(keyEvent("h", { ctrlKey: true }), ref.current!);
    });
    expect(screen.getByRole("textbox", { name: "Reemplazar con" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    rerender(<ProgramWindow ref={ref} parts={[parts[0]]} readOnly={true} onDirty={vi.fn()} />);
    expect(ref.current?.replace).toBeUndefined();
    expect(handleShortcut(keyEvent("r", { ctrlKey: true }), ref.current!)).toBe(false);
    expect(handleShortcut(keyEvent("h", { ctrlKey: true }), ref.current!)).toBe(false);
    expect(screen.queryByRole("textbox", { name: "Reemplazar con" })).toBeNull();
  });

  test("F3 y Shift+F3 funcionan también en solo lectura", () => {
    const ref = createRef<ProgramActions>();
    const twoMatches = {
      ...parts[0],
      source: "PACKAGE PKG_A AS\n  PROCEDURE hello;\n  PROCEDURE hello_two;\nEND;",
    };
    render(<ProgramWindow ref={ref} parts={[twoMatches]} readOnly={true} onDirty={vi.fn()} />);
    expect(ref.current?.findNext).toBeTypeOf("function");
    expect(ref.current?.findPrev).toBeTypeOf("function");

    act(() => {
      handleShortcut(keyEvent("F3"), ref.current!);
    });
    const search = screen.getByRole("textbox", { name: "Buscar" });
    fireEvent.change(search, { target: { value: "PROCEDURE" } });
    fireEvent.keyDown(search, { key: "Escape" });

    const view = viewOf("Spec");
    act(() => {
      handleShortcut(keyEvent("F3"), ref.current!);
    });
    const firstFrom = view.state.selection.main.from;
    expect(view.state.sliceDoc(firstFrom, view.state.selection.main.to)).toBe("PROCEDURE");

    act(() => {
      handleShortcut(keyEvent("F3"), ref.current!);
    });
    const secondFrom = view.state.selection.main.from;
    expect(secondFrom).toBeGreaterThan(firstFrom);
    expect(view.state.sliceDoc(secondFrom, view.state.selection.main.to)).toBe("PROCEDURE");

    act(() => {
      handleShortcut(keyEvent("F3", { shiftKey: true }), ref.current!);
    });
    expect(view.state.selection.main.from).toBe(firstFrom);
  });
});

test("registra su texto vivo y se da de baja al cerrarse", () => {
  const release = vi.fn();
  const registerSource = vi.fn().mockReturnValue(release);
  const { unmount } = render(
    <ProgramWindow parts={parts} readOnly={false} onDirty={vi.fn()} registerSource={registerSource} />,
  );
  expect(registerSource).toHaveBeenCalledOnce();
  const read = registerSource.mock.calls[0][0] as () => { kind: string; source: string }[];
  const editor = screen.getByRole("textbox", { name: "Spec" });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => view.dispatch({ changes: { from: 0, insert: "-- nuevo\n" } }));
  expect(read()).toEqual([
    { kind: "PACKAGE", source: `-- nuevo\n${parts[0].source}` },
    { kind: "PACKAGE BODY", source: parts[1].source },
  ]);
  unmount();
  expect(release).toHaveBeenCalledOnce();
});

test("Mostrar ficha abre la ficha de la constante en el cursor", async () => {
  const source = "PACKAGE PKG_A AS\n  c_max CONSTANT NUMBER := 3;\n  PROCEDURE p(x NUMBER := c_max);\nEND;";
  const ref = createRef<ProgramActions>();
  render(<ProgramWindow ref={ref} parts={[{ ...parts[0], source }]} readOnly onDirty={vi.fn()} symbols={null} />);
  const editor = screen.getByRole("textbox", { name: "Spec" });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => view.dispatch({ selection: { anchor: source.lastIndexOf("c_max") + 1 } }));
  act(() => ref.current!.showSymbolCard!());
  expect(await screen.findByText("NUMBER := 3")).toBeInTheDocument();
  expect(screen.getByText("línea 2")).toBeInTheDocument();
});
