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
