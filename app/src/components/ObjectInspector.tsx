import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { InspectMode } from "../objectMenu";
import { describeError, type ObjectColumn, type ObjectInfo } from "../types";
import "./ObjectInspector.css";

export interface Inspection {
  object: ObjectInfo;
  sessionId: string;
  mode: InspectMode;
}

const titles = { properties: "Propiedades", describe: "Describir", compare: "Comparar con…" };
const relation = new Set(["Table", "View", "MaterializedView"]);
const withoutDdl = new Set(["RecycleBin", "DbmsJob", "JavaClass", "User"]);

export function ObjectInspector({ object, sessionId, mode, onClose }: Inspection & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [owner, setOwner] = useState(object.owner);
  const [name, setName] = useState("");
  const [source, setSource] = useState<string>();
  const [comparison, setComparison] = useState<{ name: string; source: string }>();
  const [columns, setColumns] = useState<ObjectColumn[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const label = object.owner ? object.owner + "." + object.name : object.name;

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (mode !== "describe" || withoutDdl.has(object.object_type)) return;
    let current = true;
    setBusy(true);
    const read = relation.has(object.object_type)
      ? api.describeColumns(sessionId, object.owner, object.name).then((value) => { if (current) setColumns(value); })
      : api.objectDdl(sessionId, object.object_type, object.owner, object.name).then((value) => { if (current) setSource(value); });
    void read.catch((err) => { if (current) setError(describeError(err).message); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [object, sessionId, mode]);

  async function compare() {
    setBusy(true);
    setError("");
    setComparison(undefined);
    try {
      const [left, right] = await Promise.all([
        api.objectDdl(sessionId, object.object_type, object.owner, object.name),
        api.objectDdl(sessionId, object.object_type, owner.trim(), name.trim()),
      ]);
      setSource(left);
      setComparison({ name: owner.trim() + "." + name.trim(), source: right });
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="object-inspector" aria-labelledby="inspector-title" onCancel={onClose}>
      <header><h2 id="inspector-title">{titles[mode]}</h2><button type="button" className="btn" onClick={onClose}>Cerrar</button></header>
      <dl><dt>Objeto</dt><dd>{label}</dd><dt>Tipo</dt><dd>{object.object_type}</dd>
        <dt>Estado</dt><dd>{object.status === "Valid" ? "Válido" : "Inválido"}</dd>
        <dt>Último DDL</dt><dd>{object.last_ddl_time || "—"}</dd></dl>
      {mode === "compare" && <form onSubmit={(event) => { event.preventDefault(); void compare(); }}>
        <label>Esquema<input required value={owner} onChange={(event) => setOwner(event.target.value)} /></label>
        <label>Objeto de destino<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <button className="btn" disabled={busy || !owner.trim() || !name.trim()}>Comparar</button>
      </form>}
      {busy && <p role="status">Cargando…</p>}
      {error && <p role="alert">{error}</p>}
      {columns && (columns.length ? <table><thead><tr><th>Columna</th><th>Tipo</th><th>Acepta nulos</th></tr></thead>
        <tbody>{columns.map((column) => <tr key={column.name}><td>{column.name}</td><td>{column.data_type}</td><td>{column.nullable ? "Sí" : "No"}</td></tr>)}</tbody></table>
        : <p>Sin columnas disponibles.</p>)}
      {mode === "describe" && source !== undefined && <pre tabIndex={0}>{source || "Fuente no disponible."}</pre>}
      {comparison && <><p role="status">{source === comparison.source ? "DDL idéntico" : "DDL distinto"}</p>
        <div className="object-inspector-diff">
          <section><h3>{label}</h3><pre tabIndex={0}>{source}</pre></section>
          <section><h3>{comparison.name}</h3><pre tabIndex={0}>{comparison.source}</pre></section>
        </div></>}
    </dialog>
  );
}
