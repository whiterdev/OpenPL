import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import App from "./App";
import { api } from "./api";

const windowEvents = vi.hoisted(() => ({ close: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: windowEvents.close }),
}));

vi.mock("./api", () => ({
  api: {
    clientInfo: vi.fn(async () => ({ version: "19.0.0", error: null, help: "", lib_dir: null })),
    openProgramFile: vi.fn(),
    saveProgramFile: vi.fn(),
    listProfiles: vi.fn(async () => []),
    connect: vi.fn(),
    listObjects: vi.fn(),
    programSource: vi.fn(),
    sqlOpen: vi.fn(),
    sqlClose: vi.fn(),
    sqlExecute: vi.fn(),
    sqlCommit: vi.fn(),
    sqlRollback: vi.fn(),
    sqlCancel: vi.fn(),
    sqlEditTarget: vi.fn(),
    sqlApply: vi.fn(),
  },
}));

test("permite editar y guardar un archivo local desde el flujo normal", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.openProgramFile).mockResolvedValue({ name: "demo.pks", source: "PACKAGE demo AS\r\nEND;" });
  vi.mocked(api.saveProgramFile).mockResolvedValueOnce(null).mockResolvedValueOnce("demo.pks");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    const editor = await screen.findByRole("textbox", { name: "Spec" });
    const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\n-- cambio" } }));
    await screen.findByRole("button", { name: /demo\.pks \*/ });

    const closeEvent = { preventDefault: vi.fn() };
    const onClose = windowEvents.close.mock.calls[0]?.[0];
    expect(onClose).toBeTypeOf("function");
    onClose(closeEvent);
    expect(closeEvent.preventDefault).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar demo.pks" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(editor).toBeInTheDocument();

    const program = within(screen.getByRole("region", { name: "Ventana de programa" }));
    const save = program.getByRole("button", { name: /Guardar/ });
    fireEvent.click(save);
    await screen.findByRole("button", { name: /demo\.pks \*/ });
    await vi.waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await program.findByText("Archivo guardado");
    expect(api.saveProgramFile).toHaveBeenLastCalledWith("PACKAGE demo AS\nEND;\n-- cambio", "pks", "demo.pks");
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(editor).not.toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
  } finally {
    confirm.mockRestore();
  }
});

test("compara el programa en su sesión aunque el explorador cambie de conexión", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.connect)
    .mockResolvedValueOnce({ session_id: "s1", server_version: "12.1.0", compat: { kind: "Supported" } })
    .mockResolvedValueOnce({ session_id: "s2", server_version: "12.1.0", compat: { kind: "Supported" } });
  vi.mocked(api.listObjects).mockResolvedValue([{
    owner: "HR", name: "PKG_A", object_type: "Package", status: "Valid", last_ddl_time: "2026-01-01T12:00:00",
  }]);
  const spec = {
    kind: "PACKAGE", source: "CREATE OR REPLACE PACKAGE PKG_A AS\n  g_total NUMBER;\nEND;",
    last_ddl_time: "2026-01-01T12:00:00", diagnostics: [],
  };
  vi.mocked(api.programSource).mockResolvedValueOnce([spec])
    .mockResolvedValueOnce([{ ...spec, source: "CREATE OR REPLACE PACKAGE PKG_A AS\nEND; -- remoto" }])
    .mockResolvedValueOnce([spec]);
  render(<App />);

  async function login(service: string) {
    const dialog = within(await screen.findByRole("dialog", { name: "Conectar a Oracle" }));
    const user = dialog.getByLabelText("Usuario");
    fireEvent.change(user, { target: { value: "HR" } });
    fireEvent.change(dialog.getByLabelText("Contraseña"), { target: { value: "clave" } });
    fireEvent.change(dialog.getByLabelText("Host"), { target: { value: "db.example.com" } });
    fireEvent.change(dialog.getByLabelText("Servicio"), { target: { value: service } });
    fireEvent.click(dialog.getByRole("button", { name: "Conectar" }));
    await waitFor(() => expect(user).not.toBeInTheDocument());
  }

  await login("DEV");
  fireEvent.click(await screen.findByRole("treeitem", { name: "Paquetes" }));
  const object = await screen.findByRole("treeitem", { name: "PKG_A" });
  fireEvent.contextMenu(object);
  fireEvent.click(screen.getByRole("menuitem", { name: "Editar Spec y Body" }));
  const editor = await screen.findByRole("textbox", { name: "Spec" });
  fireEvent.keyDown(window, { key: "P", altKey: true, shiftKey: true });
  expect(editor.querySelector(".cm-foldPlaceholder")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "A", altKey: true, shiftKey: true });
  expect(editor.querySelector(".cm-foldPlaceholder")).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "l", ctrlKey: true, shiftKey: true });
  await login("QA");
  fireEvent.keyDown(window, { key: "d", altKey: true, shiftKey: true });

  expect(await screen.findByText("Cambio en Oracle")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar comparación" }));
  fireEvent.keyDown(window, { key: "F8" });
  expect(await screen.findByRole("button", { name: "Guardar script" })).toBeInTheDocument();
  expect(api.programSource).toHaveBeenCalledTimes(3);
  expect(api.programSource).toHaveBeenLastCalledWith("s1", "Package", "HR", "PKG_A");
});

test("Nuevo despliega los tipos de ventana y crea un paquete con Spec y Body", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByRole("button", { name: "Nuevo" }));
  const menu = within(screen.getByRole("menu", { name: "Nuevo" }));
  expect(menu.getByRole("menuitem", { name: /Ventana SQL/ })).toBeDisabled();
  expect(menu.getByRole("menuitem", { name: /Ventana de prueba/ })).toBeDisabled();
  expect(menu.getByRole("menuitem", { name: /Vista/ })).toBeEnabled();
  fireEvent.click(menu.getByRole("menuitem", { name: /Paquete/ }));
  expect(await screen.findByRole("textbox", { name: "Spec" })).toHaveTextContent("CREATE OR REPLACE PACKAGE nuevo_paquete AS");
  fireEvent.click(screen.getByRole("button", { name: /^Body/ }));
  expect(screen.getByRole("textbox", { name: "Body" })).toHaveTextContent("CREATE OR REPLACE PACKAGE BODY nuevo_paquete AS");
  expect(screen.queryByRole("menu", { name: "Nuevo" })).not.toBeInTheDocument();
});

test("bloquea el menú del navegador salvo en campos de texto", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  const input = (await screen.findAllByRole("textbox"))[0];
  expect(fireEvent.contextMenu(input)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(fireEvent.contextMenu(document.querySelector(".titlebar")!)).toBe(false);
});

test("sin conexión ofrece conectar o abrir un programa, y lo pendiente se marca", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  const workspace = within(screen.getByRole("main"));
  expect(workspace.getByText("Sin conexión")).toBeInTheDocument();
  fireEvent.click(workspace.getByRole("button", { name: /Nuevo programa/ }));
  expect(await screen.findByRole("textbox", { name: "Fuente" })).toBeInTheDocument();

  expect(screen.queryByRole("button", { name: "Ayuda" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Commit/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Nuevo" }));
  const menu = within(screen.getByRole("menu", { name: "Nuevo" }));
  expect(menu.getByRole("menuitem", { name: /Ventana de prueba.*Próximamente/ })).toBeDisabled();
  expect(menu.getByRole("menuitem", { name: /Ventana SQL/ })).toBeDisabled();
  expect(menu.getByRole("menuitem", { name: /Ventana SQL/ })).not.toHaveTextContent("Próximamente");
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Sesión" }));
  const session = within(screen.getByRole("menu", { name: "Sesión" }));
  expect(session.getByRole("menuitem", { name: /Plan de ejecución.*Próximamente/ })).toBeDisabled();
  expect(session.getByRole("menuitem", { name: /^Desconectar$/ })).toBeDisabled();
});

test("Conectar desde el área vacía abre el login", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  fireEvent.click(within(screen.getByRole("main")).getByRole("button", { name: /Conectar/ }));
  expect(await screen.findByRole("button", { name: "Cancelar" })).toBeInTheDocument();
});

async function connectAs(service = "DEV") {
  vi.mocked(api.connect).mockResolvedValueOnce({ session_id: "s1", server_version: "12.1.0", compat: { kind: "Supported" } });
  const dialog = within(await screen.findByRole("dialog", { name: "Conectar a Oracle" }));
  const user = dialog.getByLabelText("Usuario");
  fireEvent.change(user, { target: { value: "HR" } });
  fireEvent.change(dialog.getByLabelText("Contraseña"), { target: { value: "clave" } });
  fireEvent.change(dialog.getByLabelText("Host"), { target: { value: "db.example.com" } });
  fireEvent.change(dialog.getByLabelText("Servicio"), { target: { value: service } });
  fireEvent.click(dialog.getByRole("button", { name: "Conectar" }));
  await waitFor(() => expect(user).not.toBeInTheDocument());
}

test("Ctrl N abre una ventana SQL con sesión propia y Commit actúa sobre ella", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listObjects).mockResolvedValue([]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w1");
  vi.mocked(api.sqlExecute).mockResolvedValue({
    result: { kind: "Done", message: "1 fila actualizada" }, elapsed_ms: 1, output: [], transaction: true,
  });
  vi.mocked(api.sqlCommit).mockResolvedValue(false);
  render(<App />);
  await connectAs();
  expect(screen.getByText("Sin transacción")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "n", ctrlKey: true });
  const editor = await screen.findByRole("textbox", { name: "SQL" });
  expect(api.sqlOpen).toHaveBeenCalledWith("s1");
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => view.dispatch({ changes: { from: 0, insert: "update t set a = 1" } }));
  await act(async () => { fireEvent.keyDown(window, { key: "F8" }); });
  expect(api.sqlExecute).toHaveBeenCalledWith("w1", "update t set a = 1", []);
  expect(await screen.findByText("Transacción abierta")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Commit/ }));
  expect(await screen.findByText("Sin transacción")).toBeInTheDocument();
  expect(api.sqlCommit).toHaveBeenCalledWith("w1");
});

test("cerrar una ventana SQL con transacción abierta pregunta qué hacer", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listObjects).mockResolvedValue([]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w2");
  vi.mocked(api.sqlExecute).mockResolvedValue({
    result: { kind: "Done", message: "1 fila borrada" }, elapsed_ms: 1, output: [], transaction: true,
  });
  vi.mocked(api.sqlRollback).mockResolvedValue(false);
  vi.mocked(api.sqlClose).mockResolvedValue();
  render(<App />);
  await connectAs();
  fireEvent.keyDown(window, { key: "n", ctrlKey: true });
  const editor = await screen.findByRole("textbox", { name: "SQL" });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => view.dispatch({ changes: { from: 0, insert: "delete from t where id = 1" } }));
  await act(async () => { fireEvent.keyDown(window, { key: "F8" }); });
  await screen.findByText("Transacción abierta");

  fireEvent.click(screen.getByRole("button", { name: /^Cerrar SQL 1/ }));
  let dialog = within(screen.getByRole("dialog", { name: "Transacción abierta" }));
  fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
  expect(editor).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Cerrar SQL 1/ }));
  dialog = within(screen.getByRole("dialog", { name: "Transacción abierta" }));
  fireEvent.click(dialog.getByRole("button", { name: "Rollback" }));
  await waitFor(() => expect(editor).not.toBeInTheDocument());
  expect(api.sqlRollback).toHaveBeenCalledWith("w2");
  expect(api.sqlClose).toHaveBeenCalledWith("w2");
});

test("Consultar datos del explorador abre y ejecuta un SELECT", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listObjects).mockResolvedValue([{
    owner: "HR", name: "CLIENTES", object_type: "Table", status: "Valid", last_ddl_time: "",
  }]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w3");
  vi.mocked(api.sqlExecute).mockResolvedValue({
    result: { kind: "Query", cursor: 1, columns: [{ name: "ID", type_name: "NUMBER", numeric: true }], page: { rows: [["1"]], more: false } },
    elapsed_ms: 1, output: [], transaction: false,
  });
  render(<App />);
  await connectAs();
  fireEvent.click(await screen.findByRole("treeitem", { name: "Tablas" }));
  fireEvent.contextMenu(await screen.findByRole("treeitem", { name: "CLIENTES" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Consultar datos/ }));
  expect(await screen.findByRole("grid", { name: "Resultados" })).toBeInTheDocument();
  expect(api.sqlExecute).toHaveBeenCalledWith("w3", 'SELECT * FROM "HR"."CLIENTES"', []);
});

test("Editar datos del explorador abre la grilla en edición", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listObjects).mockResolvedValue([{
    owner: "HR", name: "CLIENTES", object_type: "Table", status: "Valid", last_ddl_time: "",
  }]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w4");
  vi.mocked(api.sqlEditTarget).mockResolvedValue({
    owner: "HR", name: "CLIENTES", columns: [{ name: "ID", data_type: "NUMBER", nullable: false, editable: true }],
  });
  vi.mocked(api.sqlExecute)
    .mockResolvedValueOnce({
      result: { kind: "Query", cursor: 1, columns: [{ name: "ID", type_name: "NUMBER", numeric: true }], page: { rows: [["1"]], more: false } },
      elapsed_ms: 1, output: [], transaction: false,
    })
    .mockResolvedValueOnce({
      result: {
        kind: "Query", cursor: 2,
        columns: [{ name: "OPENPL$ROWID", type_name: "ROWID", numeric: false }, { name: "ID", type_name: "NUMBER", numeric: true }],
        page: { rows: [["AAA1", "1"]], more: false },
      },
      elapsed_ms: 1, output: [], transaction: false,
    });
  render(<App />);
  await connectAs();
  fireEvent.click(await screen.findByRole("treeitem", { name: "Tablas" }));
  fireEvent.contextMenu(await screen.findByRole("treeitem", { name: "CLIENTES" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Editar datos/ }));
  expect(await screen.findByRole("button", { name: /Editando/ })).toHaveAttribute("aria-pressed", "true");
  expect(api.sqlEditTarget).toHaveBeenCalledWith("w4", "HR", "CLIENTES");
});
