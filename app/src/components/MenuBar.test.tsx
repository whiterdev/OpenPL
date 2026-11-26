import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MenuBar, type MenuDef } from "./MenuBar";

function menus(onConnect = vi.fn()): MenuDef[] {
  return [
    { label: "Archivo", items: [{ command: "save" }] },
    {
      label: "Sesión",
      items: [{ command: "connect", run: onConnect }, "sep", { command: "commit" }],
    },
  ];
}

describe("MenuBar", () => {
  test("abre el menú y muestra cada comando con su atajo", async () => {
    render(<MenuBar menus={menus()} />);
    await userEvent.click(screen.getByRole("button", { name: "Sesión" }));
    const item = screen.getByRole("menuitem", { name: /Conectar/ });
    expect(item).toHaveTextContent("Ctrl Shift L");
    expect(screen.getByRole("menuitem", { name: /Commit/ })).toHaveTextContent("F10");
  });

  test("comandos sin acción quedan deshabilitados", async () => {
    render(<MenuBar menus={menus()} />);
    await userEvent.click(screen.getByRole("button", { name: "Sesión" }));
    expect(screen.getByRole("menuitem", { name: /Commit/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Conectar/ })).toBeEnabled();
  });

  test("elegir un comando lo ejecuta y cierra el menú", async () => {
    const onConnect = vi.fn();
    render(<MenuBar menus={menus(onConnect)} />);
    await userEvent.click(screen.getByRole("button", { name: "Sesión" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Conectar/ }));
    expect(onConnect).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("Escape cierra el menú", async () => {
    render(<MenuBar menus={menus()} />);
    await userEvent.click(screen.getByRole("button", { name: "Archivo" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

test("el menú principal se recorre con flechas y Escape devuelve el foco", () => {
  render(<MenuBar menus={[{ label: "Archivo", items: [
    { command: "newSql", label: "SQL", run: vi.fn() },
    { command: "newTest", label: "Prueba" },
    { command: "newCommand", label: "Consola", run: vi.fn() },
  ] }]} />);
  const trigger = screen.getByRole("button", { name: "Archivo" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const first = screen.getByRole("menuitem", { name: /^SQL/ });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  const last = screen.getByRole("menuitem", { name: /^Consola/ });
  expect(last).toHaveFocus();
  fireEvent.keyDown(last, { key: "Escape" });
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("Alt solo abre el primer menú y Alt+otra tecla no actúa", () => {
  render(<MenuBar menus={menus()} />);

  // Alt+S (otra tecla mientras Alt está presionado) no abre la barra.
  fireEvent.keyDown(document, { key: "Alt", altKey: true });
  fireEvent.keyDown(document, { key: "s", altKey: true });
  fireEvent.keyUp(document, { key: "s", altKey: false });
  fireEvent.keyUp(document, { key: "Alt", altKey: false });
  expect(screen.queryByRole("menu")).toBeNull();

  // Alt solo (keydown + keyup sin otra tecla) abre el primer menú y enfoca la barra.
  fireEvent.keyDown(document, { key: "Alt", altKey: true });
  fireEvent.keyUp(document, { key: "Alt", altKey: false });
  expect(screen.getByRole("menu", { name: "Archivo" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Archivo" })).toHaveFocus();

  // Alt solo de nuevo cierra el menú abierto.
  fireEvent.keyDown(document, { key: "Alt", altKey: true });
  fireEvent.keyUp(document, { key: "Alt", altKey: false });
  expect(screen.queryByRole("menu")).toBeNull();
});

test("Alt no abre la barra si hay un diálogo modal abierto", () => {
  render(
    <>
      <MenuBar menus={menus()} />
      <div role="dialog" aria-modal="true" />
    </>,
  );
  fireEvent.keyDown(document, { key: "Alt", altKey: true });
  fireEvent.keyUp(document, { key: "Alt", altKey: false });
  expect(screen.queryByRole("menu")).toBeNull();
});

test("flechas izquierda y derecha cambian entre menús abiertos", () => {
  const onRun = vi.fn();
  render(
    <MenuBar
      menus={[
        { label: "Archivo", items: [{ command: "save", run: onRun }] },
        { label: "Editar", items: [{ command: "undo", run: onRun }] },
        { label: "Buscar", items: [{ command: "find", run: onRun }] },
      ]}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Archivo" }));
  expect(screen.getByRole("menuitem", { name: /Guardar/ })).toHaveFocus();

  fireEvent.keyDown(screen.getByRole("menu", { name: "Archivo" }), { key: "ArrowRight" });
  expect(screen.getByRole("menu", { name: "Editar" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: /Deshacer/ })).toHaveFocus();

  fireEvent.keyDown(screen.getByRole("menu", { name: "Editar" }), { key: "ArrowLeft" });
  expect(screen.getByRole("menu", { name: "Archivo" })).toBeInTheDocument();

  // Envolvente circular hacia la izquierda.
  fireEvent.keyDown(screen.getByRole("menu", { name: "Archivo" }), { key: "ArrowLeft" });
  expect(screen.getByRole("menu", { name: "Buscar" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: /Buscar/ })).toHaveFocus();
});

test("los ítems deshabilitados muestran el motivo en title", () => {
  render(
    <MenuBar
      menus={[
        {
          label: "Sesión",
          items: [
            { command: "connect", run: vi.fn() },
            { command: "commit" },
            { command: "disconnect", reason: "Sin conexión" },
          ],
        },
      ]}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Sesión" }));
  expect(screen.getByRole("menuitem", { name: /Conectar/ })).not.toHaveAttribute("title");
  const commit = screen.getByRole("menuitem", { name: /Commit/ });
  expect(commit).toBeDisabled();
  expect(commit).toHaveAttribute("title", expect.stringMatching(/\S/));
  const disconnect = screen.getByRole("menuitem", { name: /Desconectar/ });
  expect(disconnect).toBeDisabled();
  expect(disconnect).toHaveAttribute("title", "Sin conexión");
});
