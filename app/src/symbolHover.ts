import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Facet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, showTooltip, type Command, type Tooltip } from "@codemirror/view";
import { SymbolCard } from "./components/SymbolCard";
import { editorPath } from "./editorReference";
import { resolveSymbol, type Resolved, type ResolveContext } from "./symbolResolve";
import type { SourcePart } from "./symbolSources";
import { ensureSyntaxTree } from "@codemirror/language";

export type ContextFor = (view: EditorView, position: number) => ResolveContext | null;

export interface SymbolCardData {
  from: number;
  to: number;
  items: Resolved[];
}

/** Lo que muestra la ficha en `position`, o null si no hay nada que mostrar. */
export async function symbolHoverSource(
  view: EditorView,
  position: number,
  contextFor: ContextFor | null,
): Promise<SymbolCardData | null> {
  if (!contextFor) return null;
  const path = editorPath(view.state, position);
  if (!path) return null;
  const context = contextFor(view, position);
  if (!context) return null;
  const items = await resolveSymbol(context, path);
  return items.length ? { from: path.from, to: path.to, items } : null;
}

function cardTooltip(card: SymbolCardData): Tooltip {
  return {
    pos: card.from,
    end: card.to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-symbol-tooltip";
      const root = createRoot(dom);
      root.render(createElement(SymbolCard, { items: card.items }));
      return { dom, destroy: () => queueMicrotask(() => root.unmount()) };
    },
  };
}

const contextFacet = Facet.define<() => ContextFor | null, () => ContextFor | null>({
  combine: (values) => values[0] ?? (() => null),
});

const setCard = StateEffect.define<Tooltip | null>();
const manualCard = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setCard)) return effect.value;
    return transaction.docChanged || transaction.selection ? null : value;
  },
  provide: (field) => showTooltip.from(field),
});

/** Ficha al pasar el mouse (400 ms quieto) y la que abre `showSymbolCard`. */
export function symbolHover(contextFor: () => ContextFor | null): Extension {
  return [
    contextFacet.of(contextFor),
    manualCard,
    hoverTooltip(async (view, position) => {
      const card = await symbolHoverSource(view, position, contextFor());
      return card ? cardTooltip(card) : null;
    }, { hoverTime: 400, hideOnChange: true }),
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (event.key !== "Escape" || !view.state.field(manualCard, false)) return false;
        view.dispatch({ effects: setCard.of(null) });
        return true;
      },
    }),
  ];
}

/** Abre la ficha del nombre en el cursor. */
export const showSymbolCard: Command = (view) => {
  const contextFor = view.state.facet(contextFacet)();
  const head = view.state.selection.main.head;
  void symbolHoverSource(view, head, contextFor).then((card) => {
    if (!card || view.state.selection.main.head !== head) return;
    view.dispatch({ effects: setCard.of(cardTooltip(card)) });
  });
  return true;
};

/** Texto de un editor con su árbol de sintaxis, si está listo en 50 ms. */
export function editorPart(kind: string, view: EditorView): SourcePart {
  const tree = ensureSyntaxTree(view.state, view.state.doc.length, 50);
  return tree ? { kind, source: view.state.doc.toString(), tree } : { kind, source: view.state.doc.toString() };
}
