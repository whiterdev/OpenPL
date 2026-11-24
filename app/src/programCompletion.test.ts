import { EditorState } from "@codemirror/state";
import { sql } from "@codemirror/lang-sql";
import {
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { describe, expect, test, vi } from "vitest";
import { oracleDialect } from "./editorReference";
import type { CompletionObject } from "./types";
import {
  catalogCompletion,
  completionTarget,
  keywordCompletion,
  sqlContext,
  statementAliases,
  statementTables,
  type CompletionCatalog,
} from "./programCompletion";

const at = (source: string) => {
  const position = source.indexOf("|");
  const doc = source.slice(0, position) + source.slice(position + 1);
  return {
    doc,
    position,
    state: EditorState.create({
      doc,
      extensions: [sql({ dialect: oracleDialect })],
    }),
  };
};

function catalog(
  overrides: Partial<CompletionCatalog> = {},
): CompletionCatalog {
  return {
    objects: vi.fn().mockResolvedValue([
      { owner: "HR", name: "VENTAS", object_type: "TABLE" },
      { owner: "HR", name: "Ventas 2026", object_type: "VIEW" },
    ]),
    columns: vi
      .fn()
      .mockResolvedValue([
        { name: "ID", data_type: "NUMBER", nullable: false },
      ]),
    ...overrides,
  };
}

async function complete(
  source: string,
  source_: ReturnType<typeof catalogCompletion>,
  explicit = false,
) {
  const { state, position } = at(source);
  return (await source_(
    new CompletionContext(state, position, explicit),
  )) as CompletionResult | null;
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
    const { doc, position } = at(
      'update "Mi Tabla" t set t.| = 1 where t.id in (select x.id from (select 1 id from dual) x)',
    );
    const aliases = statementAliases(doc, position);
    expect(aliases.get("T")).toEqual({ owner: null, name: "Mi Tabla" });
    expect(aliases.has("X")).toBe(false);
  });
});

describe("statementTables", () => {
  test("lista cada tabla con su alias", () => {
    const { doc, position } = at(
      "select | from hr.ventas v join clientes on 1 = 1, pedidos as p",
    );
    expect(statementTables(doc, position)).toEqual([
      { ref: { owner: "HR", name: "VENTAS" }, alias: "V" },
      { ref: { owner: null, name: "CLIENTES" }, alias: null },
      { ref: { owner: null, name: "PEDIDOS" }, alias: "P" },
    ]);
  });

  test.each([
    "SELECT x| INTO v FROM t",
    "select x| from t for update nowait",
  ])("en %s solo cuenta la tabla real", (source) => {
    const { doc, position } = at(source);
    expect(statementTables(doc, position)).toEqual([
      { ref: { owner: null, name: "T" }, alias: null },
    ]);
  });

  test("INTO tras INSERT es una tabla", () => {
    const { doc, position } = at("insert into hr.ventas (|) values (1)");
    expect(statementTables(doc, position)).toEqual([
      { ref: { owner: "HR", name: "VENTAS" }, alias: null },
    ]);
  });
});

describe("sqlContext", () => {
  test.each([
    ["SELECT * FROM cl|", "source"],
    ["select * from clientes c join ped|", "source"],
    ["select * from clientes c, ped|", "source"],
    ["select * from t where id in (select id from cl|", "source"],
    ["insert into cl|", "source"],
    ["SELECT | FROM clientes", "select"],
    ["select a, b|", "select"],
    ["SELECT x INTO v|", null],
    ["select * from t where cl|", null],
    ["select * from clientes c join pedidos p on c.id = p.id and cl|", null],
    ["select * from (cl|", null],
    ["select count(cl|", null],
    ["select * from t -- from cl|", null],
    ["select 'from cl|' from dual", null],
    ["select * from t;\nbegin cl|", null],
  ])("%s", (source, expected) => {
    const { state, position } = at(source);
    expect(sqlContext(state, position)).toBe(expected);
  });
});

describe("completionTarget", () => {
  test("separa calificador y prefijo", () => {
    const { state, position } = at("select v.cli|");
    expect(completionTarget(state, position)).toEqual({
      from: position - 3,
      prefix: "CLI",
      qualifier: "V",
    });
    const quoted = at('select "Mi Esquema".|');
    expect(completionTarget(quoted.state, quoted.position)).toEqual({
      from: quoted.position,
      prefix: "",
      qualifier: "Mi Esquema",
    });
    const plain = at("select * from ven|");
    expect(completionTarget(plain.state, plain.position)).toEqual({
      from: plain.position - 3,
      prefix: "VEN",
      qualifier: null,
    });
  });

  test.each([
    "select 'ven|' from dual",
    "-- ven|",
    "/* ven| */",
    "select :ven|",
  ])("descarta %s", (source) => {
    const { state, position } = at(source);
    expect(completionTarget(state, position)).toBeNull();
  });
});

describe("catalogCompletion", () => {
  test("sugiere objetos del esquema y cita nombres especiales", async () => {
    const current = catalog();
    const result = await complete(
      "select * from ven|",
      catalogCompletion(() => current),
    );
    expect(current.objects).toHaveBeenCalledWith(null, "VEN", "relations");
    expect(result?.options.map((option) => option.label)).toEqual([
      "VENTAS",
      "Ventas 2026",
    ]);
    expect(result?.options[1].apply).toBe('"Ventas 2026"');
  });

  test("sugiere columnas del alias usando su tabla", async () => {
    const current = catalog();
    const result = await complete(
      "select v.| from hr.ventas v",
      catalogCompletion(() => current),
    );
    expect(current.columns).toHaveBeenCalledWith("HR", "VENTAS");
    expect(current.objects).not.toHaveBeenCalled();
    expect(result?.options).toEqual([
      expect.objectContaining({ label: "ID", detail: "NUMBER" }),
    ]);
  });

  test("con un calificador sin alias busca columnas y objetos del esquema", async () => {
    const current = catalog();
    const result = await complete(
      "select * from hr.ve|",
      catalogCompletion(() => current),
    );
    expect(current.columns).toHaveBeenCalledWith(null, "HR");
    expect(current.objects).toHaveBeenCalledWith("HR", "VE");
    expect(result?.options.map((option) => option.label)).toEqual([
      "ID",
      "VENTAS",
      "Ventas 2026",
    ]);
  });

  test("sin prefijo solo consulta al pedirlo", async () => {
    const current = catalog();
    expect(
      await complete(
        "select * from |",
        catalogCompletion(() => current),
      ),
    ).toBeNull();
    expect(current.objects).not.toHaveBeenCalled();
    await complete(
      "select * from |",
      catalogCompletion(() => current),
      true,
    );
    expect(current.objects).toHaveBeenCalledWith(null, "", "relations");
  });

  test.each(["SELECT * FROM cl|", "select * from clientes c join ped|"])(
    "tras FROM o JOIN solo pide tablas y vistas: %s",
    async (source) => {
      const current = catalog();
      await complete(source, catalogCompletion(() => current));
      expect(current.objects).toHaveBeenCalledWith(
        null,
        expect.any(String),
        "relations",
      );
      expect(current.columns).not.toHaveBeenCalled();
    },
  );

  test("tras FROM no abre con un espacio", async () => {
    const current = catalog();
    expect(
      await complete("SELECT * FROM |", catalogCompletion(() => current)),
    ).toBeNull();
    expect(current.objects).not.toHaveBeenCalled();
  });

  test.each(["SELECT i| FROM clientes", "SELECT i| INTO v FROM clientes"])(
    "con una sola tabla sin alias ofrece sus columnas: %s",
    async (source) => {
      const current = catalog();
      const result = await complete(source, catalogCompletion(() => current));
      expect(current.columns).toHaveBeenCalledWith(null, "CLIENTES");
      expect(result?.options[0]).toEqual(
        expect.objectContaining({ label: "ID", detail: "NUMBER" }),
      );
    },
  );

  test("al pedirlo con el cursor tras SELECT ofrece columnas", async () => {
    const current = catalog();
    const result = await complete(
      "SELECT | FROM clientes",
      catalogCompletion(() => current),
      true,
    );
    expect(current.columns).toHaveBeenCalledWith(null, "CLIENTES");
    expect(result?.options.map((option) => option.label)).toContain("ID");
  });

  test.each(["SELECT i| FROM clientes c", "SELECT i| FROM clientes, pedidos"])(
    "con alias o varias tablas no ofrece columnas: %s",
    async (source) => {
      const current = catalog();
      const result = await complete(source, catalogCompletion(() => current));
      expect(current.columns).not.toHaveBeenCalled();
      expect(result?.options.map((option) => option.label)).not.toContain(
        "ID",
      );
    },
  );

  test.each([
    "select * from t -- from cl|",
    "select 'from cl|' from dual",
  ])("en comentarios y cadenas no consulta: %s", async (source) => {
    const current = catalog();
    expect(await complete(source, catalogCompletion(() => current))).toBeNull();
    expect(current.objects).not.toHaveBeenCalled();
    expect(current.columns).not.toHaveBeenCalled();
  });

  test("tras INTO de un SELECT no sugiere tablas", async () => {
    const current = catalog();
    await complete("SELECT x INTO v| FROM t", catalogCompletion(() => current));
    expect(current.objects).not.toHaveBeenCalledWith(
      null,
      expect.any(String),
      "relations",
    );
  });

  test("descarta resultados si cambió la sesión durante la consulta", async () => {
    let resolve!: (value: CompletionObject[]) => void;
    const first = catalog({
      objects: vi.fn(
        () =>
          new Promise<CompletionObject[]>((done) => {
            resolve = done;
          }),
      ),
    });
    let current: CompletionCatalog | null = first;
    const pending = complete(
      "select * from ven|",
      catalogCompletion(() => current),
    );
    current = catalog();
    resolve([{ owner: "HR", name: "VENTAS", object_type: "TABLE" }]);
    expect(await pending).toBeNull();
  });

  test("sin conexión no consulta el catálogo", async () => {
    expect(
      await complete(
        "select * from ven|",
        catalogCompletion(() => null),
      ),
    ).toBeNull();
  });
});

describe("keywordCompletion", () => {
  test("ofrece palabras clave sin conexión y no tras un punto", async () => {
    const plain = at("sel|");
    const result = (await keywordCompletion(
      new CompletionContext(plain.state, plain.position, false),
    )) as CompletionResult | null;
    expect(result?.options.some((option) => option.label === "SELECT")).toBe(
      true,
    );
    const qualified = at("select v.sel|");
    expect(
      await keywordCompletion(
        new CompletionContext(qualified.state, qualified.position, false),
      ),
    ).toBeNull();
  });

  test("tras FROM o JOIN no tapa las tablas", async () => {
    for (const source of ["select * from cl|", "select * from a join ped|"]) {
      const { state, position } = at(source);
      expect(
        await keywordCompletion(new CompletionContext(state, position, true)),
      ).toBeNull();
    }
  });

  test("en la lista del SELECT sigue ofreciendo palabras clave", async () => {
    const { state, position } = at("SELECT i| FROM clientes");
    expect(
      await keywordCompletion(new CompletionContext(state, position, false)),
    ).not.toBeNull();
  });
});
