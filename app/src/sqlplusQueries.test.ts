import { expect, test, vi } from "vitest";
import { createdObject, describeObject, showErrorsQuery, showUserQuery } from "./sqlplusQueries";
import { createSqlplusState } from "./sqlplusState";
import type { ExecOutcome } from "./types";

test("detecta código creado con esquema, comillas y tipo", () => {
  expect(createdObject('/* inicio */ CREATE OR REPLACE EDITIONABLE PACKAGE BODY hr."Ventas 2026" AS END;')).toEqual({
    owner: "HR", name: "Ventas 2026", type: "PACKAGE BODY",
  });
  expect(createdObject("create table t (n number)")).toBeNull();
});

test("SHOW lee el usuario y enlaza los filtros de diagnósticos", () => {
  const object = createdObject("CREATE FUNCTION f RETURN NUMBER AS BEGIN RETURN 1; END;")!;
  const errors = showErrorsQuery(object);
  expect(errors.sql).toMatch(/^SELECT .+ FROM ALL_ERRORS/s);
  expect(errors.sql).toContain("ORDER BY sequence");
  expect(errors.binds).toContainEqual({ name: "name", value: "F", kind: "Text" });
  expect(showUserQuery.sql).toMatch(/^SELECT .*SYS_CONTEXT.*FROM DUAL/);
});

const rows = (values: string[][]): ExecOutcome => ({
  result: { kind: "Query", cursor: 1, columns: [], page: { rows: values, more: false } },
  elapsed_ms: 0, output: [], transaction: false,
});

test.each([["TABLE", "ALL_TAB_COLUMNS"], ["VIEW", "ALL_TAB_COLUMNS"], ["PACKAGE", "ALL_ARGUMENTS"], ["PROCEDURE", "ALL_ARGUMENTS"]])(
  "DESC de %s resuelve el objeto y consulta %s con binds",
  async (type, view) => {
    const query = vi.fn().mockResolvedValueOnce(rows([["HR", "T", type]])).mockResolvedValueOnce(rows([]));
    await describeObject("hr.t", createSqlplusState(), { query, print: vi.fn(), ask: vi.fn() });
    expect(query).toHaveBeenCalledTimes(2);
    for (const [sql, binds] of query.mock.calls) {
      expect(sql).toMatch(/^SELECT /);
      expect(sql).not.toContain("hr.t");
      expect(binds).toContainEqual({ name: "name", value: "T", kind: "Text" });
    }
    expect(query.mock.calls[1][0]).toContain(view);
  },
);
