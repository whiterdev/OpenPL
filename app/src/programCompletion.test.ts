import { EditorState } from "@codemirror/state";
import { sql } from "@codemirror/lang-sql";
import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { describe, expect, test, vi } from "vitest";
import { oracleDialect } from "./editorReference";
import type { CompletionObject } from "./types";
import {
  catalogCompletion, completionTarget, keywordCompletion, statementAliases, type CompletionCatalog,
} from "./programCompletion";

const at = (source: string) => {
  const position = source.indexOf("|");
  const doc = source.slice(0, position) + source.slice(position + 1);
  return { doc, position, state: EditorState.create({ doc, extensions: [sql({ dialect: oracleDialect })] }) };
};

function catalog(overrides: Partial<CompletionCatalog> = {}): CompletionCatalog {
  return {
    objects: vi.fn().mockResolvedValue([
      { owner: "HR", name: "VENTAS", object_type: "TABLE" },
      { owner: "HR", name: "Ventas 2026", object_type: "VIEW" },
    ]),
    columns: vi.fn().mockResolvedValue([{ name: "ID", data_type: "NUMBER", nullable: false }]),
    ...overrides,
  };
}

async function complete(source: string, source_: ReturnType<typeof catalogCompletion>, explicit = false) {
  const { state, position } = at(source);
  return await source_(new CompletionContext(state, position, explicit)) as CompletionResult | null;
}

describe("statementAliases", () => {
  test("reconoce tablas y alias de la sentencia actual", () => {
    const { doc, position } = at(
      "select * from otra o;\nselect v.| from hr.ventas v join clientes c on c.id = v.cliente, pedidos as p where 1 = 1;",
    );
    const aliases = statementAliases(doc, position);
    expect(aliases.get("V")).toEqual({ owner: "HR", name: "VENTAS" });
    expect(aliases.get("C")).toEqual({ owner: null, name: "CLIENTES" });
    expect(aliases.get("P")).toEqual({ owner: null, name: "PEDIDOS" });
    expect(aliases.get("VENTAS")).toEqual({ owner: "HR", name: "VENTAS" });
    expect(aliases.has("O")).toBe(false);
    expect(aliases.has("WHERE")).toBe(false);
  });

  test("conserva nombres entre comillas y omite subconsultas", () => {
    const { doc, position } = at('update "Mi Tabla" t set t.| = 1 where t.id in (select x.id from (select 1 id from dual) x)');
    const aliases = statementAliases(doc, position);
    expect(aliases.get("T")).toEqual({ owner: null, name: "Mi Tabla" });
    expect(aliases.has("X")).toBe(false);
  });
});

describe("completionTarget", () => {
  test("separa calificador y prefijo", () => {
    const { state, position } = at("select v.cli|");
    expect(completionTarget(state, position)).toEqual({ from: position - 3, prefix: "CLI", qualifier: "V" });
    const quoted = at('select "Mi Esquema".|');
    expect(completionTarget(quoted.state, quoted.position)).toEqual({ from: quoted.position, prefix: "", qualifier: "Mi Esquema" });
    const plain = at("select * from ven|");
    expect(completionTarget(plain.state, plain.position)).toEqual({ from: plain.position - 3, prefix: "VEN", qualifier: null });
  });

  test.each(["select 'ven|' from dual", "-- ven|", "/* ven| */", "select :ven|"])("descarta %s", (source) => {
    const { state, position } = at(source);
    expect(completionTarget(state, position)).toBeNull();
  });
});

describe("catalogCompletion", () => {
  test("sugiere objetos del esquema y cita nombres especiales", async () => {
    const current = catalog();
    const result = await complete("select * from ven|", catalogCompletion(() => current));
    expect(current.objects).toHaveBeenCalledWith(null, "VEN");
    expect(result?.options.map((option) => option.label)).toEqual(["VENTAS", "Ventas 2026"]);
    expect(result?.options[1].apply).toBe('"Ventas 2026"');
  });

  test("sugiere columnas del alias usando su tabla", async () => {
    const current = catalog();
    const result = await complete("select v.| from hr.ventas v", catalogCompletion(() => current));
    expect(current.columns).toHaveBeenCalledWith("HR", "VENTAS");
    expect(current.objects).not.toHaveBeenCalled();
    expect(result?.options).toEqual([expect.objectContaining({ label: "ID", detail: "NUMBER" })]);
  });

  test("con un calificador sin alias busca columnas y objetos del esquema", async () => {
    const current = catalog();
    const result = await complete("select * from hr.ve|", catalogCompletion(() => current));
    expect(current.columns).toHaveBeenCalledWith(null, "HR");
    expect(current.objects).toHaveBeenCalledWith("HR", "VE");
    expect(result?.options.map((option) => option.label)).toEqual(["ID", "VENTAS", "Ventas 2026"]);
  });

  test("sin prefijo solo consulta al pedirlo", async () => {
    const current = catalog();
    expect(await complete("select * from |", catalogCompletion(() => current))).toBeNull();
    expect(current.objects).not.toHaveBeenCalled();
    await complete("select * from |", catalogCompletion(() => current), true);
    expect(current.objects).toHaveBeenCalledWith(null, "");
  });

  test("descarta resultados si cambió la sesión durante la consulta", async () => {
    let resolve!: (value: CompletionObject[]) => void;
    const first = catalog({ objects: vi.fn(() => new Promise<CompletionObject[]>((done) => { resolve = done; })) });
    let current: CompletionCatalog | null = first;
    const pending = complete("select * from ven|", catalogCompletion(() => current));
    current = catalog();
    resolve([{ owner: "HR", name: "VENTAS", object_type: "TABLE" }]);
    expect(await pending).toBeNull();
  });

  test("sin conexión no consulta el catálogo", async () => {
    expect(await complete("select * from ven|", catalogCompletion(() => null))).toBeNull();
  });
});

describe("keywordCompletion", () => {
  test("ofrece palabras clave sin conexión y no tras un punto", async () => {
    const plain = at("sel|");
    const result = await keywordCompletion(new CompletionContext(plain.state, plain.position, false)) as CompletionResult | null;
    expect(result?.options.some((option) => option.label === "SELECT")).toBe(true);
    const qualified = at("select v.sel|");
    expect(await keywordCompletion(new CompletionContext(qualified.state, qualified.position, false))).toBeNull();
  });
});
