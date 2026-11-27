# Editor inteligente. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ficha al pasar el mouse (firma, tipo, valor declarado, comentario, campos y columnas) y navegación a definición, declaración e implementación en todos los editores de código de OpenPL.

**Architecture:** Un analizador puro (`programSymbols.ts`) saca símbolos del texto PL/SQL. Un resolvedor (`symbolResolve.ts`) busca un nombre de hasta tres partes en el alcance local, el paquete abierto y otros objetos, con fuentes obtenidas por una interfaz `SymbolLookup` (editor abierto primero, caché por conexión después). Dos extensiones de CodeMirror en `ProgramEditor` (ficha y Ctrl+clic) y un módulo de navegación compartido entre `ProgramWindow` y `SqlWindow`.

**Tech Stack:** TypeScript, React 19, CodeMirror 6 (`hoverTooltip`, `EditorView.domEventHandlers`), `@codemirror/lang-sql` (dialecto `oracleDialect`), Vitest. Sin cambios en Rust: se usan `editor_object`, `program_source` y `describe_columns`, que ya existen.

**Spec:** `docs/superpowers/specs/2026-11-27-openpl-editor-inteligente-design.md`, Parte 2.

## Global Constraints

- Oracle 12.1+. Solo lecturas que ya existen (`api.editorObject`, `api.programSource`, `api.describeColumns`). Nada que escriba en la base ni ejecute código del usuario.
- Las consultas del hover usan la conexión principal (`editorConnection.sessionId` en ventanas de programa, `tab.connection.sessionId` en SQL y prueba), no la sesión propia de la ventana SQL.
- Valor de constantes y variables: solo el declarado (`:=` o `DEFAULT`). Sin valor de sesión.
- Ficha tras 400 ms quieto (`hoverTime: 400`); se cierra al tipear o mover fuera.
- Nada recorre el documento completo por tecla: el análisis se cachea por `Text` (identidad del doc) y se calcula al pedir la ficha.
- Atajos solo en `keymap.ts`: Ir a la definición `F12`, Ir a la declaración `Ctrl+F12`, Ir a la implementación `Ctrl+Shift+F12`, Mostrar ficha `Ctrl+Shift+Space` (si `keymap.test.ts` detecta choque, el implementador elige otro y lo anota en ESTADO.md).
- Textos en pantalla (exactos): "Fuente no disponible", "Cuerpo no disponible", "Sin valor inicial", "Expresión", "Objeto no encontrado", "Ir a la definición", "Ir a la declaración", "Ir a la implementación".
- Tokens de color del tema para la ficha (`--s1`, `--line`, `--text`, `--muted`, `--font-code`). Íconos Phosphor. Antislop al cierre (AGENTS.md regla 6).
- TDD en cada tarea. Suite completa (`npx.cmd tsc --noEmit`, `npm.cmd test`) en verde antes de cada commit.

## Review Focus

- Documento a medio escribir (paréntesis sin cerrar, `END` faltante): el analizador no lanza y devuelve lo que pudo. Test en Task 1.
- Nombres entre comillas y mayúsculas mezcladas (`"MiPaquete".calcular`, `PKG_Ventas.CALCULAR`): se resuelven igual que en Oracle. Test en Tasks 2 y 4.
- Variable local que tapa a una global con el mismo nombre: gana la local dentro de su bloque y la global fuera. Test en Task 4.
- Sin conexión o con la consulta fallando: la ficha muestra lo local y nunca queda "cargando" para siempre. Test en Task 4 (lookup que rechaza) y Task 5.
- Paquete abierto con cambios sin guardar referenciado desde otra ventana: se usa el texto del editor, no la fuente de Oracle. Test en Task 3.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `app/src/programSymbols.ts` (nuevo) | Texto → `ProgramSymbol[]`. Puro. |
| `app/src/editorReference.ts` | Nombre bajo el cursor, ampliado a camino de hasta 3 partes con índices. |
| `app/src/symbolSources.ts` (nuevo) | Registro de documentos abiertos y caché de fuentes por conexión. |
| `app/src/symbolResolve.ts` (nuevo) | Camino + posición → candidatos con ubicación, incluidos campos y columnas. |
| `app/src/symbolHover.ts` + `components/SymbolCard.tsx` (nuevos) | Extensión de ficha y su contenido. |
| `app/src/editorNavigation.ts` (nuevo) | Definición, declaración, implementación; Ctrl+clic. |
| `components/ProgramEditor.tsx`, `ProgramWindow.tsx`, `SqlWindow.tsx`, `App.tsx`, `keymap.ts` | Conexión de las piezas. |

---

### Task 1: Analizador de símbolos

**Files:**
- Create: `app/src/programSymbols.ts`
- Test: `app/src/programSymbols.test.ts`
- Modify: `app/src/programStructure.ts` (exportar `matchingBlocks`, `boundary`, `parameters`, `format` si se reutilizan; no cambiar su comportamiento)

**Interfaces:**
- Consumes: `tokenize(source): Token[]` de `programStructure.ts`.
- Produces:

```ts
export type SymbolKind =
  | "package" | "procedure" | "function" | "cursor" | "type" | "subtype"
  | "variable" | "constant" | "exception" | "parameter" | "field";

export interface ProgramSymbol {
  kind: SymbolKind;
  name: string;              // clave Oracle: mayúsculas, o tal cual si venía entre comillas
  signature: string;         // línea formateada, p. ej. "FUNCTION calcular(p_id IN NUMBER) RETURN NUMBER"
  dataType: string | null;   // "NUMBER", "CLIENTES%ROWTYPE", "T_REC", "VARCHAR2(100)"
  value: string | null;      // texto tras := o DEFAULT, sin el ;
  comment: string | null;    // comentario pegado arriba (o al final de la misma línea), sin marcadores
  from: number;              // posición del nombre
  scope: { from: number; to: number } | null; // null = nivel de unidad (global de paquete)
  definition: boolean;       // true si es el cuerpo de una rutina
  container: string | null;  // rutina, cursor o tipo dueño (parámetros y campos)
  query?: string;            // texto del SELECT de un cursor
}

export function programSymbols(source: string): ProgramSymbol[];
```

Los comentarios no llegan en `tokenize` (los descarta): leerlos del árbol de `oracleDialect` (`LineComment`, `BlockComment`) en una pasada aparte.

- [ ] **Step 1: Tests** en `programSymbols.test.ts`, cada uno con un paquete corto como fuente:
  - `"constante con valor y tipo"`: `c_max CONSTANT NUMBER := 3;` → `{ kind: "constant", name: "C_MAX", dataType: "NUMBER", value: "3", scope: null }`.
  - `"variable con DEFAULT y variable sin valor"`: `g_modo VARCHAR2(10) DEFAULT 'A';` → `value: "'A'"`, `dataType: "VARCHAR2(10)"`; `g_total NUMBER;` → `value: null`.
  - `"firma de función con modos y comentario"`: `-- Calcula el total\nFUNCTION calcular(p_id IN NUMBER, p_out OUT VARCHAR2) RETURN NUMBER;` → `signature: "FUNCTION calcular(p_id IN NUMBER, p_out OUT VARCHAR2) RETURN NUMBER"`, `comment: "Calcula el total"`, `definition: false`; parámetros `P_ID` y `P_OUT` con `kind: "parameter"`, `container: "CALCULAR"`, `dataType` `NUMBER` y `VARCHAR2`.
  - `"cuerpo de rutina y locales con alcance"`: en un body, `PROCEDURE p IS v_x NUMBER := 1; BEGIN NULL; END;` → `P` con `definition: true`; `V_X` con `scope` que cubre desde `IS` hasta `END;` de `P`.
  - `"sobrecargas producen dos símbolos"`: dos `PROCEDURE p(a NUMBER)` y `PROCEDURE p(a VARCHAR2)` → dos símbolos `P` con firmas distintas.
  - `"record y sus campos"`: `TYPE t_rec IS RECORD (id NUMBER, nombre VARCHAR2(50));` → `T_REC` `kind: "type"` y campos `ID`, `NOMBRE` con `kind: "field"`, `container: "T_REC"`.
  - `"cursor con parámetros y consulta"`: `CURSOR c_cli(p_id NUMBER) IS SELECT id, nombre n FROM clientes WHERE id = p_id;` → `kind: "cursor"`, `query` empieza con `"SELECT id, nombre n FROM clientes"`.
  - `"subtype y %TYPE"`: `SUBTYPE t_monto IS NUMBER(12,2);` → `kind: "subtype"`, `dataType: "NUMBER(12,2)"`; `v_c clientes.id%TYPE;` → `dataType: "clientes.id%TYPE"`.
  - `"FOR de cursor declara su registro"`: `FOR r IN c_cli(1) LOOP ... END LOOP;` → `R` `kind: "variable"`, `dataType: "C_CLI%ROWTYPE"`, `scope` igual al `LOOP`.
  - `"texto incompleto no lanza"`: `"PACKAGE BODY x IS PROCEDURE p(a NUMBER"` → no lanza y devuelve un array.
- [ ] **Step 2: Correr y ver fallar.** `npx.cmd vitest run src/programSymbols.test.ts` → FAIL, módulo inexistente.
- [ ] **Step 3: Implementar `programSymbols`** reutilizando las funciones de `programStructure.ts` para encabezados, parámetros y bloques.
- [ ] **Step 4: Correr.** Mismo comando → PASS. `npm.cmd test` → verde (no se rompió `programStructure`).
- [ ] **Step 5: Commit.** `feat(app): analizador de símbolos PL/SQL`

### Task 2: Camino de nombre bajo el cursor

**Files:**
- Modify: `app/src/editorReference.ts`
- Test: `app/src/editorReference.test.ts`

**Interfaces:**
- Produces (se mantiene `editorReference` igual para no romper sus usos):

```ts
export interface NamePath {
  parts: string[];   // claves Oracle, p. ej. ["HR", "PKG_VENTAS", "CALCULAR"] o ["V_CLI", "NOMBRE"]
  index: number;     // parte sobre la que está el cursor
  from: number;      // inicio de esa parte
  to: number;        // fin de esa parte
}
export function editorPath(state: EditorState, position: number): NamePath | null;
```

Los índices se saltan: `t_tab(i).campo` → `parts: ["T_TAB", "CAMPO"]`. Hasta 3 partes; más → `null`. Ignora binds (`:x`) y dblinks (`@x`) como `editorReference`.

- [ ] **Step 1: Tests:**
  - `"tres partes con el cursor en la del medio"`: `hr.pkg_ventas.calcular(1)`, cursor en `pkg` → `{ parts: ["HR","PKG_VENTAS","CALCULAR"], index: 1 }`.
  - `"campo de registro tras índice"`: `t_tab(i).nombre`, cursor en `nombre` → `{ parts: ["T_TAB","NOMBRE"], index: 1 }`.
  - `"comillas conservan mayúsculas"`: `"MiPaquete".calcular` → `parts: ["MiPaquete","CALCULAR"]`.
  - `"bind y cuatro partes devuelven null"`: `:p_id` → `null`; `a.b.c.d` → `null`.
- [ ] **Step 2: Correr y ver fallar.** `npx.cmd vitest run src/editorReference.test.ts` → FAIL.
- [ ] **Step 3: Implementar `editorPath`.** Recorrer tokens de la línea hacia atrás y adelante desde el identificador: `Identifier`/`QuotedIdentifier` separados por `.`, con un grupo `(…)` balanceado opcional entre un nombre y el `.` siguiente.
- [ ] **Step 4: Correr.** Mismo comando → PASS.
- [ ] **Step 5: Commit.** `feat(app): camino de nombre de hasta tres partes`

### Task 3: Fuentes de símbolos (documentos abiertos y caché)

**Files:**
- Create: `app/src/symbolSources.ts`
- Test: `app/src/symbolSources.test.ts`
- Modify: `app/src/App.tsx` (crear una instancia y pasarla; invalidar al compilar, refrescar el explorador y reconectar)

**Interfaces:**
- Consumes: `api.editorObject`, `api.programSource`, `api.describeColumns`.
- Produces:

```ts
export interface SourcePart { kind: string; source: string }  // kind como ProgramPart.kind ("PACKAGE", "PACKAGE BODY", …)
export interface ObjectKey { connection: string; owner: string; name: string }

export interface SymbolLookup {
  object(owner: string | null, name: string): Promise<ObjectInfo | null>;
  parts(object: ObjectInfo): Promise<SourcePart[]>;      // [] = fuente no disponible
  columns(owner: string, name: string): Promise<ObjectColumn[]>;
}

export interface SymbolSources {
  /** Registra el texto vivo de un objeto abierto; devuelve la función para darlo de baja. */
  register(key: ObjectKey, read: () => SourcePart[]): () => void;
  lookup(connection: string, contextOwner: string | null): SymbolLookup;
  invalidate(connection: string, owner?: string, name?: string): void;
}

export function createSymbolSources(api: Pick<typeof import("./api").api,
  "editorObject" | "programSource" | "describeColumns">): SymbolSources;
```

- [ ] **Step 1: Tests** (con `api` falso de `vi.fn()`):
  - `"un objeto abierto se lee del editor, no de Oracle"`: `register({connection:"c",owner:"HR",name:"PKG"}, () => [{kind:"PACKAGE",source:"nuevo"}])`; `parts(info HR.PKG)` → `"nuevo"` y `programSource` no llamado.
  - `"la fuente de Oracle se pide una vez por conexión"`: dos `parts` seguidos → `programSource` llamado 1 vez; tras `invalidate("c","HR","PKG")` → 2 veces.
  - `"dar de baja vuelve a la caché"`: tras llamar la función devuelta por `register`, `parts` usa `programSource`.
  - `"un fallo de fuente devuelve lista vacía"`: `programSource` rechaza → `parts` resuelve `[]`, y el fallo no queda en caché.
  - `"columnas cacheadas por conexión"`: dos `columns("HR","CLIENTES")` → `describeColumns` 1 vez.
- [ ] **Step 2: Correr y ver fallar.** `npx.cmd vitest run src/symbolSources.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** Caché `Map` por `connection|OWNER|NAME`, guardando promesas; borrar la entrada si la promesa rechaza.
- [ ] **Step 4: Correr** → PASS.
- [ ] **Step 5: Conectar en `App.tsx`.** Una instancia con `useMemo`. Cada pestaña de programa con objeto registra `{ connection: tab.connection.sessionId, owner, name }` con un lector que arma `SourcePart[]` desde sus vistas (exponer en `ProgramActions` un `readParts?: () => SourcePart[]`). Llamar `invalidate` después de compilar un objeto, al refrescar el explorador (`refreshTick`) y al reconectar (`reconnectConnection`).
- [ ] **Step 6:** `npx.cmd tsc --noEmit` y `npm.cmd test` → verde.
- [ ] **Step 7: Commit.** `feat(app): fuentes de símbolos con caché por conexión`

### Task 4: Resolución de nombres

**Files:**
- Create: `app/src/symbolResolve.ts`
- Test: `app/src/symbolResolve.test.ts`

**Interfaces:**
- Consumes: `programSymbols` (Task 1), `NamePath` (Task 2), `SymbolLookup` y `SourcePart` (Task 3), `statementAliases` de `programCompletion.ts`.
- Produces:

```ts
export type SymbolLocation =
  | { where: "here"; part: number; from: number; line: number }                  // parte del documento abierto (0 spec / 1 body)
  | { where: "object"; object: ObjectInfo; partKind: string; from: number; line: number }; // line: 1-based, para la ficha

export type Resolved =
  | { kind: "symbol"; symbol: ProgramSymbol; location: SymbolLocation }
  | { kind: "column"; table: string; column: ObjectColumn }
  | { kind: "relation"; object: ObjectInfo; columns: ObjectColumn[] }
  | { kind: "object"; object: ObjectInfo; note: "Fuente no disponible" };

export interface ResolveContext {
  parts: SourcePart[];      // partes del documento abierto (SQL: una sola)
  current: number;          // índice de la parte donde está el cursor
  position: number;         // posición dentro de esa parte
  self: ObjectInfo | null;  // objeto del documento abierto, si lo es
  lookup: SymbolLookup | null; // null sin conexión
}

export function resolveSymbol(ctx: ResolveContext, path: NamePath): Promise<Resolved[]>;
```

Orden: (1) local de la parte actual cuyo `scope` contiene `position` (el más interno gana); (2) global del paquete en cualquiera de `parts`; (3) objeto del catálogo con `lookup.object`. Con `index` > 0, resolver primero `parts[0..index-1]` y seguir: paquete → miembro; registro → campo según `dataType` (`T_REC` local o de paquete, `TABLA%ROWTYPE` → `lookup.columns`, `CURSOR%ROWTYPE` → columnas del SELECT del cursor, con tipo de la tabla si se puede; si no, `dataType: "Expresión"`); alias SQL (`statementAliases`) → columna. Sin `lookup` o con `lookup` que rechaza: solo pasos locales, nunca rechaza.

- [ ] **Step 1: Tests** (con `lookup` falso):
  - `"local tapa a global dentro de su bloque"`: global `v NUMBER`, local `v VARCHAR2(1)` en `p`; posición dentro de `p` → `dataType "VARCHAR2(1)"`; fuera → `"NUMBER"`.
  - `"llamada a rutina del mismo paquete devuelve spec y body"`: `calcular` declarado en spec y body → dos `symbol` con `location.part` 0 y 1.
  - `"miembro de otro paquete"`: `pkg_ventas.c_max` → `lookup.object(null,"PKG_VENTAS")` y `parts` → símbolo `C_MAX` con `location.where "object"`.
  - `"campo de %ROWTYPE de tabla"`: `v_cli clientes%ROWTYPE`, `v_cli.nombre` → `{ kind: "column", table: "CLIENTES", column: { name: "NOMBRE", data_type: "VARCHAR2(100)" } }`.
  - `"campo de registro propio"`: `v_r t_rec`, `v_r.id` → símbolo campo `ID` de `T_REC`.
  - `"columna de cursor en FOR"`: `FOR r IN c_cli LOOP r.n` donde `n` es alias de `nombre` → columna `NOMBRE` de `CLIENTES`.
  - `"alias en SELECT"`: SQL `SELECT c.nombre FROM clientes c`, cursor en `nombre` → `kind: "column"`.
  - `"tabla devuelve sus columnas"`: `clientes` en un SELECT → `kind: "relation"`.
  - `"mayúsculas y comillas"`: `PKG_Ventas.CALCULAR` y `"MiPaquete".calcular` resuelven a `PKG_VENTAS` y `MiPaquete`.
  - `"sin conexión o con error solo lo local"`: `lookup: null` y `lookup.object` que rechaza → `[]` para un nombre externo, sin rechazar.
  - `"fuente envuelta"`: `parts` → `[]` → `{ kind: "object", note: "Fuente no disponible" }`.
- [ ] **Step 2: Correr y ver fallar.** `npx.cmd vitest run src/symbolResolve.test.ts` → FAIL.
- [ ] **Step 3: Implementar `resolveSymbol`.** Cachear `programSymbols(text)` por texto (`WeakMap` no sirve con strings: `Map` de un solo elemento por parte).
- [ ] **Step 4: Correr** → PASS.
- [ ] **Step 5: Commit.** `feat(app): resolución de nombres con campos y columnas`

### Task 5: Ficha al pasar el mouse

**Files:**
- Create: `app/src/symbolHover.ts`, `app/src/components/SymbolCard.tsx`, `app/src/components/SymbolCard.css`
- Test: `app/src/components/SymbolCard.test.tsx`, `app/src/symbolHover.test.ts`
- Modify: `app/src/components/ProgramEditor.tsx` (prop nueva y extensión), `app/src/keymap.ts` (`showSymbolCard`)

**Interfaces:**
- Consumes: `editorPath` (Task 2), `resolveSymbol`, `Resolved`, `ResolveContext` (Task 4).
- Produces:

```ts
// symbolHover.ts
export type ContextFor = (view: EditorView, position: number) => ResolveContext | null;
export function symbolHover(contextFor: () => ContextFor | null): Extension; // hoverTooltip con hoverTime 400, hideOnChange true
export const showSymbolCard: Command;  // abre la ficha en la posición del cursor (atajo showSymbolCard)

// SymbolCard.tsx
export function SymbolCard({ items }: { items: Resolved[] }): JSX.Element;

// ProgramEditor Props
symbolContext?: ContextFor;
```

Contenido de la ficha, por ítem: firma en `--font-code`; línea de tipo y valor para variables y constantes (`NUMBER := 3`, o `NUMBER` + "Sin valor inicial"); ubicación en `--muted` (`PKG_VENTAS · Spec · línea 12`); comentario; para `relation` una tabla de columnas (nombre, tipo, nulos) recortada a 30 filas; para cursor la consulta recortada a 6 líneas. Sobrecargas: un ítem por firma. Sin resultados: no hay ficha.

- [ ] **Step 1: Tests de `SymbolCard`:**
  - `"constante muestra tipo y valor"`: ítem `constant` `C_MAX NUMBER := 3` → texto `NUMBER := 3` visible.
  - `"variable sin valor"` → texto `Sin valor inicial`.
  - `"ubicación con línea"`: ítem en `PACKAGE BODY` de `PKG_VENTAS`, `from` en la línea 12 → `PKG_VENTAS · Body · línea 12`. La línea viene en `location.line`.
  - `"relación lista columnas"`: 2 columnas → 2 filas con nombre y tipo.
  - `"objeto sin fuente"` → `Fuente no disponible`.
- [ ] **Step 2: Test de `symbolHover`:** `"la ficha no aparece sin símbolo"`: `contextFor` que devuelve `null` → la fuente de `hoverTooltip` resuelve `null`. Probar la función fuente exportada aparte (`symbolHoverSource`) sin depender del temporizador del DOM.
- [ ] **Step 3: Correr y ver fallar.** `npx.cmd vitest run src/components/SymbolCard.test.tsx src/symbolHover.test.ts` → FAIL.
- [ ] **Step 4: Implementar.** La extensión monta `SymbolCard` con `createRoot` dentro del `dom` del tooltip y lo desmonta en `destroy`. El tooltip usa la clase `.symbol-card` con tokens del tema. `showSymbolCard` va en `keymap.ts` (`Ctrl+Shift+Space`) y en el `keymap` del editor.
- [ ] **Step 5: Correr** → PASS. `npx.cmd tsc --noEmit`, `npm.cmd test` → verde.
- [ ] **Step 6: Commit.** `feat(app): ficha de símbolo al pasar el mouse`

### Task 6: Navegación compartida y Ctrl+clic

**Files:**
- Create: `app/src/editorNavigation.ts`
- Test: `app/src/editorNavigation.test.ts`, `app/src/components/ProgramWindow.test.tsx`
- Modify: `app/src/keymap.ts` (renombrar `goToDeclaration` y sumar dos), `app/src/components/ProgramEditor.tsx` (Ctrl+clic y marca), `app/src/components/ProgramWindow.tsx` (usar el módulo; quitar la búsqueda propia de `declaration()` ~270-297), `app/src/App.tsx` (`onOpenObject` acepta destino)

**Interfaces:**
- Consumes: `Resolved`, `SymbolLocation`, `resolveSymbol` (Task 4), `editorPath` (Task 2).
- Produces:

```ts
export type NavigationGoal = "definition" | "declaration" | "implementation";
export interface NavigationTarget { location: SymbolLocation; label: string }  // label para el selector: firma + ubicación
export interface NavigationChoice { targets: NavigationTarget[]; notice?: "Cuerpo no disponible" }

/** Elige destinos según el objetivo. definition: cuerpo si existe, si no la declaración. */
export function navigationTargets(items: Resolved[], goal: NavigationGoal): NavigationChoice;

// keymap.ts: goToDefinition "F12", goToDeclaration "Ctrl+F12", goToImplementation "Ctrl+Shift+F12"
// App.tsx
onOpenObject(object, mode, connection, at?: { partKind: string; from: number })
// ProgramWindow Props
initialTarget?: { partKind: string; from: number }   // se aplica una vez al cargar las partes
onNavigate?: (target: NavigationTarget) => void      // destinos en otro objeto
```

Para `relation`, cualquier objetivo abre "Describir" (`onOpenObject(object, "view")`, que ya abre el inspector). `implementation` sin cuerpo: destino = declaración y `notice: "Cuerpo no disponible"`, mostrado con el aviso informativo existente (`showNotice`). Un destino → navega; varios → el selector `declarationMenu` existente.

Ctrl+clic: en `ProgramEditor`, `mousedown` con Ctrl (sin Shift/Alt) sobre un nombre con `editorPath` → `goToDefinition` en esa posición, `preventDefault`. Con Ctrl apretado y el mouse sobre un nombre: decoración `cm-symbol-link` (subrayado, `cursor: pointer`) en `from..to` de esa parte; se quita al soltar Ctrl o mover fuera.

- [ ] **Step 1: Tests de `navigationTargets`:**
  - `"definición prefiere el cuerpo"`: spec + body → un destino en part 1.
  - `"declaración prefiere la spec"` → part 0.
  - `"implementación sin cuerpo avisa"`: solo spec → destino part 0 y `notice: "Cuerpo no disponible"`.
  - `"sobrecargas dan varios destinos"`: dos firmas con cuerpo → 2 destinos.
- [ ] **Step 2: Tests en `ProgramWindow.test.tsx`:**
  - `"F12 sobre una llamada va al cuerpo"`: paquete con spec y body, cursor en una llamada a `calcular` en el body → selección en `PROCEDURE calcular` del body.
  - `"Ctrl+F12 va a la spec"` → selección en la declaración de la spec.
  - `"Ctrl+clic en un nombre navega"`: `mouseDown` con `ctrlKey` sobre el nombre (posición vía `view.posAtCoords` mockeado o `coordsAtPos`; seguir cómo `ProgramEditor.test.tsx` simula clics).
  - `"destino en otro objeto pide abrirlo"`: lookup falso con `PKG_OTRO` → `onNavigate` llamado con `location.where "object"`.
- [ ] **Step 3: Correr y ver fallar.** `npx.cmd vitest run src/editorNavigation.test.ts src/components/ProgramWindow.test.tsx` → FAIL.
- [ ] **Step 4: Implementar.** `keymap.ts` primero (ajustar `keymap.test.ts` si fija `F12` en `goToDeclaration`). `App.tsx`: con `at`, tras cargar o activar la pestaña, pasar `initialTarget` a `ProgramWindow`, que ubica la parte por `kind` y llama `navigateAt`. Menú contextual sobre un nombre: sumar arriba de los ítems de `EditorObjectMenu` "Ir a la definición", "Ir a la declaración", "Ir a la implementación" (prop `navigation?: ContextItem[]` en `EditorObjectMenu`).
- [ ] **Step 5: Correr** → PASS. `npx.cmd tsc --noEmit`, `npm.cmd test` → verde.
- [ ] **Step 6: Commit.** `feat(app): ir a definición, declaración e implementación; Ctrl+clic`

### Task 7: Ventanas SQL y de prueba

**Files:**
- Modify: `app/src/components/SqlWindow.tsx`, `app/src/App.tsx` (props de `SqlWindow`)
- Test: `app/src/components/SqlWindow.test.tsx`

**Interfaces:**
- Consumes: `symbolContext` de `ProgramEditor` (Task 5), `navigationTargets` y el menú de navegación (Task 6), `SymbolSources.lookup` (Task 3), `EditorObjectMenu`.
- Produces: props nuevas de `SqlWindow`: `symbols?: SymbolLookup | null` (lookup de la conexión principal), `catalog?: ObjectCatalog` (como en `ProgramWindow`), `onNavigate?: (target: NavigationTarget) => void`.

En SQL: `ResolveContext.parts` = una parte `{ kind: "SQL", source: texto }`, `self: null`. Los bloques anónimos (`DECLARE … BEGIN … END;`) resuelven sus locales igual que una rutina (lo cubre `programSymbols` si trata `DECLARE` como apertura de alcance: agregar ese test a Task 1 si no pasa).

- [ ] **Step 1: Tests:**
  - `"ficha de tabla en una ventana SQL"`: `SELECT * FROM clientes`, hover forzado con `showSymbolCard` sobre `clientes` → columnas visibles.
  - `"F12 sobre una variable del bloque anónimo va a su declaración"`: `DECLARE v NUMBER := 1; BEGIN v := 2; END;`, cursor en el segundo `v` → selección en el primero.
  - `"clic derecho sobre un nombre ofrece navegación"`: menú con "Ir a la definición".
- [ ] **Step 2: Correr y ver fallar.** `npx.cmd vitest run src/components/SqlWindow.test.tsx` → FAIL.
- [ ] **Step 3: Implementar** con las props de arriba. Las ventanas de prueba usan `SqlWindow` (verificar en `App.tsx`; si no, aplicar lo mismo a su editor).
- [ ] **Step 4: Correr** → PASS. `npx.cmd tsc --noEmit`, `npm.cmd test` → verde.
- [ ] **Step 5: Commit.** `feat(app): ficha y navegación en ventanas SQL y de prueba`

### Task 8: Documentación y cierre

**Files:**
- Create: `docs/behavior/editor-inteligente.md`, `anti-slop/audit-editor-inteligente-2026-11-27.md`
- Modify: `docs/ESTADO.md`

- [ ] **Step 1:** `docs/behavior/editor-inteligente.md`: qué muestra la ficha por tipo de símbolo, atajos, orden de resolución, qué pasa sin conexión, sin cuerpo y con fuente envuelta. Palabras propias (regla clean-room).
- [ ] **Step 2:** `docs/ESTADO.md`: entrada en el resumen y en "Teclas que cambiaron" (`F12` pasa a "Ir a la definición"; `Ctrl+F12`, `Ctrl+Shift+F12`, `Ctrl+Shift+Space` nuevas).
- [ ] **Step 3:** Informe antislop PASS/FAIL (`antislop-ui`, `antislop-human`) de la ficha y del subrayado de Ctrl+clic: contraste medido de `.symbol-card` en los 5 temas (`contrast.ts`), foco, la ficha no tapa la línea que se escribe.
- [ ] **Step 4:** `cargo fmt --all --check`, `npx.cmd tsc --noEmit`, `npm.cmd test` → verde.
- [ ] **Step 5: Commit.** `docs: editor inteligente`
