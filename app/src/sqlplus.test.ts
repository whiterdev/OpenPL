import { expect, test } from "vitest";
import { parseSqlplus } from "./sqlplus";
import { splitScript } from "./sqlScript";

test.each(["EXEC foo(1)", "execute foo(1);"])("traduce %s a PL/SQL", (input) => {
  expect(parseSqlplus(input)).toEqual({ kind: "exec", block: "BEGIN foo(1); END;" });
});

test("traduce la asignación de un bind y conserva la posición original", () => {
  const text = "EXEC :x := 1";
  expect(splitScript(text)).toEqual([
    { kind: "plsql", text: "BEGIN :x := 1; END;", from: 0, to: text.length },
  ]);
});

test.each([
  ["set serveroutput on", { kind: "set", option: "serveroutput", value: "on" }],
  ["show errors", { kind: "show", what: "errors" }],
  ["define dept = 10", { kind: "define", variable: "dept", value: "10" }],
  ["undefine dept", { kind: "undefine", variable: "dept" }],
  ["VAR x number", { kind: "variable", variable: "x", type: "number" }],
  ["PRINT", { kind: "print" }],
  ["spool off", { kind: "spool", target: "off" }],
  ['@@ "scripts/demo.sql"', { kind: "start", path: "scripts/demo.sql", nested: true }],
  ["start demo.sql", { kind: "start", path: "demo.sql", nested: false }],
  ["describe hr.t", { kind: "desc", target: "hr.t" }],
  ["connect demo", { kind: "unsupported", text: "connect demo" }],
])("reconoce %s", (input, expected) => {
  expect(parseSqlplus(input)).toEqual(expected);
  expect(splitScript(input)[0]).toMatchObject({ kind: "sqlplus", command: expected });
});

test("deja el SQL ordinario al divisor de scripts", () => {
  expect(parseSqlplus("select 1 from dual")).toBeNull();
});
