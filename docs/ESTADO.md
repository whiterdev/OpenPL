# Estado de OpenPL

Última actualización: 2026-11-27 (beta 8: ícono de actualización y menú Nuevo; diseño del editor inteligente).

## Resumen

- Editor inteligente (WAL-119, rama `xwhiterr/wal-119-editor-inteligente-ficha-al-pasar-el-mouse`): ficha al pasar el puntero con firma, tipo, valor declarado, comentario, campos de registros y columnas; Ir a la definición (F12, Ctrl+clic), a la declaración (Ctrl+F12) y a la implementación (Ctrl+Shift+F12) en paquetes, ventanas SQL y de prueba. [Comportamiento](behavior/editor-inteligente.md), [diseño](superpowers/specs/2026-11-27-openpl-editor-inteligente-design.md), [plan](superpowers/plans/2026-11-27-openpl-editor-inteligente.md) y [auditoría](../anti-slop/audit-editor-inteligente-2026-11-27.md). Pendientes de la revisión resueltos en WAL-121: análisis sin reparsear (14.000 líneas: unos 25 ms con el árbol del editor), F12 que no salta tarde, Alt+clic para agregar cursor, fuente envuelta, registro tardío, prioridad de alias, `pkg.cursor%ROWTYPE` y tipos objeto. Pendiente la prueba en escritorio contra Oracle.

- 1.0.0-beta.8 (WAL-118, WAL-120): con una versión nueva, la barra superior muestra un ícono que da un salto corto y abre el diálogo de actualización. "Más tarde" deja el ícono. Nuevo y los menús de la barra ya no quedan abiertos a la vez.

- Auditoría UX: los briefs 1 a 59 del [plan de 61 briefs](superpowers/plans/2026-11-25-openpl-auditoria-ux.md)
  están implementados en `feat/auditoria-ux`, un commit por brief. El brief 60 deja esta
  documentación y la [auditoría antislop](../anti-slop/audit-auditoria-ux-2026-11-24.md).
  Falta el brief 61 (cierre). Detalle en "Auditoría UX (rama `feat/auditoria-ux`)".

- Ctrl+C conserva la copia nativa del texto de paquetes. La grilla permite elegir un total por columna y lo muestra alineado en su pie. Los cálculos usan las filas cargadas.

- El prompt recupera el foco al entrar a la consola. `EDIT` sobre una tabla abre una pestaña de datos con edición habilitada.

- `EDIT` completa solo en el esquema indicado o en el usuario conectado. Las pruebas de rutinas generan binds de salida tipados y usan comillas únicamente para los identificadores que las necesitan.

- La ventana de comandos presenta una terminal con entrada al final de la transcripción y continuación numerada. [Comandos](behavior/comandos.md).

- La auditoría con `emil-design-eng` unificó el feedback de pulsación y corrigió navegación, foco y ancho del menú principal. [Auditoría](../anti-slop/audit-emil-design-eng-2026-11-24.md).

- La consola admite entrada multilínea y resultados alineados. Los menús ajustan su ancho al contenido y el cliente Oracle 12c desde 12.1 figura como compatible.

- La consola ofrece `EDIT [esquema.]objeto` con sugerencias del catálogo y apertura en pestaña. [Comandos](behavior/comandos.md).
- Compilar Spec o Body actualiza la marca de guardado de esa parte. El asterisco permanece si otra parte tiene cambios pendientes.

- Plan 5 implementado para la 1.0.0: consola, paleta, plan estimado, CSV, inspector y borradores SQL desde el explorador. [Plan 5](superpowers/plans/2026-11-24-openpl-05-acciones-v1.md), [consola](behavior/comandos.md), [explorador](behavior/acciones-explorador.md) y [auditoría](../anti-slop/audit-acciones-v1-2026-11-24.md).
- El plan requiere acceso a `PLAN_TABLE` y los privilegios requieren las vistas administrativas del diccionario. Se verificaron sus columnas con DBX en solo lectura. Pendiente la validación manual de escritorio contra Oracle.

- Rama de cierre: `feat/cierre-v1`, creada desde `main`. [Calificación de la candidata](RELEASE-v1.md).
- Plan 1 (base, conexión y explorador) **terminado**, con revisión final independiente y sus
  correcciones, más varias mejoras pedidas después (ver "Hecho después del plan 1").
- Plan 2 (ventana de programa) **implementado, pendiente de validar contra Oracle**.
  [Plan 2](superpowers/plans/2026-11-23-openpl-02-ventana-programa.md)
- Plan 3 (ventana SQL) **implementado** en los incrementos 1 y 2. Sigue en curso solo por la
  validación contra Oracle: lectura corrida, con 2 de 4 OK en `live_catalog` y 2 fallos ORA-12704;
  corrección de los binds de texto, pendiente de verificación. Las escrituras las prueba el usuario.
- Plan 4 (ventana de prueba) **implementado; pendiente de calificación en escritorio y Oracle**.
  [Plan de cierre](superpowers/plans/2026-11-24-openpl-04-cierre-v1.md)
- Verificación local en Windows tras la tanda B1 a B13 (2026-11-24): `cargo fmt --check`, Clippy
  con `-D warnings` y `tsc --noEmit` pasan. `cargo test --workspace`: 93 pruebas en verde, sin
  variables `OPENPL_TEST_*` (las `live` terminan sin conectarse). `npm.cmd test`: 25 archivos y
  339 pruebas, en verde en 3 corridas seguidas. Ver "Tanda B1 a B13" para lo que falta probar.
- Pruebas `live` de lectura contra la base de desarrollo (2026-11-24, corrida del usuario, solo `SELECT`): 4 de 6 OK.
  Fallan con ORA-12704 `completa_objetos_y_columnas_sin_error` (`live_catalog.rs:47`, offset 500) y
  `edicion_en_grilla_solo_resuelve_tablas` (`live_catalog.rs:89`, offset 99). Corrección de los binds de texto
  pendiente de re-corrida contra la base de desarrollo.
- El build de depuración de Tauri generó el ejecutable en Windows. Avisó que el identificador
  existente termina en `.app`, relevante para el empaquetado en macOS. Quedan pendientes la prueba
  manual del selector nativo, la validación visual y la lectura de fuentes desde la app con Oracle real.
- **No verificado todavía:** uso contra una base Oracle real (login, explorador, DDL, recompilar),
  el resto de la validación contra base real (la corrida de lectura con `OPENPL_TEST_*` ya se hizo:
  `live.rs` 2 de 2, `live_catalog.rs` 2 de 4 antes de la corrección). El CI de `main` quedó verde en `8e630b8`.

## Auditoría UX (rama `feat/auditoria-ux`)

Plan: [2026-11-25-openpl-auditoria-ux.md](superpowers/plans/2026-11-25-openpl-auditoria-ux.md).
Rama creada desde `main`, sin merge ni push. Auditoría:
[audit-auditoria-ux-2026-11-24.md](../anti-slop/audit-auditoria-ux-2026-11-24.md).

### Qué se hizo, por área

- **Teclado (briefs 1, 5, 50).** `handleShortcut` solo bloquea una tecla si una acción la
  atendió o si pertenece al webview (recarga, imprimir, ver fuente, herramientas de
  desarrollo, zoom, atrás y adelante). `isWebviewKey` es el único punto de bloqueo. Una acción
  puede devolver `false` para dejar pasar la tecla. Los comandos aceptan teclas alternativas
  (`alt`) que funcionan pero no se muestran en menús. Con AltGr activo ningún atajo coincide.
  Ctrl + rueda y los botones laterales del mouse no llegan al webview. En la consola no
  actúan F8, F5, Ctrl+S, Ctrl+E ni Ctrl+Shift+X.
- **Editor (briefs 3, 4, 6, 7, 8).** Teclas estándar de CodeMirror sin pisar Tab ni
  `keymap.ts`. Enter conserva la sangría. El completado no preselecciona. Menú contextual
  con Cortar, Copiar, Pegar, Seleccionar todo, Deshacer y Rehacer, también con Shift+F10 y la
  tecla Menú. Foco al activar la pestaña y al cerrar la descripción. Una recarga desde Oracle
  sin cambios locales reemplaza el texto y se puede deshacer. Tipear en un paquete grande ya
  no recorre el documento por tecla: estructura, plegado y estado sucio se recalculan tras
  una pausa de 150 ms o se comparan con `doc.eq`. F3 y Shift+F3 buscan siguiente y anterior.
- **Conexión y sesiones (briefs 9 a 13).** ORA-12170, ORA-28000 y ORA-28001 tienen mensaje
  propio. La conexión se corta a los 20 s y una conexión tardía se cierra. Las sesiones SQL
  hermanas se registran por conexión, se cierran con ella y se comprueban con ping al volver
  a la ventana (una vez cada 10 s como máximo). Desconectar con transacciones abiertas pide
  confirmación. Reconectar la principal reconecta las hermanas, y cada pestaña SQL caída
  ofrece su propio Reconectar. El diálogo de conexión muestra el progreso, permite cancelar y
  solo borra la contraseña ante un error de credenciales.
- **Explorador (brief 14).** Un solo punto de tabulación y navegación con flechas, Inicio y
  Fin. Los ítems deshabilitados dicen por qué.
- **Scripts y SQL*Plus (briefs 15 a 20, 24 a 27, 44, 45).** Los bloques PL/SQL sin `/` ya no
  absorben la sentencia siguiente. `EXEC` se traduce a bloque. La ventana SQL y la consola
  ejecutan SET, SHOW, DEFINE, UNDEFINE, VARIABLE, PRINT, SPOOL, `@`, `@@`, START y DESC; el
  resto dice "Comando no admitido". SHOW y DESC solo hacen SELECT con binds. Los errores
  ubican línea y columna sin inventar una posición. Las variables `&x` y `:x` se buscan en
  todo el script e ignoran los literales `q'...'`.
- **Ejecución SQL (briefs 21 a 23, 42, 43, 46, 47).** Un bloque que falla conserva su
  DBMS_OUTPUT y el estado de transacción. Fechas y TIMESTAMP en formato ISO fijo en grilla,
  binds y comparación de ediciones. Texto LOB acotado a 1.000.000 caracteres por celda.
  Salida por lotes, con tope de líneas. Commit y Rollback deshabilitados mientras hay una
  operación SQL. Las escrituras en perfiles de producción piden confirmación, una vez por
  script. Ejecutar o cerrar con ediciones de grilla pendientes pregunta antes de descartarlas.
- **Grilla (briefs 28 a 34, 48, 49).** La celda activa siempre visible, con RePág y AvPág.
  Selección de rangos con Shift, Ctrl, arrastre y encabezados. Orden y filtro sobre las filas
  cargadas. Totales parciales marcados. Tooltip en valores recortados. Visor de celda
  (Shift+Space). Copia TSV, CSV, con encabezados y como INSERT. CSV con BOM. Pegado TSV en
  edición. Escape cancela la edición de celda.
- **Consola (briefs 35 a 41, 51).** Componente propio (`CommandConsole.tsx`). El prompt forma
  parte de la transcripción. Continuación numerada, Shift+Enter, historial sin duplicados
  consecutivos, escritura por adelantado con cola, pegado multilínea, preguntas de
  sustitución, Ctrl+C para copiar o cancelar y Ctrl+L para limpiar. SELECT en texto tabular
  hasta 500 filas.
- **Pestañas, archivos y espacio de trabajo (briefs 53 a 57).** Soltar `.sql`, `.pks`, `.pkb`
  o `.tst` los abre. Ctrl+Tab recorre pestañas, y Ctrl+Shift+RePág, Ctrl+Shift+AvPág o el
  arrastre las reordenan. Las pestañas se guardan por perfil (`workspace.rs`) y se ofrecen al
  reconectar, sin ejecutar SQL.
- **Avisos, diálogos y menús (briefs 2, 52, 58, 59).** Portapapeles por plugin de Tauri y
  ventana que recuerda tamaño y posición. Los errores quedan visibles hasta cerrarlos y un
  aviso informativo no los tapa. Trampa de foco en los diálogos de conexión y temas, con
  retorno del foco al origen. Alt abre la barra de menús, ← y → cambian de menú, y los ítems
  deshabilitados muestran el motivo.

### Teclas que cambiaron

| Comando | Antes | Ahora |
|---|---|---|
| Reemplazar | Ctrl+H | Ctrl+R (Ctrl+H sigue como alternativa) |
| Refrescar explorador | Ctrl+R | Ctrl+Shift+R |
| Rehacer | Ctrl+Shift+Z | Ctrl+Shift+Z o Ctrl+Y |
| Ir a la definición (WAL-119) | (F12 iba a la declaración) | F12 y Ctrl+clic |
| Ir a la declaración (WAL-119) | F12 | Ctrl+F12 |
| Ir a la implementación (WAL-119) | (no existía) | Ctrl+Shift+F12 |
| Mostrar ficha (WAL-119) | (no existía) | Ctrl+Shift+Espacio |
| Agregar un cursor (WAL-121) | Ctrl+clic | Alt+clic |
| Ejecutar | F8 | F8 o Ctrl+Enter |
| Buscar siguiente / anterior | sin atajo | F3 / Shift+F3 |
| Pestaña siguiente / anterior | sin atajo | Ctrl+Tab / Ctrl+Shift+Tab |
| Mover pestaña a la izquierda / derecha | sin atajo | Ctrl+Shift+RePág / Ctrl+Shift+AvPág |
| Limpiar consola | sin atajo | Ctrl+L |
| Ver celda | sin atajo | Shift+Space |
| Barra de menús | solo mouse | Alt solo, luego flechas |

Ctrl+R, F5 y los demás atajos del webview siguen sin recargar la ventana donde no tienen acción.
En el editor, Ctrl+Shift+End selecciona hasta el final; en la grilla sigue siendo Traer todas.
En la consola, Ctrl+C copia la selección o, sin selección y con una ejecución en curso, la cancela.

### Decisiones

1. El bloqueo de teclas del webview vive solo en `isWebviewKey`. Cualquier otra tecla sin
   acción pasa al control que tiene el foco.
2. El timeout de conexión se aplica del lado de la app, porque el driver no tiene uno propio.
   No se usa Easy Connect Plus, que un cliente 12.1 no soporta.
3. Fechas en formato ISO fijo, sin depender del NLS de la sesión: así coinciden lo que se ve,
   lo que se enlaza y lo que compara la edición optimista.
4. `@archivo` y SPOOL leen y escriben por ruta con lista de extensiones (`lst`, `log`, `txt`,
   `csv`, `sql`), tope de 2 MiB, rutas relativas a Documentos y escritura atómica.
5. El espacio de trabajo guarda objetos (tipo, esquema y nombre) y el texto de ventanas SQL y
   de prueba. No guarda consolas, historial ni claves. Restaurar es explícito.
6. El arrastre de archivos usa eventos HTML5 (`dragDropEnabled: false`), porque el evento
   nativo de Tauri tapaba el arrastre de texto en el editor.
7. Orden, filtro, totales y copia trabajan sobre las filas cargadas y lo dicen en pantalla.

### Limitaciones conocidas

- Los anchos de columna de la grilla no se guardan: harían falta por consulta.
- CONNECT, DISCONNECT, COLUMN, BREAK, HOST, EXIT y similares responden "Comando no admitido".
  La consola no cambia de usuario.
- El texto LOB se corta en 1.000.000 caracteres por celda. Esas columnas no se editan en la
  grilla y el visor avisa cuando el valor llegó al tope.
- Los archivos locales se restauran como borrador, sin ruta. Los archivos soltados tampoco
  traen ruta: Guardar pide destino.
- `@archivo` y SPOOL no tienen lista de carpetas permitidas.
- El espacio de trabajo guarda texto SQL en la carpeta de configuración. Topes: 50 pestañas
  y 2 MiB de texto.
- PRINT reconoce valores OUT en asignaciones directas. IN OUT y OUT reales quedan sin
  verificar.
- La consola muestra hasta 500 filas por SELECT. Salida guarda hasta 10.000 líneas y la
  consola hasta 2.000.
- Orden y filtro se desactivan en modo edición.
- Las rutas de `sql.rs` (bloque que falla, fechas, LOB) y EXEC, `@`, SPOOL y DESC solo tienen
  pruebas con funciones puras o contextos falsos, sin base.
- `App.test.tsx`, "cerrar una ventana SQL con transacción abierta...", sigue marcado como
  inestable.

### Verificaciones

- Cada brief corrió sus controles. Última cifra registrada: TypeScript y 610 tests de
  frontend en el brief 57. Los cinco controles completos se repiten en el brief 61.
- Las columnas del diccionario que usan DESC y SHOW ERRORS se verificaron en desarrollo con
  SELECT. Ninguna otra comprobación tocó una base.
- No se abrió la app real durante la rama: foco, menús y fluidez solo tienen pruebas
  automáticas.

### Pruebas manuales pendientes

Las hace el usuario. Ningún agente escribe ni compila en la base de desarrollo.

1. Fluidez al editar un paquete grande (tipear, plegar, buscar).
2. Menú contextual del editor (clic derecho, Shift+F10, tecla Menú) y foco del editor al
   cambiar de pestaña, en la app real.
3. Tamaño y posición de la ventana recordados al reabrir; Pegar desde el menú en Windows.
4. Timeout de conexión contra un host inalcanzable, nunca contra la base de desarrollo.
5. En una base de pruebas con escritura: DBMS_OUTPUT de un bloque que falla, fechas y
   TIMESTAMP WITH TIME ZONE al ver y editar, y un CLOB grande.
6. VARIABLE, PRINT y binds OUT e IN OUT reales.
7. Arrastrar archivos a la ventana en Windows.
8. Cerrar y restaurar pestañas con un perfil real.
9. Recorrido visual: consola, grilla (rango, orden, filtro, visor), menús con Alt, foco de
   diálogos y avisos de error.
10. Confirmar si el test inestable de `App.test.tsx` falla en su máquina.

### Siguiente tarea

Brief 61: correr los cinco controles, revisar `git log main..feat/auditoria-ux` sin datos
reales y reportar. Merge a `main` y push solo si el usuario lo pide.

## Siguiente paso

Primero, el brief 61 de la auditoría UX y sus pruebas manuales (ver "Auditoría UX"). Después:

1. Pruebas de lectura contra la base de desarrollo, solo `SELECT`: en `crates/openpl-oracle/tests/live.rs`,
   `conecta_y_lee_version` y `servicio_inexistente_da_unknown_service`; en
   `crates/openpl-core/tests/live_catalog.rs`, `lista_tablas_propias_sin_error`,
   `todos_los_tipos_consultan_sin_error`, `completa_objetos_y_columnas_sin_error` y
   `edicion_en_grilla_solo_resuelve_tablas`. Resultado (2026-11-24, corrida del usuario, solo
   `SELECT`, sin escrituras): 4 de 6 OK. `live.rs` 2 de 2. `live_catalog.rs` 2 de 4: fallan con
   ORA-12704 (character set mismatch) `completa_objetos_y_columnas_sin_error` (`live_catalog.rs:47`,
   offset 500) y `edicion_en_grilla_solo_resuelve_tablas` (`live_catalog.rs:89`, offset 99).
   Corrección de los binds de texto pendiente de verificación en desarrollo (ver "Pendiente inmediato").
2. Excluidas de las corridas de agentes: `clave_erronea_da_invalid_credentials` (login fallido en cada
   corrida, puede bloquear la cuenta de prueba) y `ventana_sql_pagina_salida_y_errores` (ejecuta
   bloques PL/SQL de `DBMS_OUTPUT`). Las decide el usuario.
3. Escrituras y compilaciones (grilla del plan 3, Recompilar, DDL): las prueba el usuario.
4. Decisión pendiente del usuario: la ventana SQL de la app ejecuta bloques PL/SQL de `DBMS_OUTPUT`
   (`ENABLE` y `GET_LINE`) en cada consulta, aun en un `SELECT`. ¿Se acepta contra la base de desarrollo o se cambia?
5. Recorrido de calificación de la candidata y validación manual de `OUT`, `IN OUT` y `REF CURSOR`.
6. Pruebas del usuario de la tanda B1 a B13 (lista en "Tanda B1 a B13 › Pruebas del usuario").

## Hecho

- **Plan de ejecución (F5):** plan estimado en su propia pestaña y sesión. Se confirmó por DBX la disponibilidad de las columnas del plan, en solo lectura. La ejecución de F5 contra Oracle se reserva para la prueba manual.

- **Buscar comando (Ctrl+K):** paleta filtrable por nombre o atajo con las acciones de la ventana actual.

### Consola de comandos

- **Nuevo → Ventana de comando** abre una sesión SQL propia con prompt e historial. El editor de scripts y el ejecutor se comparten con SQL. [Comportamiento](behavior/comandos.md)

### Cierre funcional de la ventana de prueba

- **Probar** abre una pestaña propia y se puede invocar desde el explorador o una declaración pública. Desde **Nuevo** se abre una prueba vacía.
- El generador omite entradas con valor predeterminado, declara tipos compuestos nombrados para completar a mano y captura retornos y salidas escalares, CLOB y REF CURSOR. Los cursores muestran una vista de hasta 50 filas.
- `.tst` guarda el bloque y metadatos de binds. Los valores escritos en los campos y la conexión quedan fuera del archivo.
- La apertura SQL y la comparación se prueban con los módulos ya cargados en el runner. Se conservaron los asserts de sesión, teclado y transacción.
- [Plan de cierre](superpowers/plans/2026-11-24-openpl-04-cierre-v1.md), [auditoría](../anti-slop/audit-cierre-v1-2026-11-24.md) y [calificación de la v1](RELEASE-v1.md).

### Listado de perfiles con permisos limitados

- En Oracle XE el fallback de **Perfiles** consultaba una columna que no existe en `USER_USERS`. Si la cuenta carece de acceso al catálogo de perfiles, OpenPL muestra una lista vacía. Los demás errores siguen visibles y **Roles** conserva su consulta alternativa.
- La prueba de regresión simula la misma secuencia de errores detectada en CI. El test de catálogo contra Oracle XE sigue activo en GitHub Actions.

### Espacio del editor y formato de Probar

- SQL y **Probar** abren con el 70 % del área dividida para el editor. El divisor se mueve con ratón o teclado.
- **Probar** genera llamadas alineadas, usa los nombres de los parámetros para los binds y abre las entradas tipadas debajo del código. La acción prepara el bloque para ejecutarlo con F8.
- [Auditoría antislop](../anti-slop/audit-formato-prueba-2026-11-24.md). Queda pendiente la comprobación en escritorio y la ejecución manual en una base habilitada para pruebas.

### Sintaxis de Papel

- Se aplicaron los valores de la captura del usuario al tema claro incluido. Las palabras clave y los comentarios conservan el aviso de contraste. [Auditoría](../anti-slop/audit-papel-sintaxis-2026-11-24.md).

### Diálogo de conexión y selección de resultados

- El diálogo de conexión usa la misma capa que los demás diálogos de la aplicación, por encima del encabezado fijo de resultados.
- En SQL se pueden seleccionar las filas cargadas o una fila completa, copiar en TSV o CSV y sumar las columnas numéricas. En edición, el botón de borrado actúa sobre el cursor o la selección, y se puede agregar una fila vacía. Las operaciones quedan pendientes hasta **Aplicar cambios**.
- [Auditoría antislop](../anti-slop/audit-seleccion-grilla-2026-11-24.md). Queda pendiente la revisión visual en escritorio.

### Barra SQL

- La barra muestra un solo botón **Ejecutar** y conserva **Detener**. **Ejecutar script** sigue disponible desde el menú y con Shift+F8.
- **Traer todas** queda junto a **Resultados**, **Salida** e **Historial**. Al activarlo, el foco vuelve a la grilla.
- [Auditoría antislop de las barras SQL](../anti-slop/audit-barra-sql-2026-11-24.md). Queda pendiente el recorrido visual en escritorio.

### Solo lectura en el editor de objetos

- El menú contextual ofrece **Solo lectura** con el estado de la pestaña. Se alterna en el editor abierto y se conservan los cambios, la selección y el historial. La opción también está disponible cuando el clic no apunta a un nombre de objeto.
- [Auditoría antislop](../anti-slop/audit-solo-lectura-2026-11-24.md). Las pruebas de componentes verifican el estado y la conservación del texto. Queda pendiente el recorrido visual en escritorio.

### Probar rutinas públicas y ajuste de Papel

- En la fuente o en **Estructura**, el menú de una función o procedimiento público ofrece **Probar**. Se leen las firmas por el IPC de solo lectura, se elige la sobrecarga si hay varias y se prepara un bloque editable en una pestaña SQL. Los argumentos escalares admitidos usan variables tipadas. El botón prepara el bloque sin ejecutarlo. La ventana dedicada del Plan 4 sigue pendiente.
- Papel usa grises fríos y un acento azul. Los comentarios pasan a terracota apagada en los temas incluidos.
- [Auditoría antislop](../anti-slop/audit-papel-rutinas-2026-11-24.md). Quedan pendientes la inspección visual nativa y la prueba manual de llamadas en una base habilitada para ello.

### Selector de temas

- En `feat/seleccion-temas`, la fila activa usa fondo de superficie y un tilde. Se quitó la franja lateral y se documentó la regla de selección en `DESIGN.md`.
- [Auditoría antislop del selector](../anti-slop/audit-003-2026-11-24.md). Pasaron 340 pruebas de frontend, TypeScript, formato, Clippy y las pruebas de Rust sin conexión a Oracle. Sigue pendiente el recorrido visual de escritorio.

### Papel y comentarios

- Papel usa superficies gris cálido y sintaxis de baja saturación. Los comentarios usan un malva apagado y cursiva en SQL, PL/SQL y la vista previa. Se ajustaron los fondos del comparador para mantener legibilidad.
- [Auditoría antislop](../anti-slop/audit-papel-2026-11-24.md). La verificación visual en escritorio sigue pendiente.

### Tanda B1 a B13 (2026-11-24)

Cambios pedidos tras usar la app. Commits en `feat/plan-4-ventana-prueba`, en orden:

| Cambio | Commits |
|---|---|
| Tab indenta con 2 espacios y no saca el foco; el editor indenta con 2 espacios | `a86b870`, `d2bccc3` |
| Comentarios en cursiva (`--cm`, 4.5:1) y selección y línea activa visibles; `contrast.ts` | `17f6965`, `24ca815` |
| Spec y Body como pestañas (`tablist`, `aria-selected`, activa con borde ocre) | `a21a740` |
| Ancho de columnas ajustable en la grilla (arrastre, flechas de 16 px, doble clic restaura) | `cad1c69` |
| Un solo **Comparar con Oracle**; Ctrl+S y Archivo > Guardar escriben el editor como `.sql` | `7f09bb6` |
| F8 compila la pestaña activa en una sesión hermana; Detener (Shift+Esc) la cancela | `464abe4` |
| Menú contextual por tipo: Consultar y Editar datos, usuario | `7e3bc7d` |
| Completado con alcance `relations` tras FROM y JOIN (núcleo y comando) | `8b44de0` |
| Completado de tablas tras FROM y JOIN y de columnas en el SELECT (interfaz) | `1c53932` |
| Botón Detener con texto en la ventana SQL; corta también Traer todas y conserva las filas | `52dab57` |
| Barra flotante de búsqueda y reemplazo (Ctrl+F, Ctrl+H) | `b896cc7` |
| Temas: Grafito, Papel, Medianoche, Bosque y Alto contraste, temas propios en `localStorage` | `9ae9ef6` |
| Diálogo **Personalizar interfaz** (Ctrl+,) y botón Sol/Luna | `7820f1b` |

- Notas al día: [programa.md](behavior/programa.md) (Compilar, Detener, Comparar, Guardar, Tab,
  búsqueda), [explorador.md](behavior/explorador.md) (menú por tipo) y [DESIGN.md](../DESIGN.md)
  (temas y colores de entorno fijos).
- **Preparar compilación** y su script con `SHOW ERRORS` ya no existen: los reemplaza **Compilar** (F8).
- **Verificado:** solo pruebas automáticas (`cargo test`, Clippy, fmt, `tsc --noEmit`, `npm.cmd test`
  tres veces). No se abrió la app ni se usó ninguna base. Nada se compiló en Oracle.
- **Test inestable:** `App.test.tsx`, "cerrar una ventana SQL con transacción abierta pregunta qué
  hacer", falló 1 de 4 corridas durante la tanda. En la verificación final pasó en 3 de 3 corridas;
  sin causa encontrada todavía.
- Las pruebas `live` de la ventana SQL contra la base de desarrollo siguen excluidas de las corridas de
  agentes (`ventana_sql_pagina_salida_y_errores` ejecuta bloques PL/SQL).

#### Pruebas del usuario

Las hace el usuario. Ningún agente compila ni escribe en la base de desarrollo.

1. Compilar de verdad, con F8, un paquete (Spec), su Body, un procedimiento, una función y un trigger
   en una base de prueba donde se pueda escribir. Nunca en la base de desarrollo.
2. Confirmar que un objeto con errores devuelve ORA-24344 como código (la app lo trata como
   "Compilado con N errores") y que los números de línea de Problemas coinciden con el editor.
3. Detener (Shift+Esc) corta una compilación larga y la app muestra "Compilación detenida".
4. Completado con alcance `relations` tras FROM y JOIN contra la base de desarrollo, solo `SELECT`.
5. Recorrido visual en `npm.cmd run tauri dev`: barra de búsqueda, pestañas Spec y Body, selección
   y comentarios en el editor, ancho de columnas de la grilla y los cinco temas con Sol/Luna y
   Personalizar interfaz.
6. Confirmar si el test de `App.test.tsx` "cerrar una ventana SQL con transacción abierta pregunta qué
   hacer" falla de forma intermitente en su máquina.

### Plan 2: Primer incremento

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

### Plan 2: Acciones de objeto desde el editor

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

### Plan 2: Comparación con Oracle

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

### Plan 2: Preparación de compilación

- **Reemplazada** en la tanda B1 a B13 por **Compilar** (F8). Lo que sigue es histórico.
- **Preparar compilación** (F8) funciona en modo **Editar** sobre una fuente abierta desde Oracle.
  Valida el encabezado, consulta la versión con la sesión original y muestra una comparación. Si
  detecta cambios, ofrece **Guardar pese al cambio** como acción explícita. Si falta la fuente o
  su marca de DDL, el panel conserva el borrador y carece de opción de exportación.
- `app/src/programScript.ts` arma el archivo SQL local con el nombre calificado a partir del
  borrador. El script se revisa y ejecuta manualmente. Ejecutar F8 en la app solo hace lecturas.
  [Nota de comportamiento](behavior/programa.md)
- La ejecución de DDL y la actualización automática de diagnósticos tras compilar siguen fuera de
  este flujo.

### Plan 2: Estructura de los programas

- **Estructura** enumera las variables y constantes globales, los tipos, los cursores y las
  rutinas de un paquete. Las firmas distinguen sobrecargas y determinan qué entradas del Body
  corresponden al Spec. Clic lleva al identificador y F12 ofrece las firmas candidatas.
- `app/src/programStructure.ts` analiza los tokens del primer programa del documento. El alcance
  es la navegación por el nivel de paquete y la cabecera de programas independientes. La prueba
  nativa de visualización del panel queda pendiente. [Comportamiento de la ventana](behavior/programa.md)

### Plan 2: Plegado PL/SQL

- **Plegar bloque** (Alt+Shift+P) y **Desplegar bloque** (Alt+Shift+A) están en **Ver** y se pueden
  usar con el cursor en la línea de apertura. El margen también permite plegar. La apertura y el
  cierre quedan visibles. Ir a una declaración o problema abre el rango que lo oculta.
- `app/src/programStructure.ts` empareja los delimitadores a partir de los tokens que usa el editor.
  `app/src/programFolding.ts` guarda los rangos por documento. Las pruebas cubren paquetes,
  rutinas anidadas, `DECLARE`, `BEGIN`, `IF`, `LOOP`, `CASE` y directivas `$IF` y `$END`.
  Las cabeceras se detectan para el primer programa del documento. [Comportamiento de la ventana](behavior/programa.md)

### Plan 2: Autocompletado

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

### Plan 3: Ventana SQL, incremento 1

- [Plan 3](superpowers/plans/2026-11-24-openpl-03-ventana-sql.md) y [nota de comportamiento](behavior/sql.md).
- **Núcleo:** `crates/openpl-core/src/sql.rs` ejecuta una sentencia con binds tipados, entrega la primera
  página (50 filas) y guarda el cursor en el hilo de la sesión para `fetch`; lee `DBMS_OUTPUT` y el estado
  de la transacción tras cada ejecución. `SessionManager::open_sibling` da a cada ventana su sesión;
  `Session::interrupt` cancela con `break_execution` desde otro hilo. `DbError.offset` lleva la posición.
- **Interfaz:** `app/src/sqlScript.ts` separa el script (`;`, `/`, bloques PL/SQL, SQL*Plus omitido),
  `app/src/sqlBinds.ts` detecta `:x` y `&x`, `SqlWindow.tsx` ejecuta (F8, Shift F8), cancela (Shift Esc),
  muestra Resultados (grilla y Traer todas), Salida e Historial, y el panel Variables.
  Pestañas comunes con los programas; Ctrl N; Commit/Rollback de la ventana activa con indicador;
  diálogo al cerrar con transacción abierta; **Consultar datos** desde el explorador.
- **Sin verificar contra Oracle real:** la prueba `live` nueva (paginación, `DBMS_OUTPUT`, posición de
  error) espera credenciales `OPENPL_TEST_*`. Falta mirar la ventana en la app nativa.

### Plan 3: Ventana SQL, incremento 2 (edición en grilla)

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

### Plan 3: Carga inicial y legibilidad de resultados

- `PAGE_SIZE` es 50. El núcleo comprueba si hay una fila adicional en el cursor y la conserva para
  la página siguiente. La grilla no solicita filas al desplazarse. **Traer todas** (Ctrl+Shift+End)
  está en el encabezado y agota el mismo cursor por lotes de hasta 1.000 filas.
- Las franjas usan `--s0` y `--s1` y siguen el índice de la fila al virtualizar. Las marcas de
  edición tienen prioridad. Si falla la continuación, la grilla conserva las filas recibidas y
  muestra el error junto al atajo para reejecutar. [Comportamiento](behavior/sql.md)
- La carga de 50, la fila 51, la ausencia de carga al desplazarse y los estados del botón se probaron
  localmente. Falta el recorrido en la app nativa con Oracle. La ventana SQL existente llama a
  `DBMS_OUTPUT` incluso en consultas. Esa ruta no se usó contra una base en la verificación.
  [Auditoría de la grilla](../anti-slop/audit-002-2026-11-24.md)

### Plan 4: Firmas y sobrecargas

- `crates/openpl-core/src/routine.rs` implementa T1 en solo lectura. `list_overloads` usa
  `ALL_PROCEDURES` para conservar rutinas sin argumentos y `ALL_ARGUMENTS` para detallar parámetros,
  retornos y campos compuestos. `group_overloads` agrupa por `SUBPROGRAM_ID`.
- Se verificó en desarrollo con DBX el SELECT para la firma del procedimiento público
  de ejemplo. Se comprobó un argumento de entrada y no se ejecutó la rutina.
- **Punto de continuación:** T2, generador puro del bloque, con decisiones pendientes para **Usar**
  y BOOLEAN. [Plan 4](superpowers/plans/2026-11-24-openpl-04-ventana-prueba.md)

### Auditoría antislop 001

- Se instaló antislop (skills en `~/.claude/skills/antislop*`) y se auditó la interfaz:
  [anti-slop/audit-001-2026-11-24.md](../anti-slop/audit-001-2026-11-24.md). Los 14 hallazgos
  están corregidos (contraste medido, bordes de campos, foco, estados de carga/vacío/error en el
  explorador, "Próximamente" en lo pendiente, sin menú Ayuda vacío, estado inicial con acciones).
- [DESIGN.md](../DESIGN.md) es la dirección de diseño con sus motivos. Desde ahora toda interfaz
  nueva aplica antislop mientras se construye y cierra con su informe PASS/FAIL (`AGENTS.md`).

### Plan 4: Ventana de prueba (planificado)

- [Plan 4](superpowers/plans/2026-11-24-openpl-04-ventana-prueba.md) y
  [nota de comportamiento](behavior/prueba.md) escritos. Sin código todavía.

### Plan 1: [docs/superpowers/plans/2026-11-23-openpl-01-base-y-explorador.md](superpowers/plans/2026-11-23-openpl-01-base-y-explorador.md)

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

1. Tema **grafito** por defecto (tokens en `app/src/theme.css`), con cinco temas predefinidos,
   temas propios y botón Sol/Luna (`app/src/themes.ts`, ver [DESIGN.md](../DESIGN.md)); los colores
   de entorno son fijos. Íconos **Phosphor**, **IBM Plex**
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
11. **Versión y actualizador (WAL-114, en curso):** una sola versión semver, hoy `1.0.0-beta.5`,
    en `Cargo.toml`, `app/package.json`, `app/package-lock.json` y `tauri.conf.json`; el test
    `la_version_es_la_misma_en_todos_lados` (`app/src-tauri/src/lib.rs`) falla si no coinciden.
    La regla 9 de AGENTS.md admite, además de la base, el chequeo de actualizaciones: lee
    `latest.json` de GitHub, sin datos del usuario.
    Publicación: `.github/workflows/release.yml` corre al subir un tag `v*`. Comprueba que el tag
    coincida con la versión de `tauri.conf.json` y que haya `pubkey`, corre los tests, compila el
    instalador NSIS firmado (secrets `TAURI_SIGNING_PRIVATE_KEY*`), publica el release (pre-release
    si el tag tiene sufijo; título "OpenPL 1.0.0 Beta N"; cuerpo = mensaje del tag anotado más
    "Compilada desde <hash>.") y sube `latest.json` con `--clobber` al release fijo `updater`, que
    nunca queda como latest. Pasos en [RELEASE-v1.md](RELEASE-v1.md#publicar). Paso manual: la
    beta.5 se instala a mano con el `*-setup.exe`; el `.exe` suelto de betas anteriores no se
    actualiza solo. El workflow todavía no se corrió en GitHub.

## Pendiente inmediato

1. **Validar contra la base de desarrollo** (ver "Siguiente paso"), en dos partes:
   - Lectura (agentes, solo `SELECT`): fechas, timestamp, decimales, CLOB, paginación y posición del
     error.
   - Del usuario: edición en grilla, `RETURNING ROWID`, `DBMS_OUTPUT` y revisión manual de la ventana.
     También las pruebas manuales de los planes 1 y 2 (login con host/puerto/servicio y con alias,
     perfiles y contraseña guardada, explorador con los 35 tipos, Copiar DDL, Recompilar,
     reconexión, lectura de fuentes, menú de objeto, comparación, preparación de compilación,
     autocompletado y selector nativo de archivos).
2. **ORA-12704 en desarrollo** (corrección pendiente de verificación): fallaban
   `completa_objetos_y_columnas_sin_error` (`live_catalog.rs:47`, offset 500) y
   `edicion_en_grilla_solo_resuelve_tablas` (`live_catalog.rs:89`, offset 99). Son consultas de
   lectura, no es un fallo de escritura. Impacto: contra la base de desarrollo fallaban `complete_objects`
   (autocompletado de objetos) y `edit_target` (edición en grilla); la corrección cubre a los dos.
   - Causa probable: binds NULL dentro de `COALESCE(..., SYS_CONTEXT('USERENV','CURRENT_SCHEMA'))`,
     la única diferencia con las pruebas que pasan.
   - Corrección (`crates/openpl-core/src/catalog.rs`): los binds de texto que van en `COALESCE` o
     `UNION ALL` pasan a `CAST(... AS VARCHAR2(4000))`. Verificada sin conexión: `cargo test`, fmt y
     Clippy en verde.
   - Si la re-corrida sigue dando ORA-12704: revisar el NLS de la base de desarrollo (`NLS_NCHAR_CHARACTERSET`) con un
     `SELECT` de solo lectura sobre `NLS_DATABASE_PARAMETERS`.
3. **Plan 4:** respuestas del dueño a las decisiones abiertas y al mockup antes de escribir código.
4. **Primer CI:** el remoto `origin` ya está configurado; falta subir las ramas y corregir lo que
   falle (el YAML no se validó).
5. Decidir cómo y cuándo integrar las ramas `feat/plan-*` a `main`.
6. Problemas menores conocidos (no bloquean):
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

### Plan 2: Ventana de programa (implementado, pendiente de validar contra Oracle)
- Tareas de implementación terminadas. Falta la validación manual contra Oracle del [plan](superpowers/plans/2026-11-23-openpl-02-ventana-programa.md).
- Validar manualmente la apertura de un paquete con y sin Body, la navegación a diagnósticos y el
  selector nativo en Windows y Linux. Las pruebas de la aplicación contra Oracle serán de solo lectura.

### Plan 3: Ventana SQL (en curso: solo validación contra Oracle)
- Incrementos 1 y 2 hechos ([plan](superpowers/plans/2026-11-24-openpl-03-ventana-sql.md)). Falta la
  validación contra Oracle real: lectura corrida, con 2 de 4 OK en `live_catalog` y 2 fallos
  ORA-12704. La corrección de los binds de texto está pendiente de verificación. Las escrituras las prueba el usuario.

### Plan 4: Ventana de prueba (pendiente de calificación)
- [Plan de cierre](superpowers/plans/2026-11-24-openpl-04-cierre-v1.md) y [comportamiento](behavior/prueba.md).
- Validar visualmente el flujo completo y comprobar resultados en Oracle en una sesión habilitada para pruebas manuales.

### Plan 5: Empaquetado
- Versión 1.0.0 y paquetes x64 MSI, NSIS, Debian y AppImage generados. [Calificación de la candidata](RELEASE-v1.md).
- Pendiente: probar instalación y flujo de escritorio por plataforma. La firma y la publicación requieren preparar la distribución.

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
| Plan 4 (en curso) | `docs/superpowers/plans/2026-11-24-openpl-04-ventana-prueba.md` |
| Auditoría UX (rama `feat/auditoria-ux`) | `docs/superpowers/plans/2026-11-25-openpl-auditoria-ux.md` |
| Comportamiento observado | `docs/behavior/observaciones-referencia.md`, `conexion.md`, `explorador.md`, `programa.md`, `sql.md`, `comandos.md`, `prueba.md` |
| Instrucciones para agentes | `AGENTS.md` |
| Logo y guía | `design/logo/` |
| Mockup (privado del dueño) | referencia privada |
