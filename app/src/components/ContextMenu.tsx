import { useEffect, useLayoutEffect, useRef } from "react";
import { Check } from "@phosphor-icons/react";
import { formatKeys } from "../keymap";

export interface ContextItem {
  label: string;
  keys?: string;
  checked?: boolean;
  radio?: boolean;
  /** Sin `run` el ítem aparece deshabilitado. */
  run?: () => void;
  /** Función que todavía no existe: deshabilitada con la marca "Próximamente". */
  pending?: boolean;
}

interface Props {
  x: number;
  y: number;
  label: string;
  items: (ContextItem | "sep")[];
  onClose: () => void;
  width?: number;
  className?: string;
  /** Botón que abre el menú: un clic sobre él no cuenta como clic fuera. */
  anchor?: { readonly current: HTMLElement | null };
}

/** Menú de clic derecho en la posición del puntero. Se cierra con Escape, clic fuera o al elegir. */
export function ContextMenu({ x, y, label, items, onClose, width = 260, className = "", anchor }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const hasAction = items.some((item) => item !== "sep" && item.run);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const previousFocusRef = useRef<Element | null | undefined>(undefined);
  if (previousFocusRef.current === undefined) {
    previousFocusRef.current = typeof document !== "undefined" ? document.activeElement : null;
  }

  const restoreFocus = () => {
    const prev = previousFocusRef.current;
    if (prev instanceof HTMLElement && prev.isConnected) prev.focus();
  };

  useEffect(() => {
    const out = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.current?.contains(e.target as Node)) return;
      const focusInside = ref.current?.contains(document.activeElement);
      const hitsControl =
        e.target instanceof Element &&
        !!e.target.closest('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]');
      onCloseRef.current();
      if (focusInside && !hitsControl) restoreFocus();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const focusInside = ref.current?.contains(document.activeElement);
      onCloseRef.current();
      if (focusInside) restoreFocus();
    };
    document.addEventListener("mousedown", out);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", out);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  useEffect(() => {
    if (!ref.current?.contains(document.activeElement)) {
      ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }
  }, [hasAction]);

  // Mantener el menú dentro de la ventana.
  const fittedWidth = Math.min(width, window.innerWidth);
  const left = Math.max(0, Math.min(x, window.innerWidth - fittedWidth - 10));
  const top = Math.max(0, Math.min(y, window.innerHeight - items.length * 30 - 16));
  useLayoutEffect(() => {
    const menu = ref.current;
    if (menu) menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - menu.offsetWidth - 10))}px`;
  });

  return (
    <div ref={ref} role="menu" aria-label={label} className={`menu ${className}`}
      style={{ position: "fixed", left, top, minWidth: fittedWidth, width: "max-content", maxWidth: "100vw", maxHeight: `calc(100vh - ${top}px)`, overflow: "auto" }}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          event.preventDefault();
          onCloseRef.current();
          restoreFocus();
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = current + (event.key === "ArrowDown" ? 1 : -1);
        buttons[(next + buttons.length) % buttons.length]?.focus();
        event.preventDefault();
      }}>
      {items.map((it, i) =>
        it === "sep" ? (
          <div key={`sep${i}`} className="menu-sep" role="separator" />
        ) : (
          <button
            key={it.label}
            role={it.radio ? "menuitemradio" : it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={it.checked}
            className="menu-item"
            disabled={!it.run}
            onClick={() => {
              onClose();
              it.run?.();
            }}
          >
            <span className="menu-label">{it.label}</span>
            {it.checked && <Check size={16} aria-hidden="true" />}
            {it.pending && !it.run && <span className="menu-soon">Próximamente</span>}
            {it.keys && <span className="menu-kbd">{formatKeys(it.keys)}</span>}
          </button>
        ),
      )}
    </div>
  );
}
