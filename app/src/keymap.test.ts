import { describe, expect, test, vi } from "vitest";
import {
  commands,
  formatKeys,
  handleShortcut,
  isWebviewKey,
  matches,
  type KeyLike,
} from "./keymap";

function key(keys: string, extra: Partial<KeyLike> = {}) {
  const parts = keys.split("+");
  const last = parts[parts.length - 1];
  return {
    key: last === "Space" ? " " : last,
    ctrlKey: parts.includes("Ctrl"),
    shiftKey: parts.includes("Shift"),
    altKey: parts.includes("Alt"),
    metaKey: false,
    preventDefault: vi.fn(),
    ...extra,
  };
}

describe("keymap", () => {
  test("los atajos del diseño están registrados", () => {
    expect(commands.connect.keys).toBe("Ctrl+Shift+L");
    expect(commands.toggleExplorer.keys).toBe("Ctrl+B");
    expect(commands.refreshExplorer.keys).toBe("Ctrl+Shift+R");
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

  test("F5 y Ctrl R sin acción se bloquean (no recargan la ventana)", () => {
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

  test("Buscar actualizaciones existe sin atajo", () => {
    expect(commands.checkUpdates.label).toBe("Buscar actualizaciones");
    expect(commands.checkUpdates.keys).toBeUndefined();
    expect(commands.checkUpdates.alt).toBeUndefined();
  });

  test("ningún atajo está repetido, alias incluidos", () => {
    const keys = Object.values(commands)
      .flatMap((c) => [c.keys, ...(c.alt ?? [])])
      .filter(Boolean)
      .map((k) => k!.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("un atajo registrado sin acción no se bloquea si no es del webview", () => {
    for (const k of ["Ctrl+A", "Ctrl+Shift+End", "Shift+F10"]) {
      const ev = key(k);
      expect(handleShortcut(ev, {})).toBe(false);
      expect(ev.preventDefault, k).not.toHaveBeenCalled();
    }
  });

  test("las teclas del webview se bloquean siempre", () => {
    const webview = [
      "F5",
      "Ctrl+R",
      "Ctrl+Shift+R",
      "Ctrl+F5",
      "Ctrl+P",
      "Ctrl+U",
      "Ctrl+Shift+I",
      "Ctrl+=",
      "Ctrl+-",
      "Ctrl+0",
    ];
    for (const k of webview) {
      const ev = key(k);
      expect(isWebviewKey(ev), k).toBe(true);
      handleShortcut(ev, {});
      expect(ev.preventDefault, k).toHaveBeenCalled();
    }
    const plus = { ...key("Ctrl+="), key: "+", shiftKey: true };
    expect(isWebviewKey(plus)).toBe(true);
    expect(isWebviewKey(key("Ctrl+A"))).toBe(false);
    expect(isWebviewKey(key("Shift+F10"))).toBe(false);
  });

  test("se bloquean devtools, búsqueda, navegación y barras del webview", () => {
    const webview = [
      "F12",
      "F7",
      "Ctrl+F",
      "Ctrl+G",
      "Ctrl+Shift+G",
      "F3",
      "Shift+F3",
      "Ctrl+Shift+J",
      "Ctrl+J",
      "Ctrl+Shift+C",
      "Alt+ArrowLeft",
      "Alt+ArrowRight",
      "BrowserBack",
      "BrowserForward",
      "BrowserRefresh",
    ];
    for (const k of webview) {
      const ev = key(k);
      expect(isWebviewKey(ev), k).toBe(true);
      expect(handleShortcut(ev, {}), k).toBe(false);
      expect(ev.preventDefault, k).toHaveBeenCalled();
    }
    expect(isWebviewKey(key("ArrowLeft"))).toBe(false);
    expect(isWebviewKey(key("Ctrl+Shift+End"))).toBe(false);
  });

  test("una tecla del webview con acción ejecuta la acción", () => {
    const find = vi.fn();
    const f = key("Ctrl+F");
    expect(handleShortcut(f, { find })).toBe(true);
    expect(find).toHaveBeenCalled();
    expect(f.preventDefault).toHaveBeenCalled();
    const declined = key("F12");
    expect(handleShortcut(declined, { goToDeclaration: () => false })).toBe(false);
    expect(declined.preventDefault).toHaveBeenCalled();
  });

  test("una acción que devuelve false deja pasar la tecla", () => {
    const a = key("Ctrl+A");
    expect(handleShortcut(a, { selectGridRows: () => false })).toBe(false);
    expect(a.preventDefault).not.toHaveBeenCalled();
    const r = key("Ctrl+R");
    expect(handleShortcut(r, { replace: () => false })).toBe(false);
    expect(r.preventDefault).toHaveBeenCalled();
    const done = key("Ctrl+A");
    expect(handleShortcut(done, { selectGridRows: () => {} })).toBe(true);
    expect(done.preventDefault).toHaveBeenCalled();
  });

  test("Reemplazar usa Ctrl R con alias Ctrl H; refrescar pasa a Ctrl Shift R", () => {
    expect(commands.replace.keys).toBe("Ctrl+R");
    expect(commands.replace.alt).toEqual(["Ctrl+H"]);
    for (const k of ["Ctrl+R", "Ctrl+H"]) {
      const run = vi.fn();
      expect(handleShortcut(key(k), { replace: run }), k).toBe(true);
      expect(run).toHaveBeenCalled();
    }
    const refresh = vi.fn();
    const replace = vi.fn();
    handleShortcut(key("Ctrl+Shift+R"), { refreshExplorer: refresh, replace });
    expect(refresh).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  test("Ctrl Y rehace y Ctrl Enter ejecuta como alias", () => {
    expect(commands.redo.alt).toEqual(["Ctrl+Y"]);
    expect(commands.execute.alt).toEqual(["Ctrl+Enter"]);
    const redo = vi.fn();
    expect(handleShortcut(key("Ctrl+Y"), { redo })).toBe(true);
    expect(redo).toHaveBeenCalled();
    const execute = vi.fn();
    expect(handleShortcut(key("Ctrl+Enter"), { execute })).toBe(true);
    expect(execute).toHaveBeenCalled();
  });

  test("comandos nuevos con sus teclas", () => {
    const expected: Record<string, string> = {
      findNext: "F3",
      findPrev: "Shift+F3",
      nextTab: "Ctrl+Tab",
      prevTab: "Ctrl+Shift+Tab",
      moveTabLeft: "Ctrl+Shift+PageUp",
      moveTabRight: "Ctrl+Shift+PageDown",
      clearConsole: "Ctrl+L",
      viewCell: "Shift+Space",
    };
    for (const [id, keys] of Object.entries(expected)) {
      const c = commands[id as keyof typeof commands];
      expect(c?.keys, id).toBe(keys);
      expect(c.label, id).toBeTruthy();
      const run = vi.fn();
      expect(handleShortcut(key(keys), { [id]: run }), id).toBe(true);
      expect(run, id).toHaveBeenCalled();
    }
  });

  test("con AltGr activo ningún atajo coincide", () => {
    const altGr = key("Ctrl+Alt+N", {
      getModifierState: (k: string) => k === "AltGraph",
    });
    expect(matches(altGr, "Ctrl+Alt+N")).toBe(false);
    const run = vi.fn();
    expect(handleShortcut(altGr, { newProgram: run })).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(altGr.preventDefault).not.toHaveBeenCalled();
    const plain = key("Ctrl+Alt+N", { getModifierState: () => false });
    expect(matches(plain, "Ctrl+Alt+N")).toBe(true);
  });
});
