import { describe, expect, test } from "vitest";
import { editableQuery, ROWID_COLUMN } from "./sqlEdit";

describe("editableQuery", () => {
  test("agrega el ROWID oculto en una consulta de una tabla", () => {
    expect(
      editableQuery("select * from clientes where ciudad = :c order by id"),
    ).toEqual({
      table: { owner: null, name: "CLIENTES" },
      sql: `select clientes.ROWID AS "${ROWID_COLUMN}", clientes.* from clientes where ciudad = :c order by id`,
    });
  });

  test("usa el alias y conserva esquema, comillas y FOR UPDATE", () => {
    expect(
      editableQuery(
        'SELECT c.id, c.nombre FROM hr."Clientes 2026" c FOR UPDATE',
      ),
    ).toEqual({
      table: { owner: "HR", name: "Clientes 2026" },
      sql: `SELECT c.ROWID AS "${ROWID_COLUMN}", c.id, c.nombre FROM hr."Clientes 2026" c FOR UPDATE`,
    });
    expect(editableQuery("select t.* from ventas t")?.sql).toBe(
      `select t.ROWID AS "${ROWID_COLUMN}", t.* from ventas t`,
    );
  });

  test.each([
    "select * from a, b",
    "select * from a join b on a.id = b.id",
    "select distinct ciudad from clientes",
    "select ciudad, count(*) from clientes group by ciudad",
    "select * from a union select * from b",
    "select * from (select * from clientes)",
    "select * from clientes@remota",
    "with x as (select 1 from dual) select * from x",
    "update clientes set a = 1",
    "select * from dual connect by level < 3",
  ])("no edita %s", (sql) => {
    expect(editableQuery(sql)).toBeNull();
  });
});
