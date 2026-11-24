# Estado de OpenPL

Última actualización: 2026-11-24 (plan 3, incremento 1). Mantener este archivo al día al terminar cada bloque de trabajo.

## Resumen

- Rama de trabajo: `feat/plan-3-sql`, basada en `feat/plan-2-programa` (que sale de `feat/plan-1-base`). El repositorio todavía no tiene remoto.
- Plan 1 (base, conexión y explorador) **terminado**, con revisión final independiente y sus
  correcciones, más varias mejoras pedidas después (ver "Hecho después del plan 1").
- Plan 2 **en curso**. El primer incremento incorpora la ventana de programa, desde el explorador hasta el guardado local.
  [Plan 2](superpowers/plans/2026-11-23-openpl-02-ventana-programa.md)
- Verificación local en Windows: `cargo fmt`, Clippy, 81 pruebas de Rust sin base y 152 de interfaz,
  más el chequeo de TypeScript. Las siete pruebas Rust `live` se omitieron sin credenciales.
- El build de depuración de Tauri generó el ejecutable en Windows. Avisó que el identificador
  existente termina en `.app`, relevante para el empaquetado en macOS. Quedan pendientes la prueba
  manual del selector nativo, la validación visual y la lectura de fuentes desde la app con Oracle real.
- **No verificado todavía:** uso contra una base Oracle real (login, explorador, DDL, recompilar),
  las pruebas `live` (necesitan `OPENPL_TEST_*`) y el CI (nunca corrió: no hay remoto).

## Hecho

### Plan 2 — Primer incremento

- **Oracle:** `openpl-core/src/program.rs` lee `ALL_SOURCE` y `ALL_ERRORS` por esquema, nombre y tipo.
  `program_source` ejecuta la lectura en el hilo de la sesión. Se verificaron columnas y acceso de lectura
  al diccionario en desarrollo, sin ejecutar la app contra una base real.
- **Interfaz:** `App.tsx` conserva las ventanas por sesión y objeto. `ProgramWindow.tsx` conserva los
  borradores de Spec y Body y ofrece vista lateral, estructura básica y navegación a problemas.
  `ProgramEditor.tsx` contiene CodeMirror con dialecto PL/SQL.
- **Archivos:** los comandos Tauri abren el selector nativo. El guardado sustituye un archivo después de
  escribirlo completo. Cerrar una pestaña o la aplicación con cambios pide confirmación.
  [Comportamiento de la ventana](behavior/programa.md)
- Queda pendiente el autocompletado de catálogo.

### Plan 2 — Acciones de objeto desde el editor

- **Clic derecho** y **Alt+Enter** reconocen nombres simples o calificados, incluidos identificadores
  entre comillas. El menú ofrece **Describir** tablas y vistas, **Ver fuente** de PL/SQL y copiar
  nombre, nombre con esquema o DDL. La consulta usa la sesión original del programa.
- **Por dónde seguir:** `app/src/editorReference.ts` detecta el identificador, `EditorObjectMenu.tsx`
  presenta opciones y columnas, y `crates/openpl-core/src/catalog.rs` resuelve el objeto. Revisar
  primero el comportamiento documentado y las pruebas de `editorReference` y `ProgramWindow`.
  [Nota de comportamiento](behavior/programa.md)
- **Pendiente de validar con Oracle real:** resolución del nombre y de sinónimos locales y carga de
  columnas. Se verificaron las columnas del diccionario en desarrollo. DBX rechazó la consulta
  completa con `DATABASE_OUT_OF_SCOPE`.
- La prueba de interfaz usa un catálogo simulado y verifica que el clic derecho descrito muestra
  las columnas sin cambiar la sesión. El build de depuración de Windows incluye el menú.

### Plan 2 — Comparación con Oracle

- **Comparar con Oracle** (Alt+Shift+D) vuelve a consultar la fuente con la sesión original del
  programa. `ProgramComparison.tsx` muestra el borrador y el texto de Oracle con las diferencias
  marcadas. Cerrar el panel conserva el borrador y el historial de edición.
- `crates/openpl-core/src/program.rs` obtiene el texto y `LAST_DDL_TIME` en una consulta por parte.
  La comparación revisa ambos. Así detecta cambios de texto con la misma marca de tiempo y cambios
  de metadatos con texto idéntico. Una fuente ausente o inaccesible se informa por separado.
  [Referencia de ALL_OBJECTS en Oracle 12.1](https://docs.oracle.com/database/121/REFRN/GUID-AA6DEF8B-F04F-482A-8440-DBCB18F6C976.htm)
- El cruce entre fuente y marca de DDL se verificó con una consulta agregada de solo lectura en
  desarrollo. De 1.096 filas con la primera línea de fuente, 1.094 tenían la marca visible. Queda
  pendiente la prueba de la comparación completa desde la aplicación nativa.

### Plan 2 — Preparación de compilación

- **Preparar compilación** (F8) funciona en modo **Editar** sobre una fuente abierta desde Oracle.
  Valida el encabezado, consulta la versión con la sesión original y muestra una comparación. Si
  detecta cambios, ofrece **Guardar pese al cambio** como acción explícita. Si falta la fuente o
  su marca de DDL, el panel conserva el borrador y carece de opción de exportación.
- `app/src/programScript.ts` arma el archivo SQL local con el nombre calificado a partir del
  borrador. El script se revisa y ejecuta manualmente. Ejecutar F8 en la app solo hace lecturas.
  [Nota de comportamiento](behavior/programa.md)
- La ejecución de DDL y la actualización automática de diagnósticos tras compilar siguen fuera de
  este flujo.

### Plan 2 — Estructura de los programas

- **Estructura** enumera las variables y constantes globales, los tipos, los cursores y las
  rutinas de un paquete. Las firmas distinguen sobrecargas y determinan qué entradas del Body
  corresponden al Spec. Clic lleva al identificador y F12 ofrece las firmas candidatas.
- `app/src/programStructure.ts` analiza los tokens del primer programa del documento. El alcance
  es la navegación por el nivel de paquete y la cabecera de programas independientes. La prueba
  nativa de visualización del panel queda pendiente. [Comportamiento de la ventana](behavior/programa.md)

### Plan 2 — Plegado PL/SQL

- **Plegar bloque** (Alt+Shift+P) y **Desplegar bloque** (Alt+Shift+A) están en **Ver** y se pueden
  usar con el cursor en la línea de apertura. El margen también permite plegar. La apertura y el
  cierre quedan visibles. Ir a una declaración o problema abre el rango que lo oculta.
- `app/src/programStructure.ts` empareja los delimitadores a partir de los tokens que usa el editor.
  `app/src/programFolding.ts` guarda los rangos por documento. Las pruebas cubren paquetes,
  rutinas anidadas, `DECLARE`, `BEGIN`, `IF`, `LOOP`, `CASE` y directivas `$IF` y `$END`.
  Las cabeceras se detectan para el primer programa del documento. [Comportamiento de la ventana](behavior/programa.md)

### Plan 2 — Autocompletado

- **Completar** (Ctrl+Space o al escribir): palabras clave siempre; con conexión, objetos del
  esquema de trabajo y sinónimos públicos, objetos de `ESQUEMA.` y columnas tras `alias.`.
  Consultas en la sesión del programa con caché por sesión; una respuesta que llega después de
  cambiar de sesión se descarta. Detalle en el plan 2 y en [programa.md](behavior/programa.md).
- `crates/openpl-core/src/catalog.rs`: `complete_objects`, `object_columns`.
  `app/src/programCompletion.ts`: contexto del cursor, alias de la sentencia y fuentes de CodeMirror.
- Pendiente con Oracle real: tiempos con esquemas grandes y muchos sinónimos públicos.

### Barra superior

- **Nuevo** reemplaza al botón Programa: despliega Ventana SQL / de prueba / de comando
  (deshabilitadas hasta sus planes) y plantillas de programa en blanco, paquete, procedimiento,
  función, trigger, tipo y vista (`app/src/newWindows.ts`).
- El clic derecho fuera de campos de texto ya no abre el menú del navegador (WebView).

### Plan 3 — Ventana SQL, incremento 1

- [Plan 3](superpowers/plans/2026-11-24-openpl-03-ventana-sql.md) y [nota de comportamiento](behavior/sql.md).
- **Núcleo:** `crates/openpl-core/src/sql.rs` ejecuta una sentencia con binds tipados, entrega la primera
  página (200 filas) y guarda el cursor en el hilo de la sesión para `fetch`; lee `DBMS_OUTPUT` y el estado
  de la transacción tras cada ejecución. `SessionManager::open_sibling` da a cada ventana su sesión;
  `Session::interrupt` cancela con `break_execution` desde otro hilo. `DbError.offset` lleva la posición.
- **Interfaz:** `app/src/sqlScript.ts` separa el script (`;`, `/`, bloques PL/SQL, SQL*Plus omitido),
  `app/src/sqlBinds.ts` detecta `:x` y `&x`, `SqlWindow.tsx` ejecuta (F8, Shift F8), cancela (Shift Esc),
  muestra Resultados (grilla, más filas al bajar, Traer todas), Salida e Historial, y el panel Variables.
  Pestañas comunes con los programas; Ctrl N; Commit/Rollback de la ventana activa con indicador;
  diálogo al cerrar con transacción abierta; **Consultar datos** desde el explorador.
- **Sin verificar contra Oracle real:** la prueba `live` nueva (paginación, `DBMS_OUTPUT`, posición de
  error) espera credenciales `OPENPL_TEST_*`. Falta mirar la ventana en la app nativa.
- **Siguiente:** incremento 2, edición en grilla (candado Ctrl E, filas nuevas y borradas, Aplicar con
  `FOR UPDATE NOWAIT` y conflictos).

### Auditoría antislop 001

- Se instaló antislop (skills en `~/.claude/skills/antislop*`) y se auditó la interfaz:
  [anti-slop/audit-001-2026-11-24.md](../anti-slop/audit-001-2026-11-24.md). Los 14 hallazgos
  están corregidos (contraste medido, bordes de campos, foco, estados de carga/vacío/error en el
  explorador, "Próximamente" en lo pendiente, sin menú Ayuda vacío, estado inicial con acciones).
- [DESIGN.md](../DESIGN.md) es la dirección de diseño con sus motivos. Desde ahora toda interfaz
  nueva aplica antislop mientras se construye y cierra con su informe PASS/FAIL (`AGENTS.md`).

- **Punto de continuación:** cerrar el plan 2 con la validación manual contra Oracle (lectura de
  fuentes, menú de objeto, comparación, autocompletado) y pasar al plan 3 (ventana SQL).

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
9. Grilla de resultados propia, virtualizada con `@tanstack/react-virtual` (ya en el proyecto), en vez
   de AG Grid: sin dependencia nueva y con el estilo del tema. Se revisa en el incremento 2 si la
   edición lo exige.
10. Variables `:x` y `&x` en un panel al costado del editor (mockup v2), no en un diálogo previo.

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

### Plan 3 — Ventana SQL (en curso)
- Incremento 1 hecho. Sigue el incremento 2 (edición en grilla) del [plan](superpowers/plans/2026-11-24-openpl-03-ventana-sql.md).

### Plan 2 — Ventana de programa (implementado)
- Tareas de implementación terminadas. Falta la validación manual contra Oracle del [plan](superpowers/plans/2026-11-23-openpl-02-ventana-programa.md).
- Validar manualmente la apertura de un paquete con y sin Body, la navegación a diagnósticos y el
  selector nativo en Windows y Linux. Las pruebas de la aplicación contra Oracle serán de solo lectura.

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
| Plan 2 | `docs/superpowers/plans/2026-11-23-openpl-02-ventana-programa.md` |
| Plan 3 (en curso) | `docs/superpowers/plans/2026-11-24-openpl-03-ventana-sql.md` |
| Comportamiento observado | `docs/behavior/observaciones-referencia.md`, `conexion.md`, `explorador.md` |
| Instrucciones para agentes | `AGENTS.md` |
| Logo y guía | `design/logo/` |
| Mockup (privado del dueño) | referencia privada omitida |
