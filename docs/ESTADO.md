# Estado de OpenPL

Última actualización: 2026-11-23. Mantener este archivo al día al terminar cada bloque de trabajo.

## Resumen

- Rama de trabajo: `feat/plan-1-base` (sin merge a `main`; el repo no tiene remoto todavía).
- Plan 1 (base, conexión y explorador) **terminado**, con revisión final independiente y sus
  correcciones, más varias mejoras pedidas después (ver "Hecho después del plan 1").
- Tests: 66 de Rust (`cargo test --workspace`) y 60 de la interfaz (`npm test` en `app/`), en verde.
  `cargo clippy -D warnings` sin advertencias.
- **No verificado todavía:** uso contra una base Oracle real (login, explorador, DDL, recompilar),
  las pruebas `live` (necesitan `OPENPL_TEST_*`) y el CI (nunca corrió: no hay remoto).

## Hecho

### Plan 1 — [docs/superpowers/plans/2026-11-23-openpl-01-base-y-explorador.md](superpowers/plans/2026-11-23-openpl-01-base-y-explorador.md)

| Área | Qué hace |
|---|---|
| Cliente Oracle | Detecta Instant Client al arrancar; si falta o es de otra arquitectura muestra el error, la ayuda por SO y un campo para indicar la carpeta (se aplica al reiniciar). |
| Compatibilidad | Reglas cliente/servidor: servidor < 12.1 o IC 23 contra servidor < 19 no conectan; IC 19–21 soportado; el resto conecta con advertencia (ícono en la barra de conexión). |
| Errores | Códigos ORA/DPI clasificados (credenciales, clave expirada, servicio desconocido, conexión perdida, cliente) con mensajes cortos en español. |
| Perfiles | JSON en `<config>/openpl/connections.json` sin contraseñas; contraseña opcional en el keyring del SO. Entorno Desarrollo / Calidad / Producción con color. |
| Sesiones | Un hilo por conexión; detección de conexión perdida y botón Reconectar con el motivo si falla. |
| Explorador | Carga por tipo al expandir, filtro literal (`_` y `%` no son comodines), Míos/Todos, "inválido", contador, virtualización con listas largas, refresco sin mezclar respuestas viejas. |
| Interfaz | Barra de título con menús (Archivo, Editar, Buscar, Ver, Sesión, Herramientas, Ayuda), botón Nuevo (deshabilitado), conexión, estado de transacción, Commit/Rollback (deshabilitados). Atajos visibles y centralizados; F5/Ctrl R no recargan la ventana. |
| CI | `.github/workflows/ci.yml`: Linux con Oracle XE 18c + Instant Client 19.23, y Windows. |

### Hecho después del plan 1

- **Conexión:** "Base de datos" con dos modos: **Host / Puerto (1521) / Servicio** o **Alias TNS**.
  Se guarda como `host:puerto/servicio` o el alias; al abrir un perfil se elige el modo solo.
- **Explorador con 35 tipos** (como la herramienta de referencia): Paquetes, Procedimientos,
  Funciones, Triggers, Tipos, Fuentes y Clases Java, DBMS_Jobs, Colas, Tablas de cola, Librerías,
  Directorios, Tablas, Índices, Restricciones, Vistas, Vistas materializadas, Secuencias, Usuarios,
  Perfiles, Roles, Sinónimos, Database links, Tablespaces, Clusters, Grupos de ventanas, Ventanas,
  Calendarios, Programas, Cadenas, Jobs, Clases de job, Credenciales, Vigilantes de archivos,
  Papelera. Roles y Perfiles usan vistas `USER_*` si no hay acceso a `DBA_*`. Objetos de SYS
  globales (directorios, ventanas, clases de job) no se filtran por "Míos".
- **Menú contextual por tipo** (ver [docs/behavior/explorador.md](behavior/explorador.md)):
  habilitados Copiar DDL (`DBMS_METADATA`), Recompilar (pide confirmación en producción), Copiar
  nombre / con esquema / separados por coma, Refrescar, Expandir/Contraer. El resto (Ver, Editar,
  Probar, Consultar/Editar/Exportar datos, Describir, Propiedades, Comparar, Renombrar, Eliminar,
  Nuevo) visible y deshabilitado hasta que existan sus ventanas.
- **Logo** (base de datos con la tapa abierta), íconos de la app para Windows/macOS/Linux, favicon
  y logo en la barra de título: [design/logo/README.md](../design/logo/README.md).
- Datos de entorno reales eliminados del código, tests, docs, historial de git y mockup.

## Decisiones vigentes que actualizan el diseño

El [diseño](superpowers/specs/2026-11-23-openpl-design.md) sigue siendo la referencia del
producto; estas decisiones son posteriores y mandan sobre él:

1. Tema **grafito** único en v1 (tokens en `app/src/theme.css`), íconos **Phosphor**, **IBM Plex**
   empaquetada, componentes **estilo Zed**. Textos de interfaz cortos, sin explicaciones.
2. **Sin cinta de opciones:** barra de menús en la barra de título + paleta Ctrl K + menús
   contextuales + barra propia de cada ventana con 3–4 acciones.
3. **Atajos** (diseño §7.7) registrados solo en `app/src/keymap.ts`, visibles en menús, botones y
   tooltips. Coinciden con PL/SQL Developer donde conviene: F8 ejecutar/compilar, F10/Shift F10
   commit/rollback, F5 plan.
4. Perfil de conexión: campo `environment` (`dev`/`qa`/`prod`) en lugar de un color libre.
5. Explorador con los 35 tipos de arriba (el diseño listaba 9). Paquete y cuerpo se muestran
   juntos (spec + body) en un solo nodo.
6. CI contra **Oracle XE 18c** (no hay 12c ni 19c gratuitas en contenedor); la compatibilidad con
   12.1 se valida a mano.
7. Ventana de prueba: estructura como la de referencia (bloque `declare` para no escalares,
   llamada con parámetros nombrados, grilla de variables con usar/variable/tipo/valor). Ver mockup.
8. La edición en grilla **no** muestra un panel con el SQL que se aplicará; solo los indicadores
   de celda modificada / fila nueva / fila borrada.

## Pendiente inmediato

1. **Probar contra una base real** (lo hace el dueño del proyecto o con `OPENPL_TEST_*`):
   login con host/puerto/servicio y con alias, perfiles y contraseña guardada, explorador con los
   35 tipos, Copiar DDL, Recompilar, reconexión.
2. **Primer CI:** crear el remoto, subir la rama y corregir lo que falle (el YAML no se validó).
3. Decidir el merge de `feat/plan-1-base` a `main`.
4. Problemas menores conocidos (no bloquean):
   - Un pánico dentro de un trabajo de sesión deja esa sesión inutilizable, y en release
     (`panic = "abort"`) cierra la app (`crates/openpl-core/src/session.rs`).
   - Una reconexión simultánea con una consulta que falla puede volver a marcar como
     desconectada una sesión sana.
   - La clave de fila del explorador puede repetirse con nombres entre comillas que contienen `-`.
   - Los comandos del keyring corren en el hilo principal: en Linux, un desbloqueo del keyring
     podría congelar la ventana.
   - `stored_password` devuelve la contraseña a la interfaz (necesario para el login; la CSP solo
     permite contenido propio).

## Próximos pasos (planes)

Cada plan se escribe antes de implementar, con el formato del plan 1, en `docs/superpowers/plans/`.

### Plan 2 — Ventana de programa (diseño §7.4, mockup "1 · Ventana de programa")
- Abrir desde el explorador (doble clic / Enter / Ver / Editar / Editar Spec y Body) y desde `Nuevo ▸ Programa`.
- Editor CodeMirror 6 con modo PL/SQL, Spec y Body en pestañas rotuladas, lado a lado (Ctrl \), Alt S / Alt B.
- Leer fuente (`ALL_SOURCE` o `DBMS_METADATA`), compilar (F8) con errores de `ALL_ERRORS` en línea y en el panel Problemas.
- Panel Estructura (público/privado), ir a la declaración (F12), control de `LAST_DDL_TIME` antes de compilar.
- Pestañas de ventanas abiertas con franja de entorno; guardar/abrir archivos `.pks/.pkb/.sql`.

### Plan 3 — Ventana SQL y edición en grilla (diseño §7.5, mockup "2 · Ventana SQL")
- Sesión propia por ventana, ejecutar sentencia/selección/script, cancelar, variables `:x` y `&x`, `DBMS_OUTPUT`.
- Grilla (AG Grid Community) con carga incremental; edición por `ROWID` con candado (Ctrl E), aplicar (Ctrl Shift Enter), conflictos con `FOR UPDATE NOWAIT`, Commit/Rollback.
- Habilitar en el explorador: Consultar datos / Editar datos / Exportar datos.

### Plan 4 — Ventana de prueba (diseño §7.6, mockup "3 · Ventana de prueba")
- Generar el bloque desde `ALL_ARGUMENTS` (sobrecargas, no escalares en `declare`), grilla de variables, ejecutar (F8), `DBMS_OUTPUT`, guardar `.tst`. Habilitar "Probar".

### Plan 5 — Empaquetado
- Instaladores (MSI/NSIS, AppImage/.deb), firma, versión, notas de publicación.

### Después
- Plan de ejecución (F5), Command Window, depurador, beautifier, comparar, exportar, macOS.
- Opciones del menú contextual aún deshabilitadas (Describir, Propiedades, Renombrar, Eliminar,
  Nuevo, Comparar) a medida que existan sus ventanas.

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Diseño del producto | `docs/superpowers/specs/2026-11-23-openpl-design.md` |
| Plan 1 (terminado) | `docs/superpowers/plans/2026-11-23-openpl-01-base-y-explorador.md` |
| Comportamiento observado | `docs/behavior/observaciones-referencia.md`, `conexion.md`, `explorador.md` |
| Instrucciones para agentes | `AGENTS.md` |
| Logo y guía | `design/logo/` |
| Mockup (privado del dueño) | referencia privada omitida |
