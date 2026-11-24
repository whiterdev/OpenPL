import { useEffect, useRef, useState } from "react";
import type { ObjectInfo } from "../types";
import { accountDraft, renameDraft } from "../objectDraft";
import "./ObjectInspector.css";

export function ObjectDraftDialog({ object, action, onClose, onPrepare }: {
  object: ObjectInfo;
  action: "account" | "rename";
  onClose: () => void;
  onPrepare: (sql: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [lock, setLock] = useState(true);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const sql = action === "account" ? accountDraft(object, lock) : renameDraft(object, name);
  return (
    <dialog ref={dialog} className="object-inspector" aria-labelledby="object-draft-title" onCancel={onClose}>
      <header>
        <h2 id="object-draft-title">{action === "rename" ? "Renombrar" : "Editar usuario"} · {object.name}</h2>
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
      </header>
      <form onSubmit={(event) => { event.preventDefault(); if (sql) onPrepare(sql); }}>
        {action === "rename"
          ? <label>Nuevo nombre<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
          : <label>Estado de la cuenta<select value={lock ? "lock" : "unlock"} onChange={(event) => setLock(event.target.value === "lock")}>
            <option value="lock">Bloquear</option><option value="unlock">Desbloquear</option>
          </select></label>}
        <button className="btn" disabled={!sql}>Preparar SQL</button>
      </form>
    </dialog>
  );
}
