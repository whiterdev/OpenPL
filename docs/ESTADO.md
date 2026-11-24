# Estado de OpenPL

Última actualización: 2026-11-24 (plan 4 planificado). Mantener este archivo al día al terminar cada bloque de trabajo.

## Resumen

- Rama de trabajo: `feat/plan-4-ventana-prueba`, creada desde `feat/plan-3-sql` (que sale de
  `feat/plan-2-programa` y esta de `feat/plan-1-base`). Hay un remoto `origin` configurado, pero
  ninguna rama local tiene upstream y no existe `main` local.
- Plan 1 (base, conexión y explorador) **terminado**, con revisión final independiente y sus
  correcciones, más varias mejoras pedidas después (ver "Hecho después del plan 1").
- Plan 2 (ventana de programa) **implementado, pendiente de validar contra Oracle**.
  [Plan 2](superpowers/plans/2026-11-23-openpl-02-ventana-programa.md)
- Plan 3 (ventana SQL) **implementado** en los incrementos 1 y 2. Sigue en curso solo por la
  validación contra Oracle: la lectura espera la corrida con credenciales; las escrituras las prueba el usuario.
- Plan 4 (ventana de prueba) **planificado**: plan y nota de comportamiento escritos. El código espera
  las respuestas del dueño a las decisiones abiertas y al mockup "3 · Ventana de prueba".
- Verificación local en Windows (2026-11-24): `cargo fmt --check` y Clippy con `-D warnings` sin
  avisos; 86 pruebas de Rust pasan, de las cuales 8 son `live` y, sin `OPENPL_TEST_*`, terminan sin
  conectarse (imprimen `SKIP`); 170 pruebas de interfaz en 18 archivos; `tsc --noEmit` sin errores.
- El build de depuración de Tauri generó el ejecutable en Windows. Avisó que el identificador
  existente termina en `.app`, relevante para el empaquetado en macOS. Quedan pendientes la prueba
  manual del selector nativo, la validación visual y la lectura de fuentes desde la app con Oracle real.
- **No verificado todavía:** uso contra una base Oracle real (login, explorador, DDL, recompilar),
  las pruebas `live` (necesitan `OPENPL_TEST_*`) y el CI (no hay constancia local de que haya corrido:
  ninguna rama tiene upstream).

## Siguiente paso

1. Pruebas de lectura contra DEV, solo `SELECT`: en `crates/openpl-oracle/tests/live.rs`,
   `conecta_y_lee_version` y `servicio_inexistente_da_unknown_service`; en
   `crates/openpl-core/tests/live_catalog.rs`, `lista_tablas_propias_sin_error`,
   `todos_los_tipos_consultan_sin_error`, `completa_objetos_y_columnas_sin_error` y
   `edicion_en_grilla_solo_resuelve_tablas`. Resultado: pendiente de la corrida que se haga con la
   contraseña aportada por el usuario.
2. Excluidas de las corridas de agentes: `clave_erronea_da_invalid_credentials` (login fallido en cada
   corrida, puede bloquear la cuenta de prueba) y `ventana_sql_pagina_salida_y_errores` (ejecuta
   bloques PL/SQL de `DBMS_OUTPUT`). Las decide el usuario.
3. Escrituras y compilaciones (grilla del plan 3, Recompilar, DDL): las prueba el usuario.
4. Decisión pendiente del usuario: la ventana SQL de la app ejecuta bloques PL/SQL de `DBMS_OUTPUT`
   (`ENABLE` y `GET_LINE`) en cada consulta, aun en un `SELECT`. ¿Se acepta contra DEV o se cambia?
5. Mockup "3 · Ventana de prueba" y respuestas a las decisiones abiertas del plan 4.

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

### Plan 3 — Ventana SQL, incremento 2 (edición en grilla)

- **Editar** (Ctrl E) reejecuta la consulta con el ROWID oculto (`app/src/sqlEdit.ts`); solo consultas
  sobre una tabla. Celdas editables con teclado, filas nuevas y borradas, Descartar, **Aplicar cambios**
  (Ctrl Shift Enter). Explorador: **Editar datos** en tablas.
- `crates/openpl-core/src/grid.rs` aplica todo o nada: savepoint, `SELECT ... FOR UPDATE NOWAIT` y
  comparación de cada fila tocada; con un conflicto (bloqueada, cambiada o inexistente) vuelve al
  savepoint y la interfaz ofrece reintentar con los valores actuales o descartar esos cambios.
- **Sin verificar contra Oracle real** (nada de esto se probó escribiendo en una base; las pruebas
  `live` son de solo lectura). Validar en desarrollo: tipos DATE y TIMESTAMP al comparar y al guardar,
  números con decimales, CLOB, `RETURNING ROWID` en inserciones y el aviso de producción.
- **Siguiente:** ver "Siguiente paso" más abajo.

### Auditoría antislop 001

- Se instaló antislop (skills en `~/.claude/skills/antislop*`) y se auditó la interfaz:
  [anti-slop/audit-001-2026-11-24.md](../anti-slop/audit-001-2026-11-24.md). Los 14 hallazgos
  están corregidos (contraste medido, bordes de campos, foco, estados de carga/vacío/error en el
  explorador, "Próximamente" en lo pendiente, sin menú Ayuda vacío, estado inicial con acciones).
- [DESIGN.md](../DESIGN.md) es la dirección de diseño con sus motivos. Desde ahora toda interfaz
  nueva aplica antislop mientras se construye y cierra con su informe PASS/FAIL (`AGENTS.md`).

### Plan 4 — Ventana de prueba (planificado)

- [Plan 4](superpowers/plans/2026-11-24-openpl-04-ventana-prueba.md) y
  [nota de comportamiento](behavior/prueba.md) escritos. Sin código todavía.

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

1. **Validar contra DEV** (ver "Siguiente paso"), en dos partes:
   - Lectura (agentes, solo `SELECT`): fechas, timestamp, decimales, CLOB, paginación y posición del
     error.
   - Del usuario: edición en grilla, `RETURNING ROWID`, `DBMS_OUTPUT` y revisión manual de la ventana.
     También las pruebas manuales de los planes 1 y 2 (login con host/puerto/servicio y con alias,
     perfiles y contraseña guardada, explorador con los 35 tipos, Copiar DDL, Recompilar,
     reconexión, lectura de fuentes, menú de objeto, comparación, preparación de compilación,
     autocompletado y selector nativo de archivos).
2. **Plan 4:** respuestas del dueño a las decisiones abiertas y al mockup antes de escribir código.
3. **Primer CI:** el remoto `origin` ya está configurado; falta subir las ramas y corregir lo que
   falle (el YAML no se validó).
4. Decidir cómo y cuándo integrar las ramas `feat/plan-*` a `main`.
5. Problemas menores conocidos (no bloquean):
   - Un pánico dentro de un trabajo de sesión deja esa sesión inutilizable, y en release
     (`panic = "abort"`) cierra la app (`crates/openpl-core/src/session.rs`).
   - Una reconexión simultánea con una consulta que falla puede volver a marcar como
     desconectada una sesión sana.
   - La clave de fila del explorador puede repetirse con nombres entre comillas que contienen `-`.
   - Los comandos del keyring corren en el hilo principal: en Linux, un desbloqueo del keyring
     podría congelar la ventana.
   - `stored_password` devuelve la contraseña a la interfaz (necesario para el login; la CSP solo
     permite contenido propio).
   - La línea 1 de `crates/openpl-core/tests/live_catalog.rs` dice "solo lectura", pero
     `ventana_sql_pagina_salida_y_errores` ejecuta bloques PL/SQL de `DBMS_OUTPUT`. Corregir el
     comentario o la prueba.

## Próximos pasos (planes)

Cada plan se escribe antes de implementar, con el formato del plan 1, en `docs/superpowers/plans/`.

### Plan 2 — Ventana de programa (implementado, pendiente de validar contra Oracle)
- Tareas de implementación terminadas. Falta la validación manual contra Oracle del [plan](superpowers/plans/2026-11-23-openpl-02-ventana-programa.md).
- Validar manualmente la apertura de un paquete con y sin Body, la navegación a diagnósticos y el
  selector nativo en Windows y Linux. Las pruebas de la aplicación contra Oracle serán de solo lectura.

### Plan 3 — Ventana SQL (en curso: solo validación contra Oracle)
- Incrementos 1 y 2 hechos ([plan](superpowers/plans/2026-11-24-openpl-03-ventana-sql.md)). Falta la
  validación contra Oracle real: la lectura espera la corrida con credenciales; las escrituras las
  prueba el usuario.

### Plan 4 — Ventana de prueba (planificado, código en espera)
- [Plan](superpowers/plans/2026-11-24-openpl-04-ventana-prueba.md) y [nota](behavior/prueba.md) escritos
  (diseño §7.6, mockup "3 · Ventana de prueba"). El código espera las respuestas del dueño.
- Alcance: generar el bloque desde `ALL_ARGUMENTS` (sobrecargas, no escalares en `declare`), grilla de variables, ejecutar (F8), `DBMS_OUTPUT`, guardar `.tst`. Habilitar "Probar".

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
| Plan 2 (implementado, sin validar) | `docs/superpowers/plans/2026-11-23-openpl-02-ventana-programa.md` |
| Plan 3 (en curso: validación) | `docs/superpowers/plans/2026-11-24-openpl-03-ventana-sql.md` |
| Plan 4 (planificado) | `docs/superpowers/plans/2026-11-24-openpl-04-ventana-prueba.md` |
| Comportamiento observado | `docs/behavior/observaciones-referencia.md`, `conexion.md`, `explorador.md`, `programa.md`, `sql.md`, `prueba.md` |
| Instrucciones para agentes | `AGENTS.md` |
| Logo y guía | `design/logo/` |
| Mockup (privado del dueño) | referencia privada omitida |
