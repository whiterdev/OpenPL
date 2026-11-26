import { expect, test } from "vitest";
import { captureWorkspace, validateWorkspace } from "./workspace";

test("captura el borrador actual y excluye otras conexiones y consolas", () => {
  const connection = { profileId: "p1" };
  const workspace = captureWorkspace([
    { id: "1", label: "SQL 1", connection, sql: { initial: "viejo" } },
    { id: "2", label: "Comando", connection, sql: { initial: "", command: true } },
    { id: "3", label: "Otro", connection: { profileId: "p2" }, sql: { initial: "otro" } },
    { id: "4", label: "demo.pks", workspaceProfileId: "p1", fileName: "demo.pks", parts: [{ source: "package demo as end;" }] },
  ], "p1", new Map([["1", "SELECT 1 FROM DUAL"]]));
  expect(workspace).toEqual({ version: 1, tabs: [
    { type: "sql", title: "SQL 1", text: "SELECT 1 FROM DUAL", kind: "sql" },
    { type: "file", name: "demo.pks", text: "package demo as end;" },
  ] });
  expect(validateWorkspace(JSON.stringify(workspace))).toEqual(workspace);
});

test("rechaza versiones, tipos inválidos y texto mayor a 2 MiB", () => {
  expect(validateWorkspace({ version: 2, tabs: [] })).toBeNull();
  expect(validateWorkspace({ version: 1, tabs: [{ type: "sql", kind: "command", title: "SQL", text: "" }] })).toBeNull();
  expect(validateWorkspace({ version: 1, tabs: [{ type: "file", name: "demo.sql", text: "á".repeat(1024 * 1024 + 1) }] })).toBeNull();
});
