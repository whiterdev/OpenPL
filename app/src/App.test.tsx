import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
