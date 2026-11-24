import { useCallback, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { FloppyDisk, Lock, LockOpen, Minus, Play, Plus, Stop, Trash, Warning } from "@phosphor-icons/react";
import { EditorView } from "@codemirror/view";
import { foldCode, unfoldCode } from "@codemirror/language";
import { gotoLine } from "@codemirror/search";
import { openFind, openReplace } from "./EditorSearch";
import { startCompletion } from "@codemirror/autocomplete";
import { copyLineDown, deleteLine, indentLess, indentMore, redo, toggleComment, undo } from "@codemirror/commands";
import { api } from "../api";
import { commands, formatKeys, type CommandId } from "../keymap";
import {
  describeError, type BindKind, type BindValue, type Conflict, type EditTarget, type Environment, type ExecOutcome,
  type ProgramPart, type SqlColumn,
} from "../types";
import { editableQuery, ROWID_COLUMN } from "../sqlEdit";
import { appliedRows, buildChanges, emptyPending, pendingCount, type Cell, type Pending } from "../gridEdits";
import { ResultGrid, type CellPosition, type RowStatus } from "./ResultGrid";
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
  /** Además, abrir la grilla en edición (Editar datos). */
  editOnOpen?: boolean;
  environment?: Environment;
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
  /** La columna 0 es el ROWID agregado para editar; no se muestra. */
  hiddenRowid: boolean;
}

interface EditSession {
  target: EditTarget;
  /** Columna de la tabla para cada columna visible, o null si no se edita. */
  names: (string | null)[];
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
const FETCH_ALL = 1000;
const CANCELLED = "ORA-01013";
const KINDS: { id: BindKind; label: string }[] = [
  { id: "Text", label: "Texto" }, { id: "Number", label: "Número" }, { id: "Date", label: "Fecha" },
];

const REASONS: Record<Conflict["reason"], string> = {
  Changed: "cambió en Oracle", Locked: "bloqueada por otra sesión", Missing: "ya no existe",
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function SqlWindow({
  sessionId, initialSql = "", runOnOpen, editOnOpen, environment, onTransaction, onDirty, completion, ref,
}: Props) {
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
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [editorHeight, setEditorHeight] = useState(220);
  const lineId = useRef(0);
  const fetchingRef = useRef(false);
  const gridScroll = useRef<HTMLDivElement>(null);
  const stopFetchRef = useRef(false);
  const saved = useRef(initialSql);
  const fileName = useRef<string | null>(null);
  const started = useRef(false);
  const lastQueryRef = useRef<{ sql: string; binds: BindValue[] } | null>(null);
  const [editSession, setEditSession] = useState<EditSession | null>(null);
  const [pending, setPending] = useState<Pending>(emptyPending);
  const [selected, setSelected] = useState<CellPosition | null>(null);
  const [conflicts, setConflicts] = useState<{ list: Conflict[]; rowsOf: number[] } | null>(null);
  const [applying, setApplying] = useState(false);

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
    if (running || applying || fetchingRef.current || !list.length) return;
    setAlert("");
    setNotice("");
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
    setEditSession(null);
    setPending(emptyPending());
    setConflicts(null);
    setSelected(null);
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
          setFetchError(null);
          setGrid((current) => current?.more ? { ...current, more: false } : current);
          outcome = await api.sqlExecute(sessionId, sql, binds);
          if (outcome.result.kind === "Query") lastQueryRef.current = { sql, binds };
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
          setGrid({ cursor: id, columns, rows: page.rows, more: page.more, elapsed: outcome.elapsed_ms, hiddenRowid: false });
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

  async function fetchAll() {
    if (tab !== "results" || !grid?.more || running || applying || fetchingRef.current) return;
    fetchingRef.current = true;
    stopFetchRef.current = false;
    setFetching(true);
    setSelected(null);
    setNotice("");
    const cursor = grid.cursor;
    let received = grid.rows.length;
    const stopped = () => {
      setGrid((current) => current?.cursor === cursor ? { ...current, more: false } : current);
      setNotice(`Traer todas detenido. ${received === 1 ? "Se conserva 1 fila" : `Se conservan ${received} filas`}.`);
    };
    try {
      let more: boolean;
      do {
        const page = await api.sqlFetch(sessionId, cursor, FETCH_ALL);
        received += page.rows.length;
        setGrid((current) => current?.cursor === cursor
          ? { ...current, rows: [...current.rows, ...page.rows], more: page.more }
          : current);
        more = page.more;
      } while (more && !stopFetchRef.current);
      if (more) stopped();
    } catch (error) {
      const detail = describeError(error);
      if (detail.code === CANCELLED) {
        stopped();
        return;
      }
      const message = detail.code && !detail.message.startsWith(detail.code)
        ? `${detail.code} ${detail.message}` : detail.message;
      setGrid((current) => current?.cursor === cursor ? { ...current, more: false } : current);
      setFetchError(`${message} · Reejecuta con F8`);
      log("error", message);
    } finally {
      fetchingRef.current = false;
      setFetching(false);
    }
  }

  async function transaction(action: "commit" | "rollback") {
    if (fetchingRef.current) return;
    try {
      const open = action === "commit" ? await api.sqlCommit(sessionId) : await api.sqlRollback(sessionId);
      if (action === "rollback") setGrid((current) => current?.more ? { ...current, more: false } : current);
      onTransaction(open);
      log("info", action === "commit" ? "Commit hecho" : "Rollback hecho");
    } catch (error) {
      log("error", describeError(error).message);
      setTab("output");
    }
  }

  async function toggleEdit() {
    if (running || applying || fetchingRef.current) return;
    if (editSession) {
      const count = pendingCount(pending);
      if (count && !window.confirm(`¿Descartar ${plural(count, "cambio pendiente", "cambios pendientes")}?`)) return;
      setEditSession(null);
      setPending(emptyPending());
      setConflicts(null);
      return;
    }
    const query = lastQueryRef.current;
    if (!query) {
      setAlert("Ejecuta una consulta para editar sus filas");
      return;
    }
    const editable = editableQuery(query.sql);
    if (!editable) {
      setAlert("Solo se edita una consulta sobre una tabla, sin joins ni agrupaciones");
      return;
    }
    setAlert("");
    setRunning(true);
    try {
      const target = await api.sqlEditTarget(sessionId, editable.table.owner, editable.table.name);
      if (!target) {
        setAlert("Solo se editan tablas");
        return;
      }
      const outcome = await api.sqlExecute(sessionId, editable.sql, query.binds);
      if (outcome.result.kind !== "Query") return;
      const { cursor: id, columns, page } = outcome.result;
      const visible = columns.slice(1);
      setGrid({ cursor: id, columns, rows: page.rows, more: page.more, elapsed: outcome.elapsed_ms, hiddenRowid: columns[0]?.name === ROWID_COLUMN });
      setFetchError(null);
      setEditSession({
        target,
        names: visible.map((c) => target.columns.find((t) => t.name === c.name && t.editable)?.name ?? null),
      });
      setPending(emptyPending());
      setSelected({ row: 0, col: 0 });
      setTab("results");
    } catch (error) {
      const detail = describeError(error);
      log("error", detail.code && !detail.message.startsWith(detail.code) ? `${detail.code} ${detail.message}` : detail.message);
      setTab("output");
    } finally {
      setRunning(false);
    }
  }

  function editCell({ row, col }: CellPosition, value: Cell) {
    if (!grid) return;
    setConflicts(null);
    setPending((p) => {
      if (row >= grid.rows.length) {
        const inserts = p.inserts.map((cells, i) => i === row - grid.rows.length
          ? cells.map((cell, c) => (c === col ? value : cell)) : cells);
        return { ...p, inserts };
      }
      const current = p.edits[row];
      if (current?.kind === "delete") return p;
      const values = { ...(current?.values ?? {}) };
      if (grid.rows[row][col + 1] === value) delete values[col];
      else values[col] = value;
      const edits = { ...p.edits };
      if (Object.keys(values).length) edits[row] = { kind: "update", values };
      else delete edits[row];
      return { ...p, edits };
    });
  }

  function addRow() {
    if (!grid || !editSession) return;
    const width = grid.columns.length - 1;
    setPending((p) => ({ ...p, inserts: [...p.inserts, Array<Cell>(width).fill(null)] }));
    const firstEditable = Math.max(0, editSession.names.findIndex(Boolean));
    setSelected({ row: grid.rows.length + pending.inserts.length, col: firstEditable });
  }

  function deleteRow() {
    if (!grid || !editSession || !selected || applying || fetchingRef.current) return;
    if (selected.scope === "all") {
      setConflicts(null);
      setPending((p) => {
        const restore = !p.inserts.length && grid.rows.every((_, row) => p.edits[row]?.kind === "delete");
        return {
          edits: restore ? {} : Object.fromEntries(grid.rows.map((_, row) => [row, { kind: "delete" }])),
          inserts: [],
        };
      });
      setSelected({ row: Math.min(selected.row, Math.max(0, grid.rows.length - 1)), col: selected.col, scope: "all" });
      return;
    }
    const row = selected.row;
    setConflicts(null);
    setPending((p) => {
      if (row >= grid.rows.length) {
        return { ...p, inserts: p.inserts.filter((_, i) => i !== row - grid.rows.length) };
      }
      const edits = { ...p.edits };
      if (edits[row]?.kind === "delete") delete edits[row];
      else edits[row] = { kind: "delete" };
      return { ...p, edits };
    });
    if (row >= grid.rows.length && row === grid.rows.length + pending.inserts.length - 1) {
      setSelected(row > 0 ? { row: row - 1, col: selected.col } : null);
    }
  }

  async function applyChanges(rows = grid?.rows) {
    if (!grid || !rows || !editSession || applying || fetchingRef.current) return;
    const { changes, rowsOf } = buildChanges(rows, editSession.names, pending);
    if (!changes.length) return;
    setApplying(true);
    try {
      const result = await api.sqlApply(sessionId, editSession.target, changes);
      if (result.kind === "Conflicts") {
        setGrid({ ...grid, rows });
        setConflicts({ list: result.conflicts, rowsOf });
        return;
      }
      setGrid({ ...grid, rows: appliedRows(rows, pending, result.inserted) });
      setPending(emptyPending());
      setConflicts(null);
      setSelected(null);
      onTransaction(result.transaction);
      const parts = [
        result.updated && plural(result.updated, "fila actualizada", "filas actualizadas"),
        result.deleted && plural(result.deleted, "fila borrada", "filas borradas"),
        result.inserted.length && plural(result.inserted.length, "fila insertada", "filas insertadas"),
      ].filter(Boolean);
      log("info", `Cambios aplicados: ${parts.join(", ")}`);
    } catch (error) {
      const detail = describeError(error);
      log("error", detail.code && !detail.message.startsWith(detail.code) ? `${detail.code} ${detail.message}` : detail.message);
      setAlert("No se aplicó ningún cambio");
    } finally {
      setApplying(false);
    }
  }

  function retryConflicts() {
    if (!grid || !conflicts || !editSession) return;
    const rows = grid.rows.map((row) => [...row]);
    for (const conflict of conflicts.list) {
      const row = conflicts.rowsOf[conflict.index];
      if (!conflict.current || row >= rows.length) continue;
      editSession.names.forEach((name, col) => {
        if (name && name in conflict.current!) rows[row][col + 1] = conflict.current![name];
      });
    }
    setConflicts(null);
    void applyChanges(rows);
  }

  function discardConflicts() {
    if (!conflicts) return;
    const rows = new Set(conflicts.list.map((c) => conflicts.rowsOf[c.index]));
    setPending((p) => ({ ...p, edits: Object.fromEntries(Object.entries(p.edits).filter(([row]) => !rows.has(Number(row)))) }));
    setConflicts(null);
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
    fetchAllRows: grid?.more && !fetching && !running && !applying ? () => void fetchAll() : undefined,
    // Durante applying no se ofrece: cortar un guardado a medias deja la tabla en un estado incierto.
    cancel: running || fetching ? () => {
      if (fetchingRef.current) stopFetchRef.current = true;
      void api.sqlCancel(sessionId);
    } : undefined,
    editData: grid ? () => void toggleEdit() : undefined,
    applyChanges: editSession && pendingCount(pending) ? () => void applyChanges() : undefined,
    commit: () => void transaction("commit"),
    rollback: () => void transaction("rollback"),
    save: () => void save(),
    complete: inEditor(startCompletion),
    foldBlock: inEditor(foldCode),
    unfoldBlock: inEditor(unfoldCode),
    goToLine: inEditor(gotoLine),
    find: inEditor(openFind),
    replace: inEditor(openReplace),
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
      queueMicrotask(async () => {
        await run(splitScript(editor.state.doc.toString()));
        if (editOnOpen) await toggleEdit();
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const offset = grid?.hiddenRowid ? 1 : 0;
  const visibleColumns: SqlColumn[] = grid ? grid.columns.slice(offset) : [];
  const displayRows: Cell[][] = grid ? [
    ...grid.rows.map((row, index) => {
      const cells = row.slice(offset);
      const edit = pending.edits[index];
      return edit?.kind === "update" ? cells.map((cell, c) => (c in edit.values ? edit.values[c] : cell)) : cells;
    }),
    ...pending.inserts,
  ] : [];
  const conflictRows = new Set(conflicts?.list.map((c) => conflicts.rowsOf[c.index]) ?? []);
  const status: (RowStatus | null)[] = displayRows.map((_, row) => {
    if (conflictRows.has(row)) return "conflict";
    if (grid && row >= grid.rows.length) return "insert";
    const edit = pending.edits[row];
    return edit ? (edit.kind === "delete" ? "delete" : "update") : null;
  });
  const isModified = (row: number, col: number) => {
    const edit = pending.edits[row];
    return edit?.kind === "update" && col in edit.values;
  };
  const count = pendingCount(pending);
  const rowCount = grid?.rows.length ?? 0;
  const footer = running ? null
    : grid && tab === "results"
      ? `${rowCount === 1 ? "1 fila" : `${rowCount} filas`} · ${grid.elapsed} ms${grid.more ? " · hay más" : ""}`
      : summary;

  return (
    <section className="sql-window" aria-label="Ventana SQL">
      <div className="program-toolbar">
        <button className="btn primary" onClick={actions.execute} disabled={running || fetching || applying}>
          <Play size={14} aria-hidden /> Ejecutar <span className="kbd">{key("execute")}</span>
        </button>
        <button className={`btn sql-stop${actions.cancel ? " active" : ""}`}
          disabled={!actions.cancel} onClick={actions.cancel}>
          <Stop size={14} aria-hidden /> Detener <span className="kbd">{key("cancel")}</span>
        </button>
        <button className="ib" aria-label={`Guardar (${key("save")})`} title={`Guardar  ${key("save")}`} onClick={actions.save}>
          <FloppyDisk size={16} aria-hidden />
        </button>
        {running && <span role="status" className="program-muted">Ejecutando…</span>}
        {!running && notice && <span role="status" className="program-muted">{notice}</span>}
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
          {tab === "results" && (grid?.more || fetching) && (
            <button className="btn sql-fetch-all" disabled={!actions.fetchAllRows} onClick={() => {
              gridScroll.current?.focus();
              actions.fetchAllRows?.();
            }}>
              {commands.fetchAllRows.label} <span className="kbd">{key("fetchAllRows")}</span>
            </button>
          )}
          {tab === "results" && grid && (
            <button className="btn" aria-pressed={!!editSession} onClick={actions.editData} disabled={running || fetching || applying}>
              {editSession ? <LockOpen size={14} aria-hidden /> : <Lock size={14} aria-hidden />}
              {editSession ? "Editando" : "Editar"} <span className="kbd">{key("editData")}</span>
            </button>
          )}
          {tab === "results" && editSession && (
            <>
              <button className="ib" aria-label="Agregar fila" title="Agregar fila vacía" onClick={addRow} disabled={fetching || applying}>
                <Plus size={15} aria-hidden />
              </button>
              <button className="ib" aria-label={selected?.scope === "all" ? "Borrar selección" : "Borrar fila"}
                title={selected?.scope === "all" ? "Borrar selección (o recuperarla)" : "Borrar fila (o recuperarla)"}
                onClick={deleteRow} disabled={!selected || fetching || applying}>
                <Minus size={15} aria-hidden />
              </button>
              {count > 0 && <span className="program-muted">{plural(count, "pendiente", "pendientes")}</span>}
              <button className="btn" disabled={!count || applying} onClick={() => {
                setPending(emptyPending());
                setConflicts(null);
              }}>Descartar</button>
              <button className="btn primary" disabled={!count || applying || fetching} onClick={actions.applyChanges}>
                Aplicar cambios <span className="kbd">{key("applyChanges")}</span>
              </button>
            </>
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
              : (
                <>
                  {editSession && environment === "prod" && (
                    <div role="note" className="sql-prod"><Warning size={14} aria-hidden /> Editando datos de producción</div>
                  )}
                  {conflicts && (
                    <section role="region" aria-label="Conflictos" className="sql-conflicts">
                      {conflicts.list.map((conflict) => {
                        const row = conflicts.rowsOf[conflict.index];
                        const diffs = conflict.current && editSession
                          ? editSession.names.flatMap((name, col) => {
                            if (!name || !(name in conflict.current!)) return [];
                            const original = grid.rows[row]?.[col + 1] ?? null;
                            const now = conflict.current![name];
                            return now === original ? [] : [`${name}: «${now ?? "NULL"}» (leído «${original ?? "NULL"}»)`];
                          })
                          : [];
                        return (
                          <p key={conflict.index}>
                            Fila {row + 1}: {REASONS[conflict.reason]}{diffs.length ? `. ${diffs.join("; ")}` : ""}
                          </p>
                        );
                      })}
                      <div>
                        <button className="btn primary" onClick={retryConflicts} disabled={applying || fetching}>Reintentar con valores actuales</button>
                        <button className="btn" onClick={discardConflicts} disabled={applying || fetching}>Descartar cambios en conflicto</button>
                      </div>
                    </section>
                  )}
                  <ResultGrid queryKey={grid.cursor} columns={visibleColumns} rows={displayRows} status={status}
                    isModified={isModified} editable={editSession ? editSession.names.map(Boolean) : null}
                    selected={selected} onSelect={fetching ? () => {} : setSelected} onEdit={editCell}
                    scrollRef={gridScroll} fetching={fetching} fetchError={fetchError} />
                </>
              )}
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
