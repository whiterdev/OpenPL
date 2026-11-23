import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, lineNumbers, rectangularSelection } from "@codemirror/view";
import { foldGutter, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { search, highlightSelectionMatches } from "@codemirror/search";
import { history } from "@codemirror/commands";
import { linter } from "@codemirror/lint";
import { sql } from "@codemirror/lang-sql";
import { tags } from "@lezer/highlight";
import type { ProgramPart } from "../types";
import { editorReference, oracleDialect, type EditorReference } from "../editorReference";

const syntax = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--kw)" },
  { tag: tags.typeName, color: "var(--ty)" },
  { tag: tags.string, color: "var(--st)" },
  { tag: tags.number, color: "var(--nu)" },
  { tag: tags.comment, color: "var(--muted)" },
]);

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
}

export function ProgramEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const { part, label, readOnly } = props;

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      doc: part.source,
      extensions: [
        lineNumbers(), foldGutter(), drawSelection(), rectangularSelection(), history(),
        highlightActiveLine(), search(), highlightSelectionMatches(), sql({ dialect: oracleDialect }),
        syntaxHighlighting(syntax),
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
        }),
        linter((editor) => {
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
    return () => {
      latest.current.onView(null);
      view.destroy();
    };
  }, [part, label, readOnly]);

  return <div className="program-editor" ref={host} />;
}
