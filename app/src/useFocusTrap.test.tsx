import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, test } from "vitest";
import { useFocusTrap } from "./useFocusTrap";
import { ContextMenu } from "./components/ContextMenu";

test("Tab cicla el foco, Ctrl+A queda nativo y Escape devuelve el foco", () => {
  function Dialog({ close }: { close: () => void }) {
    const trap = useFocusTrap(close);
    return <div role="dialog" {...trap}>
      <input aria-label="Texto" />
      <button disabled>Deshabilitado</button>
      <button>Último</button>
    </div>;
  }
  function App() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Abrir</button>{open && <Dialog close={() => setOpen(false)} />}</>;
  }
  render(<App />);
  const opener = screen.getByRole("button", { name: "Abrir" });
  opener.focus();
  fireEvent.click(opener);
  const first = screen.getByRole("textbox", { name: "Texto" });
  const last = screen.getByRole("button", { name: "Último" });
  expect(first).toHaveFocus();
  expect(fireEvent.keyDown(first, { key: "a", ctrlKey: true })).toBe(true);
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(last).toHaveFocus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "Escape" });
  expect(opener).toHaveFocus();
});

test("Tab y clic fuera del menú contextual devuelven el foco", () => {
  function App() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Abrir</button>
      {open && <ContextMenu x={0} y={0} label="Opciones" onClose={() => setOpen(false)}
        items={[{ label: "Copiar", run: () => {} }]} />}</>;
  }
  render(<App />);
  const opener = screen.getByRole("button", { name: "Abrir" });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.keyDown(screen.getByRole("menuitem"), { key: "Tab" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  fireEvent.click(opener);
  awaitFocusOutside();
  expect(opener).toHaveFocus();

  function awaitFocusOutside() { fireEvent.mouseDown(document.body); }
});

test("clic fuera del menú contextual en una zona sin controles devuelve el foco al editor", () => {
  function App() {
    const [open, setOpen] = useState(false);
    return <>
      <div className="cm-editor">
        <div className="cm-content" tabIndex={0} onContextMenu={(e) => { e.preventDefault(); setOpen(true); }}>
          select 1 from dual
        </div>
      </div>
      <div className="backdrop">fuera</div>
      {open && <ContextMenu x={0} y={0} label="Editor" onClose={() => setOpen(false)}
        items={[{ label: "Copiar", run: () => {} }]} />}
    </>;
  }
  render(<App />);
  const editor = document.querySelector<HTMLElement>(".cm-content")!;
  editor.focus();
  fireEvent.contextMenu(editor);
  expect(screen.getByRole("menuitem", { name: "Copiar" })).toHaveFocus();
  fireEvent.mouseDown(document.querySelector(".backdrop")!);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(editor).toHaveFocus();
});
