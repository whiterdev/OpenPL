import { useEffect, useRef } from "react";
import { ArrowCircleUp } from "@phosphor-icons/react";

interface Props {
  update: { version: string; notes: string };
  /** Sin valor: esperando la decisión. null: descargando sin tamaño conocido. */
  progress?: number | null;
  onInstall: () => void;
  onLater: () => void;
}

/** Aviso de versión nueva. Escape equivale a Más tarde, salvo durante la descarga. */
export function UpdateDialog({ update, progress, onInstall, onLater }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const install = useRef<HTMLButtonElement>(null);
  const installing = progress !== undefined;
  useEffect(() => {
    const previous = document.activeElement;
    install.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  // Los botones deshabilitados pierden el foco: lo conserva el diálogo.
  useEffect(() => { if (installing) dialog.current?.focus(); }, [installing]);
  return (
    <div className="dialog-backdrop">
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true"
        aria-labelledby="update-dialog-title" className="dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            if (!installing) onLater();
          } else if (event.key === "Tab") {
            // El foco queda dentro del diálogo mientras está abierto.
            event.preventDefault();
            const buttons = Array.from(event.currentTarget.querySelectorAll("button"))
              .filter((button) => !button.disabled);
            if (!buttons.length) return;
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
            buttons[next].focus();
          }
        }}>
        <h2 id="update-dialog-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ArrowCircleUp size={16} aria-hidden="true" />
          OpenPL {update.version}
        </h2>
        {update.notes && (
          <pre style={{
            maxHeight: 200, overflow: "auto", margin: "0 0 16px", padding: "8px 10px",
            border: "1px solid var(--line)", borderRadius: 4, background: "var(--s0)",
            color: "var(--text)", fontFamily: "var(--font-code)", fontSize: 12,
            whiteSpace: "pre-wrap",
          }}>{update.notes}</pre>
        )}
        {installing && (
          <p role="status">{progress === null ? "Descargando" : `Descargando ${progress}%`}</p>
        )}
        <div className="dialog-actions">
          <button className="btn primary" ref={install} disabled={installing} onClick={onInstall}>
            Actualizar
          </button>
          <button className="btn ghost" disabled={installing} onClick={onLater}>Más tarde</button>
        </div>
      </div>
    </div>
  );
}
