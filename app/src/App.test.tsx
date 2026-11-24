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
    kind: "PACKAGE", source: "CREATE OR REPLACE PACKAGE PKG_A AS\nEND;", last_ddl_time: "2026-01-01T12:00:00", diagnostics: [],
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
  await screen.findByRole("textbox", { name: "Spec" });
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
