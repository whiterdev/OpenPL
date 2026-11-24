import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { foldedRanges } from "@codemirror/language";
import { createRef } from "react";
import { expect, test, vi } from "vitest";
import { ProgramWindow, type ProgramActions } from "./ProgramWindow";
import { api } from "../api";
import type { ProgramPart } from "../types";
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

test("preparar la compilación exige confirmar la exportación si Oracle cambió", async () => {
  const original = { ...parts[0], source: "CREATE OR REPLACE PACKAGE PKG_A AS\nEND;", last_ddl_time: "2026-01-01T12:00:00" };
  const reader = vi.fn().mockResolvedValue([{ ...original, source: original.source + " -- remoto" }]);
  const save = vi.spyOn(api, "saveProgramFile").mockResolvedValue("compilar-programa.sql");
  try {
    render(<ProgramWindow parts={[original]} readOnly={false} onDirty={vi.fn()}
      readCurrentProgram={reader} compilationTarget={{ owner: "HR", name: "PKG_A" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Preparar compilación/ }));
    expect(await screen.findByText("Cambio en Oracle")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Guardar pese al cambio" }));
    expect(save).toHaveBeenCalledWith(expect.stringContaining('CREATE OR REPLACE PACKAGE "HR"."PKG_A"'), "sql", "compilar-programa.sql");
    expect(await screen.findByText("Script guardado")).toBeInTheDocument();
  } finally {
    save.mockRestore();
  }
});

test("F8 no ofrece exportar si la marca de DDL no es visible", async () => {
  const original = { ...parts[0], source: "CREATE OR REPLACE PACKAGE PKG_A AS\nEND;" };
  render(<ProgramWindow parts={[original]} readOnly={false} onDirty={vi.fn()}
    readCurrentProgram={vi.fn().mockResolvedValue([original])} compilationTarget={{ owner: "HR", name: "PKG_A" }} />);
  fireEvent.click(screen.getByRole("button", { name: /Preparar compilación/ }));
  expect(await screen.findByText("Marca de DDL no disponible")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Guardar script" })).not.toBeInTheDocument();
});

test("cerrar la comprobación ignora una respuesta pendiente", async () => {
  const original = { ...parts[0], source: "CREATE OR REPLACE PACKAGE PKG_A AS\nEND;", last_ddl_time: "2026-01-01T12:00:00" };
  let respond!: (parts: ProgramPart[]) => void;
  const pending = new Promise<ProgramPart[]>((resolve) => { respond = resolve; });
  render(<ProgramWindow parts={[original]} readOnly={false} onDirty={vi.fn()}
    readCurrentProgram={() => pending} compilationTarget={{ owner: "HR", name: "PKG_A" }} />);
  fireEvent.click(screen.getByRole("button", { name: /Preparar compilación/ }));
  expect(screen.getByText("Leyendo Oracle…")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar comparación" }));
  await act(async () => respond([original]));
  expect(screen.queryByRole("button", { name: "Guardar script" })).not.toBeInTheDocument();
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
    expect(objects).toHaveBeenCalledWith("s1", null, "VEN", "HR");

    rerender(<ProgramWindow ref={ref} parts={[source]} readOnly={false} onDirty={vi.fn()}
      catalog={{ sessionId: "s2", owner: "QA", openProgram: vi.fn() }} />);
    act(() => ref.current?.complete?.());
    await waitFor(() => expect(objects).toHaveBeenLastCalledWith("s2", null, "VEN", "QA"));
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

test("el panel distingue las sobrecargas y F12 permite seleccionar su declaración", async () => {
  const spec = "PACKAGE PKG_A AS\n  g_total NUMBER;\n  PROCEDURE registrar(p_id NUMBER);\nEND;";
  const body = "PACKAGE BODY PKG_A AS\n  PROCEDURE registrar(p_id NUMBER) IS BEGIN NULL; END;\n"
    + "  PROCEDURE registrar(p_id VARCHAR2) IS BEGIN NULL; END;\nBEGIN\n  registrar(1);\nEND;";
  const ref = createRef<ProgramActions>();
  render(<ProgramWindow readOnly onDirty={vi.fn()} ref={ref}
    parts={[{ ...parts[0], source: spec }, { ...parts[1], source: body }]} />);
  const outline = within(screen.getByRole("complementary", { name: "Estructura" }));
  expect(outline.getByRole("button", { name: /g_total.*Público/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Body/ }));
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
