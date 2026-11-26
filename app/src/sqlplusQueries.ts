import { skipOpaque } from "./sqlScript";
import { formatTable } from "./sqlplusFormat";
import type { SqlplusCtx } from "./sqlplusRun";
import type { SqlplusState } from "./sqlplusState";
import type { BindValue, ExecOutcome } from "./types";

interface ObjectName {
  owner: string | null;
  name: string;
}

interface CreatedObject extends ObjectName {
  type: string;
}

const identifier = '(?:"(?:[^"]|"")*"|[\\p{L}_][\\p{L}\\p{N}_$#]*)';
const qualifiedName = new RegExp("^(" + identifier + ")(?:\\s*\\.\\s*(" + identifier + "))?", "u");
const currentOwner = "COALESCE(CAST(:owner AS VARCHAR2(128)), SYS_CONTEXT('USERENV','CURRENT_SCHEMA'))";

function nameParts(text: string): ObjectName | null {
  const match = qualifiedName.exec(text);
  if (!match) return null;
  const normal = (id: string) => id.startsWith('"') ? id.slice(1, -1).replace(/""/g, '"') : id.toUpperCase();
  const [, first, second] = match;
  return second ? { owner: normal(first), name: normal(second) } : { owner: null, name: normal(first) };
}

export function createdObject(sql: string): CreatedObject | null {
  let start = 0;
  while (start < sql.length) {
    if (/\s/.test(sql[start])) start += 1;
    else if (sql.startsWith("--", start) || sql.startsWith("/*", start)) start = skipOpaque(sql, start);
    else break;
  }
  const create = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?(PROCEDURE|FUNCTION|PACKAGE(?:\s+BODY)?|TRIGGER|TYPE(?:\s+BODY)?)\s+/i.exec(sql.slice(start));
  if (!create) return null;
  const name = nameParts(sql.slice(start + create[0].length));
  return name && { ...name, type: create[1].toUpperCase().replace(/\s+/g, " ") };
}

function bind(name: string, value: string | null): BindValue {
  return { name, value, kind: "Text" };
}

export const showUserQuery = {
  sql: "SELECT SYS_CONTEXT('USERENV','SESSION_USER') AS usuario FROM DUAL",
  binds: [],
};

export function showErrorsQuery(object: CreatedObject) {
  return {
    sql: "SELECT line, position, text FROM ALL_ERRORS WHERE owner = " + currentOwner +
      " AND name = :name AND type = :type ORDER BY sequence",
    binds: [bind("owner", object.owner), bind("name", object.name), bind("type", object.type)],
  };
}

function result(outcome: ExecOutcome) {
  if (outcome.result.kind === "Failed") throw { Db: outcome.result.error };
  return outcome.result.kind === "Query" ? outcome.result : null;
}

export function printQuery(outcome: ExecOutcome, state: SqlplusState, ctx: SqlplusCtx) {
  const query = result(outcome);
  if (!query?.page.rows.length) {
    ctx.print("Sin resultados");
    return;
  }
  for (const line of formatTable(query.columns, query.page.rows, state.settings)) ctx.print(line, "output");
}

export async function describeObject(target: string, state: SqlplusState, ctx: SqlplusCtx) {
  const text = target.trim();
  const name = nameParts(text);
  if (!name || qualifiedName.exec(text)?.[0] !== text) {
    ctx.print("Nombre de objeto inválido", "error");
    return;
  }
  const objects = result(await ctx.query(
    "SELECT owner, object_name, object_type FROM ALL_OBJECTS WHERE owner = " + currentOwner +
      " AND object_name = :name AND object_type IN ('TABLE','VIEW','MATERIALIZED VIEW','PACKAGE','PROCEDURE','FUNCTION')" +
      " ORDER BY object_type",
    [bind("owner", name.owner), bind("name", name.name)],
  ));
  const object = objects?.page.rows[0];
  if (!object) {
    ctx.print("Objeto no encontrado", "error");
    return;
  }
  const [owner, objectName, type] = object;
  const binds = [bind("owner", owner), bind("name", objectName)];
  const details = type === "TABLE" || type === "VIEW" || type === "MATERIALIZED VIEW"
    ? "SELECT column_name, data_type, data_length, nullable FROM ALL_TAB_COLUMNS" +
      " WHERE owner = :owner AND table_name = :name ORDER BY column_id"
    : "SELECT object_name, overload, argument_name, data_type, in_out, position FROM ALL_ARGUMENTS" +
      " WHERE owner = :owner AND data_level = 0 AND " +
      (type === "PACKAGE" ? "package_name = :name" : "package_name IS NULL AND object_name = :name") +
      " ORDER BY object_name, overload, sequence";
  printQuery(await ctx.query(details, binds), state, ctx);
}
