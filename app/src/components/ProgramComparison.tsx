import { useEffect, useRef } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { sql } from "@codemirror/lang-sql";
import type { ProgramPart } from "../types";
import { oracleDialect } from "../editorReference";
import { programSyntax } from "./ProgramEditor";

export type ComparisonResult =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; current: ProgramPart | null };

interface Props {
  label: string;
  original: ProgramPart;
  local: string;
  result: ComparisonResult;
  onClose: () => void;
}

function SourceDiff({ local, oracle }: { local: string; oracle: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function side(doc: string, label: string) {
      return {
        doc,
        extensions: [
          lineNumbers(), sql({ dialect: oracleDialect }), syntaxHighlighting(programSyntax),
          EditorState.readOnly.of(true), EditorView.editable.of(false),
          EditorView.contentAttributes.of({
            role: "textbox", "aria-label": label, "aria-readonly": "true", tabindex: "0",
          }),
        ],
      };
    }
    const diff = new MergeView({
      a: side(local, "Borrador local"),
      b: side(oracle, "Oracle"),
      parent: host.current!,
    });
    return () => diff.destroy();
  }, [local, oracle]);

  return (
    <div className="program-diff">
      <div className="program-diff-labels" aria-hidden="true"><span>Borrador local</span><span>Oracle</span></div>
      <div className="program-diff-editor" ref={host} />
    </div>
  );
}

export function ProgramComparison({ label, original, local, result, onClose }: Props) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButton.current?.focus(); }, []);
  const current = result.state === "ready" ? result.current : null;
  const source = current?.source ?? "";
  const changed = original.source !== source || original.last_ddl_time !== (current?.last_ddl_time ?? null);

  return (
    <section className="program-comparison" aria-label={`Comparación de ${label}`}>
      <header className="program-toolbar">
        <strong>Comparación de {label}</strong>
        <button ref={closeButton} className="btn" onClick={onClose}>Cerrar comparación</button>
        {result.state === "loading" && <span role="status">Leyendo Oracle…</span>}
        {result.state === "error" && <span role="alert">{result.message}</span>}
        {result.state === "ready" && (
          <span role="status" className="program-comparison-status">
            {changed && <strong>Cambio en Oracle</strong>}
            {!current && <span>Fuente no disponible en Oracle</span>}
            {current && local === source && <span>Sin diferencias de texto</span>}
            {current && local !== source && !changed && <span>Oracle conserva la versión abierta</span>}
          </span>
        )}
      </header>
      {result.state === "ready" && local !== source && <SourceDiff local={local} oracle={source} />}
    </section>
  );
}
