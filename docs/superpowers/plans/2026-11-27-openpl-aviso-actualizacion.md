# Aviso de actualización en la barra superior. Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un ícono en la barra superior que aparece con un salto cuando hay versión nueva y abre el diálogo de actualización.

**Architecture:** `App.tsx` guarda la actualización encontrada en `pendingUpdate`, separada de `updateOffer` (diálogo abierto). Un componente `UpdateBadge` la muestra en `titlebar`. Sale en la rama `xwhiterr/menu-nuevo-se-cierra` (ya tiene el arreglo del menú Nuevo) como 1.0.0-beta.8.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library, Phosphor.

**Spec:** `docs/superpowers/specs/2026-11-27-openpl-editor-inteligente-design.md`, Parte 1.

## Global Constraints

- Textos cortos en español. Íconos Phosphor. Color con tokens del tema: el ícono usa `var(--accent)`, que ya tiene contraste ≥ 3 contra `--s0` medido en `themes.ts` (no hace falta token nuevo).
- Con `prefers-reduced-motion: reduce` no hay animación.
- TDD: test que falla primero (AGENTS.md regla 5).
- Sin chequeo periódico: solo al abrir y desde Ayuda > Buscar actualizaciones.

## Review Focus

- "Más tarde" debe cerrar el diálogo y dejar el ícono: hoy `onLater` hace `setUpdateOffer(null)` y no hay otro rastro.
- Buscar actualizaciones desde Ayuda sin versión nueva no debe borrar un ícono ya visible por un chequeo anterior que sí encontró una.
- Durante la instalación el ícono no abre un segundo diálogo.
- El ícono es un botón alcanzable con Tab y con nombre accesible que incluye la versión.
- La animación corre una sola vez al aparecer, no en cada render.

---

### Task 1: Ícono de actualización

**Files:**
- Create: `app/src/components/UpdateBadge.tsx`
- Modify: `app/src/App.tsx` (estado de actualización ~219, `checkUpdates` ~565, `titlebar` ~1127, `UpdateDialog` ~1544)
- Modify: `app/src/App.css` (clase `.update-badge` y `@keyframes update-bounce`)
- Test: `app/src/components/UpdateBadge.test.tsx`, `app/src/App.test.tsx`

**Interfaces:**
- Produces: `UpdateBadge({ version: string; onOpen: () => void })`: `<button class="btn icon update-badge" aria-label={`Actualización disponible: ${version}`} title=igual>` con `<ArrowCircleUp size={15} aria-hidden />`.

- [ ] **Step 1: Tests del componente** en `UpdateBadge.test.tsx`:
  - `"muestra la versión en su nombre y abre al hacer clic"`: `getByRole("button", { name: "Actualización disponible: 1.0.0-beta.8" })`; clic → `onOpen` llamado una vez.
- [ ] **Step 2: Tests de App** en `App.test.tsx` (con `updater.check.mockResolvedValue({ version: "9.9.9", notes: "", install: vi.fn() })`, el mock que ya existe en `App.test.tsx:78`):
  - `"una actualización encontrada deja el ícono tras Más tarde"`: al cargar aparece el diálogo `OpenPL 9.9.9`; clic en "Más tarde" → el diálogo se va y el botón `Actualización disponible: 9.9.9` sigue; clic en él → el diálogo vuelve.
  - `"sin actualización no hay ícono"`: `check` devuelve `null` → `queryByRole("button", { name: /Actualización disponible/ })` es `null`.
- [ ] **Step 3: Correr y ver fallar.** `npx.cmd vitest run src/components/UpdateBadge.test.tsx src/App.test.tsx`. Esperado: FAIL, módulo `UpdateBadge` inexistente y botón no encontrado.
- [ ] **Step 4: Implementar.** `UpdateBadge.tsx`. En `App.tsx`: `const [pendingUpdate, setPendingUpdate] = useState<AvailableUpdate | null>(null)`; en `checkUpdates`, si `available` → `setPendingUpdate(update)` y `setUpdateOffer(update)` (un resultado `upToDate`/`idle` no toca `pendingUpdate`). Render en `titlebar` después del botón Nuevo: `{pendingUpdate && <UpdateBadge version={pendingUpdate.version} onOpen={() => { if (updateProgress === undefined) setUpdateOffer(pendingUpdate); }} />}`. CSS: `.update-badge { color: var(--accent) }`, animación `update-bounce` de 600 ms, `animation-iteration-count: 3`, dentro de `@media (prefers-reduced-motion: no-preference)`.
- [ ] **Step 5: Correr.** El mismo comando de Step 3 → PASS. Después `npx.cmd tsc --noEmit` y `npm.cmd test` → todo en verde.
- [ ] **Step 6: Versión y documentación.** Subir a `1.0.0-beta.8` en los mismos archivos que tocó el commit `72203eb` (`git show --stat 72203eb`). En `docs/ESTADO.md` agregar una línea al resumen: ícono de actualización y arreglo del menú Nuevo.
- [ ] **Step 7: Antislop.** Informe PASS/FAIL corto de `antislop-ui` y `antislop-human` sobre el botón (foco visible, nombre accesible, contraste, movimiento reducido) en el mensaje de commit o en `anti-slop/`.
- [ ] **Step 8: Commit.**

```bash
git add app/src docs/ESTADO.md <archivos de versión>
git commit -m "feat(app): ícono de actualización en la barra superior"
```

La publicación (push, PR, tag `v1.0.0-beta.8`) la pide el usuario aparte.
