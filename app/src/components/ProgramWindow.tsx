import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { FloppyDisk, SplitVertical } from "@phosphor-icons/react";
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

export type ProgramActions = Partial<Record<CommandId, () => void>>;

interface Props {
  parts: ProgramPart[];
  readOnly: boolean;
  onDirty: (dirty: boolean) => void;
  ref?: Ref<ProgramActions>;
  fileName?: string;
  catalog?: ObjectCatalog;
  active?: boolean;
}

const caption = (kind: string) => {
  if (kind === "PACKAGE" || kind === "TYPE") return "Spec";
  if (kind.endsWith(" BODY")) return "Body";
  return "Fuente";
};

function declarations(source: string) {
  // Conserva los saltos de línea al omitir comentarios y cadenas SQL ordinarias.
  const code = source.replace(/\/\*[\s\S]*?\*\/|--[^\n]*|'(?:''|[^'])*'/g, (text) => text.replace(/[^\r\n]/g, " "));
  return code.split("\n").flatMap((text, index) => {
    const match = /^\s*(?:(?:create\s+or\s+replace)\s+)?(?:procedure|function|type|subtype|cursor)\s+("[^"]+"|[\w$#]+)/i.exec(text);
    return match ? [{ name: match[1], line: index + 1 }] : [];
  });
}

export function ProgramWindow({ parts, readOnly, onDirty, ref, fileName, catalog, active = true }: Props) {
  const [selected, setSelected] = useState(0);
  const [split, setSplit] = useState(false);
  const [values, setValues] = useState(() => parts.map((part) => part.source));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [objectMenu, setObjectMenu] = useState<(ObjectRequest & { id: number }) | null>(null);
  const [description, setDescription] = useState<{ object: ObjectInfo; sessionId: string; id: number } | null>(null);
  const objectRequestId = useRef(0);
  const closeObjectMenu = useCallback(() => setObjectMenu(null), []);
  useEffect(() => { closeObjectMenu(); }, [active, catalog?.sessionId, closeObjectMenu]);
  const views = useRef<(EditorView | null)[]>([]);
  const saved = useRef(parts.map((part) => part.source));
  const names = useRef<(string | null)[]>([fileName ?? null]);
  const canSplit = parts.length === 2;
  const spec = canSplit ? declarations(values[0]) : [];
  const outline = declarations(values[selected]);
  const part = parts[selected];

  function focusPart(index: number) {
    setSelected(index);
    requestAnimationFrame(() => views.current[index]?.focus());
  }

  function navigate(index: number, line: number, column = 1) {
    const view = views.current[index];
    if (!view) return;
    const anchor = positionAt(view, line, column);
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    focusPart(index);
  }

  function declaration() {
    const view = views.current[selected];
    if (!view) return;
    const selection = view.state.selection.main;
    const range = selection.empty ? view.state.wordAt(selection.head) : selection;
    const name = range && view.state.sliceDoc(range.from, range.to).toUpperCase();
    const publicEntry = spec.find((entry) => entry.name.toUpperCase() === name);
    const entry = outline.find((item) => item.name.toUpperCase() === name);
    if (publicEntry) navigate(0, publicEntry.line);
    else if (entry) navigate(selected, entry.line);
  }

  async function save() {
    if (saving) return;
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
      const view = views.current[selected];
      if (view) action(view);
    };
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
    sideBySide: canSplit ? () => setSplit((value) => !value) : undefined,
    goToDeclaration: declaration,
    objectActions: catalog ? runInEditor((view) => {
      const position = view.state.selection.main.head;
      const reference = editorReference(view.state, position) ?? (position > 0 ? editorReference(view.state, position - 1) : null);
      if (!reference) return;
      const coords = view.coordsAtPos(position) ?? view.contentDOM.getBoundingClientRect();
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
        <button className="btn" disabled={saving} onClick={actions.save}>
          <FloppyDisk size={14} aria-hidden /> Guardar <span className="kbd">{keyLabel("save")}</span>
        </button>
        {readOnly && <span className="program-muted">Solo lectura</span>}
        {message && <span role="status" className="program-muted">{message}</span>}
      </div>
      <div className="program-main">
        <aside className="program-outline" aria-label="Estructura">
          <div>Estructura</div>
          {outline.map((entry) => (
            <button key={entry.line} type="button" onClick={() => navigate(selected, entry.line)}>
              {entry.name}
              {canSplit && <small>{selected === 0 || spec.some((item) => item.name.toUpperCase() === entry.name.toUpperCase()) ? "Público" : "Privado"}</small>}
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
                  setObjectMenu({ reference, x, y, id: ++objectRequestId.current });
                } : undefined}
                onView={(view) => { views.current[index] = view; }}
                onChange={(value) => {
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
      {description && (
        <ObjectDescription key={description.id} object={description.object} sessionId={description.sessionId}
          onClose={() => setDescription(null)} />
      )}
      {active && catalog && objectMenu && (
        <EditorObjectMenu key={objectMenu.id} request={objectMenu} catalog={catalog} onClose={closeObjectMenu}
          onMessage={setMessage}
          onDescribe={(object) => setDescription({ object, sessionId: catalog.sessionId, id: objectMenu.id })} />
      )}
      {diagnostics.length > 0 && (
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
