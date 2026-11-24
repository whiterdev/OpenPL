import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeDialog, toggleThemeMode } from "./ThemeDialog";
import { activeThemeId, applyTheme, loadThemes, PRESETS, saveCustomTheme, setActiveThemeId } from "../themes";

const root = document.documentElement;
const css = (token: string) => root.style.getPropertyValue(`--${token}`);
const preset = (id: string) => PRESETS.find((t) => t.id === id)!;

beforeEach(() => {
  localStorage.clear();
  applyTheme(preset("grafito"));
});

afterEach(() => {
  root.removeAttribute("style");
  root.removeAttribute("data-theme");
});

describe("ThemeDialog", () => {
  test("elegir un preset aplica sus variables", async () => {
    render(<ThemeDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: /Papel/ }));
    expect(css("s0")).toBe(preset("papel").colors.s0);
    expect(css("kw")).toBe(preset("papel").colors.kw);
    expect(root.style.colorScheme).toBe("light");
  });

  test("duplicar, editar y guardar persiste el tema propio y lo activa", async () => {
    const onClose = vi.fn();
    render(<ThemeDialog onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Duplicar como personalizado" }));
    const name = screen.getByLabelText("Nombre");
    await userEvent.clear(name);
    await userEvent.type(name, "Mío");
    const accent = screen.getByLabelText("Acento");
    await userEvent.clear(accent);
    await userEvent.type(accent, "#3366aa");
    expect(css("accent")).toBe("#3366aa");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    const saved = loadThemes().find((t) => t.name === "Mío");
    expect(saved).toBeDefined();
    expect(saved!.builtin).toBe(false);
    expect(saved!.colors.accent).toBe("#3366aa");
    expect(activeThemeId()).toBe(saved!.id);
    expect(onClose).toHaveBeenCalled();
  });

  test("el selector de color también edita el token", async () => {
    render(<ThemeDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Duplicar como personalizado" }));
    fireEvent.change(screen.getByLabelText("Selector de Palabras clave"), { target: { value: "#112233" } });
    expect(css("kw")).toBe("#112233");
    expect(screen.getByLabelText<HTMLInputElement>("Palabras clave").value).toBe("#112233");
  });

  test("Cancelar revierte la vista previa y no cambia el tema activo", async () => {
    const onClose = vi.fn();
    render(<ThemeDialog onClose={onClose} />);
    await userEvent.click(screen.getByRole("radio", { name: /Papel/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(css("s0")).toBe(preset("grafito").colors.s0);
    expect(activeThemeId()).toBe("grafito");
    expect(onClose).toHaveBeenCalled();
  });

  test("Escape cancela igual que el botón", async () => {
    const onClose = vi.fn();
    render(<ThemeDialog onClose={onClose} />);
    await userEvent.click(screen.getByRole("radio", { name: /Medianoche/ }));
    await userEvent.keyboard("{Escape}");
    expect(css("s0")).toBe(preset("grafito").colors.s0);
    expect(onClose).toHaveBeenCalled();
  });

  test("un hex inválido se rechaza y no toca la vista previa", async () => {
    render(<ThemeDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Duplicar como personalizado" }));
    const accent = screen.getByLabelText("Acento");
    await userEvent.clear(accent);
    await userEvent.type(accent, "#zz12");
    expect(accent).toHaveAttribute("aria-invalid", "true");
    expect(css("accent")).toBe(preset("grafito").colors.accent);
    await userEvent.tab();
    expect(accent).toHaveValue(preset("grafito").colors.accent);
    expect(accent).toHaveAttribute("aria-invalid", "false");
  });

  test("los temas incluidos no se editan ni se eliminan", () => {
    render(<ThemeDialog onClose={vi.fn()} />);
    expect(screen.getByLabelText("Acento")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeDisabled();
  });

  test("Restablecer vuelve a los colores guardados", async () => {
    render(<ThemeDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Duplicar como personalizado" }));
    const reset = screen.getByRole("button", { name: "Restablecer" });
    expect(reset).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Selector de Texto"), { target: { value: "#000000" } });
    expect(reset).toBeEnabled();
    await userEvent.click(reset);
    expect(css("text")).toBe(preset("grafito").colors.text);
  });

  test("Eliminar borra un tema propio guardado", async () => {
    saveCustomTheme({ ...preset("grafito"), id: "mio", name: "Mío", builtin: false });
    setActiveThemeId("mio");
    render(<ThemeDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(loadThemes().some((t) => t.id === "mio")).toBe(false);
    expect(screen.queryByRole("radio", { name: /Mío/ })).toBeNull();
    expect(activeThemeId()).toBe("grafito");
  });

  test("avisa contraste bajo sin bloquear el guardado", async () => {
    render(<ThemeDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Duplicar como personalizado" }));
    fireEvent.change(screen.getByLabelText("Selector de Texto"), {
      target: { value: preset("grafito").colors.s0 },
    });
    expect(screen.getByText("Contraste bajo")).toBeInTheDocument();
    expect(screen.getAllByText(/Texto sobre Fondo del editor/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });
});

describe("toggleThemeMode", () => {
  test("alterna entre el último tema oscuro y el último claro", () => {
    setActiveThemeId("medianoche");
    expect(toggleThemeMode().id).toBe("papel");
    expect(activeThemeId()).toBe("papel");
    expect(css("s0")).toBe(preset("papel").colors.s0);
    expect(toggleThemeMode().id).toBe("medianoche");
  });

  test("sin historial usa el primer tema del modo contrario", () => {
    expect(toggleThemeMode().id).toBe("papel");
    expect(toggleThemeMode().id).toBe("grafito");
  });
});
