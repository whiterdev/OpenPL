import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getSearchQuery, searchPanelOpen, SearchQuery } from "@codemirror/search";
import { editorSearch, findNextMatch, findPrevMatch, openFind, openReplace } from "./EditorSearch";
import { createRef } from "react";
import { ProgramEditor } from "./ProgramEditor";
import { SqlWindow } from "./SqlWindow";
import type { ProgramActions } from "./ProgramWindow";
import { contrastRatio } from "../contrast";

// Vitest vacía los imports ?raw de CSS; el proyecto no tiene @types/node.
type Fs = { readFileSync(path: string, encoding: "utf8"): string };
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): Fs } }).process.getBuiltinModule("node:fs");
const themeCss = fs.readFileSync("src/theme.css", "utf8");
const searchCss = fs.readFileSync("src/components/EditorSearch.css", "utf8");

function token(name: string) {
  const match = themeCss.match(new RegExp(`--${name}:\\s*([^;]+);`));
  expect(match, `falta --${name} en theme.css`).not.toBeNull();
  return match![1].trim();
}

let views: EditorView[] = [];

function editor(doc: string, readOnly = false) {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent, doc,
    extensions: [editorSearch(), EditorState.readOnly.of(readOnly)],
  });
  views.push(view);
  return view;
}

function open(view: EditorView, command = openFind) {
  act(() => { command(view); });
}

const searchField = () => screen.getByRole("textbox", { name: "Buscar" });
const counter = () => screen.getByRole("status");

afterEach(() => {
  act(() => { views.forEach((view) => view.destroy()); });
  views = [];
  document.body.innerHTML = "";
});

describe("barra de búsqueda", () => {
  it("Ctrl+F abre el campo Buscar con el foco", () => {
    const view = editor("select 1 from dual");
    open(view);
    expect(searchPanelOpen(view.state)).toBe(true);
    expect(document.activeElement).toBe(searchField());
  });

  it("escribir en el campo actualiza la consulta del editor", () => {
    const view = editor("select 1 from dual");
    open(view);
    fireEvent.change(searchField(), { target: { value: "dual" } });
    expect(getSearchQuery(view.state).search).toBe("dual");
  });

  it("el contador muestra el total y la posición tras Enter", () => {
    const view = editor("uno dos uno tres uno");
    open(view);
    fireEvent.change(searchField(), { target: { value: "uno" } });
    expect(counter()).toHaveTextContent("3 resultados");
    expect(counter()).toHaveAttribute("aria-live", "polite");
    fireEvent.keyDown(searchField(), { key: "Enter" });
    expect(counter()).toHaveTextContent("1 de 3");
    fireEvent.keyDown(searchField(), { key: "Enter" });
    expect(counter()).toHaveTextContent("2 de 3");
  });

  it("Shift+Enter va a la coincidencia anterior", () => {
    const view = editor("uno dos uno tres uno");
    open(view);
    fireEvent.change(searchField(), { target: { value: "uno" } });
    fireEvent.keyDown(searchField(), { key: "Enter", shiftKey: true });
    expect(counter()).toHaveTextContent("3 de 3");
  });

  it("sin coincidencias dice Sin resultados", () => {
    const view = editor("select 1 from dual");
    open(view);
    fireEvent.change(searchField(), { target: { value: "xyz" } });
    expect(counter()).toHaveTextContent("Sin resultados");
  });

  it("una expresión regular inválida se marca como no válida", () => {
    const view = editor("select 1 from dual");
    open(view);
    fireEvent.click(screen.getByRole("button", { name: "Expresión regular" }));
    fireEvent.change(searchField(), { target: { value: "(" } });
    expect(counter()).toHaveTextContent("No válida");
  });

  it("el contador se detiene en 9999", () => {
    const view = editor("a".repeat(10050));
    open(view);
    fireEvent.change(searchField(), { target: { value: "a" } });
    expect(counter()).toHaveTextContent("9999+ resultados");
  });

  it("el toggle de mayúsculas cambia aria-pressed y la consulta", () => {
    const view = editor("Uno uno UNO");
    open(view);
    fireEvent.change(searchField(), { target: { value: "uno" } });
    expect(counter()).toHaveTextContent("3 resultados");
    const toggle = screen.getByRole("button", { name: "Mayúsculas y minúsculas" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(getSearchQuery(view.state).caseSensitive).toBe(true);
    expect(counter()).toHaveTextContent("1 resultado");
  });

  it("palabra completa y expresión regular llegan a la consulta", () => {
    const view = editor("uno unos");
    open(view);
    fireEvent.click(screen.getByRole("button", { name: "Palabra completa" }));
    fireEvent.click(screen.getByRole("button", { name: "Expresión regular" }));
    const query = getSearchQuery(view.state);
    expect(query.wholeWord).toBe(true);
    expect(query.regexp).toBe(true);
  });

  it("anterior y siguiente recorren las coincidencias", () => {
    const view = editor("uno dos uno");
    open(view);
    fireEvent.change(searchField(), { target: { value: "uno" } });
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(counter()).toHaveTextContent("1 de 2");
    fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
    expect(counter()).toHaveTextContent("2 de 2");
  });

  it("Esc cierra y devuelve el foco al editor", () => {
    const view = editor("select 1 from dual");
    open(view);
    fireEvent.keyDown(searchField(), { key: "Escape" });
    expect(searchPanelOpen(view.state)).toBe(false);
    expect(document.activeElement).toBe(view.contentDOM);
  });

  it("el botón Cerrar cierra la barra", () => {
    const view = editor("select 1 from dual");
    open(view);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(searchPanelOpen(view.state)).toBe(false);
  });

  it("el contador no recalcula al mover el cursor ni al escribir el reemplazo", () => {
    const getCursorSpy = vi.spyOn(SearchQuery.prototype, "getCursor");
    try {
      const view = editor("uno dos uno tres uno");
      open(view, openReplace);
      expect(getCursorSpy).toHaveBeenCalledTimes(0);

      fireEvent.change(searchField(), { target: { value: "uno" } });
      expect(counter()).toHaveTextContent("3 resultados");
      expect(getCursorSpy).toHaveBeenCalledTimes(1);

      act(() => {
        view.dispatch({ selection: { anchor: 0, head: 3 } });
      });
      expect(counter()).toHaveTextContent("1 de 3");
      expect(getCursorSpy).toHaveBeenCalledTimes(1);

      act(() => {
        view.dispatch({ selection: { anchor: 8, head: 11 } });
      });
      expect(counter()).toHaveTextContent("2 de 3");
      expect(getCursorSpy).toHaveBeenCalledTimes(1);

      act(() => {
        view.dispatch({ selection: { anchor: 4 } });
      });
      expect(counter()).toHaveTextContent("3 resultados");
      expect(getCursorSpy).toHaveBeenCalledTimes(1);

      fireEvent.change(screen.getByRole("textbox", { name: "Reemplazar con" }), { target: { value: "dos" } });
      expect(getCursorSpy).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: "Mayúsculas y minúsculas" }));
      expect(getCursorSpy).toHaveBeenCalledTimes(2);

      act(() => {
        view.dispatch({ changes: { from: view.state.doc.length, insert: " uno" } });
      });
      expect(counter()).toHaveTextContent("4 resultados");
      expect(getCursorSpy).toHaveBeenCalledTimes(3);
    } finally {
      getCursorSpy.mockRestore();
    }
  });

  it("findNextMatch y findPrevMatch abren la barra si no hay consulta", () => {
    const first = editor("select 1 from dual");
    act(() => { findNextMatch(first); });
    expect(searchPanelOpen(first.state)).toBe(true);
    expect(document.activeElement).toBe(searchField());

    act(() => { first.destroy(); });
    document.body.innerHTML = "";

    const second = editor("select 1 from dual");
    act(() => { findPrevMatch(second); });
    expect(searchPanelOpen(second.state)).toBe(true);
    expect(document.activeElement).toBe(searchField());
  });

  it("findNextMatch y findPrevMatch recorren coincidencias con la barra cerrada", () => {
    const view = editor("uno dos uno tres");
    open(view);
    fireEvent.change(searchField(), { target: { value: "uno" } });
    fireEvent.keyDown(searchField(), { key: "Escape" });
    expect(searchPanelOpen(view.state)).toBe(false);

    act(() => { findNextMatch(view); });
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(3);

    act(() => { findNextMatch(view); });
    expect(view.state.selection.main.from).toBe(8);
    expect(view.state.selection.main.to).toBe(11);

    act(() => { findPrevMatch(view); });
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(3);
  });
});

describe("reemplazar", () => {
  it("Ctrl+F deja la fila Reemplazar cerrada", () => {
    const view = editor("uno dos");
    open(view);
    expect(screen.queryByRole("textbox", { name: "Reemplazar con" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mostrar reemplazar" })).toHaveAttribute("aria-expanded", "false");
  });

  it("Ctrl+H abre la fila Reemplazar", () => {
    const view = editor("uno dos");
    open(view, openReplace);
    expect(screen.getByRole("textbox", { name: "Reemplazar con" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mostrar reemplazar" })).toHaveAttribute("aria-expanded", "true");
  });

  it("Ctrl+F después de Ctrl+H vuelve a cerrar la fila", () => {
    const view = editor("uno dos");
    open(view, openReplace);
    open(view, openFind);
    expect(screen.queryByRole("textbox", { name: "Reemplazar con" })).toBeNull();
  });

  it("el botón de plegado abre y cierra la fila", () => {
    const view = editor("uno dos");
    open(view);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar reemplazar" }));
    expect(screen.getByRole("textbox", { name: "Reemplazar con" })).toBeInTheDocument();
  });

  it("Reemplazar cambia la coincidencia actual y Reemplazar todo el resto", () => {
    const view = editor("uno dos uno uno");
    open(view, openReplace);
    fireEvent.change(searchField(), { target: { value: "uno" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Reemplazar con" }), { target: { value: "UN" } });
    expect(getSearchQuery(view.state).replace).toBe("UN");
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    fireEvent.click(screen.getByRole("button", { name: "Reemplazar" }));
    expect(view.state.doc.toString()).toBe("UN dos uno uno");
    fireEvent.click(screen.getByRole("button", { name: "Reemplazar todo" }));
    expect(view.state.doc.toString()).toBe("UN dos UN UN");
  });

  it("en solo lectura no hay fila ni botón de reemplazo", () => {
    const view = editor("uno dos", true);
    open(view, openReplace);
    expect(screen.queryByRole("textbox", { name: "Reemplazar con" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mostrar reemplazar" })).toBeNull();
  });
});

describe("ProgramEditor", () => {
  it("usa la barra flotante arriba", () => {
    let view: EditorView | null = null;
    render(
      <ProgramEditor
        part={{ kind: "SPEC", source: "select 1 from dual", last_ddl_time: null, diagnostics: [] }}
        label="SQL" readOnly={false} onView={(v) => { view = v; }} onChange={() => {}} activate={() => {}}
      />,
    );
    open(view!);
    const bar = document.querySelector(".cm-panels-top .editor-search");
    expect(bar).not.toBeNull();
    expect(searchField()).toBeInTheDocument();
  });
});

describe("SqlWindow", () => {
  it("find abre sin la fila Reemplazar y replace la abre", () => {
    const ref = createRef<ProgramActions>();
    render(<SqlWindow ref={ref} sessionId="w1" initialSql="select 1 from dual" onTransaction={() => {}} onDirty={() => {}} />);
    act(() => ref.current!.find!());
    expect(searchField()).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Reemplazar con" })).toBeNull();
    act(() => ref.current!.replace!());
    expect(screen.getByRole("textbox", { name: "Reemplazar con" })).toBeInTheDocument();
  });
});

describe("contraste de la barra", () => {
  it("el texto y el contador se leen sobre la barra y el campo", () => {
    // Barra en --s1, interior del campo en --s0.
    expect(contrastRatio(token("text"), token("s1"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("muted"), token("s1"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("err"), token("s1"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("text"), token("s0"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("muted"), token("s0"))).toBeGreaterThanOrEqual(4.5);
  });

  it("los íconos y el borde del campo llegan a 3:1", () => {
    expect(contrastRatio(token("field-line"), token("s1"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(token("field-line"), token("s0"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(token("text"), token("s3"))).toBeGreaterThanOrEqual(4.5);
  });

  it("el toggle presionado se distingue con 3:1 en el borde y el ícono", () => {
    expect(contrastRatio(token("accent"), token("accentSoft"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(token("accent"), token("s0"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(token("text"), token("accentSoft"))).toBeGreaterThanOrEqual(4.5);
  });

  it("la barra solo usa colores del tema", () => {
    expect(searchCss).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});
