import { useEffect, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { Logo } from "./Logo";
import { api } from "../api";
import { describeError, type ClientInfo } from "../types";
import "./StartupCheck.css";

export function StartupCheck({ onReady }: { onReady: (info: ClientInfo) => void }) {
  const [info, setInfo] = useState<ClientInfo | null>(null);
  const [dir, setDir] = useState("");
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // El cliente se inicializa una sola vez al arrancar el proceso: cambiarlo exige reiniciar.
  useEffect(() => {
    api
      .clientInfo()
      .then((i) => {
        setInfo(i);
        setDir(i.lib_dir ?? "");
        if (i.version) onReady(i);
      })
      .catch((e) => setFailure(describeError(e).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failure)
    return (
      <main className="startup">
        <p className="startup-err" role="alert">
          <WarningCircle size={15} aria-hidden />
          <span>{failure}</span>
        </p>
      </main>
    );

  if (!info || info.version) return null;

  return (
    <main className="startup">
      <section className="startup-card" aria-labelledby="startup-title">
        <header>
          <Logo size={20} />
          <h1 id="startup-title">Cliente Oracle no disponible</h1>
        </header>
        <p className="startup-err" role="alert">
          <WarningCircle size={15} aria-hidden />
          {info.error?.code && <span className="mono">{info.error.code}</span>}
          <span>{info.error?.message}</span>
        </p>
        <p className="startup-help">{info.help}</p>
        <label className="startup-dir">
          <span className="lbl">Carpeta del cliente</span>
          <input className="fld mono" aria-label="Carpeta del cliente" value={dir} onChange={(e) => setDir(e.target.value)} />
        </label>
        <div className="startup-actions">
          {saved && <span className="startup-saved">Reinicie OpenPL</span>}
          <button
            className="btn primary"
            onClick={async () => {
              setSaveError(null);
              setSaved(false);
              try {
                await api.setClientDir(dir.trim() || null);
                setSaved(true);
              } catch (error) {
                setSaveError(describeError(error).message);
              }
            }}
          >
            Guardar
          </button>
        </div>
        {saveError && <p className="startup-err" role="alert">{saveError}</p>}
      </section>
    </main>
  );
}
