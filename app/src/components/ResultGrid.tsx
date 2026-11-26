import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowsDownUp, Funnel, Minus, PencilSimple, Plus, SelectionAll, WarningCircle } from "@phosphor-icons/react";
import type { SqlColumn } from "../types";
import type { Cell } from "../gridEdits";
import { commands, matches } from "../keymap";
import { copyAsInsert, copyGridCells, gridTotal, parseTsv, type GridTotal } from "../gridSelection";
import { clipboard } from "../api";
import { inSelection, moveCell, selectedCells, selectRange, type GridSelection } from "../gridNav";
import { viewIndexes, type GridSort } from "../gridView";
import { ContextMenu } from "./ContextMenu";
import { CellViewer } from "./CellViewer";

export type RowStatus = "update" | "delete" | "insert" | "conflict";
export type CellPosition = GridSelection;

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
  onPasteCells?: (position: CellPosition, matrix: string[][]) => number | void;
  onNotice?: (message: string) => void;
  scrollRef?: RefObject<HTMLDivElement | null>;
  fetching: boolean;
  fetchError: string | null;
  more?: boolean;
  insertTable?: string[];
}

const ROW = 24;
const ROW_HEADER = 64;
const TOTAL_LABELS: Record<GridTotal, string> = {
  count: "Conteo", sum: "Suma", max: "Máximo", min: "Mínimo", average: "Promedio",
};
const TOTAL_OPTIONS = Object.keys(TOTAL_LABELS) as GridTotal[];
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
  const { queryKey, columns, rows: sourceRows, status: sourceStatus, isModified, editable, selected, onSelect, onEdit, fetching, fetchError } = props;
  const [view, setView] = useState<{ queryKey: number; sort?: GridSort; filters: Record<number, string>; open: boolean } | null>(null);
  const activeView = view?.queryKey === queryKey && !editable ? view : null;
  const indexes = useMemo(() => activeView ? viewIndexes(sourceRows, columns, activeView) : null, [activeView, sourceRows, columns]);
  const rows = useMemo(() => indexes ? indexes.map((index) => sourceRows[index]) : sourceRows, [indexes, sourceRows]);
  const status = useMemo(() => indexes ? indexes.map((index) => sourceStatus[index]) : sourceStatus, [indexes, sourceStatus]);
  const sort = activeView?.sort;
  const headerHeight = activeView?.open ? ROW * 2 : ROW;
  function updateView(change: Partial<NonNullable<typeof view>>) {
    setView({ queryKey, filters: {}, open: false, ...activeView, ...change });
  }
  const localScroll = useRef<HTMLDivElement>(null);
  const cellPrefix = useId();
  const scroll = props.scrollRef ?? localScroll;
  const drag = useRef<GridSelection | null>(null);
  const [editing, setEditing] = useState<{ position: CellPosition; value: string } | null>(null);
  const editClosed = useRef(false);
  const [menu, setMenu] = useState<{ x: number; y: number; column: number; totals?: boolean } | null>(null);
  const [totalsFor, setTotalsFor] = useState<{ queryKey: number; columns: Record<number, GridTotal> } | null>(null);
  const [copyError, setCopyError] = useState(false);
  const [viewer, setViewer] = useState<{ column: SqlColumn; value: Cell } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
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
    const stopDrag = () => { drag.current = null; };
    window.addEventListener("mouseup", stopDrag);
    return () => window.removeEventListener("mouseup", stopDrag);
  }, []);
  const selectedRow = selected?.row;
  const selectedColumn = selected?.col;

  const canEdit = (p: CellPosition) =>
    !fetching && !!editable?.[p.col] && !columns[p.col]?.lob && status[p.row] !== "delete";
  const startEdit = (p: CellPosition, initial?: string) => {
    if (!canEdit(p)) return;
    editClosed.current = false;
    setEditing({ position: p, value: initial ?? rows[p.row][p.col] ?? "" });
  };
  const closeEditor = () => {
    editClosed.current = true;
    setEditing(null);
    scroll.current?.focus();
  };
  const commit = () => {
    if (!editing || editClosed.current) return;
    closeEditor();
    onEdit(editing.position, editing.value === "" ? null : editing.value);
  };
  const move = (row: number, col: number) => {
    onSelect({ row: Math.max(0, Math.min(rows.length - 1, row)), col: Math.max(0, Math.min(columns.length - 1, col)) });
  };
  const cursor = selected ?? { row: 0, col: 0 };
  const totals = totalsFor?.queryKey === queryKey ? totalsFor.columns : undefined;
  const footerHeight = totals && Object.keys(totals).length ? ROW : 0;
  useEffect(() => {
    const viewport = scroll.current;
    if (!viewport || selectedRow === undefined || selectedColumn === undefined) return;
    const height = viewport.clientHeight - headerHeight - footerHeight;
    if (height > 0) {
      const top = selectedRow * ROW;
      if (top < viewport.scrollTop) viewport.scrollTop = top;
      else if (top + ROW > viewport.scrollTop + height) viewport.scrollTop = top + ROW - height;
    }
    const width = viewport.clientWidth;
    if (width > 0) {
      const left = ROW_HEADER + widths.slice(0, selectedColumn).reduce((sum, cell) => sum + cell, 0);
      const right = left + (widths[selectedColumn] ?? 0);
      if (left < viewport.scrollLeft) viewport.scrollLeft = left;
      else if (right > viewport.scrollLeft + width) viewport.scrollLeft = Math.min(left, right - width);
    }
  }, [scroll, selectedRow, selectedColumn, widths, footerHeight, headerHeight]);
  const totalValues = useMemo(() => Object.entries(totals ?? {}).map(([column, operation]) => [
    column, gridTotal(rows.filter((_, row) => status[row] !== "delete").map((row) => row[Number(column)] ?? null), operation),
  ] as const), [totals, rows, status]);
  const totalsByColumn = Object.fromEntries(totalValues);
  function setTotal(column: number, operation?: GridTotal) {
    const next = { ...totals };
    if (operation) next[column] = operation;
    else delete next[column];
    setTotalsFor({ queryKey, columns: next });
    scroll.current?.focus();
  }
  const selectAll = () => {
    onSelect({ ...cursor, scope: "all" });
    if (props.more) props.onNotice?.(`Seleccionadas ${rows.length} filas cargadas. Hay más.`);
  };
  function viewCell({ row, col }: CellPosition) {
    if (columns[col] && rows[row]) setViewer({ column: columns[col], value: rows[row][col] ?? null });
  }
  async function copy(mode: "tsv" | "csv" | "headers" | "insert") {
    const cells = selectedCells(rows, cursor);
    let text: string;
    if (mode === "insert" && props.insertTable) {
      const table = props.insertTable;
      text = rows.flatMap((row, index) => {
        const included = columns.map((_, col) => col).filter((col) => inSelection(cursor, index, col));
        return included.length
          ? [copyAsInsert(table, included.map((col) => columns[col]), [included.map((col) => row[col] ?? null)])]
          : [];
      }).join("\n");
    } else if (mode === "headers") {
      const included = columns.map((_, col) => col).filter((col) => rows.some((_, row) => inSelection(cursor, row, col)));
      const aligned = rows.flatMap((row, index) => included.some((col) => inSelection(cursor, index, col))
        ? [included.map((col) => inSelection(cursor, index, col) ? row[col] ?? null : null)]
        : []);
      text = copyGridCells(aligned, false, { headers: included.map((col) => columns[col].name) });
    } else {
      text = copyGridCells(cells, mode === "csv");
    }
    try {
      await clipboard.writeText(text);
      setCopyError(false);
      if (props.more) props.onNotice?.(`Copiadas ${cells.length} filas cargadas. Hay más.`);
    } catch {
      setCopyError(true);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Las teclas sobre un borde de columna no mueven ni editan la celda.
    if (editing || fetching || !rows.length || event.target !== event.currentTarget) return;
    const at = selected ?? { row: 0, col: 0 };
    const position = !matches(event, commands.fetchAllRows.keys!) && moveCell(at, event, {
      rows: rows.length,
      cols: columns.length,
      page: Math.floor((event.currentTarget.clientHeight - headerHeight - footerHeight) / ROW),
    });
    if (position) {
      event.preventDefault();
      onSelect(event.shiftKey ? selectRange(at, position, "extend") : position);
    } else if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      startEdit(at);
    } else if (event.key === "Delete" && canEdit(at)) {
      event.preventDefault();
      onEdit(at, null);
    } else if (matches(event, commands.selectGridRows.keys!)) {
      event.preventDefault();
      selectAll();
    } else if (matches(event, commands.viewCell.keys!)) {
      event.preventDefault();
      viewCell(at);
    } else if (matches(event, commands.copyGrid.keys!) || (event.metaKey && event.key.toLowerCase() === "c")) {
      event.preventDefault();
      void copy("tsv");
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && canEdit(at)) {
      event.preventDefault();
      startEdit(at, event.key);
    }
  }

  if (!sourceRows.length) return <p className="sql-empty">La consulta no devolvió filas</p>;
  const activeId = selected ? `${cellPrefix}-cell-${selected.row}-${selected.col}` : undefined;
  const table = (
    <div className="sql-grid-scroll" ref={scroll} tabIndex={0} role="presentation" onKeyDown={onKeyDown}
      onContextMenu={(event) => {
        if (editing || fetching) return;
        event.preventDefault();
        scroll.current?.focus();
        const cell = (event.target as Element).closest<HTMLElement>("[data-sql-column]");
        setMenu({ x: event.clientX, y: event.clientY, column: cell ? Number(cell.dataset.sqlColumn) : cursor.col });
      }}>
      <div role="grid" aria-label="Resultados" aria-rowcount={rows.length + 1 + Number(totalValues.length > 0)} aria-readonly={!editable}
        aria-activedescendant={activeId} aria-multiselectable="true"
        className={`sql-grid${editable ? " editing" : ""}`}
        style={{ width: 64 + widths.reduce((a, b) => a + b, 0) }}>
        <div role="row" className="sql-row sql-head" style={{ gridTemplateColumns: template }}>
          <div role="columnheader" aria-label="Fila" className="sql-cell sql-rownum sql-selector">
            <button type="button" aria-label={commands.selectGridRows.label} aria-pressed={selected?.scope === "all"}
              title={commands.selectGridRows.label} disabled={fetching} onClick={() => { selectAll(); scroll.current?.focus(); }}>
              <SelectionAll size={14} aria-hidden="true" />
            </button>
          </div>
          {columns.map((c, i) => (
            <div key={`${c.name}-${i}`} role="columnheader" aria-label={c.name} data-sql-column={i} className={`sql-cell${c.numeric ? " num" : ""}`}
              aria-sort={sort?.column === i ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
              onClick={(event) => {
                if (fetching || event.target !== event.currentTarget) return;
                onSelect(selectRange({ row: 0, col: i }, { row: rows.length - 1, col: i }, "extend"));
                scroll.current?.focus();
              }}
              title={editable && !editable[i] ? `${c.type_name} · solo lectura` : c.type_name}>
              {c.name}
              <button type="button" className="ib sql-sort" aria-label={`Ordenar por ${c.name}`} disabled={!!editable || fetching}
                title={`Ordenar por ${c.name}`}
                onClick={() => updateView({
                  sort: sort?.column !== i ? { column: i, direction: "asc" }
                    : sort.direction === "asc" ? { column: i, direction: "desc" } : undefined,
                })}>
                {sort?.column !== i ? <ArrowsDownUp size={12} /> : sort.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              </button>
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
        {activeView?.open && <div role="row" className="sql-row sql-head sql-filter-row" style={{ gridTemplateColumns: template }}>
          <div role="gridcell" className="sql-cell sql-rownum" />
          {columns.map((column, index) => <div role="gridcell" className="sql-cell" key={index}>
            <input className="fld sql-filter" aria-label={`Filtrar ${column.name}`}
              value={activeView.filters[index] ?? ""}
              onChange={(event) => updateView({ filters: { ...activeView.filters, [index]: event.target.value } })} />
          </div>)}
        </div>}
        {!rows.length && <p className="sql-empty">Sin coincidencias</p>}
        <div style={{ height: rows.length * ROW, position: "relative" }}>
          {items.map((item) => {
            const row = item.index;
            const state = status[row];
            const Icon = state ? STATUS_ICON[state] : null;
            return (
              <div key={row} role="row" aria-rowindex={row + 2} className={`sql-row${row % 2 ? " sql-row-alt" : ""}${state ? ` row-${state}` : ""}`}
                style={{ gridTemplateColumns: template, transform: `translateY(${item.start}px)` }}>
                <div role="rowheader" className="sql-cell sql-rownum sql-selector"
                  aria-label={state ? `${row + 1}, ${STATUS_LABEL[state]}` : String(row + 1)}>
                  <button type="button" aria-label={`Seleccionar fila ${row + 1}`}
                    aria-pressed={selected?.scope === "all" || (selected?.scope === "row" && selected.row === row)}
                    disabled={fetching} onClick={() => { onSelect({ row, col: 0, scope: "row" }); scroll.current?.focus(); }}>
                    {Icon && <Icon size={12} aria-hidden />}{row + 1}
                  </button>
                </div>
                {columns.map((column, col) => {
                  const value = rows[row][col];
                  const isSelected = inSelection(selected, row, col);
                  const activeCell = selected?.row === row && selected.col === col;
                  const isEditing = editing?.position.row === row && editing.position.col === col;
                  return (
                    <div key={col} id={`${cellPrefix}-cell-${row}-${col}`} role="gridcell" aria-selected={isSelected} data-sql-column={col}
                      aria-label={`${column.name} ${value ?? "NULL"}`}
                      className={`sql-cell${column.numeric ? " num" : ""}${isSelected ? " selected" : ""}${activeCell ? " active-cell" : ""}${isModified(row, col) ? " modified" : ""}`}
                      onMouseDown={(event) => {
                        if (event.button !== 0 || editing || fetching) return;
                        event.preventDefault();
                        const position = { row, col };
                        const next = event.shiftKey ? selectRange(cursor, position, "extend")
                          : event.ctrlKey || event.metaKey ? selectRange(cursor, position, "add") : position;
                        drag.current = next;
                        onSelect(next);
                        scroll.current?.focus();
                      }}
                      onMouseEnter={(event) => {
                        if (drag.current) onSelect(selectRange(drag.current, { row, col }, "extend"));
                        const cell = event.currentTarget;
                        if (editable && column.lob) cell.title = "Valor recortado";
                        else if (!isEditing && value !== null && cell.scrollWidth > cell.clientWidth) cell.title = value;
                      }}
                      onMouseLeave={(event) => event.currentTarget.removeAttribute("title")}
                      onClick={(event) => {
                        if (event.detail === 0 && !editing && !fetching) onSelect({ row, col });
                      }}
                      onContextMenu={() => {
                        if (!fetching && !editing && !isSelected) onSelect({ row, col });
                      }}
                      onDoubleClick={() => startEdit({ row, col })}>
                      {isEditing ? (
                        <input className="sql-cell-input" aria-label={`Editar ${column.name}`} autoFocus value={editing.value}
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          onBlur={commit}
                          onPaste={(event) => {
                            if (!props.onPasteCells) return;
                            event.preventDefault();
                            const matrix = parseTsv(event.clipboardData.getData("text/plain"));
                            const clipped = matrix.slice(0, rows.length - row).map((line) => line.slice(0, columns.length - col));
                            const count = (lines: string[][]) => lines.reduce((sum, line) => sum + line.length, 0);
                            closeEditor();
                            const pasted = props.onPasteCells({ row, col }, clipped) ?? count(clipped);
                            props.onNotice?.(`Se pegaron ${pasted} de ${count(matrix)} celdas`);
                          }}
                          onKeyDown={(e) => {
                            if (matches(e, commands.fetchAllRows.keys!)) { e.stopPropagation(); }
                            else if (e.key === "Enter") { e.preventDefault(); commit(); move(row + 1, col); }
                            else if (e.key === "Tab") { e.preventDefault(); commit(); move(row, col + (e.shiftKey ? -1 : 1)); }
                            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeEditor(); }
                          }} />
                      ) : value === null ? <span className="sql-null">NULL</span> : value}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {!!totalValues.length && <div role="row" aria-label="Totales de columna" aria-rowindex={rows.length + 2}
          className="sql-row sql-totals" style={{ gridTemplateColumns: template }}>
          <div role="rowheader" className="sql-cell sql-rownum"
            aria-label={props.more ? "Total parcial" : undefined}
            title={props.more ? `Parcial, ${sourceRows.length} filas cargadas` : undefined}>
            {props.more ? "Parcial" : "Total"}
          </div>
          {columns.map((column, index) => {
            const operation = totals?.[index];
            const label = operation ? `${column.name} · ${TOTAL_LABELS[operation]}` : column.name;
            const value = operation ? totalsByColumn[index] ?? "—" : "";
            return <div key={index} role="gridcell" aria-label={label} title={operation ? `${label}: ${value}` : undefined}
              className="sql-cell num" data-sql-column={index}>{value}</div>;
          })}
        </div>}
      </div>
    </div>
  );
  return (
    <section className="sql-grid-region" aria-label="Grilla de resultados">
      {(fetching || fetchError) && (
        <header className="sql-grid-header">
          {fetchError && <span role="alert">{fetchError}</span>}
          {fetching && <span role="status">Trayendo filas…</span>}
        </header>
      )}
      {copyError && <div className="sql-grid-header"><span role="alert">No se pudo copiar</span></div>}
      <div className="sql-grid-header">
        <button className="ib" type="button" aria-label="Filtros" title="Filtros" aria-pressed={!!activeView?.open}
          disabled={!!editable || fetching} onClick={() => updateView({ open: !activeView?.open })}><Funnel size={14} /></button>
        {sort && props.more && <span role="status">Ordenado sobre {sourceRows.length} filas cargadas</span>}
      </div>
      {table}
      {viewer && <CellViewer column={viewer.column.name} value={viewer.value} lob={viewer.column.lob}
        onClose={() => setViewer(null)} />}
      {menu && <ContextMenu key={menu.totals ? "totals" : "grid"} {...menu}
        label={menu.totals ? `Totales de ${columns[menu.column]?.name}` : "Grilla de resultados"} onClose={closeMenu} items={menu.totals ? [
        { label: "Ninguno", radio: true, checked: !totals?.[menu.column], run: () => setTotal(menu.column) },
        ...TOTAL_OPTIONS.map((operation) => ({
          label: TOTAL_LABELS[operation], radio: true, checked: totals?.[menu.column] === operation,
          run: operation === "count" || columns[menu.column]?.numeric ? () => setTotal(menu.column, operation) : undefined,
        })),
        "sep",
        { label: "Limpiar todos", run: totalValues.length ? () => { setTotalsFor(null); scroll.current?.focus(); } : undefined },
      ] : [
        { ...commands.selectGridRows, run: () => { selectAll(); scroll.current?.focus(); } },
        { ...commands.copyGrid, run: () => { void copy("tsv"); scroll.current?.focus(); } },
        { label: "Copiar con encabezados", run: () => { void copy("headers"); scroll.current?.focus(); } },
        { label: "Copiar entre comas", run: () => { void copy("csv"); scroll.current?.focus(); } },
        { label: "Copiar como INSERT", run: props.insertTable ? () => { void copy("insert"); scroll.current?.focus(); } : undefined },
        { ...commands.viewCell, run: () => viewCell(cursor) },
        { label: "Totales de columna", run: columns[menu.column] ? () => setMenu({ ...menu, totals: true }) : undefined },
      ]} />}
    </section>
  );
}
