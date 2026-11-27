import { oracleDialect } from "./editorReference";
import {
  boundary,
  findCreatedUnit,
  format,
  normalizedParameter,
  isIdentifier,
  matchingBlocks,
  nameOf,
  readName,
  signatureModifiers,
  storedUnits,
  type Token,
} from "./programStructure";
import type { syntaxTree } from "@codemirror/language";

/** Árbol de sintaxis de CodeMirror (el de lezer, sin depender de él directamente). */
export type Tree = ReturnType<typeof syntaxTree>;

export type SymbolKind =
  | "package" | "procedure" | "function" | "cursor" | "type" | "subtype"
  | "variable" | "constant" | "exception" | "parameter" | "field";

export interface SymbolScope {
  from: number;
  to: number;
}

export interface ProgramSymbol {
  kind: SymbolKind;
  /** Clave Oracle: mayúsculas, o tal cual si venía entre comillas. */
  name: string;
  signature: string;
  dataType: string | null;
  /** Texto tras := o DEFAULT. */
  value: string | null;
  comment: string | null;
  /** Posición del nombre. */
  from: number;
  /** null: nivel de unidad (global de paquete). */
  scope: SymbolScope | null;
  definition: boolean;
  /** Rutina, cursor o tipo dueño de parámetros y campos. */
  container: string | null;
  query?: string;
  /** Rutinas: identifica la misma rutina en spec y body aunque cambien IN o los valores por omisión. */
  key?: string;
}

interface Span {
  from: number;
  to: number;
  text: string;
}

const tokenEnd = (token: Token) => token.from + token.text.length;
/** Como `format`, sin separar el `:=` que el tokenizador parte en dos. */
const signatureOf = (tokens: Token[]) => format(tokens).replace(/:\s=/g, ":=");
const listStops = new Set([";", "IS", "AS"]);
const routineStarts = new Set(["PROCEDURE", "FUNCTION"]);
/** Palabras que pueden ir antes de PROCEDURE o FUNCTION en un tipo objeto. */
const methodPrefixes = new Set(["MEMBER", "STATIC", "CONSTRUCTOR", "MAP", "ORDER", "OVERRIDING", "FINAL", "NOT", "INSTANTIABLE"]);
const statementEnd = new Set([";"]);
const routineMarkers = new Set([";", "IS", "AS"]);
const parameterModes = new Set(["IN", "OUT", "NOCOPY"]);

/** Tokens (como `tokenize`) y comentarios en una sola pasada; reusa el árbol del editor si lo hay. */
function scan(source: string, tree?: Tree) {
  const tokens: Token[] = [];
  const comments: Span[] = [];
  (tree ?? oracleDialect.language.parser.parse(source)).iterate({
    enter(node) {
      if (node.from === node.to) return;
      if (node.name === "LineComment" || node.name === "BlockComment") {
        comments.push({ from: node.from, to: node.to, text: source.slice(node.from, node.to) });
        return;
      }
      if (node.node.firstChild) return;
      const text = source.slice(node.from, node.to);
      tokens.push({ text, key: text.startsWith('"') ? text : text.toUpperCase(), from: node.from });
    },
  });
  return { tokens, comments };
}

/** Índice del primer comentario con `from >= position`. */
function firstFrom(spans: Span[], position: number) {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (spans[middle].from < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

function commentText(text: string) {
  if (text.startsWith("--")) return text.slice(2).trim();
  return text
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*?\s?/, "").trimEnd())
    .join("\n")
    .trim();
}

/** Comentario pegado arriba de `start` o al final de la línea que termina en `end`. */
function attachedComment(source: string, spans: Span[], start: number, end: number) {
  const above: Span[] = [];
  let limit = start;
  for (let i = firstFrom(spans, start) - 1; i >= 0; i -= 1) {
    const span = spans[i];
    if (span.to > limit) continue;
    const gap = source.slice(span.to, limit);
    if (!/^\s*$/.test(gap) || (gap.match(/\n/g) ?? []).length > 1) break;
    above.unshift(span);
    limit = span.from;
  }
  if (above.length) return above.map((span) => commentText(span.text)).join("\n") || null;
  const trailing = spans[firstFrom(spans, end)];
  return trailing && !/\n/.test(source.slice(end, trailing.from)) ? commentText(trailing.text) || null : null;
}

class Analyzer {
  readonly out: ProgramSymbol[] = [];
  /** Tipo objeto cuyo cuerpo se está leyendo: sus métodos lo llevan como `container`. */
  private typeName: string | null = null;
  private readonly tokens: Token[];
  private readonly blocks: ReadonlyMap<number, number>;
  private readonly comments: Span[];

  constructor(private readonly source: string, tree?: Tree) {
    const { tokens, comments } = scan(source, tree);
    this.tokens = tokens;
    this.blocks = matchingBlocks(this.tokens);
    this.comments = comments;
  }

  run() {
    const { tokens } = this;
    const unit = storedUnits.has(tokens[0]?.key) ? 0 : findCreatedUnit(tokens);
    if (unit >= 0) this.unit(unit);
    tokens.forEach((token, i) => {
      if (token.key === "DECLARE") this.anonymousBlock(i);
      if (token.key === "FOR") this.forLoop(i);
    });
    return this.out.sort((a, b) => a.from - b.from);
  }

  private text(start: number, end: number) {
    if (start >= end || start >= this.tokens.length) return "";
    const last = this.tokens[Math.min(end, this.tokens.length) - 1];
    return this.source.slice(this.tokens[start].from, tokenEnd(last));
  }

  private endOf(index: number) {
    const token = this.tokens[index];
    return token ? tokenEnd(token) : this.source.length;
  }

  private statementEnd(start: number) {
    return boundary(this.tokens, start, statementEnd);
  }

  /** Índice de := o DEFAULT en profundidad cero, con su largo en tokens. */
  private assignment(start: number, end: number) {
    let depth = 0;
    for (let i = start; i < end; i += 1) {
      const { key } = this.tokens[i];
      if (key === "(") depth += 1;
      if (key === ")") depth -= 1;
      if (depth) continue;
      if (key === "DEFAULT") return { at: i, size: 1 };
      if (key === ":" && this.tokens[i + 1]?.key === "=") return { at: i, size: 2 };
    }
    return null;
  }

  /** Sin un NOT NULL final. */
  private typeEnd(start: number, end: number) {
    const { tokens } = this;
    return end - 2 >= start && tokens[end - 2].key === "NOT" && tokens[end - 1].key === "NULL"
      ? end - 2
      : end;
  }

  private comment(start: number, end: number) {
    return attachedComment(this.source, this.comments, this.tokens[start].from, this.endOf(end));
  }

  private push(symbol: Omit<ProgramSymbol, "comment"> & { comment?: string | null }) {
    this.out.push({ comment: null, ...symbol });
  }

  /** Elementos separados por comas dentro del paréntesis que abre en `open`. */
  /** `stopAtBody`: un paréntesis sin cerrar termina en IS, AS o `;` (no sirve dentro de `AS OBJECT (…)`). */
  private list(open: number, stopAtBody = true) {
    const items: [number, number][] = [];
    if (this.tokens[open]?.key !== "(") return { items, after: open };
    let depth = 0;
    let start = open + 1;
    for (let i = open; i < this.tokens.length; i += 1) {
      const { key } = this.tokens[i];
      // Paréntesis sin cerrar: la lista termina donde empieza el cuerpo o la sentencia.
      if (stopAtBody && listStops.has(key)) {
        if (i > start) items.push([start, i]);
        return { items, after: i };
      }
      if (key === "(") depth += 1;
      else if (key === ")") depth -= 1;
      if ((key === "," && depth === 1) || depth === 0) {
        if (i > start) items.push([start, i]);
        start = i + 1;
        if (depth === 0) return { items, after: i + 1 };
      }
    }
    return { items, after: this.tokens.length };
  }

  private unit(unit: number) {
    const { tokens } = this;
    const kind = tokens[unit].key;
    if (kind === "PROCEDURE" || kind === "FUNCTION") {
      this.routine(unit, null);
      return;
    }
    if (kind === "TYPE") {
      this.objectType(unit);
      return;
    }
    if (kind !== "PACKAGE") return;
    const isBody = tokens[unit + 1]?.key === "BODY";
    const nameIndex = readName(tokens, unit + (isBody ? 2 : 1));
    const name = tokens[nameIndex];
    if (!isIdentifier(name)) return;
    this.push({
      kind: "package",
      name: nameOf(name),
      signature: `PACKAGE${isBody ? " BODY" : ""} ${this.text(unit + (isBody ? 2 : 1), nameIndex + 1)}`,
      dataType: null,
      value: null,
      comment: this.comment(unit, nameIndex),
      from: name.from,
      scope: null,
      definition: isBody,
      container: null,
    });
    const header = boundary(tokens, nameIndex + 1, routineMarkers);
    if (tokens[header]?.key === "IS" || tokens[header]?.key === "AS") this.section(header + 1, null);
  }

  /** Declaraciones hasta BEGIN o END; devuelve el índice donde se detuvo. */
  private section(start: number, scope: SymbolScope | null) {
    const { tokens } = this;
    let i = start;
    while (i < tokens.length) {
      const { key } = tokens[i];
      if (key === "BEGIN" || key === "END" || key === "WRAPPED") return i;
      if (this.typeName && methodPrefixes.has(key)) {
        i += 1;
        continue;
      }
      if (key === "PROCEDURE" || key === "FUNCTION" || key === "CURSOR") {
        i = this.routine(i, scope);
      } else if (key === "TYPE" || key === "SUBTYPE") {
        i = this.type(i, scope);
      } else if (key !== "PRAGMA" && isIdentifier(tokens[i]) && isIdentifier(tokens[i + 1])) {
        i = this.variable(i, scope);
      } else {
        i = this.statementEnd(i) + 1;
      }
    }
    return tokens.length;
  }

  private variable(start: number, scope: SymbolScope | null) {
    const { tokens } = this;
    const name = tokens[start];
    const end = this.statementEnd(start);
    const constant = tokens[start + 1].key === "CONSTANT";
    const base = {
      name: nameOf(name),
      from: name.from,
      scope,
      definition: false,
      container: null,
      comment: this.comment(start, end),
    };
    if (tokens[start + 1].key === "EXCEPTION") {
      this.push({ ...base, kind: "exception", signature: `${name.text} EXCEPTION`, dataType: null, value: null });
      return end + 1;
    }
    const typeStart = start + (constant ? 2 : 1);
    const assign = this.assignment(typeStart, end);
    const dataType = this.text(typeStart, this.typeEnd(typeStart, assign?.at ?? end)) || null;
    const value = assign ? this.text(assign.at + assign.size, end) || null : null;
    this.push({
      ...base,
      kind: constant ? "constant" : "variable",
      signature: `${name.text} ${constant ? "CONSTANT " : ""}${dataType ?? ""}${value ? ` := ${value}` : ""}`,
      dataType,
      value,
    });
    return end + 1;
  }

  private type(start: number, scope: SymbolScope | null) {
    const { tokens } = this;
    const name = tokens[start + 1];
    const end = this.statementEnd(start);
    if (!isIdentifier(name) || tokens[start + 2]?.key !== "IS") return end + 1;
    const subtype = tokens[start].key === "SUBTYPE";
    const definitionStart = start + 3;
    const typeName = nameOf(name);
    this.push({
      kind: subtype ? "subtype" : "type",
      name: typeName,
      signature: signatureOf(tokens.slice(start, end)),
      dataType: this.text(definitionStart, subtype ? this.typeEnd(definitionStart, end) : end) || null,
      value: null,
      comment: this.comment(start, end),
      from: name.from,
      scope,
      definition: false,
      container: null,
    });
    if (!subtype && tokens[definitionStart]?.key === "RECORD") {
      for (const [from, to] of this.list(definitionStart + 1).items) this.member(from, to, "field", typeName, scope);
    }
    return end + 1;
  }

  /** Campo de un RECORD o parámetro de una rutina, en tokens [from, to). */
  private member(from: number, to: number, kind: "field" | "parameter", container: string, scope: SymbolScope | null) {
    const { tokens } = this;
    const name = tokens[from];
    if (!isIdentifier(name)) return;
    let typeStart = from + 1;
    if (kind === "parameter") while (typeStart < to && parameterModes.has(tokens[typeStart].key)) typeStart += 1;
    const assign = this.assignment(typeStart, to);
    const typeEnd = this.typeEnd(typeStart, assign?.at ?? to);
    this.push({
      kind,
      name: nameOf(name),
      signature: signatureOf(tokens.slice(from, assign?.at ?? to)),
      dataType: this.text(typeStart, typeEnd) || null,
      value: assign ? this.text(assign.at + assign.size, to) || null : null,
      from: name.from,
      scope,
      definition: false,
      container,
    });
  }

  /** Firma y clave de una rutina cuyo nombre está en `nameIndex` y su encabezado termina en `end`. */
  private header(start: number, nameIndex: number, items: [number, number][], after: number, end: number) {
    const { tokens } = this;
    const kind = tokens[start].key;
    const returns = tokens[after]?.key === "RETURN" ? tokens.slice(after + 1, end) : [];
    const modifier = returns.findIndex((token) => signatureModifiers.has(token.key));
    if (modifier >= 0) returns.length = modifier;
    const parameters = items.map(([from, to]) => signatureOf(tokens.slice(from, to)));
    const signature =
      `${kind} ${this.text(start + 1, nameIndex + 1)}` +
      (parameters.length ? `(${parameters.join(", ")})` : "") +
      (returns.length ? ` RETURN ${format(returns)}` : "");
    const key = JSON.stringify([
      kind,
      nameOf(tokens[nameIndex]),
      items.map(([from, to]) => normalizedParameter(tokens.slice(from, this.assignment(from, to)?.at ?? to))),
      returns.map((token) => token.key),
    ]);
    return { signature, returns, key };
  }

  /** `TYPE … AS OBJECT (…)` con atributos y métodos, o `TYPE BODY` con sus implementaciones. */
  private objectType(unit: number) {
    const { tokens } = this;
    const isBody = tokens[unit + 1]?.key === "BODY";
    const nameIndex = readName(tokens, unit + (isBody ? 2 : 1));
    const name = tokens[nameIndex];
    if (!isIdentifier(name)) return;
    const typeName = nameOf(name);
    // `TYPE t UNDER padre (…)` no lleva IS ni AS.
    const under = !isBody && tokens[nameIndex + 1]?.key === "UNDER";
    const header = under ? nameIndex : boundary(tokens, nameIndex + 1, routineMarkers);
    if (!under && tokens[header]?.key !== "IS" && tokens[header]?.key !== "AS") return;
    if (isBody) {
      this.typeName = typeName;
      this.section(header + 1, null);
      this.typeName = null;
      return;
    }
    const end = this.statementEnd(header);
    const object = under || tokens[header + 1]?.key === "OBJECT";
    const parent = under ? tokens[readName(tokens, nameIndex + 2)] : undefined;
    this.push({
      kind: "type",
      name: typeName,
      signature: `TYPE ${this.text(unit + 1, nameIndex + 1)}`,
      dataType: parent && isIdentifier(parent) ? `UNDER ${nameOf(parent)}` : object ? "OBJECT" : this.text(header + 1, end) || null,
      value: null,
      comment: this.comment(unit, nameIndex),
      from: name.from,
      scope: null,
      definition: false,
      container: null,
    });
    if (!object) return;
    const open = boundary(tokens, header + 1, new Set(["("]), end);
    for (const [from, to] of this.list(open, false).items) {
      let first = from;
      while (first < to && methodPrefixes.has(tokens[first].key)) first += 1;
      if (tokens[first]?.key === "PROCEDURE" || tokens[first]?.key === "FUNCTION") {
        this.method(first, to, typeName);
      } else {
        this.member(first, to, "field", typeName, null);
      }
    }
  }

  /** Declaración de un método dentro de `AS OBJECT (…)`, en tokens [start, end). */
  private method(start: number, end: number, typeName: string) {
    const { tokens } = this;
    const nameIndex = start + 1;
    const name = tokens[nameIndex];
    if (!isIdentifier(name)) return;
    const { items, after } = this.list(nameIndex + 1);
    const { signature, returns, key } = this.header(start, nameIndex, items, after, end);
    const methodName = nameOf(name);
    this.out.push({
      kind: tokens[start].key === "FUNCTION" ? "function" : "procedure",
      name: methodName,
      signature,
      dataType: returns.length ? format(returns) : null,
      value: null,
      comment: this.comment(start, end - 1),
      from: name.from,
      scope: null,
      definition: false,
      container: typeName,
      key,
    });
    const own: SymbolScope = { from: tokens[start].from, to: this.endOf(end - 1) };
    for (const [from, to] of items) this.member(from, to, "parameter", methodName, own);
  }

  private routine(start: number, scope: SymbolScope | null) {
    const { tokens } = this;
    const kind = tokens[start].key;
    const nameIndex = readName(tokens, start + 1);
    const name = tokens[nameIndex];
    if (!isIdentifier(name)) return this.statementEnd(start) + 1;
    const { items, after } = this.list(nameIndex + 1);
    // RETURN SELF AS RESULT (constructores) lleva un AS que no abre el cuerpo.
    const selfResult = tokens[after]?.key === "RETURN" && tokens[after + 1]?.key === "SELF" && tokens[after + 2]?.key === "AS";
    const marker = boundary(tokens, selfResult ? after + 4 : after, routineMarkers);
    const { signature, returns, key } = this.header(start, nameIndex, items, after, marker);
    const opensBody = tokens[marker]?.key === "IS" || tokens[marker]?.key === "AS";
    const definition = opensBody && kind !== "CURSOR";
    const routineName = nameOf(name);
    const own: SymbolScope = { from: tokens[start].from, to: this.endOf(marker) };
    const symbol: ProgramSymbol = {
      kind: kind === "CURSOR" ? "cursor" : kind === "FUNCTION" ? "function" : "procedure",
      name: routineName,
      signature,
      dataType: returns.length ? format(returns) : null,
      value: null,
      comment: this.comment(start, marker),
      from: name.from,
      scope,
      definition,
      container: this.typeName,
      key,
    };
    this.out.push(symbol);
    for (const [from, to] of items) this.member(from, to, "parameter", routineName, own);

    if (kind === "CURSOR" && opensBody) {
      const end = this.statementEnd(marker + 1);
      symbol.query = this.text(marker + 1, end);
      own.to = this.endOf(end);
      return end + 1;
    }
    if (!definition) return marker + 1;
    own.to = this.source.length;
    // Lo declarado dentro de un método no pertenece al tipo.
    const outerType = this.typeName;
    this.typeName = null;
    const stop = this.section(marker + 1, own);
    this.typeName = outerType;
    const closing = tokens[stop]?.key === "BEGIN" ? this.blocks.get(stop) : tokens[stop]?.key === "END" ? stop : undefined;
    if (closing === undefined) {
      // Cuerpo sin END (se está escribiendo): sigue en la próxima rutina que empieza una sentencia.
      const next = tokens.findIndex((token, i) => i > stop && routineStarts.has(token.key) && tokens[i - 1]?.key === ";");
      if (next < 0) return tokens.length;
      own.to = tokens[next].from;
      return next;
    }
    const end = this.statementEnd(closing);
    own.to = this.endOf(end);
    return end + 1;
  }

  private anonymousBlock(start: number) {
    const scope: SymbolScope = { from: this.tokens[start].from, to: this.source.length };
    const stop = this.section(start + 1, scope);
    const closing = this.tokens[stop]?.key === "BEGIN" ? this.blocks.get(stop) : undefined;
    if (closing !== undefined) scope.to = this.endOf(this.statementEnd(closing));
  }

  private forLoop(start: number) {
    const { tokens } = this;
    const name = tokens[start + 1];
    if (!isIdentifier(name) || tokens[start + 2]?.key !== "IN") return;
    const loop = boundary(tokens, start + 3, new Set(["LOOP"]));
    if (loop >= tokens.length) return;
    const closing = this.blocks.get(loop);
    const scope: SymbolScope = {
      from: tokens[start].from,
      to: closing === undefined ? this.source.length : this.endOf(this.statementEnd(closing)),
    };
    let first = start + 3;
    if (tokens[first]?.key === "REVERSE") first += 1;
    const iterator = this.text(first, loop);
    let dataType: string | null = null;
    let query: string | undefined;
    if (tokens[first]?.key === "(") {
      query = this.text(first + 1, this.list(first).after - 1);
    } else if (iterator.includes("..")) {
      dataType = "PLS_INTEGER";
    } else if (isIdentifier(tokens[first])) {
      const cursor = tokens[first + 1]?.key === "." && isIdentifier(tokens[first + 2])
        ? `${nameOf(tokens[first])}.${nameOf(tokens[first + 2])}`
        : nameOf(tokens[first]);
      dataType = `${cursor}%ROWTYPE`;
    }
    this.push({
      kind: "variable",
      name: nameOf(name),
      signature: `${name.text} IN ${iterator}`,
      dataType,
      value: null,
      from: name.from,
      scope,
      definition: false,
      container: null,
      ...(query === undefined ? {} : { query }),
    });
  }
}

/** Símbolos declarados en el texto: unidad principal, bloques anónimos y variables de FOR. */
/** `tree`: el árbol del editor para este texto, si ya está; evita volver a parsear. */
export function programSymbols(source: string, tree?: Tree): ProgramSymbol[] {
  try {
    return new Analyzer(source, tree).run();
  } catch {
    return [];
  }
}
