import { useRef, useState } from "react";
import { abbreviationPattern, loadScriptShortcuts, saveScriptShortcuts, type ScriptShortcut } from "../autoReplace";
import { commands } from "../keymap";
import { ToolsDialog } from "./ToolsDialog";

const empty: ScriptShortcut = { abbreviation: "", script: "" };

export function AutoReplaceDialog({ close }: { close: () => void }) {
  const [entries, setEntries] = useState(loadScriptShortcuts);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState(empty);
  const [error, setError] = useState("");
  const field = useRef<HTMLInputElement>(null);

  function edit(index: number | null) {
    setSelected(index);
    setDraft(index === null ? empty : entries[index]);
    setError("");
    field.current?.focus();
  }

  function store(next: ScriptShortcut[]) {
    try {
      saveScriptShortcuts(next);
      setEntries(next);
      edit(null);
    } catch {
      setError("No se pudieron guardar los scripts");
    }
  }

  function save() {
    const abbreviation = draft.abbreviation.trim().toUpperCase();
    if (!abbreviationPattern.test(abbreviation)) {
      setError("Usá una letra inicial y luego letras, números o guiones bajos");
      field.current?.focus();
      return;
    }
    if (entries.some((entry, index) => index !== selected && entry.abbreviation.toUpperCase() === abbreviation)) {
      setError("La abreviatura ya existe");
      field.current?.focus();
      return;
    }
    const entry = { abbreviation, script: draft.script };
    store(selected === null ? [...entries, entry] : entries.map((old, index) => index === selected ? entry : old));
  }

  return (
    <ToolsDialog title={commands.autoReplace.label} close={close}>
      <p>Expandir script con {commands.expandScript.keys}</p>
      <button className="btn" type="button" onClick={() => edit(null)}>Nuevo</button>
      {entries.length > 0 && <ul className="tool-list" aria-label="Scripts">
        {entries.map((entry, index) => (
          <li key={entry.abbreviation}>
            <button className="btn" type="button" aria-pressed={selected === index}
              onClick={() => edit(index)}>{entry.abbreviation}</button>
          </li>
        ))}
      </ul>}
      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <label>Abreviatura
          <input ref={field} placeholder="SEL" value={draft.abbreviation} spellCheck={false} required
            onChange={(event) => { setDraft({ ...draft, abbreviation: event.target.value }); setError(""); }} />
        </label>
        <label>Script
          <textarea rows={5} value={draft.script} spellCheck={false} required
            onChange={(event) => { setDraft({ ...draft, script: event.target.value }); setError(""); }} />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          {selected !== null && <button type="button" className="btn"
            onClick={() => store(entries.filter((_, index) => index !== selected))}>Eliminar</button>}
          <button type="submit" className="btn primary" disabled={!draft.abbreviation.trim() || !draft.script.trim()}>Guardar</button>
          <button type="button" className="btn" onClick={close}>Cerrar</button>
        </div>
      </form>
    </ToolsDialog>
  );
}
