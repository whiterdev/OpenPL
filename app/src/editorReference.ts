import { ensureSyntaxTree } from "@codemirror/language";
import { PLSQL, SQLDialect } from "@codemirror/lang-sql";
import type { EditorState } from "@codemirror/state";

export const oracleDialect = SQLDialect.define({
  ...PLSQL.spec,
  doubleQuotedStrings: false,
});

export interface EditorReference {
  owner: string | null;
  name: string;
}

export function editorReference(
  state: EditorState,
  position: number,
): EditorReference | null {
  const line = state.doc.lineAt(position);
  const tree = ensureSyntaxTree(state, line.to, 50);
  const token = tree?.resolveInner(position, 1);
  if (
    !token ||
    (token.name !== "Identifier" && token.name !== "QuotedIdentifier")
  )
    return null;

  const node =
    token.parent?.name === "CompositeIdentifier" ? token.parent : token;
  const before = state.sliceDoc(line.from, node.from);
  const after = state.sliceDoc(node.to, line.to);
  if (/[@:]\s*$/.test(before) || /^\s*@/.test(after)) return null;

  const identifiers =
    node === token
      ? [token]
      : node
          .getChildren("Identifier")
          .concat(node.getChildren("QuotedIdentifier"))
          .sort((a, b) => a.from - b.from);
  if (identifiers.length < 1 || identifiers.length > 2) return null;
  const names = identifiers.map((identifier) => {
    const text = state.sliceDoc(identifier.from, identifier.to);
    return identifier.name === "QuotedIdentifier"
      ? text.slice(1, -1)
      : text.toUpperCase();
  });
  return {
    owner: names.length === 2 ? names[0] : null,
    name: names[names.length - 1],
  };
}

/** Nombre de hasta tres partes bajo el cursor, saltando índices: `t_tab(i).campo`. */
export interface NamePath {
  parts: string[];
  /** Parte sobre la que está el cursor. */
  index: number;
  from: number;
  to: number;
}

const namePattern = /"[^"]+"|[\p{L}][\p{L}\p{N}_$#]*/uy;
const nameBefore = /(?:"[^"]+"|[\p{L}][\p{L}\p{N}_$#]*)$/u;
const nameKey = (text: string) =>
  text.startsWith('"') ? text.slice(1, -1) : text.toUpperCase();

function skipSpaceBack(text: string, at: number) {
  while (at > 0 && /\s/.test(text[at - 1])) at -= 1;
  return at;
}

function skipSpace(text: string, at: number) {
  while (at < text.length && /\s/.test(text[at])) at += 1;
  return at;
}

/** Posición tras el paréntesis que cierra el que abre en `at`, o -1. */
function closeGroup(text: string, at: number) {
  let depth = 0;
  for (let i = at; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

/** Posición del paréntesis que abre el que cierra justo antes de `at`, o -1. */
function openGroup(text: string, at: number) {
  let depth = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    if (text[i] === ")") depth += 1;
    else if (text[i] === "(" && --depth === 0) return i;
  }
  return -1;
}

export function editorPath(state: EditorState, position: number): NamePath | null {
  const line = state.doc.lineAt(position);
  const tree = ensureSyntaxTree(state, line.to, 50);
  const token = tree?.resolveInner(position, 1);
  if (!token || (token.name !== "Identifier" && token.name !== "QuotedIdentifier")) return null;

  const text = line.text;
  const start = token.from - line.from;
  const end = token.to - line.from;
  const parts: { text: string; from: number; to: number }[] = [
    { text: text.slice(start, end), from: start, to: end },
  ];

  // Hacia atrás: ". nombre" con un índice opcional entre medio.
  for (let at = start; ;) {
    const dot = skipSpaceBack(text, at);
    if (text[dot - 1] !== ".") break;
    let before = skipSpaceBack(text, dot - 1);
    if (text[before - 1] === ")") {
      const open = openGroup(text, before);
      if (open < 0) break;
      before = skipSpaceBack(text, open);
    }
    const match = nameBefore.exec(text.slice(0, before));
    if (!match) break;
    const from = before - match[0].length;
    parts.unshift({ text: match[0], from, to: before });
    at = from;
  }
  const index = parts.length - 1;

  // Hacia adelante: índice opcional, ". nombre".
  for (let at = end; ;) {
    let next = skipSpace(text, at);
    if (text[next] === "(") {
      const close = closeGroup(text, next);
      if (close < 0) break;
      const afterGroup = skipSpace(text, close);
      if (text[afterGroup] !== ".") break;
      next = afterGroup;
    }
    if (text[next] !== ".") break;
    namePattern.lastIndex = skipSpace(text, next + 1);
    const match = namePattern.exec(text);
    if (!match) break;
    parts.push({ text: match[0], from: match.index, to: match.index + match[0].length });
    at = match.index + match[0].length;
  }

  if (parts.length > 3) return null;
  const first = skipSpaceBack(text, parts[0].from);
  if (/[@:]$/.test(text.slice(0, first)) || /^\s*@/.test(text.slice(parts[parts.length - 1].to))) return null;
  return {
    parts: parts.map((part) => nameKey(part.text)),
    index,
    from: token.from,
    to: token.to,
  };
}
