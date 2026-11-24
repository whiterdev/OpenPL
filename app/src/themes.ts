import { contrastRatio, flatten } from "./contrast";

/** Tokens editables. Los de entorno (--env-*) quedan fuera: son señal de seguridad y no cambian. */
export const THEME_TOKENS = [
  "s0", "s1", "s2", "s3", "line", "line2", "field-line", "s-menu",
  "text", "muted", "faint", "accent", "accentText", "accentSoft",
  "err", "errSoft", "ok", "okSoft",
  "kw", "ty", "st", "nu", "cm", "fn",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

export type Theme = {
  id: string;
  name: string;
  mode: "dark" | "light";
  builtin: boolean;
  colors: Record<ThemeToken, string>;
};

export const DEFAULT_THEME_ID = "grafito";
const ACTIVE_KEY = "openpl.theme";
const CUSTOM_KEY = "openpl.customThemes";
const HEX = /^#[0-9a-f]{6}$/i;

function preset(id: string, name: string, mode: Theme["mode"], colors: Record<ThemeToken, string>): Theme {
  return { id, name, mode, builtin: true, colors };
}

export const PRESETS: readonly Theme[] = [
  preset("grafito", "Grafito", "dark", {
    s0: "#212327", s1: "#282a2f", s2: "#34373d", s3: "#3d4047",
    line: "#17191c", line2: "#3a3d43", "field-line": "#72767e", "s-menu": "#2e3035",
    text: "#dad5cc", muted: "#b1aca2", faint: "#6e6b66",
    accent: "#c99a3b", accentText: "#1e1a12", accentSoft: "#3d3524",
    err: "#ec8478", errSoft: "#3e2526", ok: "#75c08e", okSoft: "#233128",
    kw: "#8db2cb", ty: "#d6b27a", st: "#a7c08e", nu: "#da8f6e", cm: "#ca8a80", fn: "#c7a2d9",
  }),
  preset("papel", "Papel", "light", {
    s0: "#e7e9ed", s1: "#e0e4eb", s2: "#dadee6", s3: "#cfd5de",
    line: "#cbd1db", line2: "#b5bfce", "field-line": "#697688", "s-menu": "#eaedf2",
    text: "#202833", muted: "#4c5869", faint: "#818b99",
    accent: "#385880", accentText: "#f4f6fa", accentSoft: "#d5e0f1",
    err: "#963d36", errSoft: "#ecd6d0", ok: "#35613f", okSoft: "#d6dfcd",
    kw: "#0b8e4a", ty: "#265f4c", st: "#3d5485", nu: "#824a36", cm: "#f2280d", fn: "#634674",
  }),
  preset("medianoche", "Medianoche", "dark", {
    s0: "#161a22", s1: "#1c212b", s2: "#262c38", s3: "#2f3644",
    line: "#0f1218", line2: "#333b4a", "field-line": "#6f7a8e", "s-menu": "#20252f",
    text: "#d8dde6", muted: "#a6afbf", faint: "#626b7a",
    accent: "#6fa8dc", accentText: "#0d1620", accentSoft: "#22344a",
    err: "#ef8a80", errSoft: "#3d2428", ok: "#7cc596", okSoft: "#202f27",
    kw: "#82aaff", ty: "#e0b878", st: "#a5d48a", nu: "#f0a07a", cm: "#ca8a80", fn: "#c792ea",
  }),
  preset("bosque", "Bosque", "dark", {
    s0: "#1b211d", s1: "#212823", s2: "#2b332d", s3: "#343d36",
    line: "#121613", line2: "#38423a", "field-line": "#717d73", "s-menu": "#262e28",
    text: "#d9dccf", muted: "#aab2a3", faint: "#667064",
    accent: "#8fbf6a", accentText: "#142010", accentSoft: "#2e3d26",
    err: "#e88a7a", errSoft: "#3d2523", ok: "#7cc79a", okSoft: "#223128",
    kw: "#87b9c9", ty: "#d4b97a", st: "#b5cf86", nu: "#e09a70", cm: "#ca8a80", fn: "#c8a6d6",
  }),
  preset("alto-contraste", "Alto contraste", "dark", {
    s0: "#000000", s1: "#0a0a0a", s2: "#1a1a1a", s3: "#2a2a2a",
    line: "#5a5a5a", line2: "#7a7a7a", "field-line": "#bdbdbd", "s-menu": "#111111",
    text: "#ffffff", muted: "#d6d6d6", faint: "#9a9a9a",
    accent: "#ffd24a", accentText: "#000000", accentSoft: "#3d3200",
    err: "#ff8a80", errSoft: "#3d1512", ok: "#7ee0a0", okSoft: "#0f3320",
    kw: "#7fc8ff", ty: "#ffd27f", st: "#b8f08a", nu: "#ffab7a", cm: "#d7a49a", fn: "#e3b0ff",
  }),
];

function rgba(hex: string, alpha: number) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Tokens translúcidos: se derivan del tema para que sigan siendo transparentes sobre cualquier fondo. */
function derived(theme: Theme): Record<string, string> {
  const dark = theme.mode === "dark";
  return {
    sel: rgba(theme.colors.accent, 0.3),
    selMatch: rgba(theme.colors.kw, 0.18),
    activeLine: dark ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 0, 0, 0.04)",
    backdrop: dark ? "rgba(12, 13, 15, 0.55)" : "rgba(20, 22, 26, 0.35)",
    shadow: dark ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.18)",
  };
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  for (const token of THEME_TOKENS) root.style.setProperty(`--${token}`, theme.colors[token]);
  for (const [token, value] of Object.entries(derived(theme))) root.style.setProperty(`--${token}`, value);
  root.style.colorScheme = theme.mode;
  root.dataset.theme = theme.id;
}

export type ContrastWarning = { fg: string; bg: string; ratio: number; min: number };

const CHECKS: [fg: ThemeToken, bg: ThemeToken, min: number][] = [
  ["text", "s0", 7],
  ...(["s1", "s2", "s3", "s-menu"] as const).map((bg): [ThemeToken, ThemeToken, number] => ["text", bg, 4.5]),
  ...(["s0", "s1", "s2", "s-menu"] as const).map((bg): [ThemeToken, ThemeToken, number] => ["muted", bg, 4.5]),
  ...(["kw", "ty", "st", "nu", "fn", "cm"] as const).map((fg): [ThemeToken, ThemeToken, number] => [fg, "s0", 4.5]),
  ["cm", "errSoft", 4.5],
  ["cm", "okSoft", 4.5],
  ["accentText", "accent", 4.5],
  ["err", "s0", 4.5],
  ["err", "s1", 4.5],
  ["ok", "s0", 4.5],
  ["ok", "s1", 4.5],
  ["accent", "s0", 3],
  ["field-line", "s1", 3],
];

/** Pares que no llegan al mínimo WCAG. Solo informa: un tema propio se guarda igual. */
export function contrastWarnings(theme: Theme): ContrastWarning[] {
  const c = theme.colors;
  const extra = derived(theme);
  const activeLine = flatten(extra.activeLine, c.s0);
  const pairs: [string, string, string, string, number][] = [
    ...CHECKS.map(([fg, bg, min]): [string, string, string, string, number] => [fg, bg, c[fg], c[bg], min]),
    ["cm", "activeLine", c.cm, activeLine, 4.5],
    ["text", "sel", c.text, flatten(extra.sel, activeLine), 4.5],
  ];
  return pairs.flatMap(([fg, bg, a, b, min]) => {
    const ratio = contrastRatio(a, b);
    return ratio < min ? [{ fg, bg, ratio, min }] : [];
  });
}

/** Devuelve el tema con solo los tokens conocidos, o null si algo no es #rrggbb. */
function sanitize(value: unknown): Theme | null {
  if (typeof value !== "object" || value === null) return null;
  const t = value as Partial<Theme>;
  if (typeof t.id !== "string" || !t.id || typeof t.name !== "string") return null;
  if (t.mode !== "dark" && t.mode !== "light") return null;
  if (typeof t.colors !== "object" || t.colors === null) return null;
  const colors = {} as Record<ThemeToken, string>;
  for (const token of THEME_TOKENS) {
    const color = (t.colors as Record<string, unknown>)[token];
    if (typeof color !== "string" || !HEX.test(color)) return null;
    colors[token] = color.toLowerCase();
  }
  return { id: t.id, name: t.name, mode: t.mode, builtin: false, colors };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* preferencia opcional */
  }
}

function customThemes(): Theme[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(read(CUSTOM_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const isPreset = (id: string) => PRESETS.some((p) => p.id === id);
  return parsed.map(sanitize).filter((t): t is Theme => t !== null && !isPreset(t.id));
}

export function loadThemes(): Theme[] {
  return [...PRESETS, ...customThemes()];
}

export function activeThemeId(): string {
  const id = read(ACTIVE_KEY);
  return id && loadThemes().some((t) => t.id === id) ? id : DEFAULT_THEME_ID;
}

export function activeTheme(): Theme {
  const id = activeThemeId();
  return loadThemes().find((t) => t.id === id)!;
}

export function applyActiveTheme() {
  applyTheme(activeTheme());
}

export function setActiveThemeId(id: string) {
  write(ACTIVE_KEY, id);
}

export function saveCustomTheme(theme: Theme) {
  if (PRESETS.some((p) => p.id === theme.id)) throw new Error(`"${theme.name}" es un tema incluido`);
  const bad = THEME_TOKENS.find((token) => !HEX.test(theme.colors[token] ?? ""));
  if (bad) throw new Error(`Color no válido en --${bad}: ${theme.colors[bad]}`);
  const clean = sanitize(theme)!;
  const others = customThemes().filter((t) => t.id !== clean.id);
  write(CUSTOM_KEY, JSON.stringify([...others, clean]));
}

export function deleteCustomTheme(id: string) {
  write(CUSTOM_KEY, JSON.stringify(customThemes().filter((t) => t.id !== id)));
  if (read(ACTIVE_KEY) === id) write(ACTIVE_KEY, null);
}
