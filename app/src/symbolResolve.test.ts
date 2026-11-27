import { expect, test, vi } from "vitest";
import { resolveSymbol, type ResolveContext } from "./symbolResolve";
import type { SourcePart, SymbolLookup } from "./symbolSources";
import type { ObjectColumn, ObjectInfo, ObjectType } from "./types";

const info = (name: string, object_type: ObjectType, owner = "HR"): ObjectInfo => ({
  owner, name, object_type, status: "Valid", last_ddl_time: "",
});

const clientes: ObjectColumn[] = [
  { name: "ID", data_type: "NUMBER", nullable: false },
  { name: "NOMBRE", data_type: "VARCHAR2(100)", nullable: true },
];

function fakeLookup(
  objects: Record<string, ObjectInfo> = {},
  sources: Record<string, SourcePart[]> = {},
): SymbolLookup & { object: ReturnType<typeof vi.fn> } {
  return {
    object: vi.fn(async (owner: string | null, name: string) =>
      objects[owner ? `${owner}.${name}` : name] ?? null),
    parts: vi.fn(async (object: ObjectInfo) => sources[object.name] ?? []),
    columns: vi.fn(async (_owner: string, name: string) => (name === "CLIENTES" ? clientes : [])),
  };
}

/** Contexto con el cursor sobre la aparición número `nth` de `word` en la parte `current`. */
function at(
  texts: string[],
  word: string,
  options: { current?: number; nth?: number; lookup?: SymbolLookup | null; kinds?: string[] } = {},
): ResolveContext {
  const current = options.current ?? texts.length - 1;
  let position = -1;
  for (let n = 0; n <= (options.nth ?? 0); n += 1) position = texts[current].indexOf(word, position + 1);
  const kinds = options.kinds ?? (texts.length === 2 ? ["PACKAGE", "PACKAGE BODY"] : ["SQL"]);
  return {
    parts: texts.map((source, index) => ({ kind: kinds[index], source })),
    current,
    position: position + 1,
    self: null,
    lookup: options.lookup === undefined ? fakeLookup() : options.lookup,
  };
}

const path = (parts: string[], index = parts.length - 1) => ({ parts, index, from: 0, to: 0 });

test("local tapa a global dentro de su bloque", async () => {
  const body =
    "PACKAGE BODY pkg IS\n  v NUMBER;\n  PROCEDURE p IS v VARCHAR2(1); BEGIN v := 'x'; END;\n  PROCEDURE q IS BEGIN v := 1; END;\nEND;";
  const inside = await resolveSymbol(at(["PACKAGE pkg IS END;", body], "v :=", {}), path(["V"]));
  expect(inside).toHaveLength(1);
  expect(inside[0]).toMatchObject({ kind: "symbol", symbol: { dataType: "VARCHAR2(1)" } });
  const outside = await resolveSymbol(at(["PACKAGE pkg IS END;", body], "v :=", { nth: 1 }), path(["V"]));
  expect(outside).toHaveLength(1);
  expect(outside[0]).toMatchObject({ kind: "symbol", symbol: { dataType: "NUMBER" } });
});

test("llamada a rutina del mismo paquete devuelve spec y body", async () => {
  const spec = "PACKAGE pkg IS\n  FUNCTION calcular RETURN NUMBER;\nEND;";
  const body =
    "PACKAGE BODY pkg IS\n  FUNCTION calcular RETURN NUMBER IS BEGIN RETURN 1; END;\n  PROCEDURE p IS x NUMBER; BEGIN x := calcular; END;\nEND;";
  const found = await resolveSymbol(at([spec, body], "calcular;"), path(["CALCULAR"]));
  expect(found.map((item) => item.kind === "symbol" && item.location)).toEqual([
    { where: "here", part: 0, from: spec.indexOf("calcular"), line: 2 },
    { where: "here", part: 1, from: body.indexOf("calcular"), line: 2 },
  ]);
});

test("miembro de otro paquete", async () => {
  const lookup = fakeLookup(
    { PKG_VENTAS: info("PKG_VENTAS", "Package") },
    { PKG_VENTAS: [{ kind: "PACKAGE", source: "PACKAGE pkg_ventas IS\n  c_max CONSTANT NUMBER := 3;\nEND;" }] },
  );
  const found = await resolveSymbol(
    at(["BEGIN x := pkg_ventas.c_max; END;"], "c_max", { lookup }),
    path(["PKG_VENTAS", "C_MAX"]),
  );
  expect(lookup.object).toHaveBeenCalledWith(null, "PKG_VENTAS");
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({
    kind: "symbol",
    symbol: { name: "C_MAX", value: "3" },
    location: { where: "object", partKind: "PACKAGE", line: 2, object: { name: "PKG_VENTAS" } },
  });
});

test("campo de %ROWTYPE de tabla", async () => {
  const lookup = fakeLookup({ CLIENTES: info("CLIENTES", "Table") });
  const found = await resolveSymbol(
    at(["DECLARE v_cli clientes%ROWTYPE; BEGIN x := v_cli.nombre; END;"], "nombre", { lookup }),
    path(["V_CLI", "NOMBRE"]),
  );
  expect(found).toEqual([
    { kind: "column", table: "CLIENTES", column: { name: "NOMBRE", data_type: "VARCHAR2(100)", nullable: true } },
  ]);
});

test("campo de registro propio", async () => {
  const source =
    "DECLARE TYPE t_rec IS RECORD (id NUMBER, nombre VARCHAR2(5)); v_r t_rec; BEGIN x := v_r.id; END;";
  const found = await resolveSymbol(at([source], "id;"), path(["V_R", "ID"]));
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ kind: "symbol", symbol: { kind: "field", name: "ID", container: "T_REC" } });
});

test("campo tras índice de colección", async () => {
  const source =
    "DECLARE TYPE t_rec IS RECORD (id NUMBER); TYPE t_tab IS TABLE OF t_rec INDEX BY PLS_INTEGER; v t_tab; BEGIN x := v(1).id; END;";
  const found = await resolveSymbol(at([source], "id;"), path(["V", "ID"]));
  expect(found[0]).toMatchObject({ kind: "symbol", symbol: { kind: "field", name: "ID" } });
});

test("columna de cursor en FOR", async () => {
  const lookup = fakeLookup({ CLIENTES: info("CLIENTES", "Table") });
  const source =
    "DECLARE CURSOR c_cli IS SELECT id, nombre n, id * 2 doble FROM clientes; BEGIN FOR r IN c_cli LOOP x := r.n; y := r.doble; END LOOP; END;";
  const named = await resolveSymbol(at([source], "n;", { lookup }), path(["R", "N"]));
  expect(named).toEqual([
    { kind: "column", table: "CLIENTES", column: { name: "NOMBRE", data_type: "VARCHAR2(100)", nullable: true } },
  ]);
  const expression = await resolveSymbol(at([source], "doble;", { lookup }), path(["R", "DOBLE"]));
  expect(expression).toEqual([
    { kind: "column", table: "C_CLI", column: { name: "DOBLE", data_type: "Expresión", nullable: true } },
  ]);
});

test("alias en SELECT", async () => {
  const lookup = fakeLookup({ CLIENTES: info("CLIENTES", "Table") });
  const found = await resolveSymbol(
    at(["SELECT c.nombre FROM clientes c"], "nombre", { lookup }),
    path(["C", "NOMBRE"]),
  );
  expect(found).toEqual([
    { kind: "column", table: "CLIENTES", column: { name: "NOMBRE", data_type: "VARCHAR2(100)", nullable: true } },
  ]);
});

test("tabla devuelve sus columnas", async () => {
  const lookup = fakeLookup({ CLIENTES: info("CLIENTES", "Table") });
  const found = await resolveSymbol(at(["SELECT * FROM clientes"], "clientes", { lookup }), path(["CLIENTES"]));
  expect(found).toEqual([{ kind: "relation", object: info("CLIENTES", "Table"), columns: clientes }]);
});

test("mayúsculas y comillas", async () => {
  const lookup = fakeLookup();
  await resolveSymbol(at(["BEGIN PKG_Ventas.CALCULAR; END;"], "CALCULAR", { lookup }), path(["PKG_VENTAS", "CALCULAR"]));
  await resolveSymbol(at(['BEGIN "MiPaquete".calcular; END;'], "calcular", { lookup }), path(["MiPaquete", "CALCULAR"]));
  expect(lookup.object).toHaveBeenCalledWith(null, "PKG_VENTAS");
  expect(lookup.object).toHaveBeenCalledWith(null, "MiPaquete");
});

test("esquema, paquete y rutina", async () => {
  const lookup = fakeLookup(
    { "HR.PKG_VENTAS": info("PKG_VENTAS", "Package") },
    { PKG_VENTAS: [{ kind: "PACKAGE", source: "PACKAGE pkg_ventas IS\n  PROCEDURE calcular;\nEND;" }] },
  );
  const found = await resolveSymbol(
    at(["BEGIN hr.pkg_ventas.calcular; END;"], "calcular", { lookup }),
    path(["HR", "PKG_VENTAS", "CALCULAR"]),
  );
  expect(found[0]).toMatchObject({ kind: "symbol", symbol: { name: "CALCULAR" }, location: { where: "object" } });
});

test("sin conexión o con error solo lo local", async () => {
  const offline = await resolveSymbol(at(["BEGIN pkg.f; END;"], "f;", { lookup: null }), path(["PKG", "F"]));
  expect(offline).toEqual([]);
  const failing = fakeLookup();
  failing.object.mockRejectedValue(new Error("ORA-03113"));
  const broken = await resolveSymbol(at(["BEGIN pkg.f; END;"], "f;", { lookup: failing }), path(["PKG", "F"]));
  expect(broken).toEqual([]);
});

test("fuente envuelta", async () => {
  const lookup = fakeLookup({ PKG_W: info("PKG_W", "Package") });
  const found = await resolveSymbol(at(["BEGIN pkg_w.f; END;"], "pkg_w", { lookup }), path(["PKG_W", "F"], 0));
  expect(found).toEqual([{ kind: "object", object: info("PKG_W", "Package"), note: "Fuente no disponible" }]);
});
