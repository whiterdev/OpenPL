import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Minus, PencilSimple, Plus, WarningCircle } from "@phosphor-icons/react";
import type { SqlColumn } from "../types";
import type { Cell } from "../gridEdits";
import { commands, formatKeys, matches } from "../keymap";

export type RowStatus = "update" | "delete" | "insert" | "conflict";
export interface CellPosition { row: number; col: number }

interface Props {
  /** Identifica la consulta; los anchos se recalculan solo cuando cambia. */
  queryKey: number;
  columns: SqlColumn[];
  rows: Cell[][];
  status: (RowStatus | null)[];
  isModified: (row: number, col: number) => boolean;
  /** Columnas editables cuando la grilla está en edición; `null` fuera de edición. */
  editable: boolean[] | null;
  selected: CellPosition | null;
  onSelect: (position: CellPosition) => void;
  onEdit: (position: CellPosition, value: Cell) => void;
  more: boolean;
  fetching: boolean;
  fetchError: string | null;
  onFetchAll: (() => void) | undefined;
}

const ROW = 24;
// Con pocas filas se dibujan todas; desde aquí se virtualiza.
const VIRTUALIZE_ABOVE = 300;
const STATUS_LABEL: Record<RowStatus, string> = {
  update: "modificada", delete: "borrada", insert: "nueva", conflict: "en conflicto",
};
const STATUS_ICON = { update: PencilSimple, delete: Minus, insert: Plus, conflict: WarningCircle };

const columnWidth = (column: SqlColumn, rows: Cell[][], index: number) => {
  let longest = column.name.length;
  for (const row of rows.slice(0, 100)) longest = Math.max(longest, (row[index] ?? "NULL").length);
  return Math.min(360, Math.max(64, longest * 7.5 + 20));
};
const RESIZE = { min: 40, max: 1200, step: 16 };
const clampWidth = (width: number) => Math.min(RESIZE.max, Math.max(RESIZE.min, Math.round(width)));

export function ResultGrid(props: Props) {
  const { queryKey, columns, rows, status, isModified, editable, selected, onSelect, onEdit, more, fetching, fetchError, onFetchAll } = props;
  const scroll = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ position: CellPosition; value: string } | null>(null);
  const autoWidths = useMemo(() => columns.map((c, i) => columnWidth(c, rows, i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKey, columns]);
  // Los anchos ajustados a mano valen solo para la consulta y las columnas con que se ajustaron.
  const [resized, setResized] = useState<{ queryKey: number; columns: SqlColumn[]; widths: number[] } | null>(null);
  const widths = resized && resized.queryKey === queryKey && resized.columns === columns ? resized.widths : autoWidths;
  const setWidth = (index: number, width: number) =>
    setResized({ queryKey, columns, widths: widths.map((w, i) => (i === index ? clampWidth(width) : w)) });
  const template = `64px ${widths.map((w) => `${w}px`).join(" ")}`;
  const virtualized = rows.length > VIRTUALIZE_ABOVE;
  const virtual = useVirtualizer({
    count: virtualized ? rows.length : 0,
    getScrollElement: () => scroll.current,
    estimateSize: () => ROW,
    overscan: 20,
  });
  const items = virtualized ? virtual.getVirtualItems() : rows.map((_, index) => ({ index, start: index * ROW }));

  useEffect(() => { if (!editable) setEditing(null); }, [editable]);
  useEffect(() => {
    if (selected && virtualized) virtual.scrollToIndex(selected.row);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.row]);

  const canEdit = (p: CellPosition) => !fetching && !!editable?.[p.col] && status[p.row] !== "delete";
  const startEdit = (p: CellPosition, initial?: string) => {
    if (!canEdit(p)) return;
    setEditing({ position: p, value: initial ?? rows[p.row][p.col] ?? "" });
  };
  const commit = () => {
    if (!editing) return;
    onEdit(editing.position, editing.value === "" ? null : editing.value);
    setEditing(null);
    scroll.current?.focus();
  };
  const move = (row: number, col: number) => {
    onSelect({ row: Math.max(0, Math.min(rows.length - 1, row)), col: Math.max(0, Math.min(columns.length - 1, col)) });
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Las teclas sobre un borde de columna no mueven ni editan la celda.
    if (editing || fetching || !rows.length || event.target !== event.currentTarget) return;
    const at = selected ?? { row: 0, col: 0 };
    const steps: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    };
    if (steps[event.key]) {
      event.preventDefault();
      move(at.row + steps[event.key][0], at.col + steps[event.key][1]);
    } else if ((event.key === "Home" || event.key === "End") && !matches(event, commands.fetchAllRows.keys!)) {
      event.preventDefault();
      move(event.ctrlKey ? (event.key === "Home" ? 0 : rows.length - 1) : at.row, event.key === "Home" ? 0 : columns.length - 1);
    } else if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      startEdit(at);
    } else if (event.key === "Delete" && canEdit(at)) {
      event.preventDefault();
      onEdit(at, null);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void navigator.clipboard?.writeText(rows[at.row]?.[at.col] ?? "");
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && canEdit(at)) {
      event.preventDefault();
      startEdit(at, event.key);
    }
  }

  if (!rows.length) return <p className="sql-empty">La consulta no devolvió filas</p>;
  const activeId = selected ? `sql-cell-${selected.row}-${selected.col}` : undefined;
  const table = (
    <div className="sql-grid-scroll" ref={scroll} tabIndex={0} role="presentation" onKeyDown={onKeyDown}>
      <div role="grid" aria-label="Resultados" aria-rowcount={rows.length + 1} aria-readonly={!editable}
        aria-activedescendant={activeId} className={`sql-grid${editable ? " editing" : ""}`}
        style={{ width: 64 + widths.reduce((a, b) => a + b, 0) }}>
        <div role="row" className="sql-row sql-head" style={{ gridTemplateColumns: template }}>
          <div role="columnheader" aria-label="Fila" className="sql-cell sql-rownum" />
          {columns.map((c, i) => (
            <div key={`${c.name}-${i}`} role="columnheader" aria-label={c.name} className={`sql-cell${c.numeric ? " num" : ""}`}
              title={editable && !editable[i] ? `${c.type_name} · solo lectura` : c.type_name}>
              {c.name}
              <div role="separator" aria-orientation="vertical" aria-label={`Ancho de ${c.name}`} tabIndex={0}
                className="sql-col-resizer" aria-valuemin={RESIZE.min} aria-valuemax={RESIZE.max} aria-valuenow={widths[i]}
                onDoubleClick={() => setWidth(i, autoWidths[i])}
                onKeyDown={(event) => {
                  const step = { ArrowLeft: -RESIZE.step, ArrowRight: RESIZE.step }[event.key];
                  if (step === undefined) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setWidth(i, widths[i] + step);
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  const startX = event.clientX;
                  const startWidth = widths[i];
                  document.body.classList.add("resizing-columns");
                  const move = (e: PointerEvent) => setWidth(i, startWidth + e.clientX - startX);
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
            </div>
          ))}
        </div>
        <div style={{ height: rows.length * ROW, position: "relative" }}>
          {items.map((item) => {
            const row = item.index;
            const state = status[row];
            const Icon = state ? STATUS_ICON[state] : null;
            return (
              <div key={row} role="row" aria-rowindex={row + 2} className={`sql-row${row % 2 ? " sql-row-alt" : ""}${state ? ` row-${state}` : ""}`}
                style={{ gridTemplateColumns: template, transform: `translateY(${item.start}px)` }}>
                <div role="rowheader" className="sql-cell sql-rownum"
                  aria-label={state ? `${row + 1}, ${STATUS_LABEL[state]}` : String(row + 1)}>
                  {Icon && <Icon size={12} aria-hidden />}{row + 1}
                </div>
                {columns.map((column, col) => {
                  const value = rows[row][col];
                  const isSelected = selected?.row === row && selected.col === col;
                  const isEditing = editing?.position.row === row && editing.position.col === col;
                  return (
                    <div key={col} id={`sql-cell-${row}-${col}`} role="gridcell" aria-selected={isSelected}
                      aria-label={`${column.name} ${value ?? "NULL"}`}
                      className={`sql-cell${column.numeric ? " num" : ""}${isSelected ? " selected" : ""}${isModified(row, col) ? " modified" : ""}`}
                      onMouseDown={() => onSelect({ row, col })}
                      onClick={() => onSelect({ row, col })}
                      onDoubleClick={() => startEdit({ row, col })}>
                      {isEditing ? (
                        <input className="sql-cell-input" aria-label={`Editar ${column.name}`} autoFocus value={editing.value}
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          onBlur={commit}
                          onKeyDown={(e) => {
                            if (matches(e, commands.fetchAllRows.keys!)) { e.stopPropagation(); }
                            else if (e.key === "Enter") { e.preventDefault(); commit(); move(row + 1, col); }
                            else if (e.key === "Tab") { e.preventDefault(); commit(); move(row, col + (e.shiftKey ? -1 : 1)); }
                            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(null); scroll.current?.focus(); }
                          }} />
                      ) : value === null ? <span className="sql-null">NULL</span> : value}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
  return (
    <section className="sql-grid-region" aria-label="Grilla de resultados">
      {(more || fetching || fetchError) && (
        <header className="sql-grid-header">
          {fetchError && <span role="alert">{fetchError}</span>}
          {(more || fetching) && (
            <button className="btn" disabled={!onFetchAll || fetching} onClick={() => {
              scroll.current?.focus();
              onFetchAll?.();
            }}>
              {commands.fetchAllRows.label} <span className="kbd">{formatKeys(commands.fetchAllRows.keys!)}</span>
            </button>
          )}
          {fetching && <span role="status">Trayendo filas…</span>}
        </header>
      )}
      {table}
    </section>
  );
}
