import type { EditorView } from "@codemirror/view";
import { redo, redoDepth, selectAll, undo, undoDepth } from "@codemirror/commands";
import { clipboard } from "./api";
import { commands } from "./keymap";
import type { ContextItem } from "./components/ContextMenu";

export interface EditorMenuOptions {
  readOnly: boolean;
  /** Ítems propios de la ventana; van antes de las acciones del editor. */
  extra?: (ContextItem | "sep")[];
}

function selectedText(view: EditorView) {
  const { state } = view;
  return state.selection.ranges.filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to)).join(state.lineBreak);
}

/** Menú contextual base del editor: portapapeles, selección e historial. */
export function editorMenuItems(view: EditorView, { readOnly, extra = [] }: EditorMenuOptions): (ContextItem | "sep")[] {
  const text = selectedText(view);
  const done = () => view.focus();
  const replace = (insert: string, userEvent: string) => {
    if (view.state.readOnly) return;
    view.dispatch(view.state.update(view.state.replaceSelection(insert), { scrollIntoView: true, userEvent }));
  };
  // Cortar solo borra si el texto llegó al portapapeles.
  const cut = () => void clipboard.writeText(text).then(() => replace("", "delete.cut"), () => {}).finally(done);
  const copy = () => void clipboard.writeText(text).catch(() => {}).finally(done);
  const paste = () => void clipboard.readText().then((value) => replace(value, "input.paste"), () => {}).finally(done);
  const history = (command: typeof undo) => () => { command(view); done(); };

  return [
    ...(extra.length ? [...extra, "sep" as const] : []),
    { label: "Cortar", keys: "Ctrl+X", run: readOnly || !text ? undefined : cut },
    { label: "Copiar", keys: "Ctrl+C", run: text ? copy : undefined },
    { label: "Pegar", keys: "Ctrl+V", run: readOnly ? undefined : paste },
    { label: "Seleccionar todo", keys: "Ctrl+A", run: () => { selectAll(view); done(); } },
    "sep",
    { label: commands.undo.label, keys: commands.undo.keys,
      run: readOnly || !undoDepth(view.state) ? undefined : history(undo) },
    { label: commands.redo.label, keys: commands.redo.keys,
      run: readOnly || !redoDepth(view.state) ? undefined : history(redo) },
  ];
}
