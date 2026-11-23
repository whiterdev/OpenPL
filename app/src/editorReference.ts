import { ensureSyntaxTree } from "@codemirror/language";
import { PLSQL, SQLDialect } from "@codemirror/lang-sql";
import type { EditorState } from "@codemirror/state";

export const oracleDialect = SQLDialect.define({ ...PLSQL.spec, doubleQuotedStrings: false });

export interface EditorReference {
  owner: string | null;
  name: string;
}

export function editorReference(state: EditorState, position: number): EditorReference | null {
  const line = state.doc.lineAt(position);
  const tree = ensureSyntaxTree(state, line.to, 50);
  const token = tree?.resolveInner(position, 1);
  if (!token || (token.name !== "Identifier" && token.name !== "QuotedIdentifier")) return null;

  const node = token.parent?.name === "CompositeIdentifier" ? token.parent : token;
  const before = state.sliceDoc(line.from, node.from);
  const after = state.sliceDoc(node.to, line.to);
  if (/[@:]\s*$/.test(before) || /^\s*@/.test(after)) return null;

  const identifiers = node === token ? [token] : node.getChildren("Identifier")
    .concat(node.getChildren("QuotedIdentifier")).sort((a, b) => a.from - b.from);
  if (identifiers.length < 1 || identifiers.length > 2) return null;
  const names = identifiers.map((identifier) => {
    const text = state.sliceDoc(identifier.from, identifier.to);
    return identifier.name === "QuotedIdentifier" ? text.slice(1, -1) : text.toUpperCase();
  });
  return { owner: names.length === 2 ? names[0] : null, name: names[names.length - 1] };
}
