import { useCallback, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { FloppyDisk, Play, PlayCircle, Stop, Trash } from "@phosphor-icons/react";
import { EditorView } from "@codemirror/view";
import { foldCode, unfoldCode } from "@codemirror/language";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import { startCompletion } from "@codemirror/autocomplete";
import { copyLineDown, deleteLine, indentLess, indentMore, redo, toggleComment, undo } from "@codemirror/commands";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api } from "../api";
import { commands, formatKeys, type CommandId } from "../keymap";
import { describeError, type BindKind, type ExecOutcome, type ProgramPart, type SqlColumn } from "../types";
import { splitScript, statementAt, type ScriptStatement } from "../sqlScript";
import { applySubstitutions, findVariables } from "../sqlBinds";
import type { CompletionCatalog } from "../programCompletion";
import { ProgramEditor, type EditorMarker } from "./ProgramEditor";
import type { ProgramActions } from "./ProgramWindow";
import "./SqlWindow.css";

interface Props {
  sessionId: string;
  initialSql?: string;
  /** Ejecutar `initialSql` al abrir (Consultar datos). */
  runOnOpen?: boolean;
  onTransaction: (open: boolean) => void;
  onDirty: (dirty: boolean) => void;
  completion?: CompletionCatalog | null;
  ref?: Ref<ProgramActions>;
}

interface Grid {
  cursor: number;
  columns: SqlColumn[];
  rows: (string | null)[][];
  more: boolean;
  elapsed: number;
}

interface OutputLine {
  id: number;
  kind: "info" | "output" | "error" | "skip";
  text: string;
}

interface HistoryEntry {
  id: number;
  sql: string;
  ok: boolean;
}

type Tab = "results" | "output" | "history";
const ROW = 24;
// Con pocas filas se dibujan todas; desde aquí se virtualiza.
const VIRTUALIZE_ABOVE = 300;
const FETCH_ALL = 1000;
const CANCELLED = "ORA-01013";
const KINDS: { id: BindKind; label: string }[] = [
  { id: "Text", label: "Texto" }, { id: "Number", label: "Número" }, { id: "Date", label: "Fecha" },
];

const columnWidth = (column: SqlColumn, rows: (string | null)[][], index: number) => {
  let longest = column.name.length;
  for (const row of rows.slice(0, 100)) longest = Math.max(longest, (row[index] ?? "NULL").length);
  return Math.min(360, Math.max(64, longest * 7.5 + 20));
};

export function SqlWindow({ sessionId, initialSql = "", runOnOpen, onTransaction, onDirty, completion, ref }: Props) {
  const part = useMemo<ProgramPart>(() => ({ kind: "SQL", source: initialSql, diagnostics: [], last_ddl_time: null }),
    // La parte inicial es fija: el editor conserva su propio texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
  const view = useRef<EditorView | null>(null);
  const [source, setSource] = useState(initialSql);
  const [cursor, setCursor] = useState(0);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<Tab>("results");
  const [grid, setGrid] = useState<Grid | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [markers, setMarkers] = useState<EditorMarker[]>([]);
  const [alert, setAlert] = useState("");
  const [values, setValues] = useState<Record<string, { value: string; kind: BindKind }>>({});
  const [fetching, setFetching] = useState(false);
  const [editorHeight, setEditorHeight] = useState(220);
  const lineId = useRef(0);
  const fetchingRef = useRef(false);
  const saved = useRef(initialSql);
  const fileName = useRef<string | null>(null);
  const started = useRef(false);

  const statements = useMemo(() => splitScript(source), [source]);
  const current = statementAt(statements, cursor);
  const variables = useMemo(() => findVariables(current?.text ?? ""), [current?.text]);

  const log = useCallback((kind: OutputLine["kind"], text: string) => {
    setOutput((lines) => [...lines, { id: ++lineId.current, kind, text }]);
  }, []);

  function targets(): { list: ScriptStatement[]; script: boolean } {
    const editor = view.current;
    const doc = editor?.state.doc.toString() ?? source;
    const range = editor?.state.selection.main;
    if (range && !range.empty) {
      const base = range.from;
      return {
        list: splitScript(doc.slice(range.from, range.to)).map((s) => ({ ...s, from: s.from + base, to: s.to + base })),
        script: true,
      };
    }
    const one = statementAt(splitScript(doc), range?.head ?? cursor);
    return { list: one ? [one] : [], script: false };
  }

  async function run(list: ScriptStatement[]) {
    if (running || !list.length) return;
    setAlert("");
    setMarkers([]);
    for (const statement of list) {
      for (const variable of findVariables(statement.text)) {
        if (variable.kind === "subst" && !values[variable.key]?.value) {
          setAlert(`Falta el valor de &${variable.name}`);
          return;
        }
      }
    }
    setRunning(true);
    let lastQuery = false;
    try {
      for (const statement of list) {
        if (statement.kind === "sqlplus") {
          log("skip", `Omitido (SQL*Plus): ${statement.text}`);
          continue;
        }
        const vars = findVariables(statement.text);
        const substitutions = Object.fromEntries(
          vars.filter((v) => v.kind === "subst").map((v) => [v.key, values[v.key]?.value ?? ""]),
        );
        const sql = applySubstitutions(statement.text, substitutions);
        const binds = vars.filter((v) => v.kind === "bind").map((v) => ({
          name: v.name, value: values[v.key]?.value || null, kind: values[v.key]?.kind ?? ("Text" as BindKind),
        }));
        let outcome: ExecOutcome;
        try {
          outcome = await api.sqlExecute(sessionId, sql, binds);
        } catch (error) {
          const detail = describeError(error);
          setHistory((h) => [{ id: ++lineId.current, sql: statement.text, ok: false }, ...h]);
          if (detail.code === CANCELLED) {
            log("info", "Ejecución cancelada");
          } else {
            log("error", detail.message.startsWith(detail.code ?? "\u0000") || !detail.code
              ? detail.message : `${detail.code} ${detail.message}`);
            const at = statement.from + (detail.offset ?? 0);
            setMarkers([{ from: at, to: at + 1, message: detail.message }]);
          }
          setTab("output");
          return;
        }
        setHistory((h) => [{ id: ++lineId.current, sql: statement.text, ok: true }, ...h]);
        outcome.output.forEach((line) => log("output", line));
        onTransaction(outcome.transaction);
        if (outcome.result.kind === "Query") {
          const { cursor: id, columns, page } = outcome.result;
          setGrid({ cursor: id, columns, rows: page.rows, more: page.more, elapsed: outcome.elapsed_ms });
          setSummary(null);
          lastQuery = true;
        } else {
          log("info", outcome.result.message);
          setSummary(`${outcome.result.message} · ${outcome.elapsed_ms} ms`);
          lastQuery = false;
        }
      }
      setTab(lastQuery ? "results" : "output");
    } finally {
      setRunning(false);
    }
  }

  async function fetchMore(all = false) {
    if (!grid || !grid.more || fetchingRef.current) return;
    fetchingRef.current = true;
    setFetching(true);
    let state = grid;
    try {
      do {
        const page = await api.sqlFetch(sessionId, state.cursor, all ? FETCH_ALL : undefined);
        state = { ...state, rows: [...state.rows, ...page.rows], more: page.more };
        setGrid(state);
      } while (all && state.more);
    } catch (error) {
      log("error", describeError(error).message);
      setTab("output");
    } finally {
      fetchingRef.current = false;
      setFetching(false);
    }
  }

  async function transaction(action: "commit" | "rollback") {
    try {
      const open = action === "commit" ? await api.sqlCommit(sessionId) : await api.sqlRollback(sessionId);
      onTransaction(open);
      log("info", action === "commit" ? "Commit hecho" : "Rollback hecho");
    } catch (error) {
      log("error", describeError(error).message);
      setTab("output");
    }
  }

  async function save() {
    const text = view.current?.state.doc.toString() ?? source;
    try {
      const name = await api.saveProgramFile(text, "sql", fileName.current);
      if (name) {
        fileName.current = name;
        saved.current = text;
        onDirty(false);
      }
    } catch (error) {
      setAlert(describeError(error).message);
    }
  }

  const inEditor = (action: (editor: EditorView) => unknown) => () => {
    if (view.current) action(view.current);
  };

  const actions: ProgramActions = {
    execute: () => void run(targets().list),
    executeScript: () => void run(splitScript(view.current?.state.doc.toString() ?? source)),
    cancel: running ? () => void api.sqlCancel(sessionId) : undefined,
    commit: () => void transaction("commit"),
    rollback: () => void transaction("rollback"),
    save: () => void save(),
    complete: inEditor(startCompletion),
    foldBlock: inEditor(foldCode),
    unfoldBlock: inEditor(unfoldCode),
    goToLine: inEditor(gotoLine),
    find: inEditor(openSearchPanel),
    replace: inEditor(openSearchPanel),
    comment: inEditor(toggleComment),
    duplicateLine: inEditor(copyLineDown),
    deleteLine: inEditor(deleteLine),
    undo: inEditor(undo),
    redo: inEditor(redo),
    indent: inEditor(indentMore),
    outdent: inEditor(indentLess),
  };
  useImperativeHandle(ref, () => actions);
  const key = (id: CommandId) => formatKeys(commands[id].keys!);

  const onView = useCallback((editor: EditorView | null) => {
    view.current = editor;
    if (editor && runOnOpen && !started.current) {
      started.current = true;
      queueMicrotask(() => void run(splitScript(editor.state.doc.toString())));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowCount = grid?.rows.length ?? 0;
  const footer = running ? null
    : grid && tab === "results"
      ? `${rowCount === 1 ? "1 fila" : `${rowCount} filas`} · ${grid.elapsed} ms${grid.more ? " · hay más" : ""}`
      : summary;

  return (
    <section className="sql-window" aria-label="Ventana SQL">
      <div className="program-toolbar">
        <button className="btn primary" onClick={actions.execute} disabled={running}>
          <Play size={14} aria-hidden /> Ejecutar <span className="kbd">{key("execute")}</span>
        </button>
        <button className="btn" onClick={actions.executeScript} disabled={running}>
          <PlayCircle size={14} aria-hidden /> Ejecutar script <span className="kbd">{key("executeScript")}</span>
        </button>
        <button className="ib" aria-label={`Cancelar ejecución (${key("cancel")})`} title={`Cancelar ejecución  ${key("cancel")}`}
          disabled={!running} onClick={actions.cancel}>
          <Stop size={16} aria-hidden />
        </button>
        <button className="ib" aria-label={`Guardar (${key("save")})`} title={`Guardar  ${key("save")}`} onClick={actions.save}>
          <FloppyDisk size={16} aria-hidden />
        </button>
        {running && <span role="status" className="program-muted">Ejecutando…</span>}
        {alert && <span role="alert" className="sql-alert">{alert}</span>}
      </div>
      <div className="sql-top" style={{ height: editorHeight }}>
        <div className="sql-editor">
          <ProgramEditor part={part} label="SQL" readOnly={false} completion={completion} markers={markers}
            activate={() => {}}
            onView={onView}
            onSelection={setCursor}
            onChange={(value) => {
              setSource(value);
              setMarkers([]);
              onDirty(value !== saved.current);
            }} />
        </div>
        {variables.length > 0 && (
          <aside className="sql-variables" aria-label="Variables">
            <div>Variables</div>
            {variables.map((v) => {
              const label = `${v.kind === "bind" ? ":" : "&"}${v.name}`;
              const entry = values[v.key] ?? { value: "", kind: "Text" as BindKind };
              const update = (change: Partial<typeof entry>) =>
                setValues((all) => ({ ...all, [v.key]: { ...entry, ...change } }));
              return (
                <div key={`${v.kind}-${v.key}`} className="sql-variable">
                  <label>
                    <span className="mono">{label}</span>
                    <input className="fld mono" aria-label={`Valor de ${label}`} value={entry.value}
                      placeholder={v.kind === "bind" ? "NULL" : ""}
                      onChange={(e) => update({ value: e.target.value })} />
                  </label>
                  {v.kind === "bind" && (
                    <select className="fld" aria-label={`Tipo de ${label}`} value={entry.kind}
                      onChange={(e) => update({ kind: e.target.value as BindKind })}>
                      {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                    </select>
                  )}
                </div>
              );
            })}
          </aside>
        )}
      </div>
      <div role="separator" aria-orientation="horizontal" aria-label="Alto del editor" tabIndex={0}
        className="sql-resizer" aria-valuemin={80} aria-valuemax={800} aria-valuenow={editorHeight}
        onKeyDown={(event) => {
          const next = { ArrowUp: editorHeight - 24, ArrowDown: editorHeight + 24 }[event.key];
          if (next === undefined) return;
          event.preventDefault();
          setEditorHeight(Math.min(800, Math.max(80, next)));
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          const startY = event.clientY;
          const startHeight = editorHeight;
          document.body.classList.add("resizing-rows");
          const move = (e: PointerEvent) => setEditorHeight(Math.min(800, Math.max(80, startHeight + e.clientY - startY)));
          const stop = () => {
            document.body.classList.remove("resizing-rows");
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", stop);
        }} />
      <div className="sql-results">
        <div className="sql-tabs">
          <div role="tablist" aria-label="Resultado" onKeyDown={(event) => {
            const order: Tab[] = ["results", "output", "history"];
            const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
            if (!step) return;
            const next = order[(order.indexOf(tab) + step + order.length) % order.length];
            setTab(next);
            document.getElementById(`sql-tab-${next}`)?.focus();
          }}>
            {([["results", "Resultados"], ["output", "Salida"], ["history", "Historial"]] as const).map(([id, label]) => (
              <button key={id} role="tab" id={`sql-tab-${id}`} aria-selected={tab === id} aria-controls={`sql-panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}>
                {label}
                {id === "output" && output.length > 0 && <span className="sql-count">{output.length}</span>}
                {id === "history" && history.length > 0 && <span className="sql-count">{history.length}</span>}
              </button>
            ))}
          </div>
          {tab === "results" && grid?.more && (
            <button className="btn" disabled={fetching} onClick={() => void fetchMore(true)}>Traer todas</button>
          )}
          {tab === "output" && output.length > 0 && (
            <button className="ib" aria-label="Limpiar salida" title="Limpiar salida" onClick={() => setOutput([])}>
              <Trash size={15} aria-hidden />
            </button>
          )}
        </div>
        <div role="tabpanel" id="sql-panel-results" aria-label="Resultados" hidden={tab !== "results"} className="sql-panel">
          {running && !grid ? null
            : !grid ? <p className="sql-empty">Sin resultados. Ejecuta con F8.</p>
              : <ResultGrid grid={grid} onNearEnd={() => void fetchMore()} />}
        </div>
        <div role="tabpanel" id="sql-panel-output" aria-label="Salida" hidden={tab !== "output"} className="sql-panel sql-output">
          {output.length === 0 ? <p className="sql-empty">Sin salida. DBMS_OUTPUT y los mensajes aparecen aquí.</p>
            : output.map((line) => <div key={line.id} className={`sql-line sql-line-${line.kind}`}>{line.text}</div>)}
        </div>
        <div role="tabpanel" id="sql-panel-history" aria-label="Historial" hidden={tab !== "history"} className="sql-panel sql-history">
          {history.length === 0 ? <p className="sql-empty">Sin sentencias ejecutadas.</p>
            : history.map((entry) => (
              <button key={entry.id} type="button" title="Poner en el editor" className={entry.ok ? "" : "sql-history-error"}
                onClick={() => {
                  const editor = view.current;
                  if (!editor) return;
                  const end = editor.state.doc.length;
                  const insert = `${end ? "\n\n" : ""}${entry.sql}`;
                  editor.dispatch({ changes: { from: end, insert }, selection: { anchor: end + insert.length - entry.sql.length, head: end + insert.length } });
                  editor.focus();
                }}>
                {entry.sql}
              </button>
            ))}
        </div>
        {footer && <div className="sql-footer">{footer}</div>}
      </div>
    </section>
  );
}

function ResultGrid({ grid, onNearEnd }: { grid: Grid; onNearEnd: () => void }) {
  const scroll = useRef<HTMLDivElement>(null);
  const widths = useMemo(() => grid.columns.map((c, i) => columnWidth(c, grid.rows, i)),
    // Los anchos se calculan con la primera página para que no salten al traer más.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid.columns, grid.cursor]);
  const template = `56px ${widths.map((w) => `${w}px`).join(" ")}`;
  const virtualized = grid.rows.length > VIRTUALIZE_ABOVE;
  const virtual = useVirtualizer({
    count: virtualized ? grid.rows.length : 0,
    getScrollElement: () => scroll.current,
    estimateSize: () => ROW,
    overscan: 20,
    initialRect: { width: 800, height: 400 },
  });
  const items = virtualized
    ? virtual.getVirtualItems()
    : grid.rows.map((_, index) => ({ index, start: index * ROW }));

  if (!grid.rows.length) return <p className="sql-empty">La consulta no devolvió filas</p>;
  return (
    <div className="sql-grid-scroll" ref={scroll} tabIndex={0} onScroll={(event) => {
      const box = event.currentTarget;
      if (grid.more && box.scrollTop + box.clientHeight >= box.scrollHeight - ROW * 20) onNearEnd();
    }}>
      <div role="grid" aria-label="Resultados" aria-rowcount={grid.rows.length + 1} className="sql-grid"
        style={{ width: 56 + widths.reduce((a, b) => a + b, 0) }}>
        <div role="row" className="sql-row sql-head" style={{ gridTemplateColumns: template }}>
          <div role="columnheader" aria-label="Fila" className="sql-cell sql-rownum" />
          {grid.columns.map((c) => (
            <div key={c.name} role="columnheader" className={`sql-cell${c.numeric ? " num" : ""}`} title={c.type_name}>{c.name}</div>
          ))}
        </div>
        <div style={{ height: grid.rows.length * ROW, position: "relative" }}>
          {items.map((item) => (
            <div key={item.index} role="row" aria-rowindex={item.index + 2} className="sql-row"
              style={{ gridTemplateColumns: template, transform: `translateY(${item.start}px)` }}>
              <div role="rowheader" className="sql-cell sql-rownum">{item.index + 1}</div>
              {grid.rows[item.index].map((value, i) => (
                <div key={i} role="gridcell" className={`sql-cell${grid.columns[i]?.numeric ? " num" : ""}`}>
                  {value === null ? <span className="sql-null">NULL</span> : value}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
