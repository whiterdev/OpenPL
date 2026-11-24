import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { keywordCompletionSource } from "@codemirror/lang-sql";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { oracleDialect } from "./editorReference";
import { tokenize, type Token } from "./programStructure";
import type {
  CompletionObject,
  CompletionScope,
  ObjectColumn,
} from "./types";

export const COMPLETION_LIMIT = 100;

export interface CompletionCatalog {
  objects: (
    owner: string | null,
    prefix: string,
    scope?: CompletionScope,
  ) => Promise<CompletionObject[]>;
  columns: (owner: string | null, name: string) => Promise<ObjectColumn[]>;
}

export interface TableReference {
  owner: string | null;
  name: string;
}

export interface CompletionTarget {
  from: number;
  prefix: string;
  qualifier: string | null;
}

const word = String.raw`[\p{L}][\p{L}\p{N}_$#]*`;
const name = String.raw`(?:"[^"]+"|${word})`;
const targetPattern = new RegExp(
  String.raw`(?:(${name})\s*\.\s*)?(${word})?$`,
  "u",
);
const validWord = new RegExp(String.raw`^[\p{L}\p{N}_$#]*$`, "u");
const plainName = /^[A-Z][A-Z0-9_$#]*$/;
const sourceKeywords = new Set(["FROM", "JOIN", "UPDATE", "INTO"]);
// Palabras que cierran la lista de tablas o no pueden ser un alias.
const clauseWords = new Set([
  "WHERE",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "CROSS",
  "OUTER",
  "NATURAL",
  "ON",
  "USING",
  "GROUP",
  "ORDER",
  "CONNECT",
  "START",
  "HAVING",
  "UNION",
  "INTERSECT",
  "MINUS",
  "SET",
  "VALUES",
  "PARTITION",
  "WITH",
  "FOR",
  "INTO",
  "PIVOT",
  "UNPIVOT",
  "SAMPLE",
  "FETCH",
  "OFFSET",
  "WHEN",
  "THEN",
  "LOOP",
  "BULK",
  "RETURNING",
  "RETURN",
  "SELECT",
  "MODEL",
  "AS",
  "AND",
  "OR",
  "IS",
  "LOG",
]);
const listEnds = new Set([
  "WHERE",
  "GROUP",
  "ORDER",
  "CONNECT",
  "START",
  "HAVING",
  "UNION",
  "INTERSECT",
  "MINUS",
  "SET",
  "VALUES",
  "SELECT",
  "MODEL",
  "FETCH",
  "OFFSET",
]);
const objectKinds: Record<string, string> = {
  TABLE: "tabla",
  VIEW: "vista",
  "MATERIALIZED VIEW": "vista materializada",
  SEQUENCE: "secuencia",
  PACKAGE: "paquete",
  PROCEDURE: "procedimiento",
  FUNCTION: "función",
  TYPE: "tipo",
  SYNONYM: "sinónimo",
};

const wholeName = new RegExp(`^${name}$`, "u");
const isName = (token: Token | undefined): token is Token =>
  !!token && wholeName.test(token.text);
const nameOf = (text: string) =>
  text.startsWith('"') ? text.slice(1, -1) : text.toUpperCase();
const quoted = (value: string) =>
  plainName.test(value) ? value : `"${value.replace(/"/g, '""')}"`;

export interface StatementTable {
  ref: TableReference;
  alias: string | null;
}

/** Límites [start, end) en `tokens` de la sentencia que contiene `position`. */
function statementBounds(tokens: Token[], position: number) {
  let start = 0;
  let end = tokens.length;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].key !== ";") continue;
    if (tokens[i].from < position) start = i + 1;
    else {
      end = i;
      break;
    }
  }
  return { start, end };
}

/**
 * Tablas de la sentencia. Con `strict`, INTO solo introduce una tabla tras INSERT o MERGE (en
 * SELECT ... INTO son variables) y FOR UPDATE no se lee como tabla.
 */
function scanTables(
  source: string,
  position: number,
  strict: boolean,
): StatementTable[] {
  const tokens = tokenize(source);
  const { start, end } = statementBounds(tokens, position);
  const tables: StatementTable[] = [];
  const readTable = (next: number) => {
    if (!isName(tokens[next]) || clauseWords.has(tokens[next].key)) return;
    let reference: TableReference = {
      owner: null,
      name: nameOf(tokens[next].text),
    };
    next += 1;
    if (tokens[next]?.key === "." && isName(tokens[next + 1])) {
      reference = {
        owner: reference.name,
        name: nameOf(tokens[next + 1].text),
      };
      next += 2;
    }
    if (tokens[next]?.key === "@") return;
    if (tokens[next]?.key === "AS") next += 1;
    const alias =
      isName(tokens[next]) && !clauseWords.has(tokens[next].key)
        ? nameOf(tokens[next].text)
        : null;
    tables.push({ ref: reference, alias });
  };
  let writes = false;
  // Por nivel de paréntesis: si una coma introduce otra tabla de la lista FROM.
  const tableList: boolean[] = [false];
  for (let i = start; i < end; i += 1) {
    const { key } = tokens[i];
    if (key === "INSERT" || key === "MERGE") writes = true;
    if (key === "(") tableList.push(false);
    else if (key === ")") {
      if (tableList.length > 1) tableList.pop();
    } else if (sourceKeywords.has(key)) {
      if (key !== "JOIN") tableList[tableList.length - 1] = key === "FROM";
      const skip =
        strict &&
        ((key === "INTO" && !writes) ||
          (key === "UPDATE" && tokens[i - 1]?.key === "FOR"));
      if (!skip) readTable(i + 1);
    } else if (key === "," && tableList[tableList.length - 1]) readTable(i + 1);
    else if (listEnds.has(key)) tableList[tableList.length - 1] = false;
  }
  return tables;
}

/** Tablas de la sentencia que contiene `position`, cada una con su alias si lo tiene. */
export function statementTables(
  source: string,
  position: number,
): StatementTable[] {
  return scanTables(source, position, true);
}

/** Tablas y alias de la sentencia que contiene `position`, con la clave normalizada como Oracle. */
export function statementAliases(
  source: string,
  position: number,
): Map<string, TableReference> {
  const aliases = new Map<string, TableReference>();
  for (const { ref, alias } of scanTables(source, position, false)) {
    aliases.set(ref.name, ref);
    if (alias) aliases.set(alias, ref);
  }
  return aliases;
}

export type SqlContext = "source" | "select";

const typing = new RegExp(String.raw`^${word}$`, "u");
const clauseEnds = new Set([...listEnds, "ON", "USING"]);

/**
 * "source" si en `position` va el nombre de una tabla (tras FROM, JOIN, una coma de la lista FROM
 * o INTO de un INSERT); "select" si está en la lista de un SELECT; null en otro caso.
 */
export function sqlContext(
  state: EditorState,
  position: number,
): SqlContext | null {
  const node = syntaxTree(state).resolveInner(position, -1);
  if (/Comment|String/.test(node.name)) return null;
  const tokens = tokenize(state.doc.toString());
  const { start } = statementBounds(tokens, position);
  let end = start;
  while (end < tokens.length && tokens[end].from < position) end += 1;
  const last = tokens[end - 1];
  if (
    end > start &&
    last.from + last.text.length >= position &&
    typing.test(last.text)
  )
    end -= 1;

  type Clause = "select" | "from" | "into" | null;
  const levels: { clause: Clause; writes: boolean }[] = [
    { clause: null, writes: false },
  ];
  for (let i = start; i < end; i += 1) {
    const { key } = tokens[i];
    const level = levels[levels.length - 1];
    if (key === "(") levels.push({ clause: null, writes: false });
    else if (key === ")") {
      if (levels.length > 1) levels.pop();
    } else if (key === "INSERT" || key === "MERGE") level.writes = true;
    else if (key === "SELECT") level.clause = "select";
    else if (key === "FROM" || key === "JOIN") level.clause = "from";
    else if (key === "INTO") level.clause = level.writes ? "into" : null;
    else if (clauseEnds.has(key)) level.clause = null;
  }

  const previous = end > start ? tokens[end - 1].key : null;
  const { clause } = levels[levels.length - 1];
  if (previous === "FROM" || previous === "JOIN") return "source";
  if (previous === "INTO") return clause === "into" ? "source" : null;
  if (previous === "," && clause === "from") return "source";
  return clause === "select" ? "select" : null;
}

/** Nombre que se está escribiendo y su calificador, o null en comentarios, literales y binds. */
export function completionTarget(
  state: EditorState,
  position: number,
): CompletionTarget | null {
  const node = syntaxTree(state).resolveInner(position, -1);
  if (/Comment|String/.test(node.name)) return null;
  const line = state.doc.lineAt(position);
  const before = state.sliceDoc(line.from, position);
  const match = targetPattern.exec(before)!;
  const typed = match[2] ?? "";
  const start = position - match[0].length;
  const preceding = state.sliceDoc(line.from, start);
  if (/[:@&]$/.test(preceding)) return null;
  if (!match[1] && /[.\p{L}\p{N}_$#"]$/u.test(preceding)) return null;
  return {
    from: position - typed.length,
    prefix: typed.toUpperCase(),
    qualifier: match[1] ? nameOf(match[1]) : null,
  };
}

function objectOption(object: CompletionObject): Completion {
  return {
    label: object.name,
    apply: quoted(object.name),
    detail: objectKinds[object.object_type] ?? object.object_type.toLowerCase(),
    type:
      object.object_type === "PACKAGE"
        ? "namespace"
        : object.object_type === "SEQUENCE"
          ? "constant"
          : "class",
    boost: object.owner === "PUBLIC" ? -1 : 0,
  };
}

function columnOption(column: ObjectColumn): Completion {
  return {
    label: column.name,
    apply: quoted(column.name),
    detail: column.data_type,
    type: "property",
    boost: 1,
  };
}

/**
 * Objetos y columnas del catálogo. `current` devuelve el catálogo de la sesión del programa en el
 * momento de la consulta; si cambió mientras se esperaba la respuesta, se descarta.
 */
export function catalogCompletion(
  current: () => CompletionCatalog | null,
): CompletionSource {
  return async (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    const catalog = current();
    if (!catalog) return null;
    const target = completionTarget(context.state, context.pos);
    if (!target || (!target.qualifier && !target.prefix && !context.explicit))
      return null;

    let options: Completion[];
    let complete = true;
    try {
      if (target.qualifier) {
        const table = statementAliases(
          context.state.doc.toString(),
          context.pos,
        ).get(target.qualifier);
        const [columns, objects] = await Promise.all([
          catalog.columns(
            table ? table.owner : null,
            table ? table.name : target.qualifier,
          ),
          table
            ? Promise.resolve([])
            : catalog.objects(target.qualifier, target.prefix),
        ]);
        complete = objects.length < COMPLETION_LIMIT;
        options = [...columns.map(columnOption), ...objects.map(objectOption)];
      } else {
        const place = sqlContext(context.state, context.pos);
        const tables =
          place === "select"
            ? statementTables(context.state.doc.toString(), context.pos)
            : [];
        const only = tables.length === 1 && !tables[0].alias ? tables[0] : null;
        const [columns, objects] = await Promise.all([
          only
            ? catalog.columns(only.ref.owner, only.ref.name)
            : Promise.resolve([]),
          place === "source"
            ? catalog.objects(null, target.prefix, "relations")
            : catalog.objects(null, target.prefix),
        ]);
        complete = objects.length < COMPLETION_LIMIT;
        options = [...columns.map(columnOption), ...objects.map(objectOption)];
      }
    } catch {
      return null;
    }
    if (current() !== catalog || context.aborted) return null;
    return {
      from: target.from,
      options,
      validFor: complete ? validWord : undefined,
    };
  };
}

const keywords = keywordCompletionSource(oracleDialect, true);

/** Palabras clave PL/SQL, salvo tras un calificador o donde va el nombre de una tabla. */
export const keywordCompletion: CompletionSource = (context) => {
  const before = context.state.sliceDoc(
    context.state.doc.lineAt(context.pos).from,
    context.pos,
  );
  if (/\.\s*[\p{L}\p{N}_$#]*$/u.test(before)) return null;
  if (sqlContext(context.state, context.pos) === "source") return null;
  return keywords(context);
};
