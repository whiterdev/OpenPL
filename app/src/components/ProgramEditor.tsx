import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers, rectangularSelection, type KeyBinding,
} from "@codemirror/view";
import { foldGutter, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { search, highlightSelectionMatches } from "@codemirror/search";
import { history, indentLess, indentMore, insertTab } from "@codemirror/commands";
import { linter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { autocompletion } from "@codemirror/autocomplete";
import { sql } from "@codemirror/lang-sql";
import { tags } from "@lezer/highlight";
import type { ProgramPart } from "../types";
import { editorReference, oracleDialect, type EditorReference } from "../editorReference";
import { programFolding } from "../programFolding";
import { catalogCompletion, keywordCompletion, type CompletionCatalog } from "../programCompletion";

export const programSyntax = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--kw)" },
  { tag: tags.typeName, color: "var(--ty)" },
  { tag: tags.string, color: "var(--st)" },
  { tag: tags.number, color: "var(--nu)" },
  { tag: tags.comment, color: "var(--muted)" },
]);

// Devuelven true siempre para que Tab no saque el foco del editor.
export const indentKeys: KeyBinding[] = [{
  key: "Tab",
  run: (view) => {
    const { doc, selection } = view.state;
    const multiline = selection.ranges.some((r) => doc.lineAt(r.from).number !== doc.lineAt(r.to).number);
    if (multiline) indentMore(view);
    else insertTab(view);
    return true;
  },
  shift: (view) => {
    indentLess(view);
    return true;
  },
}];

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
  onObjectContext?: (reference: EditorReference, x: number, y: number) => void;
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
  latest.current = props;
  const { part, label, readOnly } = props;

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      doc: part.source,
      extensions: [
        lineNumbers(), programFolding, foldGutter(), drawSelection(), rectangularSelection(), history(),
        highlightActiveLine(), search(), highlightSelectionMatches(), sql({ dialect: oracleDialect }),
        syntaxHighlighting(programSyntax),
        readOnly ? [] : autocompletion({
          override: [keywordCompletion, catalogCompletion(() => latest.current.completion ?? null)],
          icons: false,
        }),
        readOnly ? [] : keymap.of(indentKeys),
        EditorState.phrases.of({
          Find: "Buscar", next: "siguiente", previous: "anterior", all: "todas",
          Replace: "Reemplazar", replace: "reemplazar", "replace all": "reemplazar todo",
          "match case": "Mayúsculas y minúsculas", regexp: "Expresión regular",
          "by word": "Palabra completa", close: "Cerrar", "current match": "Coincidencia actual",
          "on line": "en la línea", "replaced match on line $": "Coincidencia reemplazada en la línea $",
          "replaced $ matches": "$ coincidencias reemplazadas",
          "Go to line": "Ir a línea", go: "Ir", "Fold line": "Plegar línea", "Unfold line": "Desplegar línea",
          "Folded lines": "Líneas plegadas", "Unfolded lines": "Líneas desplegadas",
          to: "a", "folded code": "Código plegado", unfold: "Desplegar",
        }),
        EditorState.allowMultipleSelections.of(true),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.contentAttributes.of({
          role: "textbox", "aria-label": label, "aria-multiline": "true", "aria-readonly": String(readOnly),
          tabindex: "0",
        }),
        EditorView.domEventHandlers({
          focus: () => { latest.current.activate(); },
          contextmenu: (event, editor) => {
            const open = latest.current.onObjectContext;
            if (!open || !(event.target instanceof Node) || !editor.contentDOM.contains(event.target)) return false;
            const point = editor.posAndSideAtCoords({ x: event.clientX, y: event.clientY });
            const reference = point && editorReference(editor.state, Math.max(0, point.pos + (point.assoc === -1 ? -1 : 0)));
            if (!reference) return false;
            latest.current.activate();
            open(reference, event.clientX, event.clientY);
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
          if (editor.state.doc.toString() !== part.source) return [];
          return part.diagnostics.filter((item) => item.line > 0).map((item) => {
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
  }, [part, label, readOnly]);

  useEffect(() => {
    const editor = viewRef.current;
    if (editor && props.markers) {
      editor.dispatch(setDiagnostics(editor.state, markerDiagnostics(props.markers, editor.state.doc.length)));
    }
  }, [props.markers]);

  return <div className="program-editor" ref={host} />;
}
