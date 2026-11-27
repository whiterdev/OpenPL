import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { editorPath } from "./editorReference";

const setLink = StateEffect.define<{ from: number; to: number } | null>();
const linkMark = Decoration.mark({ class: "cm-symbol-link" });

const linkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setLink)) return effect.value ? Decoration.set(linkMark.range(effect.value.from, effect.value.to)) : Decoration.none;
    }
    return transaction.docChanged ? Decoration.none : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Con Ctrl apretado, subraya el nombre bajo el mouse; Ctrl+clic llama a `navigate`.
 * `navigate` se lee en cada evento; sin él no hay subrayado ni clic.
 */
export function symbolLink(navigate: () => ((position: number) => void) | null | undefined): Extension {
  let mouse: { x: number; y: number } | null = null;
  const refresh = (view: EditorView, ctrl: boolean) => {
    let range: { from: number; to: number } | null = null;
    if (ctrl && mouse && navigate()) {
      const position = view.posAtCoords(mouse);
      const path = position === null ? null : editorPath(view.state, position);
      if (path) range = { from: path.from, to: path.to };
    }
    const current = view.state.field(linkField).iter();
    const same = range ? current.value && current.from === range.from && current.to === range.to : !current.value;
    if (!same) view.dispatch({ effects: setLink.of(range) });
  };
  return [
    linkField,
    // Ctrl+clic navega; agregar un cursor pasa a Alt+clic.
    EditorView.clickAddsSelectionRange.of((event) => event.altKey),
    EditorView.domEventHandlers({
      mousemove(event, view) {
        mouse = { x: event.clientX, y: event.clientY };
        refresh(view, event.ctrlKey || event.metaKey);
        return false;
      },
      mouseleave(_event, view) {
        mouse = null;
        refresh(view, false);
        return false;
      },
      keydown(event, view) {
        if (event.key === "Control" || event.key === "Meta") refresh(view, true);
        return false;
      },
      keyup(event, view) {
        if (event.key === "Control" || event.key === "Meta") refresh(view, false);
        return false;
      },
      mousedown(event, view) {
        const go = navigate();
        if (!go || event.button !== 0 || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false;
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position === null || !editorPath(view.state, position)) return false;
        event.preventDefault();
        refresh(view, false);
        go(position);
        return true;
      },
    }),
  ];
}
