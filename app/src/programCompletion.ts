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
import type { CompletionObject, ObjectColumn } from "./types";

export const COMPLETION_LIMIT = 100;

export interface CompletionCatalog {
  objects: (
    owner: string | null,
    prefix: string,
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

/** Tablas y alias de la sentencia que contiene `position`, con la clave normalizada como Oracle. */
export function statementAliases(
  source: string,
  position: number,
): Map<string, TableReference> {
  const tokens = tokenize(source);
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

  const aliases = new Map<string, TableReference>();
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
    aliases.set(reference.name, reference);
    if (tokens[next]?.key === "AS") next += 1;
    if (isName(tokens[next]) && !clauseWords.has(tokens[next].key))
      aliases.set(nameOf(tokens[next].text), reference);
  };
  // Por nivel de paréntesis: si una coma introduce otra tabla de la lista FROM.
  const tableList: boolean[] = [false];
  for (let i = start; i < end; i += 1) {
    const { key } = tokens[i];
    if (key === "(") tableList.push(false);
    else if (key === ")") {
      if (tableList.length > 1) tableList.pop();
    } else if (sourceKeywords.has(key)) {
      if (key !== "JOIN") tableList[tableList.length - 1] = key === "FROM";
      readTable(i + 1);
    } else if (key === "," && tableList[tableList.length - 1]) readTable(i + 1);
    else if (listEnds.has(key)) tableList[tableList.length - 1] = false;
  }
  return aliases;
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
        const objects = await catalog.objects(null, target.prefix);
        complete = objects.length < COMPLETION_LIMIT;
        options = objects.map(objectOption);
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

/** Palabras clave PL/SQL, salvo tras un calificador. */
export const keywordCompletion: CompletionSource = (context) => {
  const before = context.state.sliceDoc(
    context.state.doc.lineAt(context.pos).from,
    context.pos,
  );
  if (/\.\s*[\p{L}\p{N}_$#]*$/u.test(before)) return null;
  return keywords(context);
};
