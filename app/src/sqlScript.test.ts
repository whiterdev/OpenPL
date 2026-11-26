import { describe, expect, test } from "vitest";
import { splitScript, statementAt } from "./sqlScript";

const texts = (source: string) =>
  splitScript(source).map((s) => [s.kind, s.text]);

describe("splitScript", () => {
  test("separa por punto y coma y quita el terminador", () => {
    expect(texts("select 1 from dual;\nselect 2 from dual;")).toEqual([
      ["sql", "select 1 from dual"],
      ["sql", "select 2 from dual"],
    ]);
  });

  test("la última sentencia no necesita terminador", () => {
    expect(texts("select 1 from dual;\n\n  select 2\n  from dual\n")).toEqual([
      ["sql", "select 1 from dual"],
      ["sql", "select 2\n  from dual"],
    ]);
  });

  test("ignora ; en literales, comentarios e identificadores", () => {
    const source =
      "select 'a;b', q'[c;d]', \"x;y\" from dual -- ; nada\n/* ; */ where 1 = 1;";
    expect(splitScript(source)).toHaveLength(1);
  });

  test("acepta / en una línea propia después de un bloque PL/SQL", () => {
    const source = [
      "declare",
      "  x number;",
      "begin",
      "  x := 1;",
      "end;",
      "/",
      "create or replace procedure p is",
      "begin null; end;",
      "  /  ",
      "select 1 from dual;",
    ].join("\n");
    expect(texts(source)).toEqual([
      ["plsql", "declare\n  x number;\nbegin\n  x := 1;\nend;"],
      ["plsql", "create or replace procedure p is\nbegin null; end;"],
      ["sql", "select 1 from dual"],
    ]);
  });

  test.each([
    "begin null; end;",
    "declare x number; begin x := case when 1 = 1 then 1 end; end;",
    "create procedure p is begin if true then null; end if; end p;",
    "create function f return number is begin return 1; end;",
    "create trigger t before insert on t1 begin null; end;",
    "create package p as procedure q; end p;",
    "create package body p as procedure q is begin null; end q; end p;",
    "create type body t as member procedure p is begin null; end p; end;",
    "begin case 1 when 1 then null; end case; dbms_output.put_line(q'[END;]'); end;",
  ])("separa %s del SQL siguiente sin una barra", (block) => {
    expect(texts(`${block}\nselect 1 from dual;`)).toEqual([
      ["plsql", block],
      ["sql", "select 1 from dual"],
    ]);
  });

  test("una sentencia SQL también puede terminar con /", () => {
    expect(texts("update t set a = 1\n/\nselect 1 from dual")).toEqual([
      ["sql", "update t set a = 1"],
      ["sql", "select 1 from dual"],
    ]);
  });

  test("CREATE TABLE es SQL y CREATE TYPE BODY es PL/SQL", () => {
    expect(splitScript("create table t (a number);")[0].kind).toBe("sql");
    expect(
      splitScript("create or replace editionable type body t as end;\n/")[0]
        .kind,
    ).toBe("plsql");
    expect(splitScript("create type t as object (a number);\n/")[0].kind).toBe(
      "plsql",
    );
  });

  test("marca comandos SQL*Plus de una línea", () => {
    expect(
      texts(
        "set serveroutput on\nprompt hola;\n@script.sql\nselect 1 from dual;",
      ),
    ).toEqual([
      ["sqlplus", "set serveroutput on"],
      ["sqlplus", "prompt hola;"],
      ["sqlplus", "@script.sql"],
      ["sql", "select 1 from dual"],
    ]);
  });

  test("conserva posiciones y omite tramos vacíos o solo comentarios", () => {
    const source = "  -- inicio\n\nselect 1 from dual;\n;\n";
    const [only, ...rest] = splitScript(source);
    expect(rest).toEqual([]);
    expect(source.slice(only.from, only.to)).toBe("select 1 from dual");
  });
});

describe("statementAt", () => {
  const source = "select 1 from dual;\n-- siguiente\nselect 2 from dual;\n";
  const list = splitScript(source);

  test("elige la sentencia siguiente en comentarios y espacios intermedios", () => {
    expect(statementAt(list, source.indexOf("2"))?.text).toBe(
      "select 2 from dual",
    );
    expect(statementAt(list, source.indexOf(";") + 1)?.text).toBe(
      "select 2 from dual",
    );
    expect(statementAt(list, source.indexOf("-- siguiente"))?.text).toBe(
      "select 2 from dual",
    );
    expect(statementAt(list, 0)?.text).toBe("select 1 from dual");
    expect(statementAt(list, source.length)).toBeNull();
  });

  test("sin sentencias no hay nada que ejecutar", () => {
    expect(statementAt(splitScript("  -- nada"), 0)).toBeNull();
  });
});
