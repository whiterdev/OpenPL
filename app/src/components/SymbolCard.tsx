import type { SymbolKind } from "../programSymbols";
import type { Resolved, SymbolLocation } from "../symbolResolve";
import "./SymbolCard.css";

const KIND_LABELS: Record<SymbolKind, string> = {
  package: "Paquete",
  procedure: "Procedimiento",
  function: "Función",
  cursor: "Cursor",
  type: "Tipo",
  subtype: "Subtipo",
  variable: "Variable",
  constant: "Constante",
  exception: "Excepción",
  parameter: "Parámetro",
  field: "Campo",
};
const valueKinds = new Set<SymbolKind>(["variable", "constant", "parameter", "field"]);
const MAX_QUERY_LINES = 6;

/** "Spec", "Body" o "Fuente", como las pestañas de la ventana de programa. */
export function partCaption(kind: string) {
  if (kind === "PACKAGE" || kind === "TYPE") return "Spec";
  if (kind.endsWith(" BODY")) return "Body";
  return "Fuente";
}

function place(location: SymbolLocation) {
  if (location.where === "here") return `línea ${location.line}`;
  return `${location.object.name} · ${partCaption(location.partKind)} · línea ${location.line}`;
}

function shortQuery(query: string) {
  const lines = query.split(/\r?\n/);
  return lines.length > MAX_QUERY_LINES ? `${lines.slice(0, MAX_QUERY_LINES).join("\n")}\n…` : query;
}

function Item({ item }: { item: Resolved }) {
  if (item.kind === "column") {
    return (
      <div className="symbol-card-item">
        <div className="symbol-card-head"><code>{item.table}.{item.column.name}</code><span>Columna</span></div>
        <code className="symbol-card-type">{item.column.data_type}{item.column.nullable ? "" : " NOT NULL"}</code>
      </div>
    );
  }
  if (item.kind === "relation") {
    return (
      <div className="symbol-card-item">
        <div className="symbol-card-head"><code>{item.object.owner}.{item.object.name}</code></div>
        <table className="symbol-card-columns">
          <tbody>{item.columns.map((column) => (
            <tr key={column.name}>
              <td>{column.name}</td>
              <td>{column.data_type}</td>
              <td>{column.nullable ? "" : "NOT NULL"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    );
  }
  if (item.kind === "object") {
    return (
      <div className="symbol-card-item">
        <div className="symbol-card-head"><code>{item.object.owner}.{item.object.name}</code></div>
        <p className="symbol-card-note">{item.note}</p>
      </div>
    );
  }
  const { symbol } = item;
  const isValue = valueKinds.has(symbol.kind);
  return (
    <div className="symbol-card-item">
      <div className="symbol-card-head">
        <code>{isValue ? symbol.signature.split(/\s/)[0] : symbol.signature}</code>
        <span>{KIND_LABELS[symbol.kind]}</span>
      </div>
      {isValue && (
        <code className="symbol-card-type">{`${symbol.dataType ?? ""}${symbol.value ? ` := ${symbol.value}` : ""}`}</code>
      )}
      {isValue && !symbol.value && (symbol.kind === "variable" || symbol.kind === "constant") && (
        <p className="symbol-card-note">Sin valor inicial</p>
      )}
      {symbol.query && <pre className="symbol-card-query">{shortQuery(symbol.query)}</pre>}
      {symbol.comment && <p className="symbol-card-comment">{symbol.comment}</p>}
      <p className="symbol-card-place">{place(item.location)}</p>
    </div>
  );
}

/** Contenido de la ficha: un bloque por resultado (las sobrecargas suman bloques). */
export function SymbolCard({ items }: { items: Resolved[] }) {
  return (
    <div className="symbol-card">
      {items.map((item, index) => <Item key={index} item={item} />)}
    </div>
  );
}
