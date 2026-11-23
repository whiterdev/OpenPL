# OpenPL — Diseño v1

> **Nota:** hay decisiones posteriores que actualizan este diseño (tema grafito, menús y atajos,
> conexión con host/puerto/servicio, 35 tipos en el explorador, etc.). Están en
> [docs/ESTADO.md](../../ESTADO.md#decisiones-vigentes-que-actualizan-el-diseño) y mandan sobre este documento.

Fecha: 2026-11-23 · Estado: borrador para aprobación

## 1. Intención y porqué

Desarrolladores Oracle prefieren PL/SQL Developer (Allround Automations) sobre
Oracle SQL Developer porque es más intuitivo y completo, pero es software
comercial y solo para Windows. OpenPL es un IDE de escritorio **open source**,
escrito en **Rust**, que ofrece esa misma experiencia de trabajo, para la
comunidad, en **Windows y Linux desde el inicio**.

Éxito para la v1: un desarrollador que hoy usa PL/SQL Developer puede pasar un
día normal en OpenPL editando paquetes y corrigiendo datos sin echar de menos
nada esencial de esas dos tareas.

## 2. Método: clean-room, no ingeniería inversa

- **No** se descompila, desensambla ni inspecciona el binario de PL/SQL
  Developer, ni se copian sus iconos, textos, archivos de configuración o
  manual.
- Se documenta el **comportamiento observable** (qué hace cada ventana, flujo,
  atajo) a partir del uso y de documentación pública, en
  `docs/behavior/*.md`, redactado con palabras propias.
- Se implementa desde esas notas. Los contribuyentes declaran en el PR que no
  usaron material propietario.
- Proceso *(decisión mía)*: antes de implementar cada función se escribe su
  nota de comportamiento (quien conoce el producto por uso normal puede
  observarlo; lo prohibido es mirar sus entrañas o copiar sus recursos). Esa
  nota + este diseño definen "terminado". Los atajos por defecto imitan los
  habituales para que la transición sea natural, y todos son configurables.
- Nombre, logo e iconos propios. No se usa la marca "PL/SQL Developer" en la
  interfaz.

## 3. Objetivos, no-objetivos, anti-objetivos

**Objetivos v1**
1. Conectar a Oracle (12c en adelante) vía Instant Client.
2. Explorador de objetos del esquema.
3. **Ventana de programa**: editar paquetes con **Spec y Body en pestañas
   separadas** dentro de la misma ventana; también procedimientos, funciones,
   triggers, tipos y vistas. Compilar y ver errores en línea.
4. **Ventana SQL**: ejecutar consultas y **editar datos en la grilla**, con
   commit/rollback explícito; salida de `DBMS_OUTPUT` y variables `:x`.
5. **Ventana de prueba (Test Window)**: llamar a un procedimiento o función
   con parámetros y ver resultados y `DBMS_OUTPUT`.

**No-objetivos v1** (fases posteriores): depurador PL/SQL, plan de ejecución
gráfico, Command Window estilo SQL*Plus, reportes, beautifier, comparador de
esquemas, exportar/importar, macOS, plugins.

**Anti-objetivos** (fallaría aunque funcione):
- Que modifique datos u objetos sin una acción explícita del usuario
  (autocommit por defecto, compilar al guardar, etc.).
- Que pise en silencio cambios que otra persona hizo en el mismo objeto.
- Que se sienta como SQL Developer: lento, con muchos diálogos, flujos en
  varios pasos para cosas que deberían ser un atajo.
- Que dependa de un servicio en la nube o envíe telemetría.

## 4. Restricciones

- **Instant Client obligatorio** (OCI). No se busca un driver "thin". Si no se
  encuentra, la app lo explica al arrancar y muestra cómo configurarlo
  (`PATH` en Windows, `LD_LIBRARY_PATH`/`ldconfig` en Linux, o ruta en
  preferencias).
- Plataformas v1: Windows 10+ x64 y Linux x64 (Ubuntu/Debian/Fedora recientes).
- **Oracle 12.1 en adelante es requisito obligatorio** (decisión del usuario).
  Consecuencias:
  - Instant Client soportado: **19 o 21** (el 23 no conecta a 12.1). Al
    arrancar se detecta la versión del cliente; al conectar se lee la versión
    del servidor y, si la combinación no es soportada, se explica claramente.
  - Consultas al catálogo compatibles con 12.1; lo que dependa de 12.2+
    (p. ej. identificadores de más de 30 caracteres) o 18c+ se activa solo tras
    verificar la versión del servidor.
  - No hay imagen gratuita de 12c ni de 19c para CI: CI usa Oracle XE 18c (la
    más cercana a 12c disponible libremente); la
    compatibilidad con 12c se valida con una lista de pruebas manuales contra
    bases reales antes de cada versión.
- Licencia del proyecto: **Apache-2.0 OR MIT** *(decisión mía: máxima
  compatibilidad para contribuir y empaquetar; todas las dependencias elegidas
  son compatibles)*.

## 5. Enfoques considerados

| Enfoque | Ventaja | Costo |
|---|---|---|
| **A. Tauri v2 (núcleo Rust + interfaz web)** — **elegido** | Editor y grilla maduros desde el día uno; multiplataforma | Parte del código en TypeScript; en Linux corre sobre WebKitGTK |
| B. Rust nativo (egui / iced / Slint) | Todo Rust, binario chico | No hay editor de código ni grilla editable maduros: meses construyéndolos |
| C. GPUI (motor de Zed) | Muy rápido, editor de primer nivel | API inestable, poca documentación, el editor de Zed es GPL |

Se eligió **A**: lo que hace preferir PL/SQL Developer es la calidad del editor
y la grilla, y A los da maduros; Rust queda con todo lo específico de Oracle.

## 6. Arquitectura

```
┌──────────────── Interfaz (TypeScript, webview de Tauri) ───────────────┐
│ Explorador │ Ventana de programa (CodeMirror 6) │ Ventana SQL (grilla) │
└───────────────────────────── IPC de Tauri ─────────────────────────────┘
┌──────────────────────────── Núcleo Rust ───────────────────────────────┐
│ openpl-core: sesiones, catálogo, compilación, ejecución, edición grilla│
│ openpl-oracle: adaptador sobre crate `oracle` (ODPI-C / OCI)           │
└────────────────────────────────────────────────────────────────────────┘
```

**Decisiones mías** (corregibles):
- Workspace Cargo con crates `openpl-oracle` (acceso a BD), `openpl-core`
  (lógica, sin dependencia de Tauri, testeable solo), `openpl-app` (Tauri,
  comandos IPC).
- Frontend: **React + TypeScript + Vite** (el más conocido por contribuyentes).
- Editor: **CodeMirror 6** (más liviano y modular que Monaco y más fiable sobre
  WebKitGTK), con modo PL/SQL propio.
- Grilla: **AG Grid Community** (MIT), con virtualización y edición en celda.
- Driver: crate **`oracle`** (rust-oracle, sobre ODPI-C).
- Cada operación de BD corre en un hilo/tarea por sesión; la interfaz nunca se
  bloquea. Las consultas largas se pueden cancelar (`break` de OCI).

## 7. Comportamiento detallado

### 7.1 Conexiones
- Diálogo de login: usuario, contraseña, base de datos (alias de
  `tnsnames.ora` o EZConnect `host:puerto/servicio`), rol (Normal / SYSDBA /
  SYSOPER).
- Lista de conexiones guardadas en un archivo de configuración del usuario. La
  contraseña **solo** se guarda si el usuario lo pide, y en el almacén seguro
  del sistema (Windows Credential Manager / Secret Service en Linux) vía crate
  `keyring`.
- Varias conexiones abiertas a la vez; cada ventana muestra a cuál pertenece
  (color/etiqueta configurable por conexión, p. ej. rojo para producción).

### 7.2 Modelo de sesiones *(decisión mía)*
- Por conexión hay una **sesión principal** (explorador, lectura de fuentes,
  compilación).
- Cada **Ventana SQL** y cada **Ventana de prueba** abre su **propia sesión**, así su transacción y su
  cancelación son independientes (equivale al modo "multi sesión").
- Al cerrar una ventana SQL con transacción pendiente se pregunta Commit /
  Rollback / Cancelar.

### 7.3 Explorador de objetos
- Árbol por tipo: Paquetes, Procedimientos, Funciones, Triggers, Tipos,
  Tablas, Vistas, Secuencias, Sinónimos.
- Filtro "mis objetos" / "todos los accesibles" (vía `ALL_OBJECTS`), búsqueda
  por nombre, icono de estado para objetos `INVALID`.
- Doble clic o menú "Editar" abre la ventana de programa; en tablas, "Consultar
  datos" abre una ventana SQL con `SELECT * FROM tabla` (y "Editar datos" con
  `FOR UPDATE`).

### 7.4 Ventana de programa
```
┌ PKG_VENTAS (HR@DEV) ─────────────────────────┐
│ [Spec] [Body]                                 │
│ ┌──────────┐ ┌──────────────────────────────┐ │
│ │ calc_tot │ │ PROCEDURE calc_tot(p IN ...  │ │
│ │ get_cli  │ │ ...                          │ │
│ └──────────┘ └──────────────────────────────┘ │
│ (12,5) PLS-00201: identificador debe decl...  │
└───────────────────────────────────────────────┘
```
- Un paquete se abre en **una ventana con dos pestañas: Spec y Body**,
  editables por separado; si el body no existe, la pestaña permite crearlo.
- Fuente leída con `DBMS_METADATA.GET_DDL` o `ALL_SOURCE` (decisión del
  constructor), normalizada a `CREATE OR REPLACE ...`.
- Panel lateral con la estructura (procedimientos, funciones, tipos, variables
  globales) que sigue a la pestaña activa; clic navega.
- **Compilar** (F8 *por defecto mío*): compila la pestaña activa; "Compilar
  todo" compila spec y luego body. Errores de `ALL_ERRORS` en panel inferior;
  clic salta a línea/columna; subrayado en el editor.
- **Control de concurrencia**: al abrir se guarda `LAST_DDL_TIME`; al compilar
  se vuelve a leer y, si cambió, se avisa y se ofrece ver diferencias,
  sobrescribir o cancelar.
- Guardar a archivo (`.pks`/`.pkb`/`.sql`) y abrir desde archivo.
- Editor: resaltado PL/SQL, plegado, búsqueda/reemplazo, ir a línea,
  multicursor, comentar/descomentar, mayúsculas/minúsculas de selección.
- Autocompletado básico v1: palabras clave, objetos del esquema y columnas tras
  `alias.` (catálogo pedido al núcleo Rust y cacheado por conexión).

### 7.5 Ventana SQL y edición en grilla
- Editor arriba, resultados abajo. Ejecutar sentencia bajo el cursor o
  selección (F8 / Ctrl+Enter). Varias sentencias en script: ejecutar todas.
- Separación de sentencias v1 *(decisión mía)*: por `;` y por `/` en línea
  sola (bloques PL/SQL). Los comandos SQL*Plus (`SET`, `PROMPT`, `@archivo`,
  `SPOOL`, etc.) no se ejecutan: se marcan con un aviso "comando SQL*Plus, usar
  Command Window (fase posterior)" y el script continúa.
- Resultados con carga incremental (primeras N filas, más al bajar; botón
  "traer todas").
- **Edición de datos**:
  - Editable cuando la consulta es sobre una sola tabla y lleva `FOR UPDATE`, o
    cuando el usuario pulsa el candado "Editar". El núcleo añade `ROWID` de
    forma oculta para identificar filas.
  - Editar celdas, insertar fila, borrar fila. Los cambios quedan marcados y
    **pendientes** hasta "Aplicar" (Post), que genera `UPDATE/INSERT/DELETE ...
    WHERE ROWID = :rid` en la sesión de la ventana.
  - Luego **Commit** / **Rollback** desde la barra; la barra indica si hay
    transacción abierta.
  - **Conflictos** *(decisión mía)*: el candado "Editar" solo se habilita en
    consultas sobre una sola tabla (donde hay `ROWID`; no en vistas ni joins).
    Si la consulta no llevaba `FOR UPDATE`, al "Aplicar" cada fila tocada se
    bloquea con `SELECT ... WHERE ROWID = :rid FOR UPDATE NOWAIT` y se comparan
    sus valores con los originales. Si la fila está bloqueada por otra sesión o
    cambió, no se aplica y se muestra la fila en conflicto (valor actual vs. el
    tuyo) para descartar o reintentar.
  - Tipos v1 editables: VARCHAR2, CHAR, NUMBER, DATE, TIMESTAMP, CLOB (editor
    de texto emergente). Solo lectura v1: BLOB, LONG, XMLTYPE, objetos.
- Errores de Oracle mostrados con código y posición en el editor.
- Historial de sentencias ejecutadas por ventana.
- **DBMS_OUTPUT**: activable por ventana (activo por defecto); tras cada
  ejecución se leen las líneas con `DBMS_OUTPUT.GET_LINES` y se muestran en una
  pestaña "Salida" junto a los resultados.
- **Variables**: si la sentencia tiene `:x` o `&x`, antes de ejecutar aparece
  un diálogo para darles valor y tipo; se recuerdan los últimos valores.

### 7.6 Ventana de prueba (Test Window)
```
┌ Test: PKG_VENTAS.CALC_TOT (HR@DEV) ──────────┐
│ begin                                          │
│   :result := pkg_ventas.calc_tot(p_cli => :p_cli);│
│ end;                                           │
├───────────────────────────────────────────────┤
│ Variable │ Tipo     │ Valor      │ Dirección   │
│ result   │ NUMBER   │ 1520.50    │ salida      │
│ p_cli    │ NUMBER   │ 42         │ entrada     │
├───────────────────────────────────────────────┤
│ [Salida DBMS_OUTPUT] [Estado: OK 0.12 s]       │
└───────────────────────────────────────────────┘
```
- Se abre desde el explorador o desde el panel de estructura de la ventana de
  programa ("Probar"), sobre procedimientos y funciones sueltos o de paquetes.
- El núcleo lee la firma con `ALL_ARGUMENTS` (resolviendo sobrecargas: si hay
  varias, se pregunta cuál) y genera un bloque anónimo editable con una
  variable bind por parámetro y por el retorno de la función.
- Tabla de variables con nombre, tipo, valor y dirección (IN / OUT / IN OUT);
  el usuario llena las de entrada, ejecuta (F8) y ve las de salida y
  `DBMS_OUTPUT`.
- Tipos v1 en la tabla: escalares (VARCHAR2, CHAR, NUMBER, INTEGER, DATE,
  TIMESTAMP, BOOLEAN vía conversión en el bloque, CLOB). Parámetros de tipo
  registro, colección o `REF CURSOR`: v1 genera el bloque con la variable
  declarada localmente para que el usuario la complete a mano; un `REF CURSOR`
  de salida se muestra como grilla de resultados de solo lectura.
- Usa su propia sesión (como la Ventana SQL), con Commit/Rollback explícito al
  terminar: la prueba puede modificar datos.
- El script de prueba se puede guardar a archivo (`.tst` propio, en texto) y
  reabrir.

### 7.7 Menús y atajos
- Sin cinta de opciones. Barra de menús dentro de la barra de título: Archivo, Editar,
  Buscar, Ver, Sesión, Herramientas, Ayuda; botón "Nuevo" con desplegable (ventanas:
  Programa ▸ Paquete/Procedimiento/Función/Trigger/Tipo, Prueba, SQL, Comando, Plan de
  ejecución; objetos: Tabla, Vista, Vista materializada, Secuencia, Sinónimo, Job,
  Usuario, Rol, Database link). En v1 solo se habilitan los que v1 implementa.
- Paleta de comandos (Ctrl K) que busca cualquier comando por nombre y muestra su atajo.
- Menús contextuales en editor, grilla y explorador.
- Cada ventana tiene su barra con 3–4 acciones frecuentes.
- **Todo comando importante tiene atajo y el atajo se muestra** (en menús, en los
  botones principales como `kbd` y en el tooltip de los botones de ícono). Atajos
  configurables. Mapa por defecto:

| Acción | Atajo |
|---|---|
| Ejecutar / Compilar | F8 |
| Ejecutar script | Shift F8 |
| Cancelar ejecución | Shift Esc |
| Commit / Rollback | F10 / Shift F10 |
| Plan de ejecución | F5 |
| Paleta de comandos | Ctrl K |
| Nueva ventana SQL / Prueba / Comando | Ctrl N / Ctrl T / Ctrl Shift N |
| Probar el objeto actual | Ctrl T |
| Guardar / Cerrar pestaña | Ctrl S / Ctrl W |
| Spec / Body | Alt S / Alt B |
| Spec y Body lado a lado | Ctrl \ |
| Ir a la declaración | F12 |
| Ir a línea | Ctrl G |
| Buscar / Reemplazar | Ctrl F / Ctrl H |
| Comentar líneas | Ctrl / |
| Duplicar / Borrar línea | Ctrl D / Ctrl Shift K |
| Mayúsculas / Minúsculas | Ctrl Shift U / Ctrl Alt U |
| Editar datos (candado) | Ctrl E |
| Aplicar cambios de la grilla | Ctrl Shift Enter |
| Conectar | Ctrl Shift L |
| Mostrar/ocultar explorador | Ctrl B |
| Refrescar explorador | Ctrl R |

## 8. Calidad y pruebas
- Tests de integración del núcleo en CI Linux contra **Oracle XE 18c** en
  contenedor, con Instant Client 19; lista de verificación manual contra 12c
  antes de cada versión.
- Tests de `openpl-core` sin interfaz; tests de la interfaz con mocks del IPC.
- Paquetes: instalador MSI/NSIS en Windows; AppImage y .deb en Linux.

## 9. Fases posteriores (orden propuesto)
1. Plan de ejecución (`EXPLAIN PLAN` / `DBMS_XPLAN`).
2. Command Window (subconjunto SQL*Plus).
3. Depurador PL/SQL (`DBMS_DEBUG_JDWP`).
4. Beautifier, comparación de objetos, exportación de datos.
5. macOS.

## 10. Lo que queda al constructor
- Estructura interna de los crates, protocolo IPC exacto, manejo de estado en
  el frontend.
- Fuente de lectura de código (`ALL_SOURCE` vs `DBMS_METADATA`).
- Gramática del resaltado PL/SQL y heurística del panel de estructura.
- Diseño visual, temas claro/oscuro y atajos secundarios.
- Nombre definitivo del producto (OpenPL es provisional).
