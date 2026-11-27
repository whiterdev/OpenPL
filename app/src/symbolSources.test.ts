import { expect, test, vi } from "vitest";
import { createSymbolSources } from "./symbolSources";
import type { ObjectInfo } from "./types";

const pkg: ObjectInfo = {
  owner: "HR",
  name: "PKG",
  object_type: "Package",
  status: "Valid",
  last_ddl_time: "",
};

function fakeApi() {
  return {
    editorObject: vi.fn().mockResolvedValue(pkg),
    programSource: vi.fn().mockResolvedValue([
      { kind: "PACKAGE", source: "oracle", last_ddl_time: null, diagnostics: [] },
    ]),
    describeColumns: vi.fn().mockResolvedValue([
      { name: "ID", data_type: "NUMBER", nullable: false },
    ]),
  };
}

test("un objeto abierto se lee del editor, no de Oracle", async () => {
  const api = fakeApi();
  const sources = createSymbolSources(api);
  sources.register({ connection: "c", owner: "HR", name: "PKG" }, () => [
    { kind: "PACKAGE", source: "nuevo" },
  ]);
  expect(await sources.lookup("c", null).parts(pkg)).toEqual([
    { kind: "PACKAGE", source: "nuevo" },
  ]);
  expect(api.programSource).not.toHaveBeenCalled();
});

test("la fuente de Oracle se pide una vez por conexión", async () => {
  const api = fakeApi();
  const sources = createSymbolSources(api);
  const lookup = sources.lookup("c", null);
  expect(await lookup.parts(pkg)).toEqual([{ kind: "PACKAGE", source: "oracle" }]);
  await lookup.parts(pkg);
  expect(api.programSource).toHaveBeenCalledTimes(1);
  expect(api.programSource).toHaveBeenCalledWith("c", "Package", "HR", "PKG");
  sources.invalidate("c", "HR", "PKG");
  await lookup.parts(pkg);
  expect(api.programSource).toHaveBeenCalledTimes(2);
  await sources.lookup("otra", null).parts(pkg);
  expect(api.programSource).toHaveBeenCalledTimes(3);
});

test("dar de baja vuelve a la caché", async () => {
  const api = fakeApi();
  const sources = createSymbolSources(api);
  const release = sources.register({ connection: "c", owner: "HR", name: "PKG" }, () => [
    { kind: "PACKAGE", source: "nuevo" },
  ]);
  release();
  expect(await sources.lookup("c", null).parts(pkg)).toEqual([
    { kind: "PACKAGE", source: "oracle" },
  ]);
});

test("un fallo de fuente devuelve lista vacía", async () => {
  const api = fakeApi();
  api.programSource.mockRejectedValueOnce(new Error("ORA-00942"));
  const lookup = createSymbolSources(api).lookup("c", null);
  expect(await lookup.parts(pkg)).toEqual([]);
  expect(await lookup.parts(pkg)).toEqual([{ kind: "PACKAGE", source: "oracle" }]);
});

test("columnas cacheadas por conexión", async () => {
  const api = fakeApi();
  const lookup = createSymbolSources(api).lookup("c", null);
  await lookup.columns("HR", "CLIENTES");
  expect(await lookup.columns("HR", "CLIENTES")).toHaveLength(1);
  expect(api.describeColumns).toHaveBeenCalledTimes(1);
});

test("objetos del catálogo con el esquema de contexto", async () => {
  const api = fakeApi();
  const sources = createSymbolSources(api);
  expect(await sources.lookup("c", "HR").object(null, "PKG")).toEqual(pkg);
  expect(api.editorObject).toHaveBeenCalledWith("c", { owner: null, name: "PKG" }, "HR");
  await sources.lookup("c", "HR").object(null, "PKG");
  expect(api.editorObject).toHaveBeenCalledTimes(1);
  sources.invalidate("c");
  await sources.lookup("c", "HR").object(null, "PKG");
  expect(api.editorObject).toHaveBeenCalledTimes(2);
});
