import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { GitDiff, Hammer, SplitVertical, Stop } from "@phosphor-icons/react";
import { EditorView } from "@codemirror/view";
import { EditorSelection, Text } from "@codemirror/state";
import { foldCode, unfoldCode } from "@codemirror/language";
import { startCompletion } from "@codemirror/autocomplete";
import { gotoLine } from "@codemirror/search";
import { findNextMatch, findPrevMatch, openFind, openReplace } from "./EditorSearch";
import { copyLineDown, deleteLine, indentLess, indentMore, redo, toggleComment, undo } from "@codemirror/commands";
import { api } from "../api";
import { commands, formatKeys, type CommandId } from "../keymap";
import { describeError, type ObjectInfo, type ProgramPart } from "../types";
import { editorReference } from "../editorReference";
import {
  NAVIGATION_TITLES, navigationMenuItems, navigationTargets, resolveAt,
  type NavigationGoal, type NavigationTarget,
} from "../editorNavigation";
import { partCaption } from "./SymbolCard";
import { positionAt, ProgramEditor, type EditorMarker } from "./ProgramEditor";
import { EditorObjectMenu, ObjectDescription, type ObjectCatalog, type ObjectRequest } from "./EditorObjectMenu";
import { ProgramComparison, type ComparisonResult } from "./ProgramComparison";
import { compileStatement, type CompilationTarget } from "../programScript";
import { programStructure, type DeclarationKind, type ProgramDeclaration } from "../programStructure";
import { useCompletionCatalog } from "../useCompletionCatalog";
import { ContextMenu } from "./ContextMenu";
import type { SourcePart, SymbolLookup } from "../symbolSources";
import { editorPart, showSymbolCard, type ContextFor } from "../symbolHover";

export type ProgramActions = Partial<Record<CommandId, () => void>> & { hasPending?: () => boolean };

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
/** Pausa tras la última tecla antes de recalcular la estructura y las marcas. */
const SETTLE_MS = 150;
const toDoc = (source: string) => Text.of(source.split(/\r\n?|\n/));

const baselineOf = (entry: ProgramPart): Baseline => ({
  text: entry.source, source: entry.source, last_ddl_time: entry.last_ddl_time, diagnostics: entry.diagnostics,
});

interface Props {
  parts: ProgramPart[];
  readOnly: boolean;
  onReadOnlyChange?: (readOnly: boolean) => void;
  onTestRoutine?: (name: string, x: number, y: number) => void;
  onDirty: (dirty: boolean) => void;
  onWorkspaceChange?: (doc: Text) => void;
  ref?: Ref<ProgramActions>;
  fileName?: string;
  catalog?: ObjectCatalog;
  active?: boolean;
  readCurrentProgram?: () => Promise<ProgramPart[]>;
  compilationTarget?: CompilationTarget;
  compile?: ProgramCompiler;
  /** Registra el texto vivo para la ficha y la navegación de otras ventanas. */
  registerSource?: (read: () => SourcePart[]) => () => void;
  /** Catálogo para la ficha y la navegación; null o ausente: solo lo del documento. */
  symbols?: SymbolLookup | null;
  /** Objeto que muestra la ventana, para ubicar sus propias declaraciones. */
  symbolSelf?: Pick<ObjectInfo, "owner" | "name" | "object_type"> | null;
  /** Destinos en otro objeto: la ventana pide abrirlo. */
  onNavigate?: (target: NavigationTarget) => void;
  /** Posición a la que ir al abrir o al pedir un destino nuevo. */
  initialTarget?: { partKind: string; line: number; column: number };
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


export function ProgramWindow({
  parts, readOnly, onReadOnlyChange, onDirty, onWorkspaceChange, ref, fileName, catalog, active = true, readCurrentProgram, compilationTarget, compile, onTestRoutine, registerSource, symbols, symbolSelf,
  onNavigate, initialTarget,
}: Props) {
  const [baselines, setBaselines] = useState<Baseline[]>(() => parts.map(baselineOf));
  const [compiling, setCompiling] = useState(false);
  const compilation = useRef<{ stopped: boolean } | null>(null);
  const [selected, setSelected] = useState(0);
  const [split, setSplit] = useState(false);
  const [values, setValues] = useState(() => parts.map((part) => part.source));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [comparison, setComparison] = useState<{ index: number; result: ComparisonResult } | null>(null);
  const [objectMenu, setObjectMenu] = useState<(ObjectRequest & { id: number; part: number; position: number }) | null>(null);
  const [declarationMenu, setDeclarationMenu] = useState<{ title: string; x: number; y: number; targets: NavigationTarget[] } | null>(null);
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
  // Último texto guardado o compilado; doc.eq comparte estructura con el editor y no recorre el documento.
  const [saved] = useState(() => ({ current: parts.map((part) => toDoc(part.source)) }));
  const dirty = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const names = useRef<(string | null)[]>([fileName ?? null]);
  const root = useRef<HTMLElement>(null);
  const shownParts = useRef(parts);
  const wasActive = useRef(active);
  const liveParts = useRef(parts);
  liveParts.current = parts;
  const registerRef = useRef(registerSource);
  registerRef.current = registerSource;
  const liveSources = useCallback(() => liveParts.current.map((entry, index): SourcePart => {
    const view = views.current[index];
    return view ? editorPart(entry.kind, view) : { kind: entry.kind, source: entry.source };
  }), []);
  useEffect(() => registerRef.current?.(liveSources), [liveSources]);
  const activeRef = useRef(active);
  activeRef.current = active;
  const symbolRefs = useRef({ symbols, symbolSelf });
  symbolRefs.current = { symbols, symbolSelf };
  const symbolContext = useCallback<ContextFor>((view, position) => {
    const current = views.current.indexOf(view);
    if (current < 0) return null;
    return {
      parts: liveSources(),
      current,
      position,
      self: symbolRefs.current.symbolSelf ?? null,
      lookup: symbolRefs.current.symbols ?? null,
    };
  }, [liveSources]);

  function currentTexts() {
    return parts.map((entry, index) => views.current[index]?.state.doc.toString() ?? entry.source);
  }

  function isDirty() {
    return parts.some((_, index) => {
      const view = views.current[index];
      return !!view && !!saved.current[index] && !view.state.doc.eq(saved.current[index]);
    });
  }

  function reportDirty() {
    const now = isDirty();
    if (now === dirty.current) return;
    dirty.current = now;
    onDirty(now);
  }

  /** Texto actual de cada parte; adelanta la pausa si hay teclas sin procesar. */
  function flush() {
    if (!settle.current) return values;
    clearTimeout(settle.current);
    settle.current = null;
    const texts = currentTexts();
    setValues(texts);
    return texts;
  }

  // Una recarga reemplaza el texto con dispatch para no perder el historial; un borrador con cambios no se toca.
  useEffect(() => {
    if (shownParts.current === parts) return;
    shownParts.current = parts;
    const reloaded = parts.map((entry, index) => {
      const view = views.current[index];
      const previous = saved.current[index];
      if (view && previous !== undefined && !view.state.doc.eq(previous)) return false;
      saved.current[index] = toDoc(entry.source);
      if (view && !view.state.doc.eq(saved.current[index])) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: entry.source } });
      }
      if (view) saved.current[index] = view.state.doc;
      return true;
    });
    saved.current.length = parts.length;
    if (settle.current) clearTimeout(settle.current);
    settle.current = null;
    setBaselines((all) => parts.map((entry, index) => reloaded[index] || !all[index] ? baselineOf(entry) : all[index]));
    setValues(currentTexts());
    setSelected((index) => index < parts.length ? index : 0);
    dirty.current = isDirty();
    onDirty(dirty.current);
  }, [parts, onDirty]);

  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
  }, []);

  useEffect(() => {
    const activated = active && !wasActive.current;
    wasActive.current = active;
    if (!activated || comparison) return;
    const focused = document.activeElement;
    if (focused && root.current?.contains(focused)) return;
    if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
    views.current[selected]?.focus();
  }, [active, selected, comparison]);
  const canSplit = parts.length === 2;
  const firstOutline = useMemo(() => programStructure(values[0]), [values[0]]);
  const secondOutline = useMemo(() => values[1] ? programStructure(values[1]) : [], [values[1]]);
  const outline = selected === 0 ? firstOutline : secondOutline;
  const publicKeys = useMemo(() => new Set(firstOutline.map((entry) => entry.key)), [firstOutline]);
  /** Estructura del texto actual, para comandos que llegan antes de terminar la pausa. */
  function structureNow() {
    const texts = flush();
    if (texts === values) return { texts, first: firstOutline, second: secondOutline, keys: publicKeys };
    const first = programStructure(texts[0]);
    const second = texts[1] ? programStructure(texts[1]) : [];
    return { texts, first, second, keys: new Set(first.map((entry) => entry.key)) };
  }
  function canTest(entry: ProgramDeclaration, index: number, keys = publicKeys) {
    const kind = parts[index].kind;
    return !!onTestRoutine && (entry.kind === "procedure" || entry.kind === "function") &&
      (kind === "PACKAGE" || (kind === "PACKAGE BODY" && index > 0 && keys.has(entry.key)) ||
        kind === "PROCEDURE" || kind === "FUNCTION");
  }
  function openRoutineMenu(entry: ProgramDeclaration, x: number, y: number) {
    closeObjectMenu();
    closeDeclarationMenu();
    setRoutineMenu({ name: entry.name, x, y });
  }
  function routineAt(index: number, position: number) {
    const { texts, first, second, keys } = structureNow();
    return (index === 0 ? first : second).find((entry) =>
      canTest(entry, index, keys) && position >= entry.from &&
      position < entry.from + entry.name.length + (texts[index][entry.from] === '"' ? 2 : 0));
  }
  const part = parts[selected];
  const sessionId = catalog?.sessionId;
  const contextOwner = catalog?.owner ?? null;
  const completion = useCompletionCatalog(sessionId, contextOwner);

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

  function openTarget(target: NavigationTarget) {
    const { location } = target;
    if (location.where === "here") navigateAt(location.part, location.from);
    else onNavigate?.(target);
  }

  function targetLabel({ location, label }: NavigationTarget) {
    if (location.where === "object") return `${location.object.name} · ${partCaption(location.partKind)} · ${label}`;
    return canSplit ? `${caption(parts[location.part].kind)} · ${label}` : label;
  }

  /** Definición, declaración o implementación del nombre en `at` (o en el cursor). */
  /** `onMiss`: el nombre no lleva a ningún lado (Ctrl+clic lo usa para ubicar el cursor). */
  async function goTo(goal: NavigationGoal, index = selected, at?: number, onMiss?: () => void) {
    if (comparison) return;
    const view = views.current[index];
    if (!view) return;
    const position = at ?? view.state.selection.main.from;
    const { doc } = view.state;
    const head = view.state.selection.main.head;
    const found = await resolveAt(view, position, symbolContext);
    // Si mientras tanto se escribió o se movió el cursor, el destino ya no corresponde.
    if (!found || !activeRef.current || view.state.doc !== doc || view.state.selection.main.head !== head) return;
    const { name, items } = found;
    const relation = items.find((item) => item.kind === "relation");
    if (relation?.kind === "relation") {
      if (catalog) setDescription({ object: relation.object, sessionId: catalog.sessionId, id: ++objectRequestId.current });
      return;
    }
    const { targets, notice } = navigationTargets(items, goal);
    if (notice) setMessage(notice);
    if (targets.length === 1) {
      openTarget(targets[0]);
    } else if (targets.length > 1) {
      const coords = view.coordsAtPos(position) ?? view.contentDOM.getBoundingClientRect();
      closeObjectMenu();
      setDeclarationMenu({
        title: `${NAVIGATION_TITLES[goal]} de ${name}`,
        x: coords.left, y: coords.bottom, targets,
      });
    } else {
      onMiss?.();
    }
  }

  useEffect(() => {
    if (!initialTarget) return;
    const index = parts.findIndex((part) => part.kind === initialTarget.partKind);
    if (index >= 0) navigate(index, initialTarget.line, initialTarget.column);
    // Solo al pedir un destino nuevo; `parts` llega junto con él.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTarget]);

  async function save() {
    if (saving) return;
    const index = selected;
    const doc = views.current[index]?.state.doc;
    const source = doc?.toString() ?? values[index];
    setSaving(true);
    setMessage("");
    try {
      const name = await api.saveProgramFile(source, "sql", names.current[index] ?? null);
      if (name) {
        names.current[index] = name;
        saved.current[index] = doc ?? toDoc(source);
        reportDirty();
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
    flush();
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
    const doc = views.current[index]?.state.doc;
    const text = doc?.toString() ?? values[index];
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
      saved.current[index] = doc ?? toDoc(text);
      reportDirty();
      flush();
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
    goToDefinition: () => void goTo("definition"),
    goToDeclaration: () => void goTo("declaration"),
    goToImplementation: () => void goTo("implementation"),
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
      setObjectMenu({ reference, x: coords.left, y: coords.bottom, id: ++objectRequestId.current, part: selected, position });
    }) : undefined,
    complete: readOnly ? undefined : runInEditor(startCompletion),
    showSymbolCard: runInEditor(showSymbolCard),
    goToLine: runInEditor(gotoLine),
    find: runInEditor(openFind),
    findNext: runInEditor(findNextMatch),
    findPrev: runInEditor(findPrevMatch),
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
    <section ref={root} className="program-window" aria-label="Ventana de programa">
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
                symbolContext={symbolContext}
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
                  setObjectMenu({ reference, x, y, id: ++objectRequestId.current, part: index, position });
                } : undefined}
                onCtrlClick={(position) => void goTo("definition", index, position, () => {
                  views.current[index]?.dispatch({ selection: { anchor: position } });
                })}
                onView={(view) => {
                  views.current[index] = view;
                  const base = saved.current[index];
                  if (view && base && view.state.doc.eq(base)) saved.current[index] = view.state.doc;
                }}
                onChange={(doc) => {
                  if (index === 0) onWorkspaceChange?.(doc);
                  if (declarationMenu) closeDeclarationMenu();
                  reportDirty();
                  if (settle.current) clearTimeout(settle.current);
                  settle.current = setTimeout(() => {
                    settle.current = null;
                    setValues(currentTexts());
                  }, SETTLE_MS);
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
          onClose={() => {
            setDescription(null);
            views.current[selected]?.focus();
          }} />
      )}
      {active && catalog && objectMenu && (
        <EditorObjectMenu key={objectMenu.id} request={objectMenu} catalog={catalog} onClose={closeObjectMenu}
          readOnlyItem={readOnlyItem}
          navigation={navigationMenuItems((goal) => void goTo(goal, objectMenu.part, objectMenu.position))}
          onMessage={setMessage}
          onDescribe={(object) => setDescription({ object, sessionId: catalog.sessionId, id: objectMenu.id })} />
      )}
      {active && routineMenu && onTestRoutine && (
        <ContextMenu x={routineMenu.x} y={routineMenu.y} label={routineMenu.name} onClose={closeRoutineMenu}
          items={[...(readOnlyItem ? [readOnlyItem] : []), { label: "Probar", keys: commands.test.keys, run: () => onTestRoutine(routineMenu.name, routineMenu.x, routineMenu.y) }]} />
      )}
      {active && declarationMenu && !comparison && (
        <ContextMenu x={declarationMenu.x} y={declarationMenu.y}
          label={declarationMenu.title} width={360} className="program-declaration-menu"
          items={declarationMenu.targets.map((target) => ({
            label: targetLabel(target),
            run: () => openTarget(target),
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
