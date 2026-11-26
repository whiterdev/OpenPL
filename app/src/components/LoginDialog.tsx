import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CheckCircle, MagnifyingGlass, Plug, Plus, WarningCircle } from "@phosphor-icons/react";
import { api } from "../api";
import { describeError, type ActiveConnection, type ConnectionProfile, type Environment, type Role } from "../types";
import { useFocusTrap } from "../useFocusTrap";
import "./LoginDialog.css";

const ROLES: { id: Role; label: string }[] = [
  { id: "Normal", label: "Normal" },
  { id: "SysDba", label: "SYSDBA" },
  { id: "SysOper", label: "SYSOPER" },
];

const ENVS: { id: Environment; label: string }[] = [
  { id: "dev", label: "Desarrollo" },
  { id: "qa", label: "Calidad" },
  { id: "prod", label: "Producción" },
];

/** "host:1521/servicio" o "host/servicio" → partes; un alias TNS devuelve null. */
export function parseEzConnect(value: string): { host: string; port: string; service: string } | null {
  const m = /^([^:/\s]+)(?::(\d+))?\/(\S+)$/.exec(value.trim());
  return m ? { host: m[1], port: m[2] ?? "1521", service: m[3] } : null;
}

/** "srv:1521/ventas" → "VENTAS"; "DEVPDB" → "DEVPDB". */
function dbLabel(db: string): string {
  const part = db.trim().split("/").pop() ?? db;
  return part.toUpperCase();
}

interface Props {
  onConnected: (c: ActiveConnection) => void;
  onCancel?: () => void;
  clientVersion?: string | null;
}

export function LoginDialog({ onConnected, onCancel, clientVersion }: Props) {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ConnectionProfile | null>(null);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"basic" | "tns">("basic");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("1521");
  const [service, setService] = useState("");
  const [alias, setAlias] = useState("");
  const db = mode === "basic" ? `${host.trim()}:${port.trim() || "1521"}/${service.trim()}` : alias.trim();

  /** Rellena los campos a partir de la cadena guardada en el perfil. */
  function applyDb(value: string) {
    const ez = parseEzConnect(value);
    if (ez || value.trim() === "") {
      setMode("basic");
      setHost(ez?.host ?? "");
      setPort(ez?.port ?? "1521");
      setService(ez?.service ?? "");
      setAlias("");
    } else {
      setMode("tns");
      setAlias(value.trim());
      setHost("");
      setPort("1521");
      setService("");
    }
  }
  const [role, setRole] = useState<Role>("Normal");
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [name, setName] = useState("");
  const [savePassword, setSavePassword] = useState(true);
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const pickedId = useRef<string | null>(null);
  const connectionAttempt = useRef<symbol | null>(null);

  function fail(err: unknown) {
    const d = describeError(err);
    setError({ code: d.code, message: d.message });
  }

  const reload = () => api.listProfiles().then(setProfiles).catch(fail);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = profiles.filter((p) => !q || p.name.toLowerCase().includes(q) || p.db.toLowerCase().includes(q));
    const named = [...ENVS.map((e) => ({ id: e.id as Environment | null, label: e.label })), { id: null, label: "Sin entorno" }];
    return named
      .map((g) => ({ ...g, items: visible.filter((p) => p.environment === g.id) }))
      .filter((g) => g.items.length > 0);
  }, [profiles, search]);

  async function pick(p: ConnectionProfile) {
    pickedId.current = p.id;
    setSelected(p);
    setUser(p.user);
    applyDb(p.db);
    setRole(p.role);
    setEnvironment(p.environment);
    setName(p.name);
    setSavePassword(p.save_password);
    setError(null);
    setPassword("");
    if (p.save_password) {
      try {
        const pw = await api.storedPassword(p.id);
        // Si mientras tanto se eligió otro perfil, esta contraseña no le corresponde.
        if (pw && pickedId.current === p.id) setPassword(pw);
      } catch (err) {
        if (pickedId.current === p.id) fail(err);
      }
    }
  }

  function profileLabel() {
    const changed = selected && (selected.user !== user.trim() || selected.db !== db.trim());
    const label = changed && name === selected.name ? "" : name.trim();
    return label || `${user.trim().toUpperCase()} en ${dbLabel(db)}`;
  }

  function currentProfile(): ConnectionProfile {
    return {
      id: selected?.id ?? crypto.randomUUID(),
      name: profileLabel(),
      user: user.trim(),
      db: db.trim(),
      role,
      environment,
      save_password: savePassword,
    };
  }

  async function connect(e?: FormEvent) {
    e?.preventDefault();
    if (connectionAttempt.current) return;
    const attempt = Symbol();
    connectionAttempt.current = attempt;
    const label = profileLabel();
    setBusy(true);
    setError(null);
    try {
      const r = await api.connect({ user: user.trim(), password, db: db.trim(), role });
      if (connectionAttempt.current !== attempt) {
        await api.disconnect(r.session_id);
        return;
      }
      onConnected({
        sessionId: r.session_id,
        ...(selected?.user === user.trim() && selected.db === db.trim() && selected.role === role
          ? { profileId: selected.id } : {}),
        label,
        environment,
        serverVersion: r.server_version,
        compat: r.compat,
      });
    } catch (err) {
      if (connectionAttempt.current !== attempt) return;
      const d = describeError(err);
      setError({ code: d.code, message: d.message });
      if (d.code && ["ORA-01017", "ORA-01005", "ORA-01045"].includes(d.code)) setPassword("");
    } finally {
      if (connectionAttempt.current === attempt) {
        connectionAttempt.current = null;
        setBusy(false);
      }
    }
  }

  async function saveProfile() {
    const p = currentProfile();
    try {
      await api.saveProfile(p, savePassword ? password || null : null);
      pickedId.current = p.id;
      setSelected(p);
      setName(p.name);
      setError(null);
      await reload();
    } catch (err) {
      fail(err);
    }
  }

  async function deleteProfile() {
    if (!selected || !window.confirm(`¿Eliminar ${selected.name}?`)) return;
    try {
      await api.deleteProfile(selected.id);
      pickedId.current = null;
      setSelected(null);
      await reload();
    } catch (err) {
      fail(err);
    }
  }

  const cancelDialog = () => {
    if (!onCancel && !busy) return;
    connectionAttempt.current = null;
    setBusy(false);
    onCancel?.();
  };

  const trap = useFocusTrap(onCancel || busy ? cancelDialog : undefined);

  return (
    <div className="login-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="login-title" className="login" {...trap}>
        <aside className="login-profiles" aria-label="Perfiles guardados">
          <label className="login-search">
            <MagnifyingGlass size={14} aria-hidden />
            <input aria-label="Buscar perfil" placeholder="Buscar perfil" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="login-groups">
            {groups.map((g) => (
              <div key={g.label}>
                <div className="login-group">{g.label}</div>
                {g.items.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className={`login-prof ${p.environment ? `env-${p.environment}` : ""} ${selected?.id === p.id ? "sel" : ""}`}
                    onClick={() => void pick(p)}
                  >
                    <span className="stripe" />
                    <span className="login-prof-text">
                      <span className="login-prof-name">{p.name}</span>
                      <span className="login-prof-db mono">{p.db}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="login-new">
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                pickedId.current = null;
                setSelected(null);
                setUser("");
                setPassword("");
                applyDb("");
                setName("");
                setEnvironment(null);
                setRole("Normal");
                setError(null);
              }}
            >
              <Plus size={13} aria-hidden />
              Nuevo perfil
            </button>
          </div>
        </aside>

        <form className="login-form" onSubmit={(e) => void connect(e)}>
          <div className="login-head">
            <h1 id="login-title">Conectar a Oracle</h1>
            {clientVersion && (
              <span className="login-client">
                <CheckCircle size={14} aria-hidden />
                Instant Client {clientVersion}
              </span>
            )}
          </div>

          <div className="login-row2">
            <label className="login-field">
              <span className="lbl">Usuario</span>
              <input className="fld" aria-label="Usuario" value={user} onChange={(e) => setUser(e.target.value)} autoFocus />
            </label>
            <label className="login-field">
              <span className="lbl">Contraseña</span>
              <input
                className="fld"
                type="password"
                aria-label="Contraseña"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "login-err" : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>
          {error && (
            <div id="login-err" role="alert" className="login-err">
              <WarningCircle size={14} aria-hidden />
              {error.code && <span className="mono">{error.code}</span>}
              <span>{error.message}</span>
            </div>
          )}

          <div className="login-field">
            <span className="lbl" id="lbl-tipo">Base de datos</span>
            <div role="radiogroup" aria-labelledby="lbl-tipo" className="seg" style={{ alignSelf: "flex-start" }}>
              <button type="button" role="radio" aria-checked={mode === "basic"} onClick={() => setMode("basic")}>
                Host y servicio
              </button>
              <button type="button" role="radio" aria-checked={mode === "tns"} onClick={() => setMode("tns")}>
                Alias TNS
              </button>
            </div>
          </div>
          {mode === "basic" ? (
            <div className="login-hostrow">
              <label className="login-field">
                <span className="lbl">Host</span>
                <input className="fld mono" aria-label="Host" value={host} onChange={(e) => setHost(e.target.value)} />
              </label>
              <label className="login-field">
                <span className="lbl">Puerto</span>
                <input
                  className="fld mono"
                  aria-label="Puerto"
                  inputMode="numeric"
                  value={port}
                  onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
                />
              </label>
              <label className="login-field">
                <span className="lbl">Servicio</span>
                <input className="fld mono" aria-label="Servicio" value={service} onChange={(e) => setService(e.target.value)} />
              </label>
            </div>
          ) : (
            <label className="login-field">
              <span className="lbl">Alias</span>
              <input className="fld mono" aria-label="Alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
            </label>
          )}

          <div className="login-segs">
            <div className="login-field">
              <span className="lbl" id="lbl-rol">Rol</span>
              <div role="radiogroup" aria-labelledby="lbl-rol" className="seg">
                {ROLES.map((r) => (
                  <button type="button" role="radio" key={r.id} aria-checked={role === r.id} onClick={() => setRole(r.id)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="login-field">
              <span className="lbl" id="lbl-env">Entorno</span>
              <div role="radiogroup" aria-labelledby="lbl-env" className="seg">
                {ENVS.map((e) => (
                  <button
                    type="button"
                    role="radio"
                    key={e.id}
                    className={`env-${e.id}`}
                    aria-checked={environment === e.id}
                    onClick={() => setEnvironment(environment === e.id ? null : e.id)}
                  >
                    <span className="stripe" style={{ height: 14, width: 3 }} />
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="login-field">
            <span className="lbl">Nombre del perfil</span>
            <input className="fld" aria-label="Nombre del perfil" value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <label className="login-check">
            <input type="checkbox" checked={savePassword} onChange={(e) => setSavePassword(e.target.checked)} />
            Guardar contraseña
          </label>

          <div className="login-actions">
            <button type="button" className="btn" onClick={() => void saveProfile()}>
              Guardar perfil
            </button>
            {selected && (
              <button type="button" className="btn danger" onClick={() => void deleteProfile()}>
                Eliminar perfil
              </button>
            )}
            <span style={{ flex: 1 }} />
            {(onCancel || busy) && (
              <button type="button" className="btn ghost" onClick={() => {
                connectionAttempt.current = null;
                setBusy(false);
                onCancel?.();
              }}>
                Cancelar
              </button>
            )}
            <button type="submit" className="btn primary" disabled={busy}>
              <Plug size={14} aria-hidden />
              {busy ? "Conectando…" : "Conectar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
