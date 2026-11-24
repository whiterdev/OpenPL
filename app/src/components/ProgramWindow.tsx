import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { GitDiff, Hammer, SplitVertical, Stop } from "@phosphor-icons/react";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { foldCode, unfoldCode } from "@codemirror/language";
import { startCompletion } from "@codemirror/autocomplete";
import { gotoLine } from "@codemirror/search";
import { openFind, openReplace } from "./EditorSearch";
import { copyLineDown, deleteLine, indentLess, indentMore, redo, toggleComment, undo } from "@codemirror/commands";
import { api } from "../api";
import { commands, formatKeys, type CommandId } from "../keymap";
import { describeError, type ObjectInfo, type ProgramPart } from "../types";
import { editorReference } from "../editorReference";
import { positionAt, ProgramEditor, type EditorMarker } from "./ProgramEditor";
import { EditorObjectMenu, ObjectDescription, type ObjectCatalog, type ObjectRequest } from "./EditorObjectMenu";
import { ProgramComparison, type ComparisonResult } from "./ProgramComparison";
import { compileStatement, type CompilationTarget } from "../programScript";
import { programStructure, type DeclarationKind, type ProgramDeclaration } from "../programStructure";
import type { CompletionCatalog } from "../programCompletion";
import { ContextMenu } from "./ContextMenu";

export type ProgramActions = Partial<Record<CommandId, () => void>>;

export interface ProgramCompiler {
  run: (sql: string) => Promise<unknown>;
  cancel: () => void;
  production: boolean;
}

/** Última versión conocida en Oracle; `text` es el borrador al que corresponden diagnósticos y marcas. */
interface Baseline {
  text: string;
  source: string;
  last_ddl_time: string | null;
  diagnostics: ProgramPart["diagnostics"];
  markers?: EditorMarker[];
}

const NO_MARKERS: EditorMarker[] = [];

interface Props {
  parts: ProgramPart[];
  readOnly: boolean;
  onReadOnlyChange?: (readOnly: boolean) => void;
  onTestRoutine?: (name: string, x: number, y: number) => void;
  onDirty: (dirty: boolean) => void;
  ref?: Ref<ProgramActions>;
  fileName?: string;
  catalog?: ObjectCatalog;
  active?: boolean;
  readCurrentProgram?: () => Promise<ProgramPart[]>;
  compilationTarget?: CompilationTarget;
  compile?: ProgramCompiler;
}

const caption = (kind: string) => {
  if (kind === "PACKAGE" || kind === "TYPE") return "Spec";
  if (kind.endsWith(" BODY")) return "Body";
  return "Fuente";
};

// Letra de la palabra clave que el desarrollador escribe; se lee más rápido que un pictograma a 14 px.
const KIND_BADGES: Record<DeclarationKind, { letter: string; label: string }> = {
  package: { letter: "K", label: "Paquete" },
  procedure: { letter: "P", label: "Procedimiento" },
  function: { letter: "F", label: "Función" },
  trigger: { letter: "G", label: "Trigger" },
  cursor: { letter: "C", label: "Cursor" },
  type: { letter: "T", label: "Tipo" },
  variable: { letter: "V", label: "Variable" },
  constant: { letter: "N", label: "Constante" },
  exception: { letter: "E", label: "Excepción" },
};

const OUTLINE_WIDTH = { min: 140, max: 640, initial: 240, step: 16, key: "openpl.outlineWidth" };
const clampOutline = (value: number) => Math.round(Math.min(OUTLINE_WIDTH.max, Math.max(OUTLINE_WIDTH.min, value)));

function storedOutlineWidth() {
  try {
    const saved = Number(localStorage.getItem(OUTLINE_WIDTH.key));
    return saved ? clampOutline(saved) : OUTLINE_WIDTH.initial;
  } catch {
    return OUTLINE_WIDTH.initial;
  }
}

interface DeclarationTarget {
  index: number;
  entry: ProgramDeclaration;
}

export function ProgramWindow({
  parts, readOnly, onReadOnlyChange, onDirty, ref, fileName, catalog, active = true, readCurrentProgram, compilationTarget, compile, onTestRoutine,
}: Props) {
  const [baselines, setBaselines] = useState<Baseline[]>(() => parts.map((entry) => ({
    text: entry.source, source: entry.source, last_ddl_time: entry.last_ddl_time, diagnostics: entry.diagnostics,
  })));
  const [compiling, setCompiling] = useState(false);
  const compilation = useRef<{ stopped: boolean } | null>(null);
  const [selected, setSelected] = useState(0);
  const [split, setSplit] = useState(false);
  const [values, setValues] = useState(() => parts.map((part) => part.source));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [comparison, setComparison] = useState<{ index: number; result: ComparisonResult } | null>(null);
  const [objectMenu, setObjectMenu] = useState<(ObjectRequest & { id: number }) | null>(null);
  const [declarationMenu, setDeclarationMenu] = useState<{ name: string; x: number; y: number; targets: DeclarationTarget[] } | null>(null);
  const [routineMenu, setRoutineMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const closeRoutineMenu = useCallback(() => setRoutineMenu(null), []);
  const [description, setDescription] = useState<{ object: ObjectInfo; sessionId: string; id: number } | null>(null);
  const [outlineWidth, setOutlineWidthState] = useState(storedOutlineWidth);
  const setOutlineWidth = useCallback((value: number) => {
    const width = clampOutline(value);
    setOutlineWidthState(width);
    try { localStorage.setItem(OUTLINE_WIDTH.key, String(width)); } catch { /* preferencia opcional */ }
  }, []);
  const objectRequestId = useRef(0);
  const closeObjectMenu = useCallback(() => setObjectMenu(null), []);
  const closeDeclarationMenu = useCallback(() => setDeclarationMenu(null), []);
  useEffect(() => {
    closeObjectMenu();
    closeDeclarationMenu();
    closeRoutineMenu();
  }, [active, catalog?.sessionId, closeObjectMenu, closeDeclarationMenu, closeRoutineMenu]);
  const views = useRef<(EditorView | null)[]>([]);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const saved = useRef(parts.map((part) => part.source));
  const names = useRef<(string | null)[]>([fileName ?? null]);
  const canSplit = parts.length === 2;
  const firstOutline = useMemo(() => programStructure(values[0]), [values[0]]);
  const secondOutline = useMemo(() => values[1] ? programStructure(values[1]) : [], [values[1]]);
  const outline = selected === 0 ? firstOutline : secondOutline;
  const publicKeys = useMemo(() => new Set(firstOutline.map((entry) => entry.key)), [firstOutline]);
  function canTest(entry: ProgramDeclaration, index: number) {
    const kind = parts[index].kind;
    return !!onTestRoutine && (entry.kind === "procedure" || entry.kind === "function") &&
      (kind === "PACKAGE" || (kind === "PACKAGE BODY" && index > 0 && publicKeys.has(entry.key)) ||
        kind === "PROCEDURE" || kind === "FUNCTION");
  }
  function openRoutineMenu(entry: ProgramDeclaration, x: number, y: number) {
    closeObjectMenu();
    closeDeclarationMenu();
    setRoutineMenu({ name: entry.name, x, y });
  }
  function routineAt(index: number, position: number) {
    return (index === 0 ? firstOutline : secondOutline).find((entry) =>
      canTest(entry, index) && position >= entry.from &&
      position < entry.from + entry.name.length + (values[index][entry.from] === '"' ? 2 : 0));
  }
  const part = parts[selected];
  const sessionId = catalog?.sessionId;
  const contextOwner = catalog?.owner ?? null;
  const completion = useMemo<CompletionCatalog | null>(() => {
    if (!sessionId) return null;
    // Caché por sesión: cambiar de conexión crea otro catálogo y descarta lo anterior.
    const cache = new Map<string, Promise<unknown>>();
    const cached = <T,>(key: string, load: () => Promise<T>) => {
      let value = cache.get(key) as Promise<T> | undefined;
      if (!value) {
        value = load();
        cache.set(key, value);
        value.catch(() => cache.delete(key));
      }
      return value;
    };
    return {
      objects: (owner, prefix, scope = "any") => cached(`o\0${owner ?? ""}\0${prefix}\0${scope}`,
        () => api.completeObjects(sessionId, owner, prefix, contextOwner, scope)),
      columns: (owner, name) => cached(`c\0${owner ?? ""}\0${name}`,
        () => api.objectColumns(sessionId, owner, name, contextOwner)),
    };
  }, [sessionId, contextOwner]);

  function focusPart(index: number, focusEditor = true) {
    setComparison(null);
    closeDeclarationMenu();
    setSelected(index);
    if (focusEditor) requestAnimationFrame(() => views.current[index]?.focus());
  }

  function moveTab(event: KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + parts.length) % parts.length;
    focusPart(next, false);
    tabs.current[next]?.focus();
  }

  function navigateAt(index: number, anchor: number) {
    const view = views.current[index];
    if (!view) return;
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    focusPart(index);
  }

  function navigate(index: number, line: number, column = 1) {
    const view = views.current[index];
    if (view) navigateAt(index, positionAt(view, line, column));
  }

  function declaration() {
    if (comparison) return;
    const view = views.current[selected];
    if (!view) return;
    const position = view.state.selection.main.from;
    const reference = editorReference(view.state, position)
      ?? (position > 0 ? editorReference(view.state, position - 1) : null);
    if (!reference || (reference.owner && compilationTarget && reference.owner !== compilationTarget.name)) return;

    const bySignature = new Map<string, DeclarationTarget>();
    for (const entry of outline) {
      if (entry.name === reference.name) bySignature.set(entry.key, { index: selected, entry });
    }
    if (canSplit && selected === 1) {
      for (const entry of firstOutline) {
        if (entry.name === reference.name) bySignature.set(entry.key, { index: 0, entry });
      }
    }
    const targets = [...bySignature.values()];
    if (targets.length === 1) {
      navigateAt(targets[0].index, targets[0].entry.from);
    } else if (targets.length > 1) {
      const coords = view.coordsAtPos(position) ?? view.contentDOM.getBoundingClientRect();
      closeObjectMenu();
      setDeclarationMenu({ name: reference.name, x: coords.left, y: coords.bottom, targets });
    }
  }

  async function save() {
    if (saving) return;
    const index = selected;
    const source = values[index];
    setSaving(true);
    setMessage("");
    try {
      const name = await api.saveProgramFile(source, "sql", names.current[index] ?? null);
      if (name) {
        names.current[index] = name;
        saved.current[index] = source;
        onDirty(parts.some((other, i) => (views.current[i]?.state.doc.toString() ?? other.source) !== saved.current[i]));
        setMessage("Archivo guardado");
      }
    } catch (error) {
      setMessage(describeError(error).message);
    } finally {
      setSaving(false);
    }
  }

  function runInEditor(action: (view: EditorView) => unknown) {
    return () => {
      if (comparison) return;
      const view = views.current[selected];
      if (view) action(view);
    };
  }

  async function compare() {
    if (!readCurrentProgram || comparison?.result.state === "loading") return;
    const request = { index: selected, result: { state: "loading" } } as const;
    setComparison(request);
    closeObjectMenu();
    closeDeclarationMenu();
    const finish = (result: ComparisonResult) =>
      setComparison((current) => current === request ? { ...request, result } : current);
    try {
      const latest = await readCurrentProgram();
      finish({ state: "ready", current: latest.find((entry) => entry.kind === part.kind) ?? null });
    } catch (error) {
      const detail = describeError(error);
      finish({ state: "error", message: detail.code ? `${detail.code} ${detail.message}` : detail.message });
    }
  }

  async function compileActive() {
    if (!compile || !compilationTarget || compilation.current) return;
    const index = selected;
    const { kind } = parts[index];
    const text = views.current[index]?.state.doc.toString() ?? values[index];
    let statement: string;
    try {
      statement = compileStatement(text, kind, compilationTarget);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    if (compile.production && !window.confirm(`¿Compilar ${compilationTarget.name} en producción?`)) return;

    const request = { stopped: false };
    compilation.current = request;
    setCompiling(true);
    setMessage("Compilando");
    const latestPart = async () => (await readCurrentProgram!()).find((entry) => entry.kind === kind) ?? null;
    try {
      if (readCurrentProgram) {
        const remote = await latestPart();
        if ((remote?.last_ddl_time ?? null) !== baselines[index].last_ddl_time
          && !window.confirm(`${compilationTarget.name} cambió en Oracle. ¿Compilar igual?`)) {
          setMessage("");
          return;
        }
      }
      if (request.stopped) {
        setMessage("Compilación detenida");
        return;
      }
      try {
        await compile.run(statement);
      } catch (error) {
        // ORA-24344: Oracle guardó el objeto con errores; los detalles llegan con la fuente releída.
        if (describeError(error).code !== "ORA-24344") throw error;
      }
      saved.current[index] = text;
      onDirty(parts.some((_, i) => (views.current[i]?.state.doc.toString() ?? values[i]) !== saved.current[i]));
      const current = readCurrentProgram ? await latestPart() : null;
      const diagnostics = current?.diagnostics ?? [];
      const view = views.current[index];
      const markers = view ? diagnostics.filter((item) => item.line > 0).map((item) => {
        const from = positionAt(view, item.line, item.column);
        return { from, to: from + 1, message: item.text };
      }) : [];
      setBaselines((all) => all.map((entry, i) => i === index ? {
        text,
        source: current?.source ?? entry.source,
        last_ddl_time: current?.last_ddl_time ?? null,
        diagnostics,
        markers,
      } : entry));
      const errors = diagnostics.filter((item) => !item.warning).length;
      setMessage(errors ? `Compilado con ${errors} ${errors === 1 ? "error" : "errores"}` : "Compilado");
    } catch (error) {
      const detail = describeError(error);
      setMessage(request.stopped ? "Compilación detenida" : detail.code ? `${detail.code} ${detail.message}` : detail.message);
    } finally {
      compilation.current = null;
      setCompiling(false);
    }
  }

  function stopCompilation() {
    if (!compile || !compilation.current) return;
    compilation.current.stopped = true;
    compile.cancel();
  }

  function changeCase(transform: (value: string) => string) {
    return runInEditor((view) => view.dispatch(view.state.changeByRange((range) => {
      const insert = transform(view.state.sliceDoc(range.from, range.to));
      const end = range.from + insert.length;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: range.anchor <= range.head
          ? EditorSelection.range(range.from, end)
          : EditorSelection.range(end, range.from),
      };
    })));
  }

  const canCompile = !!compile && !!compilationTarget && !readOnly;
  const readOnlyItem = onReadOnlyChange && {
    label: "Solo lectura",
    checked: readOnly,
    run: () => {
      onReadOnlyChange(!readOnly);
      views.current[selected]?.focus();
    },
  };
  const actions: ProgramActions = {
    save: () => void save(),
    spec: canSplit ? () => focusPart(0) : undefined,
    body: canSplit ? () => focusPart(1) : undefined,
    sideBySide: canSplit ? () => {
      setComparison(null);
      setSplit((value) => !value);
    } : undefined,
    goToDeclaration: declaration,
    foldBlock: runInEditor(foldCode),
    unfoldBlock: runInEditor(unfoldCode),
    compareProgram: readCurrentProgram ? () => void compare() : undefined,
    execute: canCompile ? () => void compileActive() : undefined,
    cancel: canCompile ? stopCompilation : undefined,
    test: onTestRoutine ? runInEditor((view) => {
      const position = view.state.selection.main.head;
      const entry = routineAt(selected, position);
      if (!entry) return;
      const coords = view.coordsAtPos(position) ?? view.contentDOM.getBoundingClientRect();
      onTestRoutine(entry.name, coords.left, coords.bottom);
    }) : undefined,
    objectActions: catalog ? runInEditor((view) => {
      const position = view.state.selection.main.head;
      const reference = editorReference(view.state, position) ?? (position > 0 ? editorReference(view.state, position - 1) : null);
      if (!reference) return;
      const coords = view.coordsAtPos(position) ?? view.contentDOM.getBoundingClientRect();
      closeDeclarationMenu();
      setObjectMenu({ reference, x: coords.left, y: coords.bottom, id: ++objectRequestId.current });
    }) : undefined,
    complete: readOnly ? undefined : runInEditor(startCompletion),
    goToLine: runInEditor(gotoLine),
    find: runInEditor(openFind),
    replace: readOnly ? undefined : runInEditor(openReplace),
    ...(readOnly ? {} : {
      comment: runInEditor(toggleComment),
      duplicateLine: runInEditor(copyLineDown),
      deleteLine: runInEditor(deleteLine),
      upperCase: changeCase((value) => value.toUpperCase()),
      lowerCase: changeCase((value) => value.toLowerCase()),
      undo: runInEditor(undo),
      redo: runInEditor(redo),
      indent: runInEditor(indentMore),
      outdent: runInEditor(indentLess),
    }),
  };
  useImperativeHandle(ref, () => actions);
  const diagnostics = values[selected] === baselines[selected].text ? baselines[selected].diagnostics : [];
  const markersFor = (index: number) => {
    const { markers, text } = baselines[index];
    if (!markers) return undefined;
    return values[index] === text ? markers : NO_MARKERS;
  };
  const keyLabel = (id: CommandId) => formatKeys(commands[id].keys!);

  return (
    <section className="program-window" aria-label="Ventana de programa">
      <div className="program-toolbar">
        {canSplit && (
          <div className="program-parts" role="tablist" aria-label="Partes del programa">
            {parts.map((entry, index) => (
              <button key={entry.kind} ref={(node) => { tabs.current[index] = node; }} className="program-part"
                role="tab" aria-selected={selected === index} tabIndex={selected === index ? 0 : -1}
                onClick={() => focusPart(index)} onKeyDown={(event) => moveTab(event, index)}>
                {caption(entry.kind)} <span className="kbd">{keyLabel(index ? "body" : "spec")}</span>
              </button>
            ))}
          </div>
        )}
        {canSplit && (
          <button className="ib" aria-label="Lado a lado" title={keyLabel("sideBySide")} aria-pressed={split} onClick={actions.sideBySide}>
            <SplitVertical size={16} aria-hidden />
          </button>
        )}
        {canCompile && (
          <>
            <button className="btn" onClick={actions.execute} disabled={compiling}>
              <Hammer size={14} aria-hidden /> Compilar <span className="kbd">{keyLabel("execute")}</span>
            </button>
            <button className="btn" onClick={actions.cancel} disabled={!compiling}>
              <Stop size={14} aria-hidden /> Detener <span className="kbd">{keyLabel("cancel")}</span>
            </button>
          </>
        )}
        {readCurrentProgram && (
          <button className="btn" onClick={actions.compareProgram} disabled={comparison?.result.state === "loading"}>
            <GitDiff size={14} aria-hidden /> Comparar con Oracle <span className="kbd">{keyLabel("compareProgram")}</span>
          </button>
        )}
        {readOnly && <span className="program-muted">Solo lectura</span>}
        {message && <span role="status" className="program-muted">{message}</span>}
      </div>
      <div className="program-main" hidden={!!comparison}>
        <aside className="program-outline" aria-label="Estructura" style={{ width: outlineWidth }}>
          <div>Estructura</div>
          {outline.map((entry) => {
            const visibility = canSplit ? (selected === 0 || publicKeys.has(entry.key) ? "Público" : "Privado") : null;
            return (
              <button key={entry.from} type="button" title={`${KIND_BADGES[entry.kind].label} · ${entry.label}`}
                aria-label={[KIND_BADGES[entry.kind].label, entry.label, visibility].filter(Boolean).join(" ")}
                onContextMenu={canTest(entry, selected) ? (event) => {
                  event.preventDefault();
                  openRoutineMenu(entry, event.clientX, event.clientY);
                } : undefined}
                onClick={() => navigateAt(selected, entry.from)}>
                <span className={`decl-badge decl-${entry.kind}`} aria-hidden>{KIND_BADGES[entry.kind].letter}</span>
                <span className="program-outline-name">{entry.label}</span>
                {visibility === "Privado" && <small aria-hidden>Privado</small>}
              </button>
            );
          })}
        </aside>
        <div role="separator" aria-orientation="vertical" aria-label="Ancho de Estructura" tabIndex={0}
          className="program-outline-resizer" aria-valuemin={OUTLINE_WIDTH.min} aria-valuemax={OUTLINE_WIDTH.max}
          aria-valuenow={outlineWidth}
          onDoubleClick={() => setOutlineWidth(OUTLINE_WIDTH.initial)}
          onKeyDown={(event) => {
            const next = { ArrowLeft: outlineWidth - OUTLINE_WIDTH.step, ArrowRight: outlineWidth + OUTLINE_WIDTH.step,
              Home: OUTLINE_WIDTH.min, End: OUTLINE_WIDTH.max }[event.key];
            if (next === undefined) return;
            event.preventDefault();
            setOutlineWidth(next);
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            const startX = event.clientX;
            const startWidth = outlineWidth;
            document.body.classList.add("resizing-columns");
            const move = (e: PointerEvent) => setOutlineWidth(startWidth + e.clientX - startX);
            const stop = () => {
              document.body.classList.remove("resizing-columns");
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", stop);
              window.removeEventListener("pointercancel", stop);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", stop);
            window.addEventListener("pointercancel", stop);
          }} />
        <div className="program-editors">
          {parts.map((entry, index) => (
            <div key={entry.kind} className="program-pane" hidden={!split && selected !== index}>
              {split && <span className="program-pane-label">{caption(entry.kind)}</span>}
              <ProgramEditor
                part={entry}
                label={caption(entry.kind)}
                readOnly={readOnly}
                completion={completion}
                markers={markersFor(index)}
                menuExtra={readOnlyItem ? [readOnlyItem] : undefined}
                activate={() => setSelected(index)}
                onObjectContext={catalog ? (reference, x, y, position) => {
                  const entry = routineAt(index, position);
                  if (entry) {
                    openRoutineMenu(entry, x, y);
                    return;
                  }
                  closeRoutineMenu();
                  closeDeclarationMenu();
                  setObjectMenu({ reference, x, y, id: ++objectRequestId.current });
                } : undefined}
                onView={(view) => { views.current[index] = view; }}
                onChange={(value) => {
                  closeDeclarationMenu();
                  const updated = parts.map((other, i) => i === index
                    ? value
                    : views.current[i]?.state.doc.toString() ?? other.source);
                  setValues(updated);
                  onDirty(updated.some((current, i) => current !== saved.current[i]));
                }}
              />
            </div>
          ))}
        </div>
      </div>
      {comparison && (
        <ProgramComparison label={caption(parts[comparison.index].kind)}
          original={{ ...parts[comparison.index], ...baselines[comparison.index] }}
          local={values[comparison.index]} result={comparison.result} onClose={() => focusPart(comparison.index)} />
      )}
      {!comparison && description && (
        <ObjectDescription key={description.id} object={description.object} sessionId={description.sessionId}
          onClose={() => setDescription(null)} />
      )}
      {active && catalog && objectMenu && (
        <EditorObjectMenu key={objectMenu.id} request={objectMenu} catalog={catalog} onClose={closeObjectMenu}
          readOnlyItem={readOnlyItem}
          onMessage={setMessage}
          onDescribe={(object) => setDescription({ object, sessionId: catalog.sessionId, id: objectMenu.id })} />
      )}
      {active && routineMenu && onTestRoutine && (
        <ContextMenu x={routineMenu.x} y={routineMenu.y} label={routineMenu.name} onClose={closeRoutineMenu}
          items={[...(readOnlyItem ? [readOnlyItem] : []), { label: "Probar", keys: commands.test.keys, run: () => onTestRoutine(routineMenu.name, routineMenu.x, routineMenu.y) }]} />
      )}
      {active && declarationMenu && !comparison && (
        <ContextMenu x={declarationMenu.x} y={declarationMenu.y}
          label={`Declaraciones de ${declarationMenu.name}`} width={360} className="program-declaration-menu"
          items={declarationMenu.targets.map(({ entry, index }) => ({
            label: canSplit ? `${caption(parts[index].kind)} · ${entry.label}` : entry.label,
            run: () => navigateAt(index, entry.from),
          }))}
          onClose={closeDeclarationMenu} />
      )}
      {!comparison && diagnostics.length > 0 && (
        <div className="program-problems" aria-label="Problemas">
          <div>Problemas <span>{diagnostics.length}</span></div>
          {diagnostics.map((item, index) => (
            <button key={index} onClick={() => navigate(selected, item.line, item.column)}>
              <span className={item.warning ? "warning" : "error"}>{item.line}:{item.column}</span>
              {item.text}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
