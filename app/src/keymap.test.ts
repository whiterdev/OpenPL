import { describe, expect, test, vi } from "vitest";
import { commands, formatKeys, handleShortcut, matches } from "./keymap";

describe("keymap", () => {
  test("los atajos del diseño están registrados", () => {
    expect(commands.connect.keys).toBe("Ctrl+Shift+L");
    expect(commands.toggleExplorer.keys).toBe("Ctrl+B");
    expect(commands.refreshExplorer.keys).toBe("Ctrl+R");
    expect(commands.commit.keys).toBe("F10");
    expect(commands.rollback.keys).toBe("Shift+F10");
    expect(commands.palette.keys).toBe("Ctrl+K");
  });

  test("Ctrl Space completa en el editor", () => {
    expect(commands.complete.keys).toBe("Ctrl+Space");
    const ev = {
      key: " ",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    };
    expect(matches(ev, "Ctrl+Space")).toBe(true);
    expect(matches({ ...ev, ctrlKey: false }, "Ctrl+Space")).toBe(false);
  });

  test("formatKeys muestra con espacios", () => {
    expect(formatKeys("Ctrl+Shift+L")).toBe("Ctrl Shift L");
    expect(formatKeys("F10")).toBe("F10");
  });

  test("matches reconoce modificadores exactos", () => {
    const ev = {
      key: "l",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    };
    expect(matches(ev, "Ctrl+Shift+L")).toBe(true);
    expect(matches({ ...ev, shiftKey: false }, "Ctrl+Shift+L")).toBe(false);
    expect(
      matches(
        {
          key: "F10",
          ctrlKey: false,
          shiftKey: true,
          altKey: false,
          metaKey: false,
        },
        "Shift+F10",
      ),
    ).toBe(true);
    expect(
      matches(
        {
          key: "F10",
          ctrlKey: false,
          shiftKey: true,
          altKey: false,
          metaKey: false,
        },
        "F10",
      ),
    ).toBe(false);
  });

  test("un atajo registrado sin acción igual se bloquea (F5, Ctrl R no recargan la ventana)", () => {
    const ev = {
      key: "F5",
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
    };
    expect(handleShortcut(ev, {})).toBe(false);
    expect(ev.preventDefault).toHaveBeenCalled();
    const r = {
      key: "r",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
    };
    handleShortcut(r, {});
    expect(r.preventDefault).toHaveBeenCalled();
  });

  test("handleShortcut ejecuta la acción del atajo", () => {
    const run = vi.fn();
    const ev = {
      key: "b",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
    };
    expect(handleShortcut(ev, { toggleExplorer: run })).toBe(true);
    expect(run).toHaveBeenCalled();
  });

  test("teclas sin atajo no se bloquean", () => {
    const ev = {
      key: "a",
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
    };
    handleShortcut(ev, {});
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  test("Ctrl , abre Personalizar interfaz", () => {
    expect(commands.customizeUi.label).toBe("Personalizar interfaz");
    expect(commands.customizeUi.keys).toBe("Ctrl+,");
    const run = vi.fn();
    const ev = {
      key: ",",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
    };
    expect(handleShortcut(ev, { customizeUi: run })).toBe(true);
    expect(run).toHaveBeenCalled();
  });

  test("ningún atajo está repetido", () => {
    const keys = Object.values(commands)
      .map((c) => c.keys)
      .filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
