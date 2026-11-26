import { EditorState } from "@codemirror/state";
import { sql } from "@codemirror/lang-sql";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { oracleDialect } from "./editorReference";
import { tokenize } from "./programStructure";
import type { CompletionObject } from "./types";
import {
  catalogCompletion,
  completionTarget,
  keywordCompletion,
  sqlContext,
  statementAliases,
  statementTables,
  STATEMENT_SPAN_LINES,
  type CompletionCatalog,
} from "./programCompletion";

vi.mock("./programStructure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./programStructure")>();
  return { ...actual, tokenize: vi.fn(actual.tokenize) };
});

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

  test("al final de la ventana SQL, sin ';', sugiere columnas del alias", async () => {
    const current = catalog();
    const result = await complete(
      "SELECT * FROM FIN_DOCUMENTO T WHERE T.|",
      catalogCompletion(() => current),
      true,
    );
    expect(current.columns).toHaveBeenCalledWith(null, "FIN_DOCUMENTO");
    expect(current.objects).not.toHaveBeenCalled();
    expect(result?.options.map((option) => option.label)).toEqual(["ID"]);
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

describe("en un paquete grande", () => {
  const preface = "  v_total := pkg_ventas.total(1); -- línea\n".repeat(20_000);
  const longest = () =>
    Math.max(0, ...vi.mocked(tokenize).mock.calls.map(([text]) => text.length));
  // Como en el editor, donde el árbol de sintaxis ya cubre el cursor.
  const parsed = (source: string) => {
    const { state, position } = at(source);
    ensureSyntaxTree(state, state.doc.length, 60_000);
    const ready = state.update({}).state;
    expect(syntaxTree(ready).length).toBe(ready.doc.length);
    return { state: ready, position };
  };
  async function run(state: EditorState, position: number) {
    const current = catalog();
    const result = (await catalogCompletion(() => current)(
      new CompletionContext(state, position, false),
    )) as CompletionResult | null;
    return { result, current };
  }
  // El árbol de `at` no pasa del inicio, así que da el cálculo sobre todo el documento.
  async function compare(source: string) {
    const fast = parsed(source);
    vi.mocked(tokenize).mockClear();
    const windowed = await run(fast.state, fast.position);
    const tokenized = longest();
    const slow = at(source);
    const full = await run(slow.state, slow.position);
    expect(windowed.result).toEqual(full.result);
    expect(vi.mocked(windowed.current.columns).mock.calls).toEqual(
      vi.mocked(full.current.columns).mock.calls,
    );
    expect(vi.mocked(windowed.current.objects).mock.calls).toEqual(
      vi.mocked(full.current.objects).mock.calls,
    );
    return { windowed, tokenized };
  }

  beforeEach(() => {
    vi.mocked(tokenize).mockClear();
  });

  test("resuelve el alias de la sentencia actual tokenizando solo su tramo", async () => {
    const { windowed, tokenized } = await compare(
      `${preface}select v.| from hr.ventas v where v.id = 1;\n${preface}`,
    );
    expect(windowed.current.columns).toHaveBeenCalledWith("HR", "VENTAS");
    expect(tokenized).toBeGreaterThan(0);
    expect(tokenized).toBeLessThan(2_000);
  });

  test("un ';' dentro de un comentario previo no corta la sentencia", async () => {
    const { windowed, tokenized } = await compare(
      `${preface}/* ; select * from otra o */ select o.| from hr.ventas v;\n${preface}`,
    );
    expect(windowed.current.columns).toHaveBeenCalledWith(null, "O");
    expect(tokenized).toBeLessThan(2_000);
  });

  test("con una sola tabla ofrece sus columnas tokenizando solo su tramo", async () => {
    const { windowed, tokenized } = await compare(
      `${preface}SELECT i| FROM clientes;\n${preface}`,
    );
    expect(windowed.current.columns).toHaveBeenCalledWith(null, "CLIENTES");
    expect(tokenized).toBeLessThan(2_000);
  });

  test("el contexto tras JOIN se decide tokenizando solo el tramo", () => {
    const { state, position } = parsed(
      `${preface}select * from clientes c join ped|\n${preface}`,
    );
    vi.mocked(tokenize).mockClear();
    expect(sqlContext(state, position)).toBe("source");
    expect(longest()).toBeLessThan(2_000);
  });

  test("dentro de un comentario de bloque que empezó antes del tramo no consulta", async () => {
    const body = "select * from t;\n".repeat(2 * STATEMENT_SPAN_LINES);
    const { state, position } = parsed(
      `${preface}/* desactivado\n${body}select * from ven|\n*/\n`,
    );
    vi.mocked(tokenize).mockClear();
    const { result, current } = await run(state, position);
    expect(result).toBeNull();
    expect(current.objects).not.toHaveBeenCalled();
    expect(sqlContext(state, position)).toBeNull();
    expect(longest()).toBe(0);
  });

  test("dentro de una cadena no consulta", async () => {
    const { state, position } = parsed(
      `${preface}select 'from ven|' from dual;\n${preface}`,
    );
    vi.mocked(tokenize).mockClear();
    const { result, current } = await run(state, position);
    expect(result).toBeNull();
    expect(current.objects).not.toHaveBeenCalled();
    expect(longest()).toBe(0);
  });

  test("si la sentencia supera el tope cae al cálculo completo", async () => {
    const columns = "  , v.id\n".repeat(STATEMENT_SPAN_LINES + 10);
    const source = `${preface}select v.|\n${columns}from hr.ventas v;\n`;
    const { windowed, tokenized } = await compare(source);
    expect(windowed.current.columns).toHaveBeenCalledWith("HR", "VENTAS");
    expect(tokenized).toBe(source.length - 1);
  });
});
