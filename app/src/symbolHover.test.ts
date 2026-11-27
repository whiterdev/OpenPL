import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { sql } from "@codemirror/lang-sql";
import { expect, test } from "vitest";
import { oracleDialect } from "./editorReference";
import { symbolHoverSource } from "./symbolHover";

const view = (doc: string) =>
  new EditorView({ state: EditorState.create({ doc, extensions: [sql({ dialect: oracleDialect })] }) });

test("la ficha no aparece sin contexto", async () => {
  expect(await symbolHoverSource(view("DECLARE v NUMBER; BEGIN v := 1; END;"), 25, () => null)).toBeNull();
});

test("la ficha no aparece fuera de un nombre", async () => {
  const editor = view("DECLARE v NUMBER; BEGIN v := 1; END;");
  const context = () => ({ parts: [{ kind: "SQL", source: editor.state.doc.toString() }], current: 0, position: 27, self: null, lookup: null });
  expect(await symbolHoverSource(editor, 27, context)).toBeNull();
});

test("la ficha de una variable local cubre su nombre", async () => {
  const doc = "DECLARE v NUMBER := 1; BEGIN v := 2; END;";
  const editor = view(doc);
  const position = doc.indexOf("v :=") ;
  const context = (_view: EditorView, at: number) => ({ parts: [{ kind: "SQL", source: doc }], current: 0, position: at, self: null, lookup: null });
  const card = await symbolHoverSource(editor, position, context);
  expect(card).toMatchObject({ from: position, to: position + 1 });
  expect(card!.items[0]).toMatchObject({ kind: "symbol", symbol: { name: "V", value: "1" } });
});
