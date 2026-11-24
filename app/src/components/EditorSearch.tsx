import type { KeyboardEvent, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ArrowDown, ArrowUp, Asterisk, CaretDown, CaretRight, TextAa, TextAUnderline, X } from "@phosphor-icons/react";
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import type { Command, EditorView, Panel, ViewUpdate } from "@codemirror/view";
import {
  closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, search,
  SearchQuery, setSearchQuery,
} from "@codemirror/search";
import "./EditorSearch.css";

const MAX_COUNT = 9999;

const setReplaceOpen = StateEffect.define<boolean>();

const replaceOpen = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setReplaceOpen)) value = effect.value;
    return value;
  },
});

function openWithReplace(view: EditorView, open: boolean) {
  view.dispatch({ effects: setReplaceOpen.of(open && !view.state.readOnly) });
  return openSearchPanel(view);
}

/** Ctrl+F: abre la barra con la fila Reemplazar cerrada. */
export const openFind: Command = (view) => openWithReplace(view, false);

/** Ctrl+H: abre la barra con la fila Reemplazar visible (salvo en solo lectura). */
export const openReplace: Command = (view) => openWithReplace(view, true);

interface Count {
  total: number;
  current: number;
}

function countMatches(state: EditorState, query: SearchQuery): Count {
  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  for (let step = cursor.next(); !step.done && total < MAX_COUNT; step = cursor.next()) {
    total++;
    if (step.value.from === from && step.value.to === to) current = total;
  }
  // El tope corta la cuenta; si queda algo después, se informa con "+".
  if (total === MAX_COUNT && !cursor.next().done) total = MAX_COUNT + 1;
  return { total, current };
}

function counterText(query: SearchQuery, count: Count | null) {
  if (!query.search) return "";
  if (!query.valid || !count) return "No válida";
  if (count.total === 0) return "Sin resultados";
  const total = count.total > MAX_COUNT ? `${MAX_COUNT}+` : String(count.total);
  if (count.current) return `${count.current} de ${total}`;
  return `${total} ${count.total === 1 ? "resultado" : "resultados"}`;
}

function IconButton(props: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean; expanded?: boolean }) {
  return (
    <button
      type="button" className="editor-search-ib" aria-label={props.label} title={props.label}
      aria-pressed={props.pressed} aria-expanded={props.expanded} onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function SearchBar({ view, state }: { view: EditorView; state: EditorState }) {
  const query = getSearchQuery(state);
  const showReplace = state.field(replaceOpen, false) && !state.readOnly;
  const count = query.valid ? countMatches(state, query) : null;

  const change = (spec: Partial<Pick<SearchQuery, "search" | "replace" | "caseSensitive" | "wholeWord" | "regexp">>) => {
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({
        search: query.search, replace: query.replace, caseSensitive: query.caseSensitive,
        wholeWord: query.wholeWord, regexp: query.regexp, literal: query.literal, ...spec,
      })),
    });
  };

  const close = () => {
    closeSearchPanel(view);
    view.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    (event.shiftKey ? findPrevious : findNext)(view);
  };

  const onReplaceKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    replaceNext(view);
  };

  const status = counterText(query, count);
  const failed = !!query.search && (!query.valid || count?.total === 0);

  return (
    <div className="editor-search-bar" onKeyDown={onKeyDown}>
      <div className="editor-search-row">
        {state.readOnly ? <span className="editor-search-gap" /> : (
          <IconButton
            label="Mostrar reemplazar" expanded={showReplace}
            onClick={() => view.dispatch({ effects: setReplaceOpen.of(!showReplace) })}
          >
            {showReplace ? <CaretDown aria-hidden="true" /> : <CaretRight aria-hidden="true" />}
          </IconButton>
        )}
        <div className="editor-search-field">
          <input
            type="text" aria-label="Buscar" placeholder="Buscar" main-field="true" spellCheck={false}
            value={query.search} onChange={(event) => change({ search: event.target.value })} onKeyDown={onSearchKey}
          />
          <IconButton label="Mayúsculas y minúsculas" pressed={query.caseSensitive}
            onClick={() => change({ caseSensitive: !query.caseSensitive })}>
            <TextAa aria-hidden="true" />
          </IconButton>
          <IconButton label="Palabra completa" pressed={query.wholeWord}
            onClick={() => change({ wholeWord: !query.wholeWord })}>
            <TextAUnderline aria-hidden="true" />
          </IconButton>
          <IconButton label="Expresión regular" pressed={query.regexp}
            onClick={() => change({ regexp: !query.regexp })}>
            <Asterisk aria-hidden="true" />
          </IconButton>
        </div>
        <span role="status" aria-live="polite" className={failed ? "editor-search-count failed" : "editor-search-count"}>
          {status}
        </span>
        <IconButton label="Anterior" onClick={() => findPrevious(view)}><ArrowUp aria-hidden="true" /></IconButton>
        <IconButton label="Siguiente" onClick={() => findNext(view)}><ArrowDown aria-hidden="true" /></IconButton>
        <IconButton label="Cerrar" onClick={close}><X aria-hidden="true" /></IconButton>
      </div>
      {showReplace && (
        <div className="editor-search-row">
          <span className="editor-search-gap" />
          <div className="editor-search-field">
            <input
              type="text" aria-label="Reemplazar con" placeholder="Reemplazar" spellCheck={false}
              value={query.replace} onChange={(event) => change({ replace: event.target.value })} onKeyDown={onReplaceKey}
            />
          </div>
          <button type="button" className="btn editor-search-btn" onClick={() => replaceNext(view)}>Reemplazar</button>
          <button type="button" className="btn editor-search-btn" aria-label="Reemplazar todo" title="Reemplazar todo"
            onClick={() => replaceAll(view)}>
            Todo
          </button>
        </div>
      )}
    </div>
  );
}

function createSearchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "editor-search";
  const root = createRoot(dom);
  const draw = (state: EditorState) => root.render(<SearchBar view={view} state={state} />);
  // Sincrónico: openSearchPanel busca el campo [main-field] apenas se crea el panel.
  flushSync(() => draw(view.state));
  return {
    dom,
    top: true,
    mount() {
      const field = dom.querySelector<HTMLInputElement>("[main-field]");
      field?.focus();
      field?.select();
    },
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.startState.readOnly !== update.state.readOnly
        || getSearchQuery(update.startState) !== getSearchQuery(update.state)
        || update.startState.field(replaceOpen, false) !== update.state.field(replaceOpen, false)) {
        draw(update.state);
      }
    },
    // Diferido: el cierre llega desde un evento de esta misma raíz de React.
    destroy() {
      queueMicrotask(() => root.unmount());
    },
  };
}

/** Búsqueda del editor con la barra flotante propia. */
export function editorSearch(): Extension {
  return [replaceOpen, search({ top: true, createPanel: createSearchPanel })];
}
