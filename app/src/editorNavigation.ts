import type { Resolved, SymbolLocation } from "./symbolResolve";

export type NavigationGoal = "definition" | "declaration" | "implementation";

export interface NavigationTarget {
  location: SymbolLocation;
  /** Firma del destino, para el selector cuando hay varios. */
  label: string;
}

export interface NavigationChoice {
  targets: NavigationTarget[];
  notice?: "Cuerpo no disponible";
}

const routineKinds = new Set(["procedure", "function"]);

/**
 * Destinos según el objetivo, uno por declaración distinta (las sobrecargas suman destinos).
 * definition: el cuerpo si existe, si no la declaración. declaration: al revés.
 * implementation: el cuerpo; sin cuerpo, la declaración con aviso.
 */
export function navigationTargets(items: Resolved[], goal: NavigationGoal): NavigationChoice {
  const groups = new Map<string, Extract<Resolved, { kind: "symbol" }>[]>();
  for (const item of items) {
    if (item.kind !== "symbol") continue;
    const key = `${item.symbol.kind}|${item.symbol.signature.replace(/\s+/g, " ").toUpperCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  let missingBody = false;
  const targets: NavigationTarget[] = [];
  for (const group of groups.values()) {
    const body = group.find((item) => item.symbol.definition);
    const declaration = group.find((item) => !item.symbol.definition);
    const chosen = goal === "declaration" ? declaration ?? body : body ?? declaration;
    if (!chosen) continue;
    if (goal === "implementation" && !body && routineKinds.has(chosen.symbol.kind)) missingBody = true;
    targets.push({ location: chosen.location, label: chosen.symbol.signature });
  }
  return missingBody ? { targets, notice: "Cuerpo no disponible" } : { targets };
}
