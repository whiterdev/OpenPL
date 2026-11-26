import { expect, test } from "vitest";
import { needsConfirm, statementRisk } from "./sqlRisk";
import { splitScript } from "./sqlScript";

test.each([
  "SELECT 1 FROM dual",
  "/* comentario */ -- otra línea\nselect * from t",
  "select 'FOR UPDATE', q'[FOR UPDATE]', \"FOR UPDATE\" from dual",
  "select * from t where id = 1 /* for update */",
  "with c as (select 1 from dual) select * from c",
  "EXPLAIN PLAN FOR SELECT 1 FROM dual",
])("%s se clasifica como lectura", (sql) => {
  expect(statementRisk(sql, "sql")).toBe("read");
});

test.each([
  "SELECT * FROM t FOR UPDATE",
  "WITH c AS (SELECT * FROM t) SELECT * FROM c FOR /* comentario */ UPDATE",
  "insert into t values (1)", "update t set x = 1", "delete from t",
  "merge into t using s on (t.id = s.id)", "create table t (x number)",
  "alter table t add (y number)", "drop table t", "truncate table t",
  "rename t to u", "comment on table t is 'demo'", "grant select on t to hr",
  "revoke select on t from hr", "commit", "rollback",
  "begin null; end;", "declare x number; begin null; end;",
  "exec demo(1)", "savepoint s", "lock table t in exclusive mode",
  "analyze table t compute statistics", "call demo(1)", "set transaction read write",
])("%s se clasifica como escritura", (sql) => {
  expect(statementRisk(sql, "sql")).toBe("write");
});

test("cuenta las escrituras de un script", () => {
  expect(needsConfirm(splitScript("SELECT 1 FROM dual;\nEXEC p(1)\nCOMMIT;"))).toBe("2 de escritura");
  expect(needsConfirm(splitScript("SELECT 1 FROM dual;"))).toBeNull();
});
