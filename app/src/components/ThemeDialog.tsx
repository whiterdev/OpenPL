import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Copy, WarningCircle } from "@phosphor-icons/react";
import {
  activeTheme,
  activeThemeId,
  applyTheme,
  contrastWarnings,
  deleteCustomTheme,
  loadThemes,
  saveCustomTheme,
  setActiveThemeId,
  type Theme,
  type ThemeToken,
} from "../themes";
import "./ThemeDialog.css";

const HEX = /^#[0-9a-f]{6}$/i;
const LAST_KEY = { dark: "openpl.theme.lastDark", light: "openpl.theme.lastLight" } as const;

const LABELS: Record<string, string> = {
  s0: "Fondo del editor", s1: "Paneles", s2: "Hover", s3: "Seleccionado",
  line: "Divisiones", line2: "Bordes", "field-line": "Borde de campo", "s-menu": "Menús",
  text: "Texto", muted: "Texto secundario", faint: "Deshabilitado",
  accent: "Acento", accentText: "Texto sobre acento", accentSoft: "Acento suave",
  err: "Error", errSoft: "Fondo de error", ok: "Correcto", okSoft: "Fondo correcto",
  kw: "Palabras clave", ty: "Tipos", st: "Cadenas", nu: "Números", cm: "Comentarios", fn: "Funciones",
  activeLine: "Línea activa", sel: "Selección",
};

const GROUPS: { title: string; tokens: ThemeToken[] }[] = [
  {
    title: "Interfaz",
    tokens: ["s0", "s1", "s-menu", "line", "line2", "field-line", "text", "muted", "faint", "err", "errSoft", "ok", "okSoft"],
  },
  { title: "Acento", tokens: ["accent", "accentText", "accentSoft"] },
  { title: "Palabras clave y sintaxis", tokens: ["kw", "ty", "st", "nu", "fn", "cm"] },
  { title: "Secundario", tokens: ["s2", "s3"] },
];

const SWATCHES: ThemeToken[] = ["s0", "s2", "text", "accent", "kw"];
const MODES: { id: Theme["mode"]; label: string }[] = [
  { id: "dark", label: "Oscuro" },
  { id: "light", label: "Claro" },
];

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Recuerda el último tema usado de cada modo para el botón Sol/Luna. */
export function rememberTheme(theme: Theme) {
  try {
    localStorage.setItem(LAST_KEY[theme.mode], theme.id);
  } catch {
    /* preferencia opcional */
  }
}

/** Cambia al último tema del modo contrario (o al primero de ese modo) y lo deja activo. */
export function toggleThemeMode(): Theme {
  const current = activeTheme();
  rememberTheme(current);
  const target = current.mode === "dark" ? "light" : "dark";
  const themes = loadThemes();
  const lastId = storageGet(LAST_KEY[target]);
  const next = themes.find((t) => t.id === lastId && t.mode === target) ?? themes.find((t) => t.mode === target)!;
  setActiveThemeId(next.id);
  applyTheme(next);
  rememberTheme(next);
  return next;
}

function sameTheme(a: Theme, b: Theme) {
  return a.name === b.name && a.mode === b.mode && JSON.stringify(a.colors) === JSON.stringify(b.colors);
}

function ColorField({
  token,
  value,
  disabled,
  onChange,
}: {
  token: ThemeToken;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const id = `td-hex-${token}`;
  const label = LABELS[token];
  const invalid = !HEX.test(text);

  useEffect(() => setText(value), [value]);

  return (
    <div className="td-color">
      <label htmlFor={id}>{label}</label>
      <input
        type="color"
        aria-label={`Selector de ${label}`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
      />
      <input
        id={id}
        className="fld mono"
        value={text}
        disabled={disabled}
        spellCheck={false}
        maxLength={7}
        aria-invalid={invalid}
        onChange={(e) => {
          setText(e.target.value);
          if (HEX.test(e.target.value)) onChange(e.target.value.toLowerCase());
        }}
        onBlur={() => setText(value)}
      />
    </div>
  );
}

export function ThemeDialog({ onClose }: { onClose: () => void }) {
  const [themes, setThemes] = useState<Theme[]>(() => loadThemes());
  const [stored] = useState(() => new Set(themes.map((t) => t.id)));
  const [original, setOriginal] = useState<Theme>(() => activeTheme());
  const [selectedId, setSelectedId] = useState(() => activeThemeId());
  const [edits, setEdits] = useState<Record<string, Theme>>({});
  const [error, setError] = useState<string | null>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const base = themes.find((t) => t.id === selectedId) ?? themes[0];
  const draft = edits[base.id] ?? base;
  const warnings = contrastWarnings(draft);
  const locked = draft.builtin;
  const nameMissing = Object.values(edits).some((t) => !t.name.trim());

  useEffect(() => applyTheme(draft), [draft]);

  useEffect(() => {
    const opener = document.activeElement;
    selectedRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  function edit(change: Partial<Theme>) {
    setEdits((all) => ({ ...all, [draft.id]: { ...draft, ...change } }));
  }

  function setColor(token: ThemeToken, value: string) {
    edit({ colors: { ...draft.colors, [token]: value } });
  }

  function duplicate() {
    const copy: Theme = {
      ...draft,
      id: `propio-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: `${draft.name} (copia)`,
      builtin: false,
      colors: { ...draft.colors },
    };
    setThemes((all) => [...all, copy]);
    setEdits((all) => ({ ...all, [copy.id]: copy }));
    setSelectedId(copy.id);
  }

  function reset() {
    setEdits((all) => ({ ...all, [base.id]: base }));
  }

  function remove() {
    if (locked) return;
    deleteCustomTheme(draft.id);
    setEdits(({ [draft.id]: _, ...rest }) => rest);
    setThemes((all) => all.filter((t) => t.id !== draft.id));
    if (original.id === draft.id) setOriginal(activeTheme());
    setSelectedId(activeThemeId());
  }

  function cancel() {
    applyTheme(original);
    onClose();
  }

  function save() {
    try {
      for (const theme of Object.values(edits)) saveCustomTheme({ ...theme, name: theme.name.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setActiveThemeId(draft.id);
    applyTheme(draft);
    rememberTheme(draft);
    onClose();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  }

  return (
    <div className="td-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="td-title" className="td" onKeyDown={onKeyDown}>
        <div className="td-side">
          <h1 id="td-title" className="td-title">Personalizar interfaz</h1>
          <div role="radiogroup" aria-label="Temas" className="td-list">
            {themes.map((t) => {
              const shown = edits[t.id] ?? t;
              return (
                <button
                  key={t.id}
                  ref={t.id === selectedId ? selectedRef : undefined}
                  type="button"
                  role="radio"
                  aria-checked={t.id === selectedId}
                  className="td-theme"
                  onClick={() => setSelectedId(t.id)}
                >
                  <span className="td-swatches" aria-hidden="true">
                    {SWATCHES.map((token) => (
                      <span key={token} style={{ background: shown.colors[token] }} />
                    ))}
                  </span>
                  <span className="td-theme-text">
                    <span className="td-theme-name">{shown.name || "Sin nombre"}</span>
                    <span className="td-theme-mode">
                      {shown.mode === "dark" ? "Oscuro" : "Claro"}
                      {edits[t.id] && (!stored.has(t.id) || !sameTheme(edits[t.id], t)) ? " · sin guardar" : ""}
                    </span>
                  </span>
                  {t.id === selectedId && <Check className="td-selected" size={16} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <div className="td-dup">
            <button type="button" className="btn" onClick={duplicate}>
              <Copy size={13} aria-hidden />
              Duplicar como personalizado
            </button>
          </div>
        </div>

        <div className="td-main">
          <div className="td-head">
            <label className="td-field">
              <span>Nombre</span>
              <input
                className="fld"
                value={draft.name}
                disabled={locked}
                aria-invalid={!locked && !draft.name.trim()}
                onChange={(e) => edit({ name: e.target.value })}
              />
            </label>
            <div className="td-field">
              <span id="td-mode">Modo</span>
              <div role="radiogroup" aria-labelledby="td-mode" className="seg">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={draft.mode === m.id}
                    disabled={locked}
                    onClick={() => edit({ mode: m.id })}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="td-scroll">
            {GROUPS.map((g) => (
              <div key={g.title} className="td-group">
                <h2>{g.title}</h2>
                {g.tokens.map((token) => (
                  <ColorField
                    key={`${draft.id}-${token}`}
                    token={token}
                    value={draft.colors[token]}
                    disabled={locked}
                    onChange={(value) => setColor(token, value)}
                  />
                ))}
              </div>
            ))}

            <div className="td-group">
              <h2>Vista previa</h2>
              <pre className="td-preview" aria-label="Vista previa de código">
                <span className="cm">-- Total por cliente</span>
                {"\n"}
                <span className="kw">DECLARE</span> v_total <span className="ty">NUMBER</span> :={" "}
                <span className="fn">calcular</span>(<span className="nu">42</span>);
                {"\n"}
                <span className="kw">SELECT</span> nombre <span className="kw">FROM</span> clientes{" "}
                <span className="kw">WHERE</span> estado = <span className="st">'ACTIVO'</span>;
              </pre>
            </div>
          </div>

          <div aria-live="polite">
            {warnings.length > 0 && (
              <div className="td-warn">
                <div className="td-warn-head">
                  <WarningCircle size={14} aria-hidden />
                  <span>Contraste bajo</span>
                </div>
                <ul>
                  {warnings.map((w) => (
                    <li key={`${w.fg}-${w.bg}`}>
                      {LABELS[w.fg]} sobre {LABELS[w.bg]} {w.ratio.toFixed(1)}:1 (mín. {w.min})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {error && (
            <div role="alert" className="td-err">
              <WarningCircle size={14} aria-hidden />
              {error}
            </div>
          )}

          <div className="td-actions">
            <button type="button" className="btn danger" disabled={locked} onClick={remove}>
              Eliminar
            </button>
            <span className="td-spacer" />
            <button type="button" className="btn ghost" disabled={sameTheme(draft, base)} onClick={reset}>
              Restablecer
            </button>
            <button type="button" className="btn ghost" onClick={cancel}>
              Cancelar
            </button>
            <button type="button" className="btn primary" disabled={nameMissing} onClick={save}>
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
