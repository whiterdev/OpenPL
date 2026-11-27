import { CommandConsole, type ConsoleIo, type OutputLine } from "./CommandConsole";
import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { locateError, formatConsoleError } from "../sqlError";
import { useLineBuffer } from "../useLineBuffer";
import { createSqlplusState } from "../sqlplusState";
import { createdObject } from "../sqlplusQueries";
import { feedbackLine, formatTable } from "../sqlplusFormat";
import { printSqlplus, runSqlplus, substituteDefines, timingLine, type SqlplusCtx } from "../sqlplusRun";
import { parseSqlplus } from "../sqlplus";
import { needsConfirm } from "../sqlRisk";
import { FloppyDisk, Lock, LockOpen, Minus, Play, Plus, Stop, Trash, Warning } from "@phosphor-icons/react";
import { EditorView } from "@codemirror/view";
import { foldCode, unfoldCode } from "@codemirror/language";
import { gotoLine } from "@codemirror/search";
import { findNextMatch, findPrevMatch, openFind, openReplace } from "./EditorSearch";
import { startCompletion } from "@codemirror/autocomplete";
import { copyLineDown, deleteLine, indentLess, indentMore, redo, toggleComment, undo } from "@codemirror/commands";
import { api } from "../api";
import { commands, formatKeys, type CommandId } from "../keymap";
import {
  describeError, type BindKind, type BindValue, type Conflict, type EditTarget, type Environment, type ExecOutcome,
  type ProgramPart, type SqlColumn, type TestOutput, type ExplainPlan, type CompletionObject, type ObjectInfo,
} from "../types";
import { editableQuery, ROWID_COLUMN } from "../sqlEdit";
import { appliedRows, buildChanges, emptyPending, pendingCount, pendingDiscardMessage, type Cell, type Pending } from "../gridEdits";
import { copyGridCells, withBom } from "../gridSelection";
import { ResultGrid, type CellPosition, type RowStatus } from "./ResultGrid";
import { splitScript, statementAt, type ScriptStatement } from "../sqlScript";
import { applySubstitutions, assignedBinds, findVariables } from "../sqlBinds";
import type { CompletionCatalog } from "../programCompletion";
import { ProgramEditor, type EditorMarker } from "./ProgramEditor";
import type { ProgramActions } from "./ProgramWindow";
import { routineDraft } from "../routineTest";
import { serializeTestFile, type TestSettings } from "../testFile";
import { ContextMenu } from "./ContextMenu";
import { EditorObjectMenu, type ObjectCatalog, type ObjectRequest } from "./EditorObjectMenu";
import {
  NAVIGATION_TITLES, navigationMenuItems, navigationTargets, resolveAt,
  type NavigationGoal, type NavigationTarget,
} from "../editorNavigation";
import { editorPart, showSymbolCard, type ContextFor } from "../symbolHover";
import type { SymbolLookup } from "../symbolSources";
import "./SqlWindow.css";

interface Props {
  sessionId: string;
  command?: boolean;
  active?: boolean;
  onEditObject?: (object: CompletionObject) => void;
  initialSql?: string;
  testSettings?: TestSettings;
  /** Ejecutar `initialSql` al abrir (Consultar datos). */
  runOnOpen?: boolean;
  exportOnOpen?: boolean;
  /** Además, abrir la grilla en edición (Editar datos). */
  editOnOpen?: boolean;
  environment?: Environment;
  onTransaction: (open: boolean) => void;
  onBusy?: (busy: boolean) => void;
  onPendingChange?: (count: number) => void;
  onDirty: (dirty: boolean) => void;
  onWorkspaceChange?: (text: string) => void;
  completion?: CompletionCatalog | null;
  ref?: Ref<ProgramActions>;
  /** Catálogo de la conexión principal para la ficha y la navegación. */
  symbols?: SymbolLookup | null;
  /** Menú contextual sobre nombres (Describir, Ver fuente, Copiar). */
  catalog?: ObjectCatalog;
  /** Abre un objeto: tabla o vista en su descripción, programa en la posición pedida. */
  openObject?: (object: ObjectInfo, at?: { partKind: string; line: number; column: number }) => void;
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

interface HistoryEntry {
  id: number;
  sql: string;
  ok: boolean;
}

type Tab = "variables" | "results" | "output" | "history" | "plan";
const RESULT_TABS = [["results", "Resultados"], ["output", "Salida"], ["history", "Historial"]] as const;
const EDITOR_SHARE = { initial: 70, min: 20, max: 85, step: 4 };
const clampEditorShare = (share: number) => Math.max(EDITOR_SHARE.min, Math.min(EDITOR_SHARE.max, Math.round(share)));
const FETCH_ALL = 1000;
const CANCELLED = "ORA-01013";

function ConfirmExecution({ complete }: { complete: (approved: boolean) => void }) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    cancel.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return (
    <div className="dialog-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby={id} className="dialog"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") complete(false);
          else if (event.key === "Tab") {
            event.preventDefault();
            Array.from(event.currentTarget.querySelectorAll("button"))
              .find((button) => button !== document.activeElement)?.focus();
          }
        }}>
        <h2 id={id}>Producción. ¿Ejecutar?</h2>
        <div className="dialog-actions">
          <button type="button" className="btn primary" onClick={() => complete(true)}>Ejecutar</button>
          <button type="button" className="btn" ref={cancel} onClick={() => complete(false)}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
const KINDS: { id: BindKind; label: string }[] = [
  { id: "Text", label: "Texto" }, { id: "Number", label: "Número" }, { id: "Date", label: "Fecha" },
];

const REASONS: Record<Conflict["reason"], string> = {
  Changed: "cambió en Oracle", Locked: "bloqueada por otra sesión", Missing: "ya no existe",
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export function SqlWindow({
  sessionId, command = false, active = true, onEditObject, initialSql = "", testSettings, runOnOpen, exportOnOpen, editOnOpen, environment, onTransaction, onBusy, onPendingChange, onDirty, onWorkspaceChange, completion, ref,
  symbols, catalog, openObject,
}: Props) {
  const part = useMemo<ProgramPart>(() => ({ kind: "SQL", source: initialSql, diagnostics: [], last_ddl_time: null }),
    // La parte inicial es fija: el editor conserva su propio texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
  const view = useRef<EditorView | null>(null);
  const tabPrefix = useId();
  const [source, setSource] = useState(initialSql);
  const [confirming, setConfirming] = useState(false);
  const confirmation = useRef<((approved: boolean) => void) | null>(null);
  useEffect(() => () => { confirmation.current?.(false); }, []);
  const confirmationDialog = confirming && <ConfirmExecution complete={(approved) => {
    confirmation.current?.(approved);
    confirmation.current = null;
    setConfirming(false);
  }} />;
  const [cursor, setCursor] = useState(0);
  const [running, setRunning] = useState(false);
  const hasTestVariables = !!testSettings;
  const [tab, setTab] = useState<Tab>(command ? "output" : hasTestVariables ? "variables" : "results");
  const [plan, setPlan] = useState<ExplainPlan | null>(null);
  const [planSelection, setPlanSelection] = useState<CellPosition | null>(null);
  const [planning, setPlanning] = useState(false);
  const tabs: readonly (readonly [Tab, string])[] = [
    ...(hasTestVariables ? [["variables", "Variables"] as const] : []),
    ...RESULT_TABS, ...(plan ? [["plan", "Plan"] as const] : []),
  ];
  const [grid, setGrid] = useState<Grid | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const { lines, omitted: omittedLines, append, flush: flushOutput, clear: clearOutput } =
    useLineBuffer<OutputLine>(command ? 2000 : 10000);
  const output = useMemo(() => omittedLines
    ? [{ id: 0, kind: "info" as const, text: `… ${omittedLines} líneas anteriores omitidas` }, ...lines]
    : lines, [lines, omittedLines]);
  const echo = useRef(true);
  const sqlplusRef = useRef<ReturnType<typeof createSqlplusState> | null>(null);
  const sqlplus = sqlplusRef.current ??= createSqlplusState();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [markers, setMarkers] = useState<EditorMarker[]>([]);
  const [alert, setAlert] = useState("");
  const [values, setValues] = useState<Record<string, { value: string; kind: BindKind }>>(
    () => Object.fromEntries(Object.entries(testSettings?.bindKinds ?? {}).map(([name, kind]) => [name, { value: "", kind }])),
  );
  const [omitted, setOmitted] = useState<number[]>([]);
  const [testResults, setTestResults] = useState<TestOutput[]>([]);
  const [testSelection, setTestSelection] = useState<Record<string, CellPosition>>({});
  const routine = testSettings?.routine;
  const draft = useMemo(() => routine && routineDraft(routine.path, routine.signature, routine.overloaded, omitted), [routine, omitted]);
  const declaredOutputs = draft?.outputs ?? testSettings?.outputs;
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [editorShare, setEditorShare] = useState(EDITOR_SHARE.initial);
  const lineId = useRef(0);
  const fetchingRef = useRef(false);
  const gridScroll = useRef<HTMLDivElement>(null);
  const stopFetchRef = useRef(false);
  const saved = useRef(initialSql);
  const fileName = useRef<string | null>(testSettings?.fileName ?? null);
  const started = useRef(false);
  const lastQueryRef = useRef<{ sql: string; binds: BindValue[] } | null>(null);
  const [editSession, setEditSession] = useState<EditSession | null>(null);
  const [pending, setPending] = useState<Pending>(emptyPending);
  const count = pendingCount(pending);
  useEffect(() => { onPendingChange?.(count); }, [count, onPendingChange]);
  const [selected, setSelected] = useState<CellPosition | null>(null);
  const [conflicts, setConflicts] = useState<{ list: Conflict[]; rowsOf: number[] } | null>(null);
  const [applying, setApplying] = useState(false);

  const statements = useMemo(() => splitScript(source), [source]);
  const current = statementAt(statements, cursor);
  const variables = useMemo(() => findVariables(source), [source]);
  const activeVariables = useMemo(
    () => new Set(findVariables(current?.text ?? "").map((variable) => `${variable.kind}-${variable.key}`)),
    [current?.text],
  );
  const editableVariables = variables.filter((variable) =>
    variable.kind !== "bind" || !declaredOutputs?.some((output) => output.name === variable.key));

  function toggleOptional(index: number) {
    const editor = view.current;
    if (!routine || !draft || !editor || editor.state.doc.toString() !== draft.source) return;
    const next = omitted.includes(index) ? omitted.filter((value) => value !== index) : [...omitted, index];
    const script = routineDraft(routine.path, routine.signature, routine.overloaded, next).source;
    setOmitted(next);
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: script } });
  }

  const appendLine = useCallback((kind: OutputLine["kind"], text: string) => {
    append({ id: ++lineId.current, kind, text });
  }, [append]);
  const log = useCallback((kind: OutputLine["kind"], text: string) => {
    if (kind === "skip") {
      sqlplus.spool?.lines.push(text);
      appendLine(kind, text);
    } else printSqlplus(sqlplus, (line, level) => appendLine(level ?? "info", line), text, kind);
  }, [appendLine, sqlplus]);

  function targets(whole = false): { list: ScriptStatement[]; script: boolean } {
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
    if (whole) return { list: splitScript(doc), script: true };
    const one = statementAt(splitScript(doc), range?.head ?? cursor);
    return { list: one ? [one] : [], script: false };
  }

  async function explain() {
    if (planning) return;
    const { list } = targets();
    if (list.length !== 1 || list[0].kind !== "sql") {
      setAlert("Selecciona una sentencia SQL");
      return;
    }
    const sql = panelSql(list[0].text);
    if (sql === null) return;
    setPlanning(true);
    setAlert("");
    try {
      setPlan(await api.sqlExplain(sessionId, sql));
      setPlanSelection(null);
      setTab("plan");
    } catch (error) {
      setAlert(describeError(error).message);
    } finally {
      setPlanning(false);
    }
  }

  function panelSql(text: string): string | null {
    const substitutions: Record<string, string> = Object.create(null);
    for (const variable of findVariables(text)) {
      if (variable.kind !== "subst") continue;
      const value = values[variable.key]?.value;
      if (!value) {
        setAlert(`Falta el valor de &${variable.name}`);
        return null;
      }
      substitutions[variable.key] = value;
    }
    return applySubstitutions(text, substitutions);
  }

  function runConsoleCommand(source: string): boolean {
    const [keyword, ...words] = source.replace(/;$/, "").trim().split(/\s+/);
    const syntax = words.join(" ").toUpperCase();
    switch (keyword.toUpperCase()) {
      case "PROMPT":
        log("output", source.slice(keyword.length).trimStart());
        return true;
      case "REM":
      case "REMARK":
        return true;
      case "CLEAR":
        if (syntax === "SCREEN") { clearOutput(); return true; }
        break;
      case "SET":
        if (/^ECHO (ON|OFF)$/.test(syntax)) {
          echo.current = syntax.endsWith("ON");
          return true;
        }
        break;
    }
    return false;
  }

  async function consoleQuery(result: Extract<ExecOutcome["result"], { kind: "Query" }>) {
    const limit = 500;
    const rows = result.page.rows.slice(0, limit);
    let cursorOpen = result.page.more;
    let reportedMore = cursorOpen || result.page.rows.length > limit;
    try {
      while (cursorOpen && rows.length < limit && !stopFetchRef.current) {
        const size = Math.min(100, limit - rows.length);
        const page = await api.sqlFetch(sessionId, result.cursor, size);
        rows.push(...page.rows.slice(0, size));
        cursorOpen = page.more;
        reportedMore = cursorOpen || page.rows.length > size;
        if (!page.rows.length) break;
      }
    } finally {
      if (cursorOpen) await api.sqlFetch(sessionId, result.cursor, 0);
    }
    formatTable(result.columns, rows, sqlplus.settings).forEach((line) => log("output", line));
    const { feedback } = sqlplus.settings;
    if (stopFetchRef.current) log("info", "Ejecución cancelada");
    else if (reportedMore) log("info", `Se muestran ${rows.length} filas. Hay más.`);
    else if (feedback === true || (typeof feedback === "number" && rows.length >= feedback)) {
      log("info", feedbackLine(rows.length));
    }
  }

  async function run(list: ScriptStatement[], entered = false, exportQuery = false, io?: ConsoleIo) {
    if (running || applying || fetchingRef.current) return;
    if (!list.length) {
      setAlert("No hay sentencia para ejecutar");
      return;
    }
    if (count && !window.confirm(pendingDiscardMessage(count))) return;
    setAlert("");
    setNotice("");
    setTestResults([]);
    setTestSelection({});
    setMarkers([]);
    stopFetchRef.current = false;
    setRunning(true);
    let startedSql = false;
    let lastQuery = false;
    let productionApproved = environment !== "prod";
    const promptedBinds = new Map<string, string>();
    const ask: SqlplusCtx["ask"] = io?.ask ?? (async (name) => {
      const value = values[name.toUpperCase()]?.value;
      if (value) return value;
      setAlert(`Falta el valor de &${name}`);
      return null;
    });
    async function confirmWrites(statements: ScriptStatement[]): Promise<boolean> {
      if (productionApproved || !needsConfirm(statements.filter((statement) => statement.kind !== "sqlplus"))) return true;
      productionApproved = await new Promise<boolean>((resolve) => {
        confirmation.current = resolve;
        setConfirming(true);
      });
      return productionApproved;
    }

    async function executeStatements(statements: ScriptStatement[], script?: SqlplusCtx["script"]): Promise<boolean> {
      if (!await confirmWrites(statements)) return false;
      let nestedSucceeded = true;
      const context: SqlplusCtx = {
        print: (line, kind) => appendLine(kind ?? "info", line),
        ask,
        query: (sql, binds = []) => {
          setGrid((current) => current?.more ? { ...current, more: false } : current);
          return api.sqlExecute(sessionId, sql, binds);
        },
        readFile: api.readScriptFile,
        writeFile: api.writeSpoolFile,
        runScript: async (source, child) => {
          nestedSucceeded = await executeStatements(splitScript(source), child);
        },
        script,
      };
      for (const statement of statements) {
        if (command && ((entered && !script) || echo.current)) {
          log("info", `SQL> ${statement.text}${statement.kind === "sql" ? ";" : ""}`);
        }
        if (statement.kind === "sqlplus") {
          if (command && runConsoleCommand(statement.text)) continue;
          const parsed = statement.command ?? parseSqlplus(statement.text);
          try {
            if (parsed) await runSqlplus(parsed, sqlplus, context);
          } catch (error) {
            log("error", describeError(error).message);
            setTab("output");
            return false;
          }
          if (!nestedSucceeded) return false;
          continue;
        }
        const sql = await substituteDefines(statement.text, sqlplus, ask);
        if (sql === null) return false;
        if (sql !== statement.text && !await confirmWrites([{ ...statement, text: sql }])) return false;
        const vars = findVariables(sql).filter((variable) => variable.kind === "bind");
        const outputs = declaredOutputs?.filter((output) => vars.some((v) => v.key === output.name)) ?? [];
        const assigned = statement.kind === "plsql" ? assignedBinds(sql) : new Set<string>();
        const binds: BindValue[] = [];
        for (const variable of vars) {
          if (outputs.some((output) => output.name === variable.key)) continue;
          const declared = sqlplus.vars.get(variable.key);
          if (declared && assigned.has(variable.key)) {
            outputs.push({ name: variable.key, label: variable.name, kind: declared.type });
            continue;
          }
          const entry = values[variable.key];
          if (declared || entry) {
            binds.push({ name: variable.name, value: declared ? declared.value : entry.value || null, kind: declared?.type ?? entry.kind });
            continue;
          }
          if (!io) {
            setAlert(`Falta el valor de :${variable.name}`);
            return false;
          }
          const value = promptedBinds.get(variable.key) ?? await io.ask(`:${variable.name}`);
          if (value === null) return false;
          promptedBinds.set(variable.key, value);
          binds.push({ name: variable.name, value: value || null, kind: "Text" });
        }
        if (!startedSql) {
          startedSql = true;
          setEditSession(null);
          setPending(emptyPending());
          setConflicts(null);
          setSelected(null);
        }
        let outcome: ExecOutcome;
        try {
          setFetchError(null);
          setGrid((current) => current?.more ? { ...current, more: false } : current);
          outcome = await (outputs.length
            ? api.sqlExecute(sessionId, sql, binds, undefined, outputs)
            : api.sqlExecute(sessionId, sql, binds));
          if (outcome.result.kind === "Query") lastQueryRef.current = { sql, binds };
          if (outcome.result.kind === "Failed") {
            if (sqlplus.settings.serveroutput) outcome.output.forEach((line) => log("output", line));
            onTransaction(outcome.transaction);
            if (createdObject(sql)) sqlplus.lastCreated = sql;
            throw { Db: outcome.result.error };
          }
        } catch (error) {
          const detail = describeError(error);
          setHistory((h) => [{ id: ++lineId.current, sql: statement.text, ok: false }, ...h]);
          if (detail.code === CANCELLED) {
            log("info", "Ejecución cancelada");
          } else {
            const location = locateError(sql, detail);
            formatConsoleError(detail.code, detail.message, location).forEach((line) => log("error", line));
            const editor = view.current;
            if (location && editor && !script && sql === statement.text &&
                editor.state.sliceDoc(statement.from, statement.to) === statement.text) {
              const lines = sql.split("\n");
              const beforeLine = lines.slice(0, location.line - 1).reduce((sum, line) => sum + line.length + 1, 0);
              const column = Array.from(location.snippet).slice(0, location.column - 1).join("").length;
              const at = statement.from + beforeLine + column;
              setMarkers([{ from: at, to: Math.min(at + 1, editor.state.doc.length), message: detail.message }]);
              editor.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at) });
            }
          }
          setTab("output");
          return false;
        }
        setHistory((h) => [{ id: ++lineId.current, sql: statement.text, ok: true }, ...h]);
        if (sqlplus.settings.serveroutput) outcome.output.forEach((line) => log("output", line));
        if (createdObject(sql)) sqlplus.lastCreated = sql;
        if (outcome.test_outputs?.length) {
          for (const output of outcome.test_outputs) {
            const variable = sqlplus.vars.get(output.name.toUpperCase());
            if (variable && output.kind === "Scalar") variable.value = output.value;
          }
          if (testSettings) setTestResults(outcome.test_outputs);
        }
        onTransaction(outcome.transaction);
        if (outcome.result.kind === "Query") {
          const { cursor: id, columns, page } = outcome.result;
          const result = { cursor: id, columns, rows: page.rows, more: page.more, elapsed: outcome.elapsed_ms, hiddenRowid: false };
          setSummary(null);
          if (command) {
            try {
              await consoleQuery(outcome.result);
            } catch (error) {
              const detail = describeError(error);
              if (detail.code === CANCELLED) log("info", "Ejecución cancelada");
              else formatConsoleError(detail.code, detail.message, locateError(sql, detail)).forEach((line) => log("error", line));
              return false;
            }
            if (stopFetchRef.current) return false;
          } else {
            setGrid(result);
            if (exportQuery) await exportRows(result);
          }
          lastQuery = true;
        } else if (outcome.result.kind === "Done") {
          if (sqlplus.settings.feedback !== false) log("info", outcome.result.message);
          setSummary(`${outcome.result.message} · ${outcome.elapsed_ms} ms`);
          lastQuery = false;
        }
        if (sqlplus.settings.timing) log("info", timingLine(outcome.elapsed_ms));
      }
      return true;
    }
    try {
      if (await executeStatements(list)) {
        setTab(command ? "output" : lastQuery ? "results" : declaredOutputs?.length ? "variables" : "output");
      }
    } finally {
      flushOutput();
      setRunning(false);
    }
  }

  async function fetchAll(result = grid, forExport = false) {
    if ((!forExport && (tab !== "results" || running)) || !result?.more || applying || fetchingRef.current) return;
    fetchingRef.current = true;
    stopFetchRef.current = false;
    setFetching(true);
    setSelected(null);
    setNotice("");
    const cursor = result.cursor;
    let received = result.rows.length;
    const exported = forExport ? [...result.rows] : [];
    const stopped = () => {
      setGrid((current) => current?.cursor === cursor ? { ...current, more: false } : current);
      setNotice(`Traer todas detenido. ${received === 1 ? "Se conserva 1 fila" : `Se conservan ${received} filas`}.`);
    };
    try {
      let more: boolean;
      do {
        const page = await api.sqlFetch(sessionId, cursor, FETCH_ALL);
        received += page.rows.length;
        if (forExport) exported.push(...page.rows);
        setGrid((current) => current?.cursor === cursor
          ? { ...current, rows: [...current.rows, ...page.rows], more: page.more }
          : current);
        more = page.more;
      } while (more && !stopFetchRef.current);
      if (more) stopped();
      else if (forExport) return exported;
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

  async function exportRows(result: Grid) {
    const rows = result.more ? await fetchAll(result, true) : result.rows;
    if (!rows) return;
    const offset = result.hiddenRowid ? 1 : 0;
    const headers = result.columns.slice(offset).map((column) => column.name);
    try {
      const name = await api.saveProgramFile(withBom(copyGridCells(rows.map((row) => row.slice(offset)), true, { headers })),
        "csv", "resultados.csv");
      if (name) setNotice("CSV guardado");
    } catch (error) {
      setAlert(describeError(error).message);
    }
  }

  async function transaction(action: "commit" | "rollback") {
    if (running || applying || fetchingRef.current) return;
    try {
      const open = action === "commit" ? await api.sqlCommit(sessionId) : await api.sqlRollback(sessionId);
      if (action === "rollback") setGrid((current) => current?.more ? { ...current, more: false } : current);
      onTransaction(open);
      log("info", action === "commit" ? "Commit hecho" : "Rollback hecho");
    } catch (error) {
      log("error", describeError(error).message);
      setTab("output");
    } finally {
      flushOutput();
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

  function pasteCells({ row, col }: CellPosition, matrix: string[][]): number {
    if (!grid || !editSession) return 0;
    let pasted = 0;
    matrix.forEach((line, rowOffset) => {
      const targetRow = row + rowOffset;
      if (pending.edits[targetRow]?.kind === "delete") return;
      line.forEach((value, colOffset) => {
        const targetCol = col + colOffset;
        if (!editSession.names[targetCol] || grid.columns[targetCol + 1]?.lob) return;
        editCell({ row: targetRow, col: targetCol }, value === "" ? null : value);
        pasted++;
      });
    });
    return pasted;
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
      const activeBinds = new Set(findVariables(text).filter((v) => v.kind === "bind").map((v) => v.key));
      const outputs = declaredOutputs?.filter((output) => activeBinds.has(output.name)) ?? [];
      const bindKinds = Object.fromEntries(Object.entries(values)
        .filter(([name]) => activeBinds.has(name) && !outputs.some((out) => out.name === name))
        .map(([name, entry]) => [name, entry.kind]));
      const file = testSettings ? serializeTestFile({ source: text, bindKinds, outputs }) : text;
      const name = await api.saveProgramFile(file, testSettings ? "tst" : "sql", fileName.current);
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

  const activeRef = useRef(active);
  activeRef.current = active;
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;
  const symbolContext = useCallback<ContextFor>((editor, position) => ({
    parts: [editorPart("SQL", editor)],
    current: 0,
    position,
    self: null,
    lookup: symbolsRef.current ?? null,
  }), []);
  const [objectMenu, setObjectMenu] = useState<(ObjectRequest & { id: number; position: number }) | null>(null);
  const [targetsMenu, setTargetsMenu] = useState<{ title: string; x: number; y: number; targets: NavigationTarget[] } | null>(null);
  const objectMenuId = useRef(0);
  const closeObjectMenu = useCallback(() => setObjectMenu(null), []);
  const closeTargetsMenu = useCallback(() => setTargetsMenu(null), []);

  function openTarget({ location }: NavigationTarget) {
    const editor = view.current;
    if (location.where === "object") {
      openObject?.(location.object, { partKind: location.partKind, line: location.line, column: location.column });
    } else if (editor) {
      editor.dispatch({ selection: { anchor: location.from }, scrollIntoView: true });
      editor.focus();
    }
  }

  /** Definición, declaración o implementación del nombre en `at` (o en el cursor). */
  async function goTo(goal: NavigationGoal, at?: number, onMiss?: () => void) {
    const editor = view.current;
    if (!editor) return;
    const position = at ?? editor.state.selection.main.from;
    const { doc } = editor.state;
    const head = editor.state.selection.main.head;
    const found = await resolveAt(editor, position, symbolContext);
    // Si mientras tanto se escribió o se movió el cursor, el destino ya no corresponde.
    if (!found || !activeRef.current || editor.state.doc !== doc || editor.state.selection.main.head !== head) return;
    const relation = found.items.find((item) => item.kind === "relation");
    if (relation?.kind === "relation") {
      openObject?.(relation.object);
      return;
    }
    const { targets, notice } = navigationTargets(found.items, goal);
    if (notice) setNotice(notice);
    if (targets.length === 1) {
      openTarget(targets[0]);
    } else if (targets.length > 1) {
      const coords = editor.coordsAtPos(position) ?? editor.contentDOM.getBoundingClientRect();
      closeObjectMenu();
      setTargetsMenu({ title: `${NAVIGATION_TITLES[goal]} de ${found.name}`, x: coords.left, y: coords.bottom, targets });
    } else {
      onMiss?.();
    }
  }

  const busy = running || fetching || applying;
  useEffect(() => { onBusy?.(busy); }, [busy, onBusy]);
  const actions: ProgramActions = {
    hasPending: () => count > 0,
    explainPlan: command ? undefined : () => void explain(),
    execute: command ? undefined : () => void run(targets().list),
    executeScript: command ? undefined : () => void run(targets(true).list),
    exportData: !command && grid && !editSession && !busy ? () => void exportRows(grid) : undefined,
    fetchAllRows: !command && grid?.more && !busy ? () => void fetchAll() : undefined,
    // Durante applying no se ofrece: cortar un guardado a medias deja la tabla en un estado incierto.
    cancel: running || fetching ? () => {
      if (command || fetchingRef.current) stopFetchRef.current = true;
      void api.sqlCancel(sessionId);
    } : undefined,
    editData: !command && grid ? () => void toggleEdit() : undefined,
    applyChanges: editSession && pendingCount(pending) ? () => void applyChanges() : undefined,
    commit: busy ? undefined : () => void transaction("commit"),
    rollback: busy ? undefined : () => void transaction("rollback"),
    save: command ? undefined : () => void save(),
    complete: inEditor(startCompletion),
    showSymbolCard: inEditor(showSymbolCard),
    goToDefinition: () => void goTo("definition"),
    goToDeclaration: () => void goTo("declaration"),
    goToImplementation: () => void goTo("implementation"),
    foldBlock: inEditor(foldCode),
    unfoldBlock: inEditor(unfoldCode),
    goToLine: inEditor(gotoLine),
    find: inEditor(openFind),
    replace: inEditor(openReplace),
    findNext: inEditor(findNextMatch),
    findPrev: inEditor(findPrevMatch),
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
        await run(splitScript(editor.state.doc.toString()), false, exportOnOpen);
        if (editOnOpen) await toggleEdit();
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const offset = grid?.hiddenRowid ? 1 : 0;
  const insertSource = lastQueryRef.current?.sql;
  const insertTarget = useMemo(() => insertSource ? editableQuery(insertSource)?.table : undefined, [insertSource]);
  const insertTable = editSession?.target ?? insertTarget;
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
  const rowCount = grid?.rows.length ?? 0;
  const footer = running ? null
    : grid && tab === "results"
      ? `${rowCount === 1 ? "1 fila" : `${rowCount} filas`} · ${grid.elapsed} ms${grid.more ? " · hay más" : ""}`
      : summary;

  const variableFields = editableVariables.map((v) => {
    const label = `${v.kind === "bind" ? ":" : "&"}${v.name}`;
    const usage = activeVariables.has(`${v.kind}-${v.key}`)
      ? "Se usa en la sentencia actual" : "Se usa en otra sentencia";
    const entry = values[v.key] ?? { value: "", kind: "Text" as BindKind };
    const update = (change: Partial<typeof entry>) => {
      setValues((all) => ({ ...all, [v.key]: { ...entry, ...change } }));
      if (testSettings && change.kind !== undefined) onDirty(true);
    };
    return (
      <div key={`${v.kind}-${v.key}`} className="sql-variable">
        <label>
          <span className="mono">{label}</span>
          <input className="fld mono" aria-label={`Valor de ${label}`} title={usage} value={entry.value}
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
  });

  if (command) return <><CommandConsole sessionId={sessionId} tabPrefix={tabPrefix} active={active}
    lines={output} running={running} alert={alert} notice={notice} log={log} onEditObject={onEditObject}
    onRun={(source, io) => run(splitScript(source), true, false, io)} onCancel={actions.cancel} onClear={clearOutput} />
    {confirmationDialog}</>;

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
        {planning && <span role="status" className="program-muted">Generando plan…</span>}
        {!running && notice && <span role="status" className="program-muted">{notice}</span>}
        {alert && <span role="alert" className="sql-alert">{alert}</span>}
      </div>
      <div className="sql-top" style={{ flexGrow: editorShare }}>
        <div className="sql-editor">
          <ProgramEditor part={part} label="SQL" readOnly={false} completion={completion} markers={markers}
            activate={() => {}}
            symbolContext={symbolContext}
            onCtrlClick={(position) => void goTo("definition", position, () => {
              view.current?.dispatch({ selection: { anchor: position } });
            })}
            onObjectContext={catalog ? (reference, x, y, position) => {
              closeTargetsMenu();
              setObjectMenu({ reference, x, y, position, id: ++objectMenuId.current });
            } : undefined}
            onView={onView}
            onSelection={setCursor}
            onChange={(doc) => {
              const value = doc.toString();
              onWorkspaceChange?.(value);
              setSource(value);
              setTestResults([]);
              setMarkers([]);
              onDirty(value !== saved.current);
            }} />
        </div>
        {!hasTestVariables && variables.length > 0 && (
          <aside className="sql-variables" aria-label="Variables">
            <div>Variables</div>
            {variableFields}
          </aside>
        )}
      </div>
      <div role="separator" aria-orientation="horizontal" aria-label="Alto del editor" tabIndex={0}
        className="sql-resizer" aria-valuemin={EDITOR_SHARE.min} aria-valuemax={EDITOR_SHARE.max}
        aria-valuenow={editorShare} aria-valuetext={`${editorShare}%`}
        onKeyDown={(event) => {
          const next = { ArrowUp: editorShare - EDITOR_SHARE.step, ArrowDown: editorShare + EDITOR_SHARE.step }[event.key];
          if (next === undefined) return;
          event.preventDefault();
          setEditorShare(clampEditorShare(next));
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          const startY = event.clientY;
          const startShare = editorShare;
          const availableHeight = Math.max(1,
            (event.currentTarget.previousElementSibling?.clientHeight ?? 0) +
            (event.currentTarget.nextElementSibling?.clientHeight ?? 0));
          document.body.classList.add("resizing-rows");
          const move = (e: PointerEvent) => setEditorShare(clampEditorShare(startShare + 100 * (e.clientY - startY) / availableHeight));
          const stop = () => {
            document.body.classList.remove("resizing-rows");
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", stop);
          window.addEventListener("pointercancel", stop);
        }} />
      <div className="sql-results" style={{ flexGrow: 100 - editorShare }}>
        <div className="sql-tabs">
          <div role="tablist" aria-label="Resultado" onKeyDown={(event) => {
            const order = tabs.map(([id]) => id);
            const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
            if (!step) return;
            const next = order[(order.indexOf(tab) + step + order.length) % order.length];
            setTab(next);
            const nextIndex = order.indexOf(next);
            event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus();
          }}>
            {tabs.map(([id, label]) => (
              <button key={id} role="tab" id={`${tabPrefix}-tab-${id}`} aria-selected={tab === id} aria-controls={`${tabPrefix}-panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}>
                {command && id === "output" ? "Consola" : label}
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
            <button className="btn" onClick={actions.exportData} disabled={!actions.exportData}>
              Exportar CSV <span className="kbd">{key("exportData")}</span>
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
            <button className="ib" aria-label="Limpiar salida" title="Limpiar salida" onClick={clearOutput}>
              <Trash size={15} aria-hidden />
            </button>
          )}
        </div>
        {hasTestVariables && (
          <div role="tabpanel" id={`${tabPrefix}-panel-variables`} aria-label="Variables" hidden={tab !== "variables"} className="sql-panel">
            {draft?.optional.map(({ index, label }) => (
              <label key={index} className="sql-test-optional">
                <input type="checkbox" checked={!omitted.includes(index)}
                  disabled={running || source !== draft.source}
                  aria-label={`Usar ${label}`} onChange={() => toggleOptional(index)} />
                {label}
              </label>
            ))}
            <div className="sql-test-variables">{variableFields}</div>
            {!variableFields.length && !declaredOutputs?.length && <p className="sql-empty">Sin variables</p>}
            {declaredOutputs?.map((bind, index) => {
              const output = testResults.find((value) => value.name === bind.name);
              return (
                <section key={bind.name} className="sql-test-output" aria-label={bind.label}>
                  <strong>{bind.label}</strong>
                  {output?.kind === "Cursor" ? <>
                    <div className="sql-test-cursor">
                      <ResultGrid queryKey={index} columns={output.columns} rows={output.page.rows}
                        status={[]} isModified={() => false} editable={null} selected={testSelection[bind.name] ?? null}
                        onSelect={(cell) => setTestSelection((all) => ({ ...all, [bind.name]: cell }))}
                        onEdit={() => {}} fetching={false} fetchError={null} />
                    </div>
                    {output.page.more && <span className="program-muted">{plural(output.page.rows.length, "fila mostrada", "filas mostradas")}</span>}
                  </> : output?.kind === "Error" ? <span role="alert">{output.message}</span>
                    : <output>{output ? output.value ?? "NULL" : "—"}</output>}
                </section>
              );
            })}
          </div>
        )}
        <div role="tabpanel" id={`${tabPrefix}-panel-results`} aria-label="Resultados" hidden={tab !== "results"} className="sql-panel">
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
                    scrollRef={gridScroll} fetching={fetching} fetchError={fetchError} more={grid.more}
                    onNotice={setNotice} onPasteCells={editSession ? pasteCells : undefined} insertTable={insertTable
                      ? (insertTable.owner ? [insertTable.owner, insertTable.name] : [insertTable.name])
                      : undefined} />
                </>
              )}
        </div>
        <div role="tabpanel" id={`${tabPrefix}-panel-output`} aria-label="Salida" hidden={tab !== "output"} className="sql-panel sql-output">
          {output.length === 0 ? <p className="sql-empty">Sin salida. DBMS_OUTPUT y los mensajes aparecen aquí.</p>
            : output.map((line) => <div key={line.id} className={`sql-line sql-line-${line.kind}`}>{line.text}</div>)}
        </div>
        <div role="tabpanel" id={`${tabPrefix}-panel-history`} aria-label="Historial" hidden={tab !== "history"} className="sql-panel sql-history">
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
        {plan && (
          <div role="tabpanel" id={`${tabPrefix}-panel-plan`} aria-label="Plan" hidden={tab !== "plan"} className="sql-panel">
            <ResultGrid queryKey={0} columns={plan.columns} rows={plan.page.rows} status={[]}
              isModified={() => false} editable={null} selected={planSelection} onSelect={setPlanSelection}
              onEdit={() => {}} fetching={false} fetchError={null} />
            {plan.page.more && <div className="sql-footer">{plan.page.rows.length} pasos mostrados</div>}
          </div>
        )}
      </div>
      {confirmationDialog}
      {active && catalog && objectMenu && (
        <EditorObjectMenu key={objectMenu.id} request={objectMenu} catalog={catalog} onClose={closeObjectMenu}
          navigation={navigationMenuItems((goal) => void goTo(goal, objectMenu.position))}
          onMessage={setNotice}
          onDescribe={(object) => openObject?.(object)} />
      )}
      {active && targetsMenu && (
        <ContextMenu x={targetsMenu.x} y={targetsMenu.y} label={targetsMenu.title} width={360}
          items={targetsMenu.targets.map((target) => ({
            label: target.location.where === "object" ? `${target.location.object.name} · ${target.label}` : target.label,
            run: () => openTarget(target),
          }))}
          onClose={closeTargetsMenu} />
      )}
    </section>
  );
}
