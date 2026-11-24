import { describe, expect, test, vi } from "vitest";
import { objectMenuItems, type ObjectMenuHandlers } from "./objectMenu";
import type { ContextItem } from "./components/ContextMenu";
import type { ObjectType } from "./types";

function handlers(extra: Partial<ObjectMenuHandlers> = {}): ObjectMenuHandlers {
  return {
    open: vi.fn(),
    view: vi.fn(),
    edit: vi.fn(),
    recompile: vi.fn(),
    copyDdl: vi.fn(),
    copyName: vi.fn(),
    copyFullName: vi.fn(),
    refresh: vi.fn(),
    queryData: vi.fn(),
    editData: vi.fn(),
    ...extra,
  };
}

const items = (t: ObjectType, h = handlers()) =>
  objectMenuItems(t, h).filter((x): x is ContextItem => x !== "sep");
const labels = (t: ObjectType) => items(t).map((x) => x.label);
const item = (t: ObjectType, label: string, h = handlers()) => items(t, h).find((x) => x.label === label);

function expectPending(x: ContextItem | undefined) {
  expect(x?.pending).toBe(true);
  expect(x?.run).toBeUndefined();
}

describe("objectMenuItems", () => {
  test("conecta las acciones del inspector", () => {
    const inspect = vi.fn();
    const h = handlers({ inspect });
    for (const label of ["Describir", "Propiedades", "Comparar con…"]) item("Table", label, h)?.run?.();
    expect(inspect.mock.calls).toEqual([["describe"], ["properties"], ["compare"]]);
  });
  test.each<ObjectType>(["Table", "View", "MaterializedView", "User", "Package", "RecycleBin"])(
    "%s no repite rótulos",
    (t) => {
      const all = labels(t);
      expect(new Set(all).size).toBe(all.length);
    },
  );

  test("tabla: consultar, editar y exportar datos", () => {
    const h = handlers();
    const all = items("Table", h);
    const query = all.find((x) => x.label === "Consultar datos");
    const edit = all.find((x) => x.label === "Editar datos");
    query?.run?.();
    edit?.run?.();
    expect(h.queryData).toHaveBeenCalled();
    expect(h.editData).toHaveBeenCalled();
    expect(edit?.keys).toBe("Ctrl+E");
    expect(all.find((x) => x.label === "Exportar datos")).toBeDefined();
    expect(labels("Table")).toContain("Copiar DDL");
    expect(labels("Table")).not.toContain("Recompilar");
  });

  test("tabla sin manejadores de datos: consultar y editar quedan pendientes", () => {
    const h = handlers({ queryData: undefined, editData: undefined });
    expectPending(item("Table", "Consultar datos", h));
    expectPending(item("Table", "Editar datos", h));
  });

  test.each<ObjectType>(["View", "MaterializedView"])("%s: consulta datos y Editar datos deshabilitado", (t) => {
    const h = handlers();
    item(t, "Consultar datos", h)?.run?.();
    expect(h.queryData).toHaveBeenCalled();
    const edit = item(t, "Editar datos", h);
    expect(edit).toBeDefined();
    expect(edit?.run).toBeUndefined();
    expect(edit?.pending).toBeFalsy();
    expect(labels(t)).toContain("Exportar datos");
    expect(labels(t)).toContain("Recompilar");
  });

  test("usuario: editar usuario y consultar privilegios", () => {
    const draft = vi.fn();
    const h = handlers({ draft });
    item("User", "Editar usuario", h)?.run?.();
    item("User", "Privilegios", h)?.run?.();
    expect(draft.mock.calls).toEqual([["account"], ["privileges"]]);
    item("User", "Copiar DDL", h)?.run?.();
    expect(h.copyDdl).toHaveBeenCalled();
    expect(labels("User")).not.toContain("Consultar datos");
    expect(labels("User")).not.toContain("Recompilar");
  });

  test("paquete: Spec y Body, Recompilar y sin datos", () => {
    const h = handlers();
    item("Package", "Editar Spec y Body", h)?.run?.();
    expect(h.edit).toHaveBeenCalled();
    item("Package", "Recompilar", h)?.run?.();
    expect(h.recompile).toHaveBeenCalled();
    expect(labels("Package")).not.toContain("Consultar datos");
    expect(labels("Package")).not.toContain("Editar datos");
  });

  test("un tipo sin reglas solo tiene las opciones comunes", () => {
    expect(labels("RecycleBin")).toEqual([
      "Abrir",
      "Describir",
      "Propiedades",
      "Copiar nombre",
      "Copiar nombre con esquema",
      "Refrescar",
    ]);
  });
});
