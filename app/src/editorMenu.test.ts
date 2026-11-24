import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { clipboard } from "./api";
import { editorMenuItems } from "./editorMenu";
import type { ContextItem } from "./components/ContextMenu";

let views: EditorView[] = [];

afterEach(() => {
  views.forEach((view) => { view.destroy(); view.dom.remove(); });
  views = [];
  vi.restoreAllMocks();
});

function editor(doc: string, selection: { anchor: number; head?: number } = { anchor: 0 }, readOnly = false) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, selection, extensions: [history(), EditorState.readOnly.of(readOnly)] }),
  });
  views.push(view);
  return view;
}

function item(items: (ContextItem | "sep")[], label: string) {
  const found = items.find((entry): entry is ContextItem => entry !== "sep" && entry.label === label);
  if (!found) throw new Error(`Falta ${label}`);
  return found;
}

const flush = () => new Promise<void>((done) => setTimeout(done, 0));

describe("editorMenuItems", () => {
  it("muestra los atajos de cada acción", () => {
    const items = editorMenuItems(editor("select 1"), { readOnly: false });
    expect(items.filter((entry) => entry !== "sep").map((entry) => [entry.label, entry.keys])).toEqual([
      ["Cortar", "Ctrl+X"], ["Copiar", "Ctrl+C"], ["Pegar", "Ctrl+V"], ["Seleccionar todo", "Ctrl+A"],
      ["Deshacer", "Ctrl+Z"], ["Rehacer", "Ctrl+Shift+Z"],
    ]);
  });

  it("sin selección deshabilita Cortar y Copiar", () => {
    const items = editorMenuItems(editor("select 1"), { readOnly: false });
    expect(item(items, "Cortar").run).toBeUndefined();
    expect(item(items, "Copiar").run).toBeUndefined();
    expect(item(items, "Pegar").run).toBeDefined();
    expect(item(items, "Seleccionar todo").run).toBeDefined();
  });

  it("con selección habilita Cortar y Copiar", () => {
    const items = editorMenuItems(editor("select 1", { anchor: 0, head: 6 }), { readOnly: false });
    expect(item(items, "Cortar").run).toBeDefined();
    expect(item(items, "Copiar").run).toBeDefined();
  });

  it("en solo lectura solo deja Copiar y Seleccionar todo", () => {
    const view = editor("select 1", { anchor: 0, head: 6 }, true);
    const items = editorMenuItems(view, { readOnly: true });
    expect(item(items, "Cortar").run).toBeUndefined();
    expect(item(items, "Pegar").run).toBeUndefined();
    expect(item(items, "Deshacer").run).toBeUndefined();
    expect(item(items, "Rehacer").run).toBeUndefined();
    expect(item(items, "Copiar").run).toBeDefined();
    expect(item(items, "Seleccionar todo").run).toBeDefined();
  });

  it("Copiar escribe la selección y devuelve el foco al editor", async () => {
    const write = vi.spyOn(clipboard, "writeText").mockResolvedValue();
    const view = editor("select 1 from dual", { anchor: 0, head: 8 });
    item(editorMenuItems(view, { readOnly: false }), "Copiar").run!();
    await flush();
    expect(write).toHaveBeenCalledWith("select 1");
    expect(view.state.doc.toString()).toBe("select 1 from dual");
    expect(view.contentDOM).toHaveFocus();
  });

  it("Cortar escribe la selección y la borra", async () => {
    vi.spyOn(clipboard, "writeText").mockResolvedValue();
    const view = editor("select 1 from dual", { anchor: 8, head: 18 });
    item(editorMenuItems(view, { readOnly: false }), "Cortar").run!();
    await flush();
    expect(clipboard.writeText).toHaveBeenCalledWith(" from dual");
    expect(view.state.doc.toString()).toBe("select 1");
    expect(view.contentDOM).toHaveFocus();
  });

  it("Cortar no borra si el portapapeles falla", async () => {
    vi.spyOn(clipboard, "writeText").mockRejectedValue(new Error("sin permiso"));
    const view = editor("select 1", { anchor: 0, head: 6 });
    item(editorMenuItems(view, { readOnly: false }), "Cortar").run!();
    await flush();
    expect(view.state.doc.toString()).toBe("select 1");
  });

  it("Pegar inserta el texto del portapapeles en la selección", async () => {
    vi.spyOn(clipboard, "readText").mockResolvedValue("PKG_VENTAS");
    const view = editor("select x from dual", { anchor: 7, head: 8 });
    item(editorMenuItems(view, { readOnly: false }), "Pegar").run!();
    await flush();
    expect(view.state.doc.toString()).toBe("select PKG_VENTAS from dual");
    expect(view.state.selection.main.head).toBe("select PKG_VENTAS".length);
    expect(view.contentDOM).toHaveFocus();
  });

  it("Seleccionar todo selecciona el documento", () => {
    const view = editor("begin\n  null;\nend;", { anchor: 3 });
    item(editorMenuItems(view, { readOnly: false }), "Seleccionar todo").run!();
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(view.state.doc.length);
    expect(view.contentDOM).toHaveFocus();
  });

  it("Deshacer y Rehacer siguen el historial", () => {
    const view = editor("begin");
    expect(item(editorMenuItems(view, { readOnly: false }), "Deshacer").run).toBeUndefined();
    view.dispatch({ changes: { from: 5, insert: ";" }, userEvent: "input.type" });
    item(editorMenuItems(view, { readOnly: false }), "Deshacer").run!();
    expect(view.state.doc.toString()).toBe("begin");
    item(editorMenuItems(view, { readOnly: false }), "Rehacer").run!();
    expect(view.state.doc.toString()).toBe("begin;");
    expect(view.contentDOM).toHaveFocus();
  });

  it("agrega los ítems extra al principio", () => {
    const extra = { label: "Solo lectura", checked: true, run: vi.fn() };
    const items = editorMenuItems(editor("select 1"), { readOnly: false, extra: [extra] });
    expect(items[0]).toBe(extra);
    expect(items[1]).toBe("sep");
  });
});
