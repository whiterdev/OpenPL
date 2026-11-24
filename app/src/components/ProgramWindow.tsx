import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { FileCode, FloppyDisk, GitDiff, SplitVertical } from "@phosphor-icons/react";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import { copyLineDown, deleteLine, indentLess, indentMore, redo, toggleComment, undo } from "@codemirror/commands";
import { api } from "../api";
import { commands, formatKeys, type CommandId } from "../keymap";
import { describeError, type ObjectInfo, type ProgramPart } from "../types";
import { editorReference } from "../editorReference";
import { positionAt, ProgramEditor } from "./ProgramEditor";
import { EditorObjectMenu, ObjectDescription, type ObjectCatalog, type ObjectRequest } from "./EditorObjectMenu";
import { ProgramComparison, type ComparisonResult } from "./ProgramComparison";
import { prepareProgramScript, type CompilationTarget } from "../programScript";
import { programStructure, type ProgramDeclaration } from "../programStructure";
import { ContextMenu } from "./ContextMenu";

export type ProgramActions = Partial<Record<CommandId, () => void>>;

interface Props {
  parts: ProgramPart[];
  readOnly: boolean;
  onDirty: (dirty: boolean) => void;
  ref?: Ref<ProgramActions>;
  fileName?: string;
  catalog?: ObjectCatalog;
  active?: boolean;
  readCurrentProgram?: () => Promise<ProgramPart[]>;
  compilationTarget?: CompilationTarget;
}

const caption = (kind: string) => {
  if (kind === "PACKAGE" || kind === "TYPE") return "Spec";
  if (kind.endsWith(" BODY")) return "Body";
  return "Fuente";
};

interface DeclarationTarget {
  index: number;
  entry: ProgramDeclaration;
}

export function ProgramWindow({
  parts, readOnly, onDirty, ref, fileName, catalog, active = true, readCurrentProgram, compilationTarget,
}: Props) {
  const [selected, setSelected] = useState(0);
  const [split, setSplit] = useState(false);
  const [values, setValues] = useState(() => parts.map((part) => part.source));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [comparison, setComparison] = useState<{ index: number; result: ComparisonResult; script?: string } | null>(null);
  const [savingScript, setSavingScript] = useState(false);
  const [objectMenu, setObjectMenu] = useState<(ObjectRequest & { id: number }) | null>(null);
  const [declarationMenu, setDeclarationMenu] = useState<{ name: string; x: number; y: number; targets: DeclarationTarget[] } | null>(null);
  const [description, setDescription] = useState<{ object: ObjectInfo; sessionId: string; id: number } | null>(null);
  const objectRequestId = useRef(0);
  const closeObjectMenu = useCallback(() => setObjectMenu(null), []);
  const closeDeclarationMenu = useCallback(() => setDeclarationMenu(null), []);
  useEffect(() => {
    closeObjectMenu();
    closeDeclarationMenu();
  }, [active, catalog?.sessionId, closeObjectMenu, closeDeclarationMenu]);
  const views = useRef<(EditorView | null)[]>([]);
  const saved = useRef(parts.map((part) => part.source));
  const names = useRef<(string | null)[]>([fileName ?? null]);
  const canSplit = parts.length === 2;
  const firstOutline = useMemo(() => programStructure(values[0]), [values[0]]);
  const secondOutline = useMemo(() => values[1] ? programStructure(values[1]) : [], [values[1]]);
  const outline = selected === 0 ? firstOutline : secondOutline;
  const publicKeys = useMemo(() => new Set(firstOutline.map((entry) => entry.key)), [firstOutline]);
  const part = parts[selected];

  function focusPart(index: number) {
    setComparison(null);
    closeDeclarationMenu();
    setSelected(index);
    requestAnimationFrame(() => views.current[index]?.focus());
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
    if (saving || savingScript) return;
    const index = selected;
    const source = values[index];
    const extension = part.kind === "PACKAGE" ? "pks" : part.kind === "PACKAGE BODY" ? "pkb" : "sql";
    setSaving(true);
    setMessage("");
    try {
      const name = await api.saveProgramFile(source, extension, names.current[index] ?? null);
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

  async function compare(target?: CompilationTarget) {
    if (!readCurrentProgram || comparison?.result.state === "loading") return;
    let script: string | undefined;
    if (target) {
      try {
        script = prepareProgramScript(values[selected], part.kind, target);
      } catch (error) {
        setComparison({ index: selected, result: { state: "error", message: describeError(error).message } });
        return;
      }
    }
    const request = { index: selected, result: { state: "loading" }, script } as const;
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

  async function saveScript() {
    const script = comparison?.script;
    if (!script || savingScript || saving) return;
    setSavingScript(true);
    setMessage("");
    try {
      const file = await api.saveProgramFile(script, "sql", "compilar-programa.sql");
      if (file) setMessage("Script guardado");
    } catch (error) {
      setMessage(describeError(error).message);
    } finally {
      setSavingScript(false);
    }
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

  const actions: ProgramActions = {
    save: () => void save(),
    spec: canSplit ? () => focusPart(0) : undefined,
    body: canSplit ? () => focusPart(1) : undefined,
    sideBySide: canSplit ? () => {
      setComparison(null);
      setSplit((value) => !value);
    } : undefined,
    goToDeclaration: declaration,
    execute: !readOnly && readCurrentProgram && compilationTarget
      ? () => void compare(compilationTarget)
      : undefined,
    compareProgram: readCurrentProgram ? () => void compare() : undefined,
    objectActions: catalog ? runInEditor((view) => {
      const position = view.state.selection.main.head;
      const reference = editorReference(view.state, position) ?? (position > 0 ? editorReference(view.state, position - 1) : null);
      if (!reference) return;
      const coords = view.coordsAtPos(position) ?? view.contentDOM.getBoundingClientRect();
      closeDeclarationMenu();
      setObjectMenu({ reference, x: coords.left, y: coords.bottom, id: ++objectRequestId.current });
    }) : undefined,
    goToLine: runInEditor(gotoLine),
    find: runInEditor(openSearchPanel),
    replace: readOnly ? undefined : runInEditor(openSearchPanel),
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
  const diagnostics = values[selected] === part.source ? part.diagnostics : [];
  const keyLabel = (id: CommandId) => formatKeys(commands[id].keys!);

  return (
    <section className="program-window" aria-label="Ventana de programa">
      <div className="program-toolbar">
        {canSplit && parts.map((entry, index) => (
          <button key={entry.kind} className="btn" aria-pressed={selected === index} onClick={() => focusPart(index)}>
            {caption(entry.kind)} <span className="kbd">{keyLabel(index ? "body" : "spec")}</span>
          </button>
        ))}
        {canSplit && (
          <button className="ib" aria-label="Lado a lado" title={keyLabel("sideBySide")} aria-pressed={split} onClick={actions.sideBySide}>
            <SplitVertical size={16} aria-hidden />
          </button>
        )}
        <button className="btn" disabled={saving || savingScript} onClick={actions.save}>
          <FloppyDisk size={14} aria-hidden /> Guardar <span className="kbd">{keyLabel("save")}</span>
        </button>
        {actions.execute && (
          <button className="btn" onClick={actions.execute} disabled={comparison?.result.state === "loading"}>
            <FileCode size={14} aria-hidden /> Preparar compilación <span className="kbd">{keyLabel("execute")}</span>
          </button>
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
        <aside className="program-outline" aria-label="Estructura">
          <div>Estructura</div>
          {outline.map((entry) => (
            <button key={entry.from} type="button" title={entry.label} onClick={() => navigateAt(selected, entry.from)}>
              <span>{entry.label}</span>
              {canSplit && <small>{selected === 0 || publicKeys.has(entry.key) ? "Público" : "Privado"}</small>}
            </button>
          ))}
        </aside>
        <div className="program-editors">
          {parts.map((entry, index) => (
            <div key={entry.kind} className="program-pane" hidden={!split && selected !== index}>
              {split && <span className="program-pane-label">{caption(entry.kind)}</span>}
              <ProgramEditor
                part={entry}
                label={caption(entry.kind)}
                readOnly={readOnly}
                activate={() => setSelected(index)}
                onObjectContext={catalog ? (reference, x, y) => {
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
        <ProgramComparison label={caption(parts[comparison.index].kind)} original={parts[comparison.index]}
          local={values[comparison.index]} result={comparison.result} onClose={() => focusPart(comparison.index)}
          onSaveScript={comparison.script && readCurrentProgram ? () => void saveScript() : undefined}
          savingScript={savingScript || saving} />
      )}
      {!comparison && description && (
        <ObjectDescription key={description.id} object={description.object} sessionId={description.sessionId}
          onClose={() => setDescription(null)} />
      )}
      {active && catalog && objectMenu && (
        <EditorObjectMenu key={objectMenu.id} request={objectMenu} catalog={catalog} onClose={closeObjectMenu}
          onMessage={setMessage}
          onDescribe={(object) => setDescription({ object, sessionId: catalog.sessionId, id: objectMenu.id })} />
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
