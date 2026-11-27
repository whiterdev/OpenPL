import type { NamePath } from "./editorReference";
import { statementTables, type TableReference } from "./programCompletion";
import { isIdentifier, nameOf, tokenize, type Token } from "./programStructure";
import { programSymbols, type ProgramSymbol, type Tree } from "./programSymbols";
import type { SourcePart, SymbolLookup } from "./symbolSources";
import type { ObjectColumn, ObjectInfo, ObjectType } from "./types";

export type SymbolLocation =
  | { where: "here"; part: number; from: number; line: number; column: number }
  | { where: "object"; object: ObjectInfo; partKind: string; from: number; line: number; column: number };

export type Resolved =
  | { kind: "symbol"; symbol: ProgramSymbol; location: SymbolLocation }
  | { kind: "column"; table: string; column: ObjectColumn }
  | { kind: "relation"; object: ObjectInfo; columns: ObjectColumn[] }
  | { kind: "object"; object: ObjectInfo; note: "Fuente no disponible" };

export interface ResolveContext {
  /** Partes del documento abierto (SQL: una sola). */
  parts: SourcePart[];
  /** Parte donde está el cursor. */
  current: number;
  /** Posición dentro de esa parte. */
  position: number;
  /** Objeto del documento abierto, si lo es. Sus declaraciones se ubican como "here". */
  self: Pick<ObjectInfo, "owner" | "name" | "object_type"> | null;
  /** null sin conexión. */
  lookup: SymbolLookup | null;
}

/** Fuente envuelta con `wrap`: no se puede analizar. */
const wrappedSource =
  /^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?)?(?:(?:NON)?EDITIONABLE\s+)?(?:PACKAGE|TYPE|FUNCTION|PROCEDURE|TRIGGER)(?:\s+BODY)?\s+(?:"[^"]+"|[\w$#]+)(?:\s*\.\s*(?:"[^"]+"|[\w$#]+))?\s+wrapped\b/i;

const relationTypes = new Set<ObjectType>(["Table", "View", "MaterializedView"]);
const programTypes = new Set<ObjectType>(["Package", "Function", "Procedure", "Type", "Trigger"]);
const memberKinds = new Set(["field", "parameter"]);
const MAX_DEPTH = 6;

const cache = new Map<string, ProgramSymbol[]>();
function symbolsOf(source: string, tree?: Tree) {
  const hit = cache.get(source);
  if (hit) {
    cache.delete(source);
    cache.set(source, hit);
    return hit;
  }
  const symbols = programSymbols(source, tree);
  cache.set(source, symbols);
  if (cache.size > 16) cache.delete(cache.keys().next().value!);
  return symbols;
}

/** Unidad donde se buscan símbolos: el documento abierto o un objeto de la base. */
interface Home {
  parts: SourcePart[];
  symbols: ProgramSymbol[][];
  object: ObjectInfo | null;
}

/** Parte y posición desde donde se busca: elige el alcance local más interno. */
interface At {
  part: number;
  position: number;
}

type Entity =
  | { t: "unit"; home: Home }
  | { t: "record"; home: Home; dataType: string; at?: At }
  | { t: "query"; home: Home; query: string; label: string }
  | { t: "relation"; owner: string | null; name: string }
  | { t: "schema"; owner: string }
  | { t: "unreadable"; object: ObjectInfo };

const homeOf = (parts: SourcePart[], object: ObjectInfo | null): Home => ({
  parts,
  symbols: parts.map((part) => symbolsOf(part.source, part.tree)),
  object,
});

function lineAt(source: string, from: number) {
  let line = 1;
  for (let i = source.indexOf("\n"); i >= 0 && i < from; i = source.indexOf("\n", i + 1)) line += 1;
  return line;
}

function located(home: Home, part: number, symbol: ProgramSymbol): Resolved {
  const { source } = home.parts[part];
  const line = lineAt(source, symbol.from);
  const column = symbol.from - (source.lastIndexOf("\n", symbol.from - 1) + 1) + 1;
  return {
    kind: "symbol",
    symbol,
    location: home.object
      ? { where: "object", object: home.object, partKind: home.parts[part].kind, from: symbol.from, line, column }
      : { where: "here", part, from: symbol.from, line, column },
  };
}

const sqlStarts = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "WITH"]);
const ALIAS_WINDOW = 4000;

/**
 * Tablas y alias visibles en `position`, solo si está dentro del texto de una sentencia SQL
 * (no en el PL/SQL que la rodea, p. ej. después del LOOP de un FOR con consulta). Tokeniza una
 * ventana acotada, así un `;` dentro de un texto o un comentario no corta la sentencia.
 */
function sqlAliasesAt(source: string, position: number) {
  const aliases = new Map<string, TableReference>();
  const from = source.lastIndexOf("\n", Math.max(0, position - ALIAS_WINDOW)) + 1;
  const next = source.indexOf("\n", position + ALIAS_WINDOW);
  const text = source.slice(from, next < 0 ? source.length : next);
  const at = position - from;
  const tokens = tokenize(text);
  let first = 0;
  let last = tokens.length;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].key !== ";") continue;
    if (tokens[i].from < at) first = i + 1;
    else {
      last = i;
      break;
    }
  }
  const inside = tokens.slice(first, last).some((token, offset) => {
    if (!sqlStarts.has(token.key) || token.from > at) return false;
    // La sentencia termina en el paréntesis que la cierra o al final.
    let depth = 0;
    for (let j = first + offset + 1; j < last; j += 1) {
      const { key } = tokens[j];
      if (key === "(") depth += 1;
      else if (key === ")" && depth-- === 0) return at <= tokens[j].from;
    }
    return true;
  });
  if (!inside) return aliases;
  for (const { ref, alias } of statementTables(text, at)) {
    aliases.set(ref.name, ref);
    if (alias) aliases.set(alias, ref);
  }
  return aliases;
}

/** Nombre con puntos, respetando comillas: `hr."Mi Tabla"` → ["HR", "Mi Tabla"]. */
function nameParts(text: string) {
  return (text.trim().match(/"[^"]+"|[^.\s]+/g) ?? []).map((part) =>
    part.startsWith('"') ? part.slice(1, -1) : part.toUpperCase());
}

/** Miembros de nivel de unidad (scope null) con ese nombre, en todas las partes. */
function unitMembers(home: Home, name: string, kinds?: Set<string>) {
  const found: Resolved[] = [];
  home.symbols.forEach((symbols, part) => {
    for (const symbol of symbols) {
      if (symbol.name !== name || symbol.scope || memberKinds.has(symbol.kind)) continue;
      if (kinds && !kinds.has(symbol.kind)) continue;
      found.push(located(home, part, symbol));
    }
  });
  return found;
}

/** El símbolo visible desde `at` (local más interno), si no el de nivel de unidad, si no el primero. */
function findSymbol(home: Home, name: string, kinds: Set<string>, at?: At) {
  const found: { part: number; symbol: ProgramSymbol }[] = [];
  home.symbols.forEach((symbols, part) => {
    for (const symbol of symbols) if (symbol.name === name && kinds.has(symbol.kind)) found.push({ part, symbol });
  });
  if (at) {
    const size = ({ symbol }: { symbol: ProgramSymbol }) => symbol.scope!.to - symbol.scope!.from;
    const local = found
      .filter(({ part, symbol }) => part === at.part && symbol.scope && symbol.scope.from <= at.position && at.position <= symbol.scope.to)
      .sort((a, b) => size(a) - size(b));
    if (local.length) return local[0];
  }
  return found.find(({ symbol }) => !symbol.scope) ?? found[0] ?? null;
}

const typeKinds = new Set(["type", "subtype"]);
const valueKinds = new Set(["variable", "constant", "parameter"]);
const cursorKinds = new Set(["cursor"]);

class Resolver {
  private readonly here: Home;

  constructor(private readonly ctx: ResolveContext) {
    this.here = homeOf(ctx.parts, null);
  }

  private async safe<T>(load: (lookup: SymbolLookup) => Promise<T>, fallback: T): Promise<T> {
    const { lookup } = this.ctx;
    if (!lookup) return fallback;
    try {
      return await load(lookup);
    } catch {
      return fallback;
    }
  }

  private object(owner: string | null, name: string) {
    return this.safe((lookup) => lookup.object(owner, name), null);
  }

  private async columns(owner: string | null, name: string) {
    const realOwner = owner ?? (await this.object(null, name))?.owner;
    if (!realOwner) return [];
    return this.safe((lookup) => lookup.columns(realOwner, name), [] as ObjectColumn[]);
  }

  /** Partes legibles del objeto; null si no hay ninguna (sin permiso o todo envuelto). */
  private async home(object: ObjectInfo) {
    const parts = (await this.safe((lookup) => lookup.parts(object), [] as SourcePart[]))
      .filter((part) => !wrappedSource.test(part.source));
    return parts.length ? homeOf(parts, object) : null;
  }

  /** Símbolos visibles en el cursor: el alcance local más interno, o el nivel de unidad. */
  private visible(name: string): Resolved[] {
    const { current, position } = this.ctx;
    const local = (this.here.symbols[current] ?? []).filter(
      (symbol) => symbol.name === name && symbol.kind !== "field" && symbol.scope &&
        symbol.scope.from <= position && position <= symbol.scope.to,
    );
    if (local.length) {
      const size = (symbol: ProgramSymbol) => symbol.scope!.to - symbol.scope!.from;
      const inner = Math.min(...local.map(size));
      return local.filter((symbol) => size(symbol) === inner).map((symbol) => located(this.here, current, symbol));
    }
    return unitMembers(this.here, name);
  }

  private async objectResult(object: ObjectInfo): Promise<Resolved[]> {
    if (relationTypes.has(object.object_type)) {
      return [{ kind: "relation", object, columns: await this.columns(object.owner, object.name) }];
    }
    if (!programTypes.has(object.object_type)) return [];
    const home = await this.home(object);
    if (!home) return [{ kind: "object", object, note: "Fuente no disponible" }];
    return unitMembers(home, object.name);
  }

  private async entityFromObject(object: ObjectInfo | null, fallbackSchema: string | null): Promise<Entity | null> {
    if (!object) return fallbackSchema ? { t: "schema", owner: fallbackSchema } : null;
    if (relationTypes.has(object.object_type)) return { t: "relation", owner: object.owner, name: object.name };
    if (object.object_type !== "Package") return null;
    const home = await this.home(object);
    return home ? { t: "unit", home } : { t: "unreadable", object };
  }

  /** Entidad de un símbolo del documento abierto. */
  private entityFromSymbol(found: Resolved | undefined): Entity | null {
    if (found?.kind !== "symbol") return null;
    const { symbol } = found;
    const home = this.here;
    if (symbol.kind === "package") return { t: "unit", home };
    if (symbol.query !== undefined && !symbol.dataType) {
      return { t: "query", home, query: symbol.query, label: symbol.name };
    }
    const at = { part: this.ctx.current, position: this.ctx.position };
    return symbol.dataType ? { t: "record", home, dataType: symbol.dataType, at } : null;
  }

  private async firstEntity(name: string): Promise<Entity | null> {
    // Dentro de una sentencia SQL, Oracle resuelve primero sus alias y tablas.
    const { current, position } = this.ctx;
    const table = sqlAliasesAt(this.ctx.parts[current]?.source ?? "", position).get(name);
    if (table) return { t: "relation", owner: table.owner, name: table.name };
    const visible = this.visible(name);
    const fromSymbol = this.entityFromSymbol(visible.find((item) =>
      item.kind === "symbol" && (valueKinds.has(item.symbol.kind) || item.symbol.kind === "package")));
    if (fromSymbol) return fromSymbol;
    if (!this.ctx.lookup) return null;
    return this.entityFromObject(await this.object(null, name), name);
  }

  private async memberEntity(entity: Entity, name: string): Promise<Entity | null> {
    if (entity.t === "schema") return this.entityFromObject(await this.object(entity.owner, name), null);
    if (entity.t === "unit") {
      const [found] = unitMembers(entity.home, name, valueKinds);
      return found?.kind === "symbol" && found.symbol.dataType
        ? { t: "record", home: entity.home, dataType: found.symbol.dataType }
        : null;
    }
    if (entity.t === "record") {
      const [found] = await this.typeMembers(entity.home, entity.dataType, name, 0, entity.at);
      return found?.kind === "symbol" && found.symbol.dataType
        ? { t: "record", home: entity.home, dataType: found.symbol.dataType, at: entity.at }
        : null;
    }
    return null;
  }

  private async members(entity: Entity, name: string): Promise<Resolved[]> {
    switch (entity.t) {
      case "schema": {
        const object = await this.object(entity.owner, name);
        return object ? this.objectResult(object) : [];
      }
      case "unit":
        return unitMembers(entity.home, name);
      case "relation": {
        const column = (await this.columns(entity.owner, entity.name)).find((item) => item.name === name);
        return column ? [{ kind: "column", table: entity.name, column }] : [];
      }
      case "record":
        return this.typeMembers(entity.home, entity.dataType, name, 0, entity.at);
      case "query":
        return this.queryColumn(entity.query, name, entity.label);
      case "unreadable":
        return [{ kind: "object", object: entity.object, note: "Fuente no disponible" }];
    }
  }

  /** Campo `name` de un valor de tipo `dataType` declarado en `home`. */
  private async typeMembers(home: Home, dataType: string, name: string, depth: number, at?: At): Promise<Resolved[]> {
    if (depth > MAX_DEPTH) return [];
    const text = dataType.trim();
    const rowType = /^(.+)%ROWTYPE$/i.exec(text);
    if (rowType) {
      const base = nameParts(rowType[1]);
      if (base.length === 1) {
        const cursor = findSymbol(home, base[0], cursorKinds, at);
        if (cursor?.symbol.query) return this.queryColumn(cursor.symbol.query, name, cursor.symbol.name);
      }
      if (base.length === 2) {
        // pkg.cursor%ROWTYPE
        const owner = await this.object(null, base[0]);
        const unit = owner?.object_type === "Package" ? await this.home(owner) : null;
        const cursor = unit ? findSymbol(unit, base[1], cursorKinds) : null;
        if (cursor?.symbol.query) return this.queryColumn(cursor.symbol.query, name, cursor.symbol.name);
      }
      const table = base[base.length - 1];
      const column = (await this.columns(base.length > 1 ? base[0] : null, table)).find((item) => item.name === name);
      return column ? [{ kind: "column", table, column }] : [];
    }
    const anchored = /^(.+)%TYPE$/i.exec(text);
    if (anchored) {
      const base = nameParts(anchored[1]);
      const variable = base.length === 1 ? findSymbol(home, base[0], valueKinds, at) : null;
      return variable?.symbol.dataType
        ? this.typeMembers(home, variable.symbol.dataType, name, depth + 1, at)
        : [];
    }
    const collection =
      /^(?:TABLE|VARRAY\s*\([^)]*\)|VARYING\s+ARRAY\s*\([^)]*\))\s+OF\s+(.+?)(?:\s+INDEX\s+BY\s+[\s\S]*)?(?:\s+NOT\s+NULL)?$/i.exec(text);
    if (collection) return this.typeMembers(home, collection[1], name, depth + 1, at);

    const base = nameParts(text);
    if (base.length < 1 || base.length > 2) return [];
    let typeHome: Home | null = base.length === 1 ? home : null;
    let typeAt = at;
    let type = typeHome ? findSymbol(typeHome, base[0], typeKinds, typeAt) : null;
    if (!type) {
      // Tipo de otro paquete (pkg.t_rec) o tipo objeto del esquema (t_persona, hr.t_persona).
      typeAt = undefined;
      const owner = base.length === 2 ? await this.object(null, base[0]) : null;
      if (owner?.object_type === "Package") {
        typeHome = await this.home(owner);
      } else {
        const object = base.length === 2 ? await this.object(base[0], base[1]) : await this.object(null, base[0]);
        typeHome = object?.object_type === "Type" ? await this.home(object) : null;
      }
      type = typeHome ? findSymbol(typeHome, base[base.length - 1], typeKinds) : null;
    }
    if (!type || !typeHome) return [];
    const found = type;
    const typeName = found.symbol.name;
    const parent = /^UNDER (.+)$/.exec(found.symbol.dataType ?? "")?.[1];
    if (found.symbol.dataType === "OBJECT" || parent) {
      const members: Resolved[] = [];
      typeHome.symbols.forEach((symbols, part) => {
        for (const symbol of symbols) {
          if (symbol.container === typeName && symbol.name === name && symbol.kind !== "parameter") {
            members.push(located(typeHome, part, symbol));
          }
        }
      });
      // Lo heredado se busca en el tipo padre.
      return members.length || !parent ? members : this.typeMembers(typeHome, parent, name, depth + 1);
    }
    if (found.symbol.kind === "type" && /^RECORD\b/i.test(found.symbol.dataType ?? "")) {
      return typeHome.symbols[found.part]
        .filter((symbol) => symbol.kind === "field" && symbol.container === typeName && symbol.name === name &&
          symbol.scope?.from === found.symbol.scope?.from)
        .map((symbol) => located(typeHome, found.part, symbol));
    }
    return found.symbol.dataType ? this.typeMembers(typeHome, found.symbol.dataType, name, depth + 1, typeAt) : [];
  }

  /** Columna `name` de la lista de un SELECT; tipo de la tabla si es una columna simple. */
  private async queryColumn(query: string, name: string, label: string): Promise<Resolved[]> {
    const tokens = tokenize(query);
    const select = tokens.findIndex((token) => token.key === "SELECT");
    if (select < 0) return [];
    const items: Token[][] = [];
    let depth = 0;
    let item: Token[] = [];
    for (let i = select + 1; i < tokens.length; i += 1) {
      const { key } = tokens[i];
      if (key === "(") depth += 1;
      if (key === ")") depth -= 1;
      if (depth === 0 && (key === "FROM" || key === "INTO")) break;
      if (depth === 0 && key === ",") {
        items.push(item);
        item = [];
      } else {
        item.push(tokens[i]);
      }
    }
    items.push(item);

    for (const entry of items) {
      if (!entry.length) continue;
      const last = entry[entry.length - 1];
      const before = entry[entry.length - 2];
      const aliased = entry.length > 1 && isIdentifier(last) && before.key !== "." && before.key !== "%";
      const expression = aliased ? entry.slice(0, before.key === "AS" ? -2 : -1) : entry;
      const simple =
        (expression.length === 1 && isIdentifier(expression[0])) ||
        (expression.length === 3 && isIdentifier(expression[0]) && expression[1].key === "." && isIdentifier(expression[2]));
      const columnName = simple ? nameOf(expression[expression.length - 1]) : null;
      if ((aliased ? nameOf(last) : columnName) !== name) continue;
      if (!columnName) return [{ kind: "column", table: label, column: { name, data_type: "Expresión", nullable: true } }];

      const qualifier = expression.length === 3 ? nameOf(expression[0]) : null;
      const tables = statementTables(query, tokens[select].from);
      const table = qualifier
        ? tables.find((entry) => entry.alias === qualifier || entry.ref.name === qualifier)
        : tables.length === 1 ? tables[0] : undefined;
      if (!table) return [{ kind: "column", table: label, column: { name, data_type: "Expresión", nullable: true } }];
      const column = (await this.columns(table.ref.owner, table.ref.name)).find((entry) => entry.name === columnName);
      return column
        ? [{ kind: "column", table: table.ref.name, column }]
        : [{ kind: "column", table: label, column: { name, data_type: "Expresión", nullable: true } }];
    }
    return [];
  }

  async resolve(path: NamePath): Promise<Resolved[]> {
    const target = path.parts[path.index];
    if (path.index === 0) {
      const visible = this.visible(target);
      if (visible.length) return visible;
      if (!this.ctx.lookup) return [];
      const object = await this.object(null, target);
      return object ? this.objectResult(object) : [];
    }
    let entity = await this.firstEntity(path.parts[0]);
    for (let i = 1; entity && i < path.index; i += 1) entity = await this.memberEntity(entity, path.parts[i]);
    return entity ? this.members(entity, target) : [];
  }
}

/** Busca el nombre bajo el cursor: alcance local, el paquete abierto y después la base. Nunca rechaza. */
export async function resolveSymbol(ctx: ResolveContext, path: NamePath): Promise<Resolved[]> {
  try {
    return await new Resolver(ctx).resolve(path);
  } catch {
    return [];
  }
}
