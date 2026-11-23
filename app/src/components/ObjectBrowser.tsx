import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
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
  AppWindow,
  Binoculars,
  Books,
  CalendarBlank,
  CirclesThree,
  Clock,
  Coffee,
  FolderSimple,
  Globe,
  HardDrives,
  Hash,
  IdentificationCard,
  Key,
  Link,
  Password,
  Rows,
  SquaresFour,
  Stack,
  Tag,
  TerminalWindow,
  Timer,
  Trash,
  User,
  UsersThree,
  type IconProps,
} from "@phosphor-icons/react";
import { api } from "../api";
import { commands, formatKeys } from "../keymap";
import { describeError, type ActiveConnection, type ObjectInfo, type ObjectType, type Scope } from "../types";
import { ContextMenu, type ContextItem } from "./ContextMenu";
import "./ObjectBrowser.css";

const CODE = "var(--fn)";
const DATA = "var(--st)";
const SCHED = "var(--env-qa)";
const SEC = "var(--kw)";
const STORE = "var(--muted)";

const TYPES: { t: ObjectType; label: string; Icon: ComponentType<IconProps>; tint: string }[] = [
  { t: "Package", label: "Paquetes", Icon: Package, tint: "var(--accent)" },
  { t: "Procedure", label: "Procedimientos", Icon: FunctionIcon, tint: CODE },
  { t: "Function", label: "Funciones", Icon: FunctionIcon, tint: CODE },
  { t: "Trigger", label: "Triggers", Icon: Lightning, tint: SCHED },
  { t: "Type", label: "Tipos", Icon: Cube, tint: "var(--ty)" },
  { t: "JavaSource", label: "Fuentes Java", Icon: Coffee, tint: CODE },
  { t: "JavaClass", label: "Clases Java", Icon: Coffee, tint: CODE },
  { t: "DbmsJob", label: "DBMS_Jobs", Icon: Clock, tint: SCHED },
  { t: "Queue", label: "Colas", Icon: Rows, tint: DATA },
  { t: "QueueTable", label: "Tablas de cola", Icon: Rows, tint: DATA },
  { t: "Library", label: "Librerías", Icon: Books, tint: CODE },
  { t: "Directory", label: "Directorios", Icon: FolderSimple, tint: STORE },
  { t: "Table", label: "Tablas", Icon: Table, tint: DATA },
  { t: "Index", label: "Índices", Icon: Hash, tint: DATA },
  { t: "Constraint", label: "Restricciones", Icon: Key, tint: DATA },
  { t: "View", label: "Vistas", Icon: Eye, tint: DATA },
  { t: "MaterializedView", label: "Vistas materializadas", Icon: Stack, tint: DATA },
  { t: "Sequence", label: "Secuencias", Icon: ListNumbers, tint: STORE },
  { t: "User", label: "Usuarios", Icon: User, tint: SEC },
  { t: "Profile", label: "Perfiles", Icon: IdentificationCard, tint: SEC },
  { t: "Role", label: "Roles", Icon: UsersThree, tint: SEC },
  { t: "Synonym", label: "Sinónimos", Icon: LinkSimple, tint: STORE },
  { t: "DatabaseLink", label: "Database links", Icon: Globe, tint: STORE },
  { t: "Tablespace", label: "Tablespaces", Icon: HardDrives, tint: STORE },
  { t: "Cluster", label: "Clusters", Icon: CirclesThree, tint: DATA },
  { t: "WindowGroup", label: "Grupos de ventanas", Icon: SquaresFour, tint: SCHED },
  { t: "Window", label: "Ventanas", Icon: AppWindow, tint: SCHED },
  { t: "Schedule", label: "Calendarios", Icon: CalendarBlank, tint: SCHED },
  { t: "Program", label: "Programas", Icon: TerminalWindow, tint: SCHED },
  { t: "Chain", label: "Cadenas", Icon: Link, tint: SCHED },
  { t: "Job", label: "Jobs", Icon: Timer, tint: SCHED },
  { t: "JobClass", label: "Clases de job", Icon: Tag, tint: SCHED },
  { t: "Credential", label: "Credenciales", Icon: Password, tint: SEC },
  { t: "FileWatcher", label: "Vigilantes de archivos", Icon: Binoculars, tint: SCHED },
  { t: "RecycleBin", label: "Papelera", Icon: Trash, tint: STORE },
];

const CODE_TYPES = new Set<ObjectType>(["Package", "Procedure", "Function", "Trigger", "Type", "JavaSource", "JavaClass"]);
const DATA_TYPES = new Set<ObjectType>(["Table", "View", "MaterializedView"]);
const TESTABLE = new Set<ObjectType>(["Package", "Procedure", "Function"]);
const RECOMPILABLE = new Set<ObjectType>([...CODE_TYPES, "View", "MaterializedView"]);
const DDL_TYPES = new Set<ObjectType>(
  TYPES.map((x) => x.t).filter((t) => !["JavaClass", "DbmsJob", "RecycleBin"].includes(t)),
);
const RENAMEABLE = new Set<ObjectType>(["Table", "View", "Sequence", "Synonym"]);

const ROW = 24;
/** jsdom y listas cortas: sin virtualizar. Con más filas, solo se dibujan las visibles. */
const VIRTUALIZE_ABOVE = 200;

type Row = { kind: "type"; i: number } | { kind: "obj"; i: number; o: ObjectInfo };

interface Props {
  connection: ActiveConnection;
  onOpenObject: (o: ObjectInfo) => void;
  onConnectionLost: () => void;
  refreshKey: number;
  onNotice?: (message: string) => void;
}

export function ObjectBrowser({ connection, onOpenObject, onConnectionLost, refreshKey, onNotice }: Props) {
  const [scope, setScope] = useState<Scope>("Mine");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<ObjectType>>(new Set());
  const [cache, setCache] = useState<Record<string, ObjectInfo[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inflight = useRef(new Set<string>());
  const generation = useRef(0);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; label: string; items: (ContextItem | "sep")[] } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const copy = (text: string) => void navigator.clipboard?.writeText(text);
  const refresh = () => setLocalRefresh((n) => n + 1);

  function objectMenu(e: React.MouseEvent, o: ObjectInfo) {
    e.preventDefault();
    const t = o.object_type;
    const full = o.owner ? `${o.owner}.${o.name}` : o.name;
    const code = CODE_TYPES.has(t);
    const items: (ContextItem | "sep")[] = [{ label: "Abrir", keys: "Enter", run: () => onOpenObject(o) }];
    if (t === "Package") items.push({ label: "Ver Spec y Body" }, { label: "Editar Spec y Body" });
    else if (code || DATA_TYPES.has(t)) items.push({ label: "Ver" }, { label: "Editar" });
    if (TESTABLE.has(t)) items.push({ label: commands.test.label, keys: commands.test.keys });
    if (DATA_TYPES.has(t)) {
      items.push("sep", { label: "Consultar datos" });
      if (t !== "MaterializedView") items.push({ label: "Editar datos", keys: commands.editData.keys });
      if (t === "Table") items.push({ label: "Exportar datos" });
    }
    items.push("sep", { label: "Describir" }, { label: "Propiedades" });
    if (RECOMPILABLE.has(t)) items.push({ label: "Recompilar", run: () => void recompile(o) });
    if (DDL_TYPES.has(t)) items.push({ label: "Copiar DDL", run: () => void copyDdl(o) });
    if (code || DATA_TYPES.has(t)) items.push({ label: "Comparar con…" });
    items.push(
      "sep",
      { label: "Copiar nombre", keys: "Ctrl+C", run: () => copy(o.name) },
      { label: "Copiar nombre con esquema", run: () => copy(full) },
      "sep",
    );
    if (RENAMEABLE.has(t)) items.push({ label: "Renombrar" });
    items.push({ label: "Eliminar" }, "sep", { label: "Refrescar", keys: commands.refreshExplorer.keys, run: refresh });
    setMenu({ x: e.clientX, y: e.clientY, label: full, items });
  }

  async function copyDdl(o: ObjectInfo) {
    try {
      const ddl = await api.objectDdl(connection.sessionId, o.object_type, o.owner, o.name);
      copy(ddl);
      onNotice?.("DDL copiado");
    } catch (err) {
      const d = describeError(err);
      if (d.kind === "ConnectionLost") onConnectionLost();
      onNotice?.(d.code ? `${d.code} ${d.message}` : d.message);
    }
  }

  async function recompile(o: ObjectInfo) {
    if (connection.environment === "prod" && !window.confirm(`¿Recompilar ${o.name} en producción?`)) return;
    try {
      const r = await api.recompile(connection.sessionId, o.object_type, o.owner, o.name);
      onNotice?.(r.with_errors ? `${o.name} compilado con errores` : `${o.name} compilado`);
      refresh();
    } catch (err) {
      const d = describeError(err);
      if (d.kind === "ConnectionLost") onConnectionLost();
      onNotice?.(d.code ? `${d.code} ${d.message}` : d.message);
    }
  }

  function typeMenu(e: React.MouseEvent, t: ObjectType, label: string) {
    e.preventDefault();
    const open = expanded.has(t);
    const loaded = cache[keyOf(t)];
    setMenu({
      x: e.clientX,
      y: e.clientY,
      label,
      items: [
        { label: open ? "Contraer" : "Expandir", run: () => toggle(t) },
        { label: "Nuevo…" },
        "sep",
        {
          label: "Copiar nombres separados por coma",
          run: loaded && loaded.length ? () => copy(loaded.map((o) => o.name).join(", ")) : undefined,
        },
        { label: "Refrescar", keys: commands.refreshExplorer.keys, run: refresh },
      ],
    });
  }

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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") copy(o.name);
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
          onContextMenu={(e) => typeMenu(e, ty.t, ty.label)}
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
    const shown = scope === "All" && o.owner ? `${o.owner}.${o.name}` : o.name;
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
        onContextMenu={(e) => objectMenu(e, o)}
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
      {menu && <ContextMenu x={menu.x} y={menu.y} label={menu.label} items={menu.items} onClose={closeMenu} />}
    </aside>
  );
}
