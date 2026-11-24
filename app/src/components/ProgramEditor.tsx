import { useCallback, useEffect, useRef, useState } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, rectangularSelection, type Command, type KeyBinding,
} from "@codemirror/view";
import { foldGutter, HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import {
  deleteCharBackward, deleteCharForward, deleteGroupBackward, deleteGroupForward, deleteLineBoundaryBackward,
  deleteLineBoundaryForward, deleteToLineEnd, history, indentLess, indentMore, insertNewlineAndIndent,
  insertNewlineKeepIndent, splitLine, standardKeymap, transposeChars,
} from "@codemirror/commands";
import { forceLinting, linter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { autocompletion } from "@codemirror/autocomplete";
import { sql } from "@codemirror/lang-sql";
import { tags } from "@lezer/highlight";
import type { ProgramPart } from "../types";
import { editorReference, oracleDialect, type EditorReference } from "../editorReference";
import { programFolding } from "../programFolding";
import { catalogCompletion, keywordCompletion, type CompletionCatalog } from "../programCompletion";
import { editorSearch } from "./EditorSearch";
import { editorMenuItems } from "../editorMenu";
import { ContextMenu, type ContextItem } from "./ContextMenu";

export const programSyntax = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--kw)" },
  { tag: tags.typeName, color: "var(--ty)" },
  { tag: tags.string, color: "var(--st)" },
  { tag: tags.number, color: "var(--nu)" },
  { tag: tags.comment, color: "var(--cm)", fontStyle: "italic" },
]);

const INDENT = "  ";

// Devuelven true siempre para que Tab no saque el foco del editor.
export const indentKeys: KeyBinding[] = [{
  key: "Tab",
  run: (view) => {
    const { doc, selection } = view.state;
    const multiline = selection.ranges.some((r) => doc.lineAt(r.from).number !== doc.lineAt(r.to).number);
    if (multiline) indentMore(view);
    else view.dispatch(view.state.update(view.state.replaceSelection(INDENT), { scrollIntoView: true, userEvent: "input" }));
    return true;
  },
  shift: (view) => {
    indentLess(view);
    return true;
  },
}];

const editingCommands = new Set<Command>([
  insertNewlineAndIndent, deleteCharBackward, deleteCharForward, deleteGroupBackward, deleteGroupForward,
  deleteLineBoundaryBackward, deleteLineBoundaryForward, deleteToLineEnd, splitLine, transposeChars,
]);

// lang-sql calcula sangría 0 en PL/SQL (tras "x := 1;" o un IF al final), así que Enter copia la de la línea.
const enterKeepsIndent: KeyBinding[] = [{ key: "Enter", run: insertNewlineKeepIndent, shift: insertNewlineKeepIndent }];

// Sin los comandos que editan, para que solo lectura no tome Enter, Backspace ni Supr.
const navigationKeymap = standardKeymap.filter((binding) => !binding.run || !editingCommands.has(binding.run));

export function positionAt(view: EditorView, row: number, column: number) {
  const line = view.state.doc.line(Math.max(1, Math.min(row, view.state.doc.lines)));
  return Math.min(line.to, line.from + Math.max(0, column - 1));
}

interface Props {
  part: ProgramPart;
  label: string;
  readOnly: boolean;
  onView: (view: EditorView | null) => void;
  onChange: (value: string) => void;
  activate: () => void;
  onObjectContext?: (reference: EditorReference, x: number, y: number, position: number) => void;
  /** Ítems de la ventana que se suman al menú contextual del editor. */
  menuExtra?: (ContextItem | "sep")[];
  /** Catálogo de la sesión del programa; se lee en cada consulta. */
  completion?: CompletionCatalog | null;
  onSelection?: (head: number) => void;
  /** Marcas con posiciones absolutas; reemplazan a los diagnósticos de la parte. */
  markers?: EditorMarker[];
}

function markerDiagnostics(markers: EditorMarker[], length: number): Diagnostic[] {
  return markers.map((m) => ({
    from: Math.min(m.from, length), to: Math.min(Math.max(m.to, m.from + 1), length),
    severity: "error", message: m.message,
  }));
}

export interface EditorMarker {
  from: number;
  to: number;
  message: string;
}

export function ProgramEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const viewRef = useRef<EditorView | null>(null);
  const editing = useRef(new Compartment()).current;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  latest.current = props;
  const { part, label, readOnly } = props;

  const editingExtensions = useCallback((locked: boolean, editorLabel: string) => [
    EditorState.readOnly.of(locked),
    EditorView.editable.of(!locked),
    EditorView.contentAttributes.of({
      role: "textbox", "aria-label": editorLabel, "aria-multiline": "true", "aria-readonly": String(locked),
      tabindex: "0",
    }),
    locked ? [] : autocompletion({
      override: [keywordCompletion, catalogCompletion(() => latest.current.completion ?? null)],
      icons: false,
      selectOnOpen: false,
    }),
    locked ? [] : keymap.of([...indentKeys, ...enterKeepsIndent]),
    keymap.of(locked ? navigationKeymap : standardKeymap),
  ], []);

  useEffect(() => {
    let keyboardMenu = false;
    const view = new EditorView({
      parent: host.current!,
      doc: latest.current.part.source,
      extensions: [
        lineNumbers(), programFolding, foldGutter(), drawSelection(), rectangularSelection(), history(),
        highlightActiveLine(), editorSearch(), highlightSelectionMatches(), sql({ dialect: oracleDialect }),
        syntaxHighlighting(programSyntax), indentUnit.of(INDENT),
        editing.of(editingExtensions(latest.current.readOnly, label)),
        // Los anuncios de búsqueda para lectores de pantalla siguen saliendo de @codemirror/search.
        EditorState.phrases.of({
          "current match": "Coincidencia actual",
          "on line": "en la línea", "replaced match on line $": "Coincidencia reemplazada en la línea $",
          "replaced $ matches": "$ coincidencias reemplazadas",
          "Go to line": "Ir a línea", go: "Ir", "Fold line": "Plegar línea", "Unfold line": "Desplegar línea",
          "Folded lines": "Líneas plegadas", "Unfolded lines": "Líneas desplegadas",
          to: "a", "folded code": "Código plegado", unfold: "Desplegar",
        }),
        EditorState.allowMultipleSelections.of(true),
        EditorView.domEventHandlers({
          focus: () => { latest.current.activate(); },
          keydown: (event) => {
            keyboardMenu = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
            return false;
          },
          mousedown: () => { keyboardMenu = false; return false; },
          contextmenu: (event, editor) => {
            if (!(event.target instanceof Node) || !editor.contentDOM.contains(event.target)) return false;
            // La tecla Menú y Shift+F10 llegan como contextmenu; Chromium a veces manda coordenadas 0.
            const keyboard = keyboardMenu || (event.clientX === 0 && event.clientY === 0);
            keyboardMenu = false;
            event.preventDefault();
            latest.current.activate();
            const open = latest.current.onObjectContext;
            const point = open && !keyboard ? editor.posAndSideAtCoords({ x: event.clientX, y: event.clientY }) : null;
            if (open && point) {
              const position = Math.max(0, point.pos + (point.assoc === -1 ? -1 : 0));
              const reference = editorReference(editor.state, position);
              if (reference) {
                setMenu(null);
                open(reference, event.clientX, event.clientY, position);
                return true;
              }
            }
            if (keyboard) {
              const coords = editor.coordsAtPos(editor.state.selection.main.head) ?? editor.contentDOM.getBoundingClientRect();
              setMenu({ x: coords.left, y: coords.bottom });
            } else {
              setMenu({ x: event.clientX, y: event.clientY });
            }
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latest.current.onChange(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) latest.current.onSelection?.(update.state.selection.main.head);
        }),
        linter((editor) => {
          const markers = latest.current.markers;
          if (markers) return markerDiagnostics(markers, editor.state.doc.length);
          const { part: current } = latest.current;
          if (editor.state.doc.toString() !== current.source) return [];
          return current.diagnostics.filter((item) => item.line > 0).map((item) => {
            const from = positionAt(editor, item.line, item.column);
            return {
              from, to: Math.min(from + 1, editor.state.doc.length),
              severity: item.warning ? "warning" : "error", message: item.text,
            };
          });
        }, { delay: 0 }),
      ],
    });
    latest.current.onView(view);
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      latest.current.onView(null);
      view.destroy();
    };
  }, [label, editing, editingExtensions]);

  // El texto nuevo lo aplica ProgramWindow con dispatch; aquí solo se recalculan los diagnósticos de la parte.
  useEffect(() => {
    const editor = viewRef.current;
    if (editor && !latest.current.markers) forceLinting(editor);
  }, [part]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.readOnly !== readOnly) {
      view.dispatch({ effects: editing.reconfigure(editingExtensions(readOnly, label)) });
    }
  }, [readOnly, label, editing, editingExtensions]);

  useEffect(() => {
    const editor = viewRef.current;
    if (editor && props.markers) {
      editor.dispatch(setDiagnostics(editor.state, markerDiagnostics(props.markers, editor.state.doc.length)));
    }
  }, [props.markers]);

  const view = viewRef.current;
  return (
    <>
      <div className="program-editor" ref={host} />
      {menu && view && (
        <ContextMenu x={menu.x} y={menu.y} label="Editor" onClose={closeMenu}
          items={editorMenuItems(view, { readOnly, extra: props.menuExtra })} />
      )}
    </>
  );
}
