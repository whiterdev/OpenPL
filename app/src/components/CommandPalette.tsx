import { useEffect, useId, useRef, useState } from "react";
import { commands, formatKeys, type CommandId } from "../keymap";

const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export function CommandPalette({ actions, onClose }: {
  actions: Partial<Record<CommandId, () => void>>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useId();
  const entries = Object.values(commands)
    .filter(({ id, label, keys }) => id !== "palette" && actions[id] &&
      normalize(`${label} ${keys ? formatKeys(keys) : ""}`).includes(normalize(query)))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
  const run = (id: CommandId) => {
    onClose();
    actions[id]?.();
  };

  useEffect(() => {
    const previous = document.activeElement;
    input.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Buscar comando" className="dialog command-palette"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const next = Math.max(0, Math.min(entries.length - 1, selected + (event.key === "ArrowDown" ? 1 : -1)));
            setSelected(next);
            document.getElementById(`${list}-${next}`)?.scrollIntoView?.({ block: "nearest" });
          } else if (event.key === "Enter" && entries[selected]) {
            event.preventDefault();
            run(entries[selected].id);
          } else if (event.key === "Tab") {
            event.preventDefault();
          }
        }}>
        <input ref={input} className="fld" aria-label="Buscar comando" placeholder="Buscar comando"
          aria-controls={list} aria-activedescendant={entries[selected] ? `${list}-${selected}` : undefined}
          value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} />
        <div id={list} role="listbox" aria-label="Comandos disponibles" className="command-palette-list">
          {entries.map(({ id, label, keys }, index) => (
            <button key={id} type="button" role="option" id={`${list}-${index}`} aria-selected={index === selected}
              tabIndex={-1} className="menu-item" onClick={() => run(id)}>
              <span>{label}</span>
              {keys && <span className="kbd">{formatKeys(keys)}</span>}
            </button>
          ))}
          {!entries.length && <p role="status">Sin comandos</p>}
        </div>
      </div>
    </div>
  );
}
