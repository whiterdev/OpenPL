import { useEffect, useState } from "react";
import { api } from "../api";
import type { EditorReference } from "../editorReference";
import { describeError, type ObjectInfo, type ObjectColumn } from "../types";
import { ContextMenu, type ContextItem } from "./ContextMenu";

export interface ObjectCatalog {
  sessionId: string;
  owner: string | null;
  openProgram: (object: ObjectInfo) => void;
}

export interface ObjectRequest {
  reference: EditorReference;
  x: number;
  y: number;
}

interface Props {
  request: ObjectRequest;
  catalog: ObjectCatalog;
  onClose: () => void;
  onDescribe: (object: ObjectInfo) => void;
  onMessage: (message: string) => void;
}

const tableTypes = new Set(["Table", "View", "MaterializedView"]);
const programTypes = new Set(["Package", "Type", "Function", "Procedure", "Trigger"]);
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function EditorObjectMenu({ request, catalog, onClose, onDescribe, onMessage }: Props) {
  const [result, setResult] = useState<{ object: ObjectInfo | null; message?: string }>();
  const { reference } = request;
  const { sessionId, owner } = catalog;

  useEffect(() => {
    let cancelled = false;
    api.editorObject(sessionId, reference, owner)
      .then((object) => { if (!cancelled) setResult({ object }); })
      .catch((error) => { if (!cancelled) setResult({ object: null, message: describeError(error).message }); });
    return () => { cancelled = true; };
  }, [sessionId, owner, reference]);

  const object = result?.object;
  async function copy(text: string) {
    try {
      if (!navigator.clipboard) throw new Error("Portapapeles no disponible");
      await navigator.clipboard.writeText(text);
    } catch (error) {
      onMessage(describeError(error).message);
    }
  }
  const items: (ContextItem | "sep")[] = [];
  if (object) {
    if (tableTypes.has(object.object_type)) items.push({ label: "Describir", run: () => onDescribe(object) });
    if (programTypes.has(object.object_type)) items.push({ label: "Ver fuente", run: () => catalog.openProgram(object) });
    items.push(
      { label: "Copiar nombre", run: () => void copy(object.name) },
      { label: "Copiar nombre con esquema", run: () => void copy(`${quote(object.owner)}.${quote(object.name)}`) },
      { label: "Copiar DDL", run: () => {
        void api.objectDdl(sessionId, object.object_type, object.owner, object.name)
          .then(copy).catch((error) => onMessage(describeError(error).message));
      } },
    );
  } else {
    items.push({ label: result ? result.message ?? "Objeto no encontrado" : "Buscando objeto…" });
  }
  const label = object ? `${object.owner}.${object.name}` : reference.name;
  return <ContextMenu x={request.x} y={request.y} label={label} items={items} onClose={onClose} />;
}

export function ObjectDescription({ sessionId, object, onClose }: {
  sessionId: string;
  object: ObjectInfo;
  onClose: () => void;
}) {
  const [columns, setColumns] = useState<ObjectColumn[]>();
  const [error, setError] = useState("");
  const { owner, name } = object;

  useEffect(() => {
    let cancelled = false;
    api.describeColumns(sessionId, owner, name)
      .then((data) => { if (!cancelled) setColumns(data); })
      .catch((failure) => { if (!cancelled) setError(describeError(failure).message); });
    return () => { cancelled = true; };
  }, [sessionId, owner, name]);

  const title = `${owner}.${name}`;
  return (
    <section className="program-description" aria-label={`Descripción de ${title}`}>
      <header><strong>{title}</strong><button className="btn" onClick={onClose}>Cerrar descripción</button></header>
      {error ? <p role="alert">{error}</p> : columns ? columns.length ? (
        <table>
          <thead><tr><th>Columna</th><th>Tipo</th><th>Nulos</th></tr></thead>
          <tbody>{columns.map((column) => (
            <tr key={column.name}><td>{column.name}</td><td>{column.data_type}</td><td>{column.nullable ? "Sí" : "No"}</td></tr>
          ))}</tbody>
        </table>
      ) : <p>Sin columnas visibles</p> : <p role="status">Cargando columnas…</p>}
    </section>
  );
}
