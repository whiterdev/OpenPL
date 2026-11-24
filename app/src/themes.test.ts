import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contrastRatio } from "./contrast";
import {
  activeTheme,
  activeThemeId,
  applyActiveTheme,
  applyTheme,
  contrastWarnings,
  DEFAULT_THEME_ID,
  deleteCustomTheme,
  loadThemes,
  PRESETS,
  saveCustomTheme,
  setActiveThemeId,
  THEME_TOKENS,
  type Theme,
} from "./themes";

// Vitest vacía los imports ?raw de CSS; el proyecto no tiene @types/node.
type Fs = { readFileSync(path: string, encoding: "utf8"): string };
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): Fs } }).process.getBuiltinModule("node:fs");
const themeCss = fs.readFileSync("src/theme.css", "utf8");

const grafito = () => PRESETS.find((t) => t.id === "grafito")!;

function custom(overrides: Partial<Theme> = {}): Theme {
  return { ...grafito(), id: "mio", name: "Mío", builtin: false, colors: { ...grafito().colors }, ...overrides };
}

beforeEach(() => {
  localStorage.removeItem("openpl.theme");
  localStorage.removeItem("openpl.customThemes");
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

describe("presets", () => {
  it("trae Grafito, Papel, Medianoche, Bosque y Alto contraste", () => {
    expect(PRESETS.map((t) => t.name)).toEqual(["Grafito", "Papel", "Medianoche", "Bosque", "Alto contraste"]);
    expect(PRESETS.every((t) => t.builtin)).toBe(true);
    expect(PRESETS.find((t) => t.name === "Papel")!.mode).toBe("light");
    expect(DEFAULT_THEME_ID).toBe("grafito");
  });

  it("Grafito coincide con los valores de theme.css", () => {
    for (const token of THEME_TOKENS) {
      const match = themeCss.match(new RegExp(`--${token}:\\s*([^;]+);`));
      expect(match?.[1].trim(), `--${token}`).toBe(grafito().colors[token]);
    }
  });

  it("los colores de entorno no forman parte del tema", () => {
    expect(THEME_TOKENS.some((t) => t.startsWith("env"))).toBe(false);
  });

  for (const theme of PRESETS) {
    describe(theme.name, () => {
      const c = theme.colors;
      it("el texto contrasta 7:1 sobre el fondo del editor", () => {
        expect(contrastRatio(c.text, c.s0)).toBeGreaterThanOrEqual(7);
      });
      it("secundario, comentarios y sintaxis contrastan 4.5:1", () => {
        for (const token of ["muted", "cm", "kw", "ty", "st", "nu", "fn"] as const) {
          expect(contrastRatio(c[token], c.s0), token).toBeGreaterThanOrEqual(4.5);
        }
      });
      it("no tiene avisos de contraste", () => {
        expect(contrastWarnings(theme)).toEqual([]);
      });
    });
  }
});

describe("contrastWarnings", () => {
  it("avisa cuando el texto no se lee sobre el fondo", () => {
    const theme = custom({ colors: { ...grafito().colors, text: "#2a2c30" } });
    expect(contrastWarnings(theme).map((w) => w.fg + "/" + w.bg)).toContain("text/s0");
  });
});

describe("persistencia", () => {
  it("sin nada guardado el tema activo es Grafito", () => {
    expect(activeThemeId()).toBe("grafito");
    expect(activeTheme().id).toBe("grafito");
  });

  it("recuerda el tema activo", () => {
    setActiveThemeId("papel");
    expect(localStorage.getItem("openpl.theme")).toBe("papel");
    expect(activeThemeId()).toBe("papel");
  });

  it("un id desconocido cae en Grafito", () => {
    localStorage.setItem("openpl.theme", "no-existe");
    expect(activeThemeId()).toBe("grafito");
  });

  it("JSON corrupto en los temas propios deja solo los presets y Grafito activo", () => {
    localStorage.setItem("openpl.customThemes", "{no es json");
    localStorage.setItem("openpl.theme", "mio");
    expect(loadThemes().map((t) => t.id)).toEqual(PRESETS.map((t) => t.id));
    expect(activeThemeId()).toBe("grafito");
  });

  it("descarta temas guardados con colores inválidos", () => {
    const bad = { ...custom({ id: "malo" }), colors: { ...grafito().colors, kw: "red" } };
    localStorage.setItem("openpl.customThemes", JSON.stringify([bad, custom()]));
    expect(loadThemes().map((t) => t.id)).toEqual([...PRESETS.map((t) => t.id), "mio"]);
  });

  it("si localStorage falla usa Grafito", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(loadThemes()).toHaveLength(PRESETS.length);
    expect(activeThemeId()).toBe("grafito");
  });

  it("guarda un tema propio aunque tenga poco contraste", () => {
    saveCustomTheme(custom({ colors: { ...grafito().colors, text: "#2a2c30" } }));
    const saved = loadThemes().find((t) => t.id === "mio")!;
    expect(saved.builtin).toBe(false);
    expect(saved.colors.text).toBe("#2a2c30");
  });

  it("guardar con el mismo id reemplaza el tema", () => {
    saveCustomTheme(custom());
    saveCustomTheme(custom({ name: "Otro" }));
    expect(loadThemes().filter((t) => t.id === "mio").map((t) => t.name)).toEqual(["Otro"]);
  });

  it("rechaza colores que no son #rrggbb", () => {
    expect(() => saveCustomTheme(custom({ colors: { ...grafito().colors, accent: "#abc" } }))).toThrow(/accent/);
    expect(() => saveCustomTheme(custom({ colors: { ...grafito().colors, text: "white" } }))).toThrow(/text/);
    expect(loadThemes().some((t) => t.id === "mio")).toBe(false);
  });

  it("no permite pisar un preset", () => {
    expect(() => saveCustomTheme(custom({ id: "grafito" }))).toThrow();
  });

  it("no guarda colores de entorno aunque vengan en el tema", () => {
    const colors = { ...grafito().colors, "env-prod": "#000000" } as Theme["colors"];
    saveCustomTheme(custom({ colors }));
    expect(localStorage.getItem("openpl.customThemes")).not.toContain("env-prod");
  });

  it("borrar el tema activo vuelve a Grafito", () => {
    saveCustomTheme(custom());
    setActiveThemeId("mio");
    deleteCustomTheme("mio");
    expect(loadThemes().some((t) => t.id === "mio")).toBe(false);
    expect(activeThemeId()).toBe("grafito");
  });
});

describe("hojas de estilo", () => {
  const literal = /#[0-9a-f]{3,8}\b|rgba?\(/i;
  const outsideRoot = themeCss.replace(/:root\s*\{[^}]*\}/, "");

  for (const [file, css] of [
    ["App.css", fs.readFileSync("src/App.css", "utf8")],
    ["LoginDialog.css", fs.readFileSync("src/components/LoginDialog.css", "utf8")],
    ["theme.css fuera de :root", outsideRoot],
  ]) {
    it(`${file} usa tokens en vez de colores literales`, () => {
      expect(css.split("\n").filter((line) => literal.test(line))).toEqual([]);
    });
  }

  it("theme.css define el fondo de diálogos y la sombra", () => {
    expect(themeCss).toMatch(/--backdrop:\s*rgba\(12, 13, 15, 0\.55\);/);
    expect(themeCss).toMatch(/--shadow:\s*rgba\(0, 0, 0, 0\.5\);/);
  });
});

describe("applyTheme", () => {
  it("escribe las variables, color-scheme y data-theme", () => {
    const papel = PRESETS.find((t) => t.id === "papel")!;
    applyTheme(papel);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--s0")).toBe(papel.colors.s0);
    expect(root.style.getPropertyValue("--kw")).toBe(papel.colors.kw);
    expect(root.style.getPropertyValue("--field-line")).toBe(papel.colors["field-line"]);
    expect(root.style.getPropertyValue("--sel")).not.toBe("");
    expect(root.style.getPropertyValue("--activeLine")).not.toBe("");
    expect(root.style.colorScheme).toBe("light");
    expect(root.dataset.theme).toBe("papel");
  });

  it("deriva la selección del acento como en theme.css", () => {
    applyTheme(grafito());
    expect(document.documentElement.style.getPropertyValue("--sel")).toBe("rgba(201, 154, 59, 0.3)");
    expect(document.documentElement.style.getPropertyValue("--selMatch")).toBe("rgba(141, 178, 203, 0.18)");
  });

  it("al arrancar aplica el tema guardado", () => {
    setActiveThemeId("medianoche");
    applyActiveTheme();
    expect(document.documentElement.dataset.theme).toBe("medianoche");
    expect(document.documentElement.style.getPropertyValue("--s0")).toBe("#161a22");
  });

  it("no toca los colores de entorno", () => {
    applyTheme(grafito());
    expect(document.documentElement.style.getPropertyValue("--env-prod")).toBe("");
  });
});
