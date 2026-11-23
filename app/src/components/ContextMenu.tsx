import { useEffect, useRef } from "react";
import { formatKeys } from "../keymap";

export interface ContextItem {
  label: string;
  keys?: string;
  /** Sin `run` el ítem aparece deshabilitado. */
  run?: () => void;
}

interface Props {
  x: number;
  y: number;
  label: string;
  items: (ContextItem | "sep")[];
  onClose: () => void;
}

/** Menú de clic derecho en la posición del puntero. Se cierra con Escape, clic fuera o al elegir. */
export function ContextMenu({ x, y, label, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const hasAction = items.some((item) => item !== "sep" && item.run);

  useEffect(() => {
    const out = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", out);
    document.addEventListener("keydown", esc);
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("mousedown", out);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose, hasAction]);

  // Mantener el menú dentro de la ventana.
  const left = Math.max(0, Math.min(x, window.innerWidth - 270));
  const top = Math.max(0, Math.min(y, window.innerHeight - items.length * 30 - 16));

  return (
    <div ref={ref} role="menu" aria-label={label} className="menu" style={{ position: "fixed", left, top, width: 260 }}>
      {items.map((it, i) =>
        it === "sep" ? (
          <div key={`sep${i}`} className="menu-sep" role="separator" />
        ) : (
          <button
            key={it.label}
            role="menuitem"
            className="menu-item"
            disabled={!it.run}
            onClick={() => {
              onClose();
              it.run?.();
            }}
          >
            <span className="menu-label">{it.label}</span>
            {it.keys && <span className="menu-kbd">{formatKeys(it.keys)}</span>}
          </button>
        ),
      )}
    </div>
  );
}
