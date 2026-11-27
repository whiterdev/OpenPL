import type { api as appApi } from "./api";
import type { ObjectColumn, ObjectInfo } from "./types";
import type { Tree } from "./programSymbols";

export interface SourcePart {
  /** Como `ProgramPart.kind`: "PACKAGE", "PACKAGE BODY", "SQL"… */
  kind: string;
  source: string;
  /** Árbol del editor para `source`, si está listo: evita volver a parsear. */
  tree?: Tree;
}

export interface ObjectKey {
  connection: string;
  owner: string;
  name: string;
}

export interface SymbolLookup {
  object(owner: string | null, name: string): Promise<ObjectInfo | null>;
  /** Lista vacía: fuente no disponible. */
  parts(object: ObjectInfo): Promise<SourcePart[]>;
  columns(owner: string, name: string): Promise<ObjectColumn[]>;
}

export interface SymbolSources {
  /** Registra el texto vivo de un objeto abierto; devuelve la función para darlo de baja. */
  register(key: ObjectKey, read: () => SourcePart[]): () => void;
  lookup(connection: string, contextOwner: string | null): SymbolLookup;
  invalidate(connection: string, owner?: string, name?: string): void;
}

export type SymbolApi = Pick<typeof appApi, "editorObject" | "programSource" | "describeColumns">;

const keyOf = (...parts: (string | null)[]) => JSON.stringify(parts);

/** Fuentes para resolver nombres: editores abiertos primero, después Oracle con caché por conexión. */
export function createSymbolSources(api: SymbolApi): SymbolSources {
  const open = new Map<string, () => SourcePart[]>();
  const cache = new Map<string, { connection: string; owner: string | null; name: string; value: Promise<unknown> }>();

  function cached<T>(connection: string, owner: string | null, name: string, kind: string, load: () => Promise<T>) {
    const key = keyOf(kind, connection, owner, name);
    const hit = cache.get(key);
    if (hit) return hit.value as Promise<T>;
    const value = load();
    cache.set(key, { connection, owner, name, value });
    value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
    return value;
  }

  return {
    register(key, read) {
      const id = keyOf(key.connection, key.owner, key.name);
      open.set(id, read);
      return () => { if (open.get(id) === read) open.delete(id); };
    },
    lookup(connection, contextOwner) {
      return {
        object: (owner, name) =>
          cached(connection, owner ?? contextOwner, name, "object", () =>
            api.editorObject(connection, { owner, name }, contextOwner)),
        parts: async (object) => {
          const live = open.get(keyOf(connection, object.owner, object.name));
          if (live) return live();
          try {
            const parts = await cached(connection, object.owner, object.name, "source", () =>
              api.programSource(connection, object.object_type, object.owner, object.name));
            return parts.map(({ kind, source }) => ({ kind, source }));
          } catch {
            return [];
          }
        },
        columns: (owner, name) =>
          cached(connection, owner, name, "columns", () => api.describeColumns(connection, owner, name)),
      };
    },
    invalidate(connection, owner, name) {
      for (const [key, entry] of cache) {
        if (entry.connection !== connection) continue;
        if (owner !== undefined && entry.owner !== owner) continue;
        if (name !== undefined && entry.name !== name) continue;
        cache.delete(key);
      }
    },
  };
}
