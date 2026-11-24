import { oracleDialect } from "./editorReference";

export interface ProgramDeclaration {
  name: string;
  label: string;
  key: string;
  from: number;
  definition: boolean;
}

interface Token {
  text: string;
  key: string;
  from: number;
}

const isIdentifier = (token: Token | undefined): token is Token =>
  !!token && /^(?:"[^"]+"|[\p{L}][\p{L}\p{N}_$#]*)$/u.test(token.text);
const nameOf = (token: Token) => token.text.startsWith('"') ? token.text.slice(1, -1) : token.key;
const storedUnits = new Set(["PROCEDURE", "FUNCTION", "TRIGGER", "TYPE", "PACKAGE"]);
const routines = new Set(["PROCEDURE", "FUNCTION", "CURSOR"]);
const bodyMarkers = new Set([";", "AS", "IS"]);
const signatureModifiers = new Set(["ACCESSIBLE", "AUTHID", "DETERMINISTIC", "PARALLEL_ENABLE", "PIPELINED", "RESULT_CACHE"]);
const openings = new Set(["BEGIN", "IF", "LOOP", "CASE"]);
const closingWords = new Set(["IF", "LOOP", "CASE"]);

function tokenize(source: string) {
  const tokens: Token[] = [];
  oracleDialect.language.parser.parse(source).iterate({
    enter(node) {
      if (node.from === node.to || node.node.firstChild || node.name === "LineComment" || node.name === "BlockComment") return;
      const text = source.slice(node.from, node.to);
      tokens.push({ text, key: text.startsWith('"') ? text : text.toUpperCase(), from: node.from });
    },
  });
  return tokens;
}

function boundary(tokens: Token[], start: number, markers: Set<string>, end = tokens.length) {
  let depth = 0;
  for (let i = start; i < end; i += 1) {
    const { key } = tokens[i];
    if (depth === 0 && markers.has(key)) return i;
    if (key === "(") depth += 1;
    if (key === ")") depth -= 1;
  }
  return end;
}

function parameters(tokens: Token[], start: number, end: number) {
  const parts: Token[][] = [];
  if (tokens[start]?.key !== "(") return { parts, after: start };
  const separators = new Set([",", ")"]);
  const defaults = new Set(["DEFAULT", ":=", ":"]);
  for (let i = start + 1; i < end;) {
    const delimiter = boundary(tokens, i, separators, end);
    const last = boundary(tokens, i, defaults, delimiter);
    if (last > i) parts.push(tokens.slice(i, last));
    i = delimiter + 1;
    if (tokens[delimiter]?.key === ")") return { parts, after: i };
  }
  return { parts, after: end };
}

function format(tokens: Token[]) {
  return tokens.map((token, i) => {
    const before = tokens[i - 1]?.key;
    const space = i > 0 && ![")", "(", ",", ".", "%"].includes(token.key) && !["(", ".", "%"].includes(before);
    return (space ? " " : "") + token.text;
  }).join("");
}

function normalizedParameter(tokens: Token[]) {
  // IN es el modo predeterminado, pero IN OUT es distinto de OUT.
  return tokens.filter((token, index) => !(index === 1 && token.key === "IN" && tokens[2]?.key !== "OUT"))
    .map((token) => token.key);
}

function readName(tokens: Token[], start: number) {
  return tokens[start + 1]?.key === "." && isIdentifier(tokens[start + 2]) ? start + 2 : start;
}

function routine(tokens: Token[], start: number) {
  const kind = tokens[start].key;
  const nameIndex = readName(tokens, start + 1);
  const name = tokens[nameIndex];
  if (!isIdentifier(name)) return null;
  const body = boundary(tokens, nameIndex + 1, bodyMarkers);
  const { parts, after } = parameters(tokens, nameIndex + 1, body);
  const returnType = tokens[after]?.key === "RETURN" ? tokens.slice(after + 1, body) : [];
  const option = returnType.findIndex((token) => signatureModifiers.has(token.key));
  if (option >= 0) returnType.length = option;
  const signature = kind === "CURSOR" && !parts.length ? name.text : `${name.text}(${parts.map(format).join(", ")})`;
  const entry: ProgramDeclaration = {
    name: nameOf(name),
    label: returnType.length ? `${signature} RETURN ${format(returnType)}` : signature,
    key: JSON.stringify([kind, nameOf(name), parts.map(normalizedParameter), returnType.map((token) => token.key)]),
    from: name.from,
    definition: tokens[body]?.key === "IS" || tokens[body]?.key === "AS",
  };
  return { entry, body };
}

function afterStatement(tokens: Token[], start: number) {
  return boundary(tokens, start, statementEnd) + 1;
}
const statementEnd = new Set([";"]);

function afterBlock(tokens: Token[], start: number) {
  let depth = 0;
  for (let i = start; i < tokens.length; i += 1) {
    const { key } = tokens[i];
    if (openings.has(key)) depth += 1;
    if (key !== "END") continue;
    depth -= 1;
    if (depth === 0) return afterStatement(tokens, i + 1);
    if (closingWords.has(tokens[i + 1]?.key)) i += 1;
  }
  return tokens.length;
}

function afterRoutine(tokens: Token[], start: number): number {
  for (let i = start; i < tokens.length;) {
    const { key } = tokens[i];
    if (key === "BEGIN") return afterBlock(tokens, i);
    if (key === "END") return afterStatement(tokens, i);
    if (key === "PROCEDURE" || key === "FUNCTION") {
      const nested = routine(tokens, i);
      if (nested?.entry.definition) {
        i = afterRoutine(tokens, nested.body + 1);
        continue;
      }
    }
    if (key === "LANGUAGE" || key === "EXTERNAL") return afterStatement(tokens, i);
    i = afterStatement(tokens, i);
  }
  return tokens.length;
}

function packageMembers(tokens: Token[], start: number) {
  const entries = new Map<string, ProgramDeclaration>();
  for (let i = start; i < tokens.length;) {
    const { key } = tokens[i];
    if (key === "BEGIN" || key === "END" || key === "WRAPPED") break;
    if (routines.has(key)) {
      const member = routine(tokens, i);
      if (member) {
        if (!entries.has(member.entry.key) || member.entry.definition) entries.set(member.entry.key, member.entry);
        const { body } = member;
        i = member.entry.definition && key !== "CURSOR" ? afterRoutine(tokens, body + 1) : afterStatement(tokens, body);
        continue;
      }
    }
    const end = boundary(tokens, i, statementEnd);
    const name = key === "TYPE" || key === "SUBTYPE" ? tokens[i + 1] : tokens[i];
    if (key !== "PRAGMA" && end > i + 1 && isIdentifier(name) && isIdentifier(tokens[i + 1])) {
      const entry = { name: nameOf(name), label: name.text, key: nameOf(name), from: name.from, definition: false };
      entries.set(entry.key, entry);
    }
    i = end + 1;
  }
  return [...entries.values()].sort((a, b) => a.from - b.from);
}

/** Analiza la estructura del primer programa del documento a partir de los tokens de Oracle. */
export function programStructure(source: string): ProgramDeclaration[] {
  const tokens = tokenize(source);
  const unit = storedUnits.has(tokens[0]?.key) ? 0 : findCreatedUnit(tokens);
  if (unit < 0) return [];
  const kind = tokens[unit].key;
  if (routines.has(kind)) {
    const entry = routine(tokens, unit)?.entry;
    return entry ? [entry] : [];
  }
  const isBody = tokens[unit + 1]?.key === "BODY";
  const nameIndex = readName(tokens, unit + (isBody ? 2 : 1));
  const name = tokens[nameIndex];
  if (!isIdentifier(name)) return [];
  if (kind === "PACKAGE") {
    const headerEnd = boundary(tokens, nameIndex + 1, bodyMarkers);
    if (tokens[headerEnd]?.key !== ";") return packageMembers(tokens, headerEnd + 1);
  }
  return [{ name: nameOf(name), label: name.text, key: nameOf(name), from: name.from, definition: false }];
}

function findCreatedUnit(tokens: Token[]) {
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].key !== "CREATE") continue;
    let unit = i + 1;
    if (tokens[unit]?.key === "OR" && tokens[unit + 1]?.key === "REPLACE") unit += 2;
    if (tokens[unit]?.key === "EDITIONABLE" || tokens[unit]?.key === "NONEDITIONABLE") unit += 1;
    if (storedUnits.has(tokens[unit]?.key)) return unit;
  }
  return -1;
}
