import { describe, expect, test } from "vitest";
import { commands, formatKeys, matches } from "./keymap";

describe("keymap", () => {
  test("los atajos del diseño están registrados", () => {
    expect(commands.connect.keys).toBe("Ctrl+Shift+L");
    expect(commands.toggleExplorer.keys).toBe("Ctrl+B");
    expect(commands.refreshExplorer.keys).toBe("Ctrl+R");
    expect(commands.commit.keys).toBe("F10");
    expect(commands.rollback.keys).toBe("Shift+F10");
    expect(commands.palette.keys).toBe("Ctrl+K");
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

  test("ningún atajo está repetido", () => {
    const keys = Object.values(commands)
      .map((c) => c.keys)
      .filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
