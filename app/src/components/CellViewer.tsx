import { useEffect, useId, useRef, useState } from "react";
import { clipboard } from "../api";
import "./CellViewer.css";

interface Props {
  column: string;
  value: string | null;
  lob: boolean;
  onClose: () => void;
}

const CHAR_LIMIT = 1_000_000;

export function CellViewer({ column, value, lob, onClose }: Props) {
  const title = useId();
  const valueRef = useRef<HTMLTextAreaElement>(null);
  const [copyError, setCopyError] = useState(false);
  const atLimit = lob && value !== null && value.length >= CHAR_LIMIT && Array.from(value).length >= CHAR_LIMIT;
  useEffect(() => {
    const previous = document.activeElement;
    valueRef.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);

  return (
    <div className="dialog-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby={title} className="dialog cell-viewer"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Tab") {
            event.preventDefault();
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("textarea, button"));
            const current = controls.indexOf(document.activeElement as HTMLElement);
            controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
          }
        }}>
        <h2 id={title}>{column}</h2>
        {atLimit && <p role="status">Primeros 1.000.000 caracteres</p>}
        <textarea ref={valueRef} className="fld mono" aria-label="Valor" value={value ?? ""} placeholder="NULL" readOnly />
        {copyError && <p role="alert">No se pudo copiar</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => {
            void clipboard.writeText(value ?? "").then(() => setCopyError(false), () => setCopyError(true));
          }}>Copiar</button>
          <button type="button" className="btn primary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
