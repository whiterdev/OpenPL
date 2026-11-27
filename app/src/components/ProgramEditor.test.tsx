import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { completionStatus, selectedCompletion, startCompletion } from "@codemirror/autocomplete";
import { redo, undo } from "@codemirror/commands";
import { sql } from "@codemirror/lang-sql";
import { syntaxTree } from "@codemirror/language";
import { oracleDialect } from "../editorReference";
import { EditorSelection, EditorState, Text, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { highlightTree, tags } from "@lezer/highlight";
import { indentKeys, ProgramEditor, programSyntax } from "./ProgramEditor";
import { clipboard } from "../api";

// Vitest vacía los imports ?raw de CSS; el proyecto no tiene @types/node.
type Fs = { readFileSync(path: string, encoding: "utf8"): string };
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): Fs } }).process.getBuiltinModule("node:fs");
const windowCss = fs.readFileSync("src/components/ProgramWindow.css", "utf8");

describe("programSyntax", () => {
  it("los comentarios van en cursiva con --cm", () => {
    const comment = programSyntax.specs.find((spec) => spec.tag === tags.comment);
    expect(comment).toMatchObject({ color: "var(--cm)", fontStyle: "italic" });
  });

  it("resalta comentarios de linea y bloque en SQL real", () => {
    const doc = "-- nota\nselect /* detalle */ 1 from dual";
    const state = EditorState.create({ doc, extensions: [sql({ dialect: oracleDialect })] });
    const comments: string[] = [];
    const commentClass = programSyntax.style([tags.comment]);
    highlightTree(syntaxTree(state), programSyntax, (from, to, classes) => {
      if (classes === commentClass) comments.push(doc.slice(from, to));
    });
    expect(comments).toEqual(["-- nota", "/* detalle */"]);
  });

  it("los comentarios tienen otra clase que las palabras clave", () => {
    const comment = programSyntax.style([tags.comment]);
    expect(comment).toBeTruthy();
    expect(comment).not.toBe(programSyntax.style([tags.keyword]));
  });
});

describe("estilos del editor", () => {
  const rules = (selector: string) =>
    windowCss.split("\n").filter((line) => line.startsWith(".program-editor") && line.includes(selector));

  it("la selección usa --sel sin !important", () => {
    const selection = rules(".cm-selectionBackground");
    expect(selection.length).toBeGreaterThan(0);
    expect(selection.join("\n")).toContain("var(--sel)");
    expect(selection.join("\n")).not.toContain("!important");
    expect(rules(".cm-focused").join("\n")).toContain("var(--sel)");
  });

  it("las coincidencias usan --selMatch", () => {
    expect(rules(".cm-selectionMatch").join("\n")).toContain("var(--selMatch)");
  });

  it("la línea activa es translúcida", () => {
    expect(rules(".cm-activeLine").join("\n")).toContain("var(--activeLine)");
  });
});

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
  it("Tab con el cursor inserta dos espacios", () => {
    const result = press("Tab", "begin\nnull;", EditorSelection.single(6));
    expect(result.handled).toBe(true);
    expect(result.doc).toBe("begin\n  null;");
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

function mount(source: string, readOnly = false) {
  let view: EditorView | null = null;
  render(
    <ProgramEditor
      part={{ kind: "BODY", source, last_ddl_time: null, diagnostics: [] }}
      label="Cuerpo" readOnly={readOnly} onView={(v) => { if (v) view = v; }} onChange={() => {}} activate={() => {}}
    />,
  );
  return view!;
}

function key(view: EditorView, name: string, mods: { ctrl?: boolean; shift?: boolean } = {}) {
  let free = true;
  act(() => {
    free = fireEvent.keyDown(view.contentDOM, { key: name, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift });
  });
  return { taken: !free };
}

const cursorAt = (view: EditorView, pos: number) => act(() => { view.dispatch({ selection: { anchor: pos } }); });
const head = (view: EditorView) => view.state.selection.main.head;

describe("teclas estándar del editor", () => {
  it("Enter conserva la sangría de la línea", () => {
    const view = mount("  IF x THEN");
    cursorAt(view, view.state.doc.length);
    key(view, "Enter");
    const lines = view.state.doc.toString().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^ {2,}$/);
    expect(head(view)).toBe(view.state.doc.length);
  });

  it("Enter tras una sentencia completa mantiene la sangría del bloque", () => {
    const view = mount("BEGIN\n    x := 1;\nEND;");
    cursorAt(view, "BEGIN\n    x := 1;".length);
    key(view, "Enter");
    expect(view.state.doc.toString()).toBe("BEGIN\n    x := 1;\n    \nEND;");
  });

  it("Home va al primer carácter y un segundo Home a la columna 0", () => {
    const view = mount("    x := 1;");
    cursorAt(view, view.state.doc.length);
    key(view, "Home");
    expect(head(view)).toBe(4);
    key(view, "Home");
    expect(head(view)).toBe(0);
  });

  it("Ctrl+flechas se mueven por palabra respetando el guion bajo", () => {
    const view = mount("v_total_x := 1");
    cursorAt(view, 0);
    key(view, "ArrowRight", { ctrl: true });
    expect(head(view)).toBe("v_total_x".length);
    key(view, "ArrowLeft", { ctrl: true });
    expect(head(view)).toBe(0);
  });

  it("Ctrl+Backspace borra la palabra anterior completa", () => {
    const view = mount("x := v_total_x");
    cursorAt(view, view.state.doc.length);
    key(view, "Backspace", { ctrl: true });
    expect(view.state.doc.toString()).toBe("x := ");
  });

  it("Ctrl+A selecciona todo el documento", () => {
    const view = mount("begin\n  null;\nend;");
    cursorAt(view, 3);
    key(view, "a", { ctrl: true });
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(view.state.doc.length);
  });

  it("Tab sigue insertando dos espacios", () => {
    const view = mount("begin");
    cursorAt(view, view.state.doc.length);
    key(view, "Tab");
    expect(view.state.doc.toString()).toBe("begin  ");
  });

  it("Ctrl+Z, Ctrl+Shift+Z y Ctrl+Y quedan para el keymap de la app", () => {
    const view = mount("begin");
    cursorAt(view, view.state.doc.length);
    key(view, "Enter");
    expect(key(view, "z", { ctrl: true }).taken).toBe(false);
    expect(key(view, "z", { ctrl: true, shift: true }).taken).toBe(false);
    expect(key(view, "y", { ctrl: true }).taken).toBe(false);
    act(() => { undo(view); });
    expect(view.state.doc.toString()).toBe("begin");
    act(() => { redo(view); });
    expect(view.state.doc.toString()).toContain("\n");
  });

  it("en solo lectura navega y selecciona", () => {
    const view = mount("  IF x THEN", true);
    cursorAt(view, view.state.doc.length);
    key(view, "Home");
    expect(head(view)).toBe(2);
    key(view, "a", { ctrl: true });
    expect(view.state.selection.main.to).toBe(view.state.doc.length);
  });

  it("en solo lectura no toma teclas que editan", () => {
    const view = mount("  IF x THEN", true);
    cursorAt(view, view.state.doc.length);
    for (const [name, ctrl] of [["Enter", false], ["Backspace", false], ["Delete", false], ["Backspace", true], ["Delete", true]] as const) {
      expect(key(view, name, { ctrl }).taken, `${ctrl ? "Ctrl+" : ""}${name}`).toBe(false);
    }
    expect(view.state.doc.toString()).toBe("  IF x THEN");
  });
});

const pause = (ms: number) => act(() => new Promise<void>((done) => setTimeout(done, ms)));

async function typeText(view: EditorView, text: string) {
  act(() => {
    const at = view.state.selection.main.head;
    view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: "input.type" });
  });
}

async function openCompletion(view: EditorView) {
  await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
  // acceptCompletion ignora Enter durante interactionDelay (75 ms).
  await pause(100);
}

describe("autocompletado", () => {
  it("aparece al escribir sin opción preseleccionada y Enter inserta salto", async () => {
    const view = mount("");
    await typeText(view, "SEL");
    await openCompletion(view);
    expect(selectedCompletion(view.state)).toBeNull();
    key(view, "Enter");
    expect(view.state.doc.toString()).toBe("SEL\n");
  });

  it("tras ArrowDown, Enter acepta la sugerencia", async () => {
    const view = mount("");
    await typeText(view, "SEL");
    await openCompletion(view);
    key(view, "ArrowDown");
    const option = selectedCompletion(view.state);
    expect(option).not.toBeNull();
    key(view, "Enter");
    expect(view.state.doc.toString()).toBe(option!.label);
  });

  it.each([
    ["comentario de línea", "-- SEL"],
    ["comentario de bloque", "/* SEL"],
    ["cadena", "x := 'SEL"],
  ])("no aparece en %s", async (_name, text) => {
    const view = mount("");
    await typeText(view, text);
    act(() => { startCompletion(view); });
    await pause(150);
    expect(completionStatus(view.state)).toBeNull();
  });
});

describe("menú contextual", () => {
  function open(props: Partial<Parameters<typeof ProgramEditor>[0]> = {}, source = "select 1 from dual") {
    let view: EditorView | null = null;
    render(
      <ProgramEditor
        part={{ kind: "SQL", source, last_ddl_time: null, diagnostics: [] }}
        label="Fuente" readOnly={false} onView={(v) => { if (v) view = v; }} onChange={() => {}} activate={() => {}}
        {...props}
      />,
    );
    return view!;
  }
  const menu = () => screen.getByRole("menu", { name: "Editor" });

  afterEach(() => vi.restoreAllMocks());

  it("el clic derecho muestra las acciones del editor y los ítems extra", () => {
    const view = open({ menuExtra: [{ label: "Solo lectura", checked: false, run: vi.fn() }] });
    fireEvent.contextMenu(view.contentDOM, { clientX: 100, clientY: 120 });
    const items = Array.from(menu().querySelectorAll(".menu-label"), (label) => label.textContent);
    expect(items).toEqual(["Solo lectura", "Cortar", "Copiar", "Pegar", "Seleccionar todo", "Deshacer", "Rehacer"]);
    expect(menu()).toHaveStyle({ top: "120px" });
    expect(screen.getByRole("menuitemcheckbox", { name: "Solo lectura" })).toHaveFocus();
  });

  it("sobre un objeto conserva el menú del objeto", () => {
    const onObjectContext = vi.fn();
    vi.spyOn(EditorView.prototype, "posAndSideAtCoords").mockReturnValue({ pos: 15, assoc: 1 });
    const view = open({ onObjectContext });
    fireEvent.contextMenu(view.contentDOM, { clientX: 100, clientY: 120 });
    expect(onObjectContext).toHaveBeenCalledWith({ owner: null, name: "DUAL" }, 100, 120, 15);
    expect(screen.queryByRole("menu", { name: "Editor" })).not.toBeInTheDocument();
  });

  it("fuera de un objeto muestra el menú base aunque haya menú de objetos", () => {
    const onObjectContext = vi.fn();
    vi.spyOn(EditorView.prototype, "posAndSideAtCoords").mockReturnValue({ pos: 6, assoc: 1 });
    const view = open({ onObjectContext });
    fireEvent.contextMenu(view.contentDOM, { clientX: 100, clientY: 120 });
    expect(onObjectContext).not.toHaveBeenCalled();
    expect(menu()).toBeInTheDocument();
  });

  it("Copiar desde el menú usa el portapapeles y devuelve el foco al editor", async () => {
    const write = vi.spyOn(clipboard, "writeText").mockResolvedValue();
    const view = open();
    act(() => { view.dispatch({ selection: { anchor: 0, head: 8 } }); });
    fireEvent.contextMenu(view.contentDOM, { clientX: 100, clientY: 120 });
    fireEvent.click(screen.getByRole("menuitem", { name: /^Copiar/ }));
    await waitFor(() => expect(view.contentDOM).toHaveFocus());
    expect(write).toHaveBeenCalledWith("select 1");
    expect(screen.queryByRole("menu", { name: "Editor" })).not.toBeInTheDocument();
  });

  it("Pegar desde el menú inserta el texto leído", async () => {
    vi.spyOn(clipboard, "readText").mockResolvedValue("PKG_VENTAS.");
    const view = open();
    act(() => { view.dispatch({ selection: { anchor: 14 } }); });
    fireEvent.contextMenu(view.contentDOM, { clientX: 100, clientY: 120 });
    fireEvent.click(screen.getByRole("menuitem", { name: /^Pegar/ }));
    await waitFor(() => expect(view.state.doc.toString()).toBe("select 1 from PKG_VENTAS.dual"));
  });

  it("en solo lectura deshabilita Cortar y Pegar", () => {
    const view = open({ readOnly: true });
    act(() => { view.dispatch({ selection: { anchor: 0, head: 6 } }); });
    fireEvent.contextMenu(view.contentDOM, { clientX: 100, clientY: 120 });
    expect(screen.getByRole("menuitem", { name: /^Cortar/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /^Pegar/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /^Copiar/ })).toBeEnabled();
  });

  it("abierto por teclado se ancla en el cursor", () => {
    const view = open();
    const coords = vi.spyOn(view, "coordsAtPos").mockReturnValue({ left: 40, right: 40, top: 50, bottom: 62 });
    act(() => { view.dispatch({ selection: { anchor: 7 } }); });
    fireEvent.contextMenu(view.contentDOM, { clientX: 0, clientY: 0 });
    expect(coords).toHaveBeenCalledWith(7);
    expect(menu()).toHaveStyle({ left: "40px", top: "62px" });
  });

  it.each([
    ["la tecla Menú", { key: "ContextMenu" }],
    ["Shift+F10", { key: "F10", shiftKey: true }],
  ])("%s ancla el menú en el cursor", (_name, keys) => {
    const posAt = vi.spyOn(EditorView.prototype, "posAndSideAtCoords");
    const view = open();
    vi.spyOn(view, "coordsAtPos").mockReturnValue({ left: 40, right: 40, top: 50, bottom: 62 });
    fireEvent.keyDown(view.contentDOM, keys);
    fireEvent.contextMenu(view.contentDOM, { clientX: 300, clientY: 200 });
    expect(menu()).toHaveStyle({ left: "40px", top: "62px" });
    expect(posAt).not.toHaveBeenCalled();
  });
});

describe("insertar en paquetes", () => {
  const body = "PACKAGE BODY pkg_ventas AS\n  \nEND pkg_ventas;";
  const emptyLine = "PACKAGE BODY pkg_ventas AS\n".length;
  const inserts = ["Insertar función", "Insertar procedimiento", "Insertar cursor", "Insertar tipo registro",
    "Insertar excepción", "Insertar constante"];

  function open(kind: string, source: string, readOnly = false) {
    let view: EditorView | null = null;
    render(
      <ProgramEditor
        part={{ kind, source, last_ddl_time: null, diagnostics: [] }}
        label="Cuerpo" readOnly={readOnly} onView={(v) => { if (v) view = v; }} onChange={() => {}} activate={() => {}}
      />,
    );
    return view!;
  }
  const labels = () => Array.from(screen.getByRole("menu", { name: "Editor" }).querySelectorAll(".menu-label"),
    (label) => label.textContent);

  afterEach(() => vi.restoreAllMocks());

  it("en una línea vacía del cuerpo muestra Insertar y la función queda implementada", () => {
    vi.spyOn(EditorView.prototype, "posAndSideAtCoords").mockReturnValue({ pos: emptyLine + 1, assoc: 1 });
    const view = open("PACKAGE BODY", body);
    fireEvent.contextMenu(view.contentDOM, { clientX: 100, clientY: 120 });
    expect(labels().slice(0, 6)).toEqual(inserts);
    fireEvent.click(screen.getByRole("menuitem", { name: "Insertar función" }));
    expect(view.state.doc.toString()).toBe(
      "PACKAGE BODY pkg_ventas AS\n  FUNCTION nueva_funcion RETURN NUMBER IS\n  BEGIN\n    RETURN NULL;\n"
      + "  END nueva_funcion;\nEND pkg_ventas;",
    );
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe("nueva_funcion");
    undo(view);
    expect(view.state.doc.toString()).toBe(body);
  });

  it("en la especificación inserta la declaración", () => {
    vi.spyOn(EditorView.prototype, "posAndSideAtCoords").mockReturnValue({ pos: "PACKAGE pkg AS\n".length, assoc: 1 });
    const view = open("PACKAGE", "PACKAGE pkg AS\n\nEND pkg;");
    fireEvent.contextMenu(view.contentDOM, { clientX: 100, clientY: 120 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Insertar procedimiento" }));
    expect(view.state.doc.toString()).toBe("PACKAGE pkg AS\nPROCEDURE nuevo_procedimiento;\nEND pkg;");
  });

  it("en una línea con texto no aparece", () => {
    vi.spyOn(EditorView.prototype, "posAndSideAtCoords").mockReturnValue({ pos: 3, assoc: 1 });
    const view = open("PACKAGE BODY", body);
    fireEvent.contextMenu(view.contentDOM, { clientX: 100, clientY: 120 });
    expect(labels()).not.toContain("Insertar función");
  });

  it("fuera de un paquete o en solo lectura no aparece", () => {
    vi.spyOn(EditorView.prototype, "posAndSideAtCoords").mockReturnValue({ pos: emptyLine + 1, assoc: 1 });
    const procedure = open("PROCEDURE", body);
    fireEvent.contextMenu(procedure.contentDOM, { clientX: 100, clientY: 120 });
    expect(labels()).not.toContain("Insertar función");
    fireEvent.keyDown(document, { key: "Escape" });
    const locked = open("PACKAGE BODY", body, true);
    fireEvent.contextMenu(locked.contentDOM, { clientX: 100, clientY: 120 });
    expect(labels()).not.toContain("Insertar función");
  });
});

describe("paquete grande", () => {
  const source = ["PACKAGE BODY PKG_VENTAS AS", ...Array.from({ length: 20000 }, (_, i) => `  -- línea ${i}`), "END;"].join("\n");

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Solo cuenta las conversiones hechas desde el editor; plegado y completado tienen su propio costo.
  function conversionsFrom(file: string) {
    const calls: string[] = [];
    const original = Text.prototype.toString;
    vi.spyOn(Text.prototype, "toString").mockImplementation(function (this: Text) {
      const stack = new Error().stack ?? "";
      if (stack.includes(file)) calls.push(stack);
      return original.call(this);
    });
    return calls;
  }

  it("tipear entrega el documento sin convertirlo a texto", () => {
    vi.useFakeTimers();
    const changes: Text[] = [];
    let view!: EditorView;
    render(
      <ProgramEditor
        part={{ kind: "PACKAGE BODY", source, last_ddl_time: null,
          diagnostics: [{ line: 2, column: 3, text: "PLS-00103: símbolo inesperado", warning: false }] }}
        label="Body" readOnly={false} onView={(v) => { if (v) view = v; }} onChange={(doc) => changes.push(doc)}
        activate={() => {}}
      />,
    );
    act(() => { vi.advanceTimersByTime(1000); });
    const conversions = conversionsFrom("ProgramEditor.tsx");
    for (const insert of ["x", "y", "z"]) {
      act(() => { view.dispatch({ changes: { from: 0, insert }, userEvent: "input.type" }); });
    }
    act(() => { vi.advanceTimersByTime(1000); });
    expect(conversions).toHaveLength(0);
    expect(changes).toHaveLength(3);
    expect(changes[2]).toBe(view.state.doc);
  });

  it("los diagnósticos de la parte se muestran mientras el texto coincide con Oracle", async () => {
    let view!: EditorView;
    render(
      <ProgramEditor
        part={{ kind: "PACKAGE BODY", source, last_ddl_time: null,
          diagnostics: [{ line: 2, column: 3, text: "PLS-00103: símbolo inesperado", warning: false }] }}
        label="Body" readOnly={false} onView={(v) => { if (v) view = v; }} onChange={() => {}} activate={() => {}}
      />,
    );
    await waitFor(() => expect(view.dom.querySelector(".cm-lintRange-error")).toBeInTheDocument());
    act(() => { view.dispatch({ changes: { from: 0, insert: "x" }, userEvent: "input.type" }); });
    await waitFor(() => expect(view.dom.querySelector(".cm-lintRange-error")).not.toBeInTheDocument());
  });
});
