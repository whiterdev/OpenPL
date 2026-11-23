import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  ClockCounterClockwise,
  Cube,
  Eye,
  Function as FunctionIcon,
  Funnel,
  Lightning,
  LinkSimple,
  ListNumbers,
  MagnifyingGlass,
  Package,
  Table,
  TreeStructure,
  type IconProps,
} from "@phosphor-icons/react";
import { api } from "../api";
import { commands, formatKeys } from "../keymap";
import { describeError, type ActiveConnection, type ObjectInfo, type ObjectType, type Scope } from "../types";
import "./ObjectBrowser.css";

const TYPES: { t: ObjectType; label: string; Icon: ComponentType<IconProps>; tint: string }[] = [
  { t: "Package", label: "Paquetes", Icon: Package, tint: "var(--accent)" },
  { t: "Procedure", label: "Procedimientos", Icon: FunctionIcon, tint: "var(--fn)" },
  { t: "Function", label: "Funciones", Icon: FunctionIcon, tint: "var(--fn)" },
  { t: "Trigger", label: "Triggers", Icon: Lightning, tint: "var(--env-qa)" },
  { t: "Type", label: "Tipos", Icon: Cube, tint: "var(--ty)" },
  { t: "Table", label: "Tablas", Icon: Table, tint: "var(--st)" },
  { t: "View", label: "Vistas", Icon: Eye, tint: "var(--st)" },
  { t: "Sequence", label: "Secuencias", Icon: ListNumbers, tint: "var(--muted)" },
  { t: "Synonym", label: "Sinónimos", Icon: LinkSimple, tint: "var(--muted)" },
];

const ROW = 24;
/** jsdom y listas cortas: sin virtualizar. Con más filas, solo se dibujan las visibles. */
const VIRTUALIZE_ABOVE = 200;

type Row = { kind: "type"; i: number } | { kind: "obj"; i: number; o: ObjectInfo };

interface Props {
  connection: ActiveConnection;
  onOpenObject: (o: ObjectInfo) => void;
  onConnectionLost: () => void;
  refreshKey: number;
}

export function ObjectBrowser({ connection, onOpenObject, onConnectionLost, refreshKey }: Props) {
  const [scope, setScope] = useState<Scope>("Mine");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<ObjectType>>(new Set());
  const [cache, setCache] = useState<Record<string, ObjectInfo[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inflight = useRef(new Set<string>());
  const generation = useRef(0);
  const [localRefresh, setLocalRefresh] = useState(0);

  const keyOf = (t: ObjectType) => `${scope}|${t}|${query ?? ""}`;

  // Debounce del filtro.
  useEffect(() => {
    const h = window.setTimeout(() => setQuery(filter.trim() || null), 300);
    return () => window.clearTimeout(h);
  }, [filter]);

  // Refrescar: vacía la caché; el efecto de carga vuelve a pedir lo expandido.
  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) {
      firstRefresh.current = false;
      return;
    }
    // Respuestas en vuelo de antes del refresco se descartan al llegar.
    generation.current += 1;
    inflight.current = new Set();
    setCache({});
    setErrors({});
  }, [refreshKey, localRefresh]);

  useEffect(() => {
    for (const t of expanded) {
      const key = keyOf(t);
      // Un tipo con error no se reintenta solo: se reintenta al refrescar.
      if (cache[key] || errors[key] || inflight.current.has(key)) continue;
      const gen = generation.current;
      const pending = inflight.current;
      pending.add(key);
      api
        .listObjects(connection.sessionId, scope, t, query)
        .then((v) => {
          if (gen !== generation.current) return;
          setCache((c) => ({ ...c, [key]: v }));
          setErrors(({ [key]: _old, ...rest }) => rest);
        })
        .catch((e) => {
          if (gen !== generation.current) return;
          const d = describeError(e);
          if (d.kind === "ConnectionLost") onConnectionLost();
          setErrors((er) => ({ ...er, [key]: d.code ? `${d.code} ${d.message}` : d.message }));
        })
        .finally(() => pending.delete(key));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, scope, query, cache, connection.sessionId]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    TYPES.forEach((ty, i) => {
      out.push({ kind: "type", i });
      if (expanded.has(ty.t)) for (const o of cache[keyOf(ty.t)] ?? []) out.push({ kind: "obj", i, o });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, cache, scope, query]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = rows.length > VIRTUALIZE_ABOVE;
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 12,
  });

  function toggle(t: ObjectType) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  }

  function onObjKey(e: KeyboardEvent, o: ObjectInfo) {
    if (e.key === "Enter") onOpenObject(o);
  }

  function renderRow(r: Row, style?: React.CSSProperties) {
    const ty = TYPES[r.i];
    if (r.kind === "type") {
      const list = cache[keyOf(ty.t)];
      const open = expanded.has(ty.t);
      return (
        <div
          key={`t-${ty.t}`}
          role="treeitem"
          aria-level={1}
          aria-label={ty.label}
          aria-expanded={open}
          tabIndex={0}
          className="ob-row ob-type"
          style={style}
          onClick={() => toggle(ty.t)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(ty.t))}
        >
          {open ? <CaretDown size={10} className="ob-caret" aria-hidden /> : <CaretRight size={10} className="ob-caret" aria-hidden />}
          <ty.Icon size={15} color={ty.tint} aria-hidden />
          <span className="ob-label">{ty.label}</span>
          {errors[keyOf(ty.t)] && <span className="ob-err" title={errors[keyOf(ty.t)]}>error</span>}
          {open && list && <span className="ob-count">{list.length}</span>}
        </div>
      );
    }
    const o = r.o;
    const shown = scope === "All" ? `${o.owner}.${o.name}` : o.name;
    const invalid = o.status === "Invalid";
    return (
      <div
        key={`o-${ty.t}-${o.owner}-${o.name}`}
        role="treeitem"
        aria-level={2}
        aria-label={invalid ? `${shown}, inválido` : shown}
        tabIndex={0}
        className="ob-row ob-obj"
        style={style}
        onDoubleClick={() => onOpenObject(o)}
        onKeyDown={(e) => onObjKey(e, o)}
      >
        <ty.Icon size={15} color={ty.tint} aria-hidden />
        <span className="ob-label">{shown}</span>
        {invalid && <span className="ob-invalid">inválido</span>}
      </div>
    );
  }

  return (
    <aside className="ob" aria-label="Explorador de objetos">
      <div className="ob-head">
        <button className="ib active" aria-label="Objetos" aria-pressed="true">
          <TreeStructure size={16} />
        </button>
        <button className="ib" aria-label="Buscar en el esquema" disabled>
          <MagnifyingGlass size={16} />
        </button>
        <button className="ib" aria-label="Historial de sentencias" disabled>
          <ClockCounterClockwise size={16} />
        </button>
        <span style={{ flex: 1 }} />
        <button
          className="ib"
          aria-label={`Refrescar (${formatKeys(commands.refreshExplorer.keys!)})`}
          title={`Refrescar  ${formatKeys(commands.refreshExplorer.keys!)}`}
          onClick={() => setLocalRefresh((n) => n + 1)}
        >
          <ArrowsClockwise size={15} />
        </button>
        <div role="radiogroup" aria-label="Alcance" className="ob-scope">
          {(["Mine", "All"] as Scope[]).map((s) => (
            <button key={s} role="radio" aria-checked={scope === s} onClick={() => setScope(s)}>
              {s === "Mine" ? "Míos" : "Todos"}
            </button>
          ))}
        </div>
      </div>
      <label className="ob-filter">
        <Funnel size={13} aria-hidden />
        <input aria-label="Filtrar objetos" value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
      </label>
      <div role="tree" aria-label={`Objetos de ${connection.label}`} className="ob-tree" ref={scrollRef}>
        {virtual ? (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vi) =>
              renderRow(rows[vi.index], { position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }),
            )}
          </div>
        ) : (
          rows.map((r) => renderRow(r))
        )}
      </div>
    </aside>
  );
}
