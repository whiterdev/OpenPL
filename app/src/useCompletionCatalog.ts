import { useMemo } from "react";
import { api } from "./api";
import type { CompletionCatalog } from "./programCompletion";

/** Catálogo de completado de una sesión, con caché propia de objetos y columnas. */
export function completionCatalog(sessionId: string, contextOwner: string | null): CompletionCatalog {
  const cache = new Map<string, Promise<unknown>>();
  const cached = <T,>(key: string, load: () => Promise<T>) => {
    let value = cache.get(key) as Promise<T> | undefined;
    if (!value) {
      value = load();
      cache.set(key, value);
      value.catch(() => cache.delete(key));
    }
    return value;
  };
  return {
    objects: (owner, prefix, scope = "any") => cached(`o\0${owner ?? ""}\0${prefix}\0${scope}`,
      () => api.completeObjects(sessionId, owner, prefix, contextOwner, scope)),
    columns: (owner, name) => cached(`c\0${owner ?? ""}\0${name}`,
      () => api.objectColumns(sessionId, owner, name, contextOwner)),
  };
}

/**
 * Devuelve el mismo catálogo mientras no cambien la sesión ni el esquema de contexto:
 * `catalogCompletion` descarta la respuesta si el catálogo cambió durante la consulta.
 */
export function useCompletionCatalog(
  sessionId: string | undefined,
  contextOwner: string | null,
): CompletionCatalog | null {
  return useMemo(
    () => (sessionId ? completionCatalog(sessionId, contextOwner) : null),
    [sessionId, contextOwner],
  );
}
