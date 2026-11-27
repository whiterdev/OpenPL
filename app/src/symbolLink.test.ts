import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, test } from "vitest";
import { symbolLink } from "./symbolLink";

const click = (init: Partial<MouseEvent>) => ({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...init }) as MouseEvent;

test("Alt+clic agrega un cursor y Ctrl+clic ya no", () => {
  const view = new EditorView({ state: EditorState.create({ doc: "x", extensions: [symbolLink(() => () => {})] }) });
  const adds = view.state.facet(EditorView.clickAddsSelectionRange);
  expect(adds.some((check) => check(click({ altKey: true })))).toBe(true);
  expect(adds.some((check) => check(click({ ctrlKey: true })))).toBe(false);
});
