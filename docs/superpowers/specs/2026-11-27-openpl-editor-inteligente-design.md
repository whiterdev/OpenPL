# Aviso de actualización y editor inteligente

Fecha: 2026-11-27. Estado: diseño, pendiente de aprobación. Revisado por un builder (7 preguntas, resueltas).

Son dos trabajos independientes. La parte 1 es chica y va primero. La parte 2 es un proyecto.

## Parte 1. Ícono de actualización en la barra superior

### Intención

Hoy la app busca una actualización al abrir (`checkUpdates(true)`, `App.tsx`) y, si la hay,
abre `UpdateDialog`. Si el usuario elige "Más tarde", el aviso desaparece y solo vuelve con
Ayuda > Buscar actualizaciones. El usuario quiere un recordatorio visible y permanente.

### Diseño

- Cuando `runCheck` devuelve `available`, la app guarda la actualización en un estado propio
  (`pendingUpdate`), aparte de `updateOffer` (el diálogo abierto).
- La barra superior (`titlebar`, junto al botón Nuevo) muestra un botón de ícono Phosphor
  (`ArrowCircleUp` o similar) con `aria-label="Actualización disponible: <versión>"` y `title`
  igual.
- Al aparecer, el ícono hace una animación corta para llamar la atención: un salto de
  unos 600 ms, repetido 2 o 3 veces y después quieto. Con `prefers-reduced-motion` no se anima.
- Clic en el ícono: abre `UpdateDialog` con esa actualización.
- "Más tarde" cierra el diálogo y el ícono queda. El ícono desaparece al instalar o al reiniciar.
- El chequeo silencioso al abrir no cambia. Ayuda > Buscar actualizaciones también llena
  `pendingUpdate`.
- Color: un token nuevo con valor en cada tema (`themes.ts`), contraste medido según AGENTS.md.

### Fuera de alcance

Chequeo periódico mientras la app está abierta. Sigue siendo solo al abrir y a pedido.

## Parte 2. Editor inteligente

### Intención

Que escribir en paquetes, ventanas SQL y ventanas de prueba se sienta como un editor moderno:
ver qué es un nombre sin salir de donde se está, y saltar a su definición.
Aplica a todo lo que use `ProgramEditor` (ventana de programa, ventana SQL, ventana de prueba).

### Objetivos

1. **Hover** sobre un nombre muestra una ficha:
   - Función o procedimiento: firma completa (parámetros con modo y tipo, `RETURN`), dónde
     está declarado (objeto, spec o body, línea) y el comentario inmediatamente anterior a la
     declaración, si existe (`--` o `/* */`).
   - Cursor: firma con parámetros y la consulta del cursor recortada.
   - Tipo (`TYPE ... IS RECORD/TABLE OF`, `SUBTYPE`): su definición.
   - Constante o variable (global del paquete o local del bloque): tipo de dato y valor
     declarado (`:= valor` o `DEFAULT valor`). Sin valor declarado: "sin valor inicial".
   - Parámetro de la rutina actual: modo y tipo.
   - Tabla o vista (ventana SQL y SQL dentro de paquetes): columnas con tipo y nulos
     (`describeColumns`, ya existe).
   - Paquete, tipo de objeto, función o procedimiento independiente de otro objeto: igual
     que arriba, leyendo su fuente.
   - Las llamadas (`pkg_ventas.calcular(...)`, `calcular(...)`) muestran la misma ficha que la
     declaración.
   - **Campos y columnas** (decidido por el usuario: en la primera versión). `v_cliente.nombre`
     con `v_cliente CLIENTES%ROWTYPE`, `r.total` dentro de `FOR r IN cur LOOP`, campos de un
     `RECORD` propio, `t_tab(i).campo`, variables `%TYPE` y `t.col` en un SELECT con alias:
     la ficha muestra el campo o la columna con su tipo resuelto. Las columnas de un cursor
     salen de su SELECT (alias o nombre de columna; tipo resuelto si la columna es de una
     tabla, "expresión" si no).
2. **Ctrl+clic** sobre un nombre: va a su **definición** (el cuerpo, si existe; si no, la
   declaración). El cursor del mouse cambia a mano y el nombre se subraya mientras Ctrl está
   apretado sobre un nombre navegable.
3. **Menú contextual** sobre un nombre, junto a los ítems actuales de `EditorObjectMenu`:
   - Ir a la definición
   - Ir a la declaración
   - Ir a la implementación (body de una rutina declarada en spec; igual a definición si
     solo existe body)
   - Ver fuente / Describir (ya existen)
4. Navegación hacia otro objeto abre (o activa, si ya está abierta) la ventana de programa de
   ese objeto y posiciona el cursor en la línea de la declaración elegida.
5. Con sobrecargas (mismo nombre, distinta firma), el hover lista todas las firmas y la
   navegación muestra el selector de destinos que ya existe (`declarationMenu`).

### Atajos (`keymap.ts`)

| Comando | Atajo |
|---|---|
| Ir a la definición | F12 (y Ctrl+clic) |
| Ir a la declaración | Ctrl+F12 |
| Ir a la implementación | Ctrl+Shift+F12 |
| Mostrar ficha por teclado | Ctrl+Shift+Espacio, si `keymap.test.ts` confirma que está libre; si no, lo elige el builder |

Hoy F12 es "Ir a la declaración" dentro del paquete. Pasa a ser "Ir a la definición".

### No objetivos

- **Valor adquirido en la sesión.** Decidido con el usuario: no se lee el valor de una
  variable desde una sesión. Solo tipo y valor declarado.
- Buscar referencias / todos los usos.
- Renombrar símbolo.
- Ayuda de firma mientras se escriben los argumentos (signature help). Posible después.
- Objetos de paquetes del sistema (`DBMS_*`, `UTL_*`): funcionan si la fuente es legible con
  los privilegios del usuario. Si está envuelta (`wrapped`), la ficha dice "fuente no
  disponible". No hay un segundo camino por catálogo.

### Anti-objetivos

- Escribir en la base de datos para obtener información (descartado PL/Scope por eso).
- Ejecutar código del usuario o inicializar paquetes al pasar el mouse.
- Que el hover haga que tipear se sienta lento: nada de análisis por tecla sobre todo el
  documento (respetar la pausa de 150 ms que ya existe para estructura y plegado).
- Fichas que tapan lo que se escribe: el hover aparece tras ~400 ms quieto y se va al
  mover el mouse o tipear.

### Restricciones

- Oracle 12.1+. Solo `SELECT` sobre vistas `ALL_*` y la lectura de fuente que ya existe
  (`program_source`).
- Sin conexión: el hover y la navegación funcionan solo dentro del documento abierto.
- AGENTS.md: TDD, textos cortos en español, tokens de color por tema, íconos Phosphor,
  atajos solo en `keymap.ts`, antislop al cierre.
- Clean-room: el comportamiento se describe con palabras propias en `docs/behavior/`.

### Enfoques considerados

- **A. Fuente analizada en la app (elegido por el usuario).** El documento abierto se analiza
  local. Para otros objetos se pide la fuente con `program_source` una vez por sesión y
  objeto, se guarda en caché y se analiza con el mismo analizador. Un solo camino de
  código. Costo: ampliar `programStructure.ts` para que extraiga parámetros, tipos, valores y
  comentarios, y alcance de variables locales.
- **B. Vistas del catálogo (`ALL_ARGUMENTS`, `ALL_PROCEDURES`).** Firmas ya armadas, pero sin
  valores de constantes ni comentarios: igual habría que leer la fuente. Dos caminos. Descartado.
- **C. PL/Scope (`ALL_IDENTIFIERS`).** Preciso, pero exige recompilar con
  `PLSCOPE_SETTINGS`, o sea escribir en la base. Descartado.

### Piezas

1. **Analizador de símbolos** (`programSymbols.ts`, nuevo, sobre `tokenize` de
   `programStructure.ts`). Entrada: texto. Salida: lista de símbolos con tipo, nombre,
   firma, tipo de dato, valor declarado, comentario, rango de la declaración y rango del
   bloque donde vale (para locales y parámetros). Funciones puras, con tests.
2. **Resolución** (`symbolResolve.ts`, nuevo). Dado un documento, una posición y el
   `editorReference` del nombre: busca primero en el alcance local, después en el paquete
   (spec + body abiertos), después en otros objetos (`editorObject` del catálogo + fuente
   en caché). Devuelve símbolos candidatos con su ubicación (objeto, parte, posición).
   Nombres de hasta tres partes y con índice (`esquema.pkg.rutina`, `registro.campo`,
   `t_tab(i).campo`): `editorReference` hoy corta en dos partes y debe ampliarse. Orden para
   desambiguar: local o registro, después paquete, después esquema.
3. **Caché de fuentes** por sesión y objeto, invalidada al compilar ese objeto desde la app,
   al refrescar el explorador y al reconectar.
4. **Extensiones de CodeMirror** en `ProgramEditor`: `hoverTooltip` para la ficha, manejo de
   Ctrl+clic y marca visual con Ctrl apretado. La ficha es un componente con los estilos del
   tema (IBM Plex Mono para firmas).
5. **Navegación**: reutiliza `navigateAt` y `declarationMenu` de `ProgramWindow`, y la
   apertura de programa del catálogo para otros objetos.

### Decidido por el usuario

- Enfoque A.
- Hover sobre constantes y variables: tipo y valor declarado. Nada de valor de sesión.
- Ctrl+clic a la definición; opciones de ir a la definición y a la declaración.
- Alcance: paquetes, ventanas SQL y "etc." (todo editor de código de la app).
- Campos de registros, `%ROWTYPE`, `%TYPE`, cursores y columnas con alias, en la primera versión.

### Decisiones mías (corregibles)

- Paquete abierto con cambios sin guardar: hover y navegación usan el texto del editor
  abierto, no la caché. Hace falta un registro de documentos abiertos compartido entre ventanas.
- Las consultas de catálogo y fuente para el hover van por la conexión principal, no por la
  sesión de la ventana, para no esperar a una consulta larga. La caché se indexa por conexión.
- Ctrl+clic o F12 sobre tabla, vista o sinónimo a tabla: abre "Describir".
- Ventanas SQL y de prueba tienen el mismo menú contextual y la misma navegación. Primero se
  extrae `navigateAt`, `declarationMenu` y `EditorObjectMenu` de `ProgramWindow` a código
  compartido.
- Sin body o sin privilegio para leerlo: "Ir a la implementación" va a la declaración y
  muestra el aviso "Cuerpo no disponible".
- La parte 1 sale sola (rama, PR y versión beta propias), junto con el arreglo del menú Nuevo.
- Hover tras ~400 ms; ficha cerrada al tipear.
- Comentario de documentación = el bloque de comentario pegado arriba de la declaración.
- Fuente envuelta o sin privilegio: "fuente no disponible", sin fallback a catálogo.
- F12 cambia de "declaración" a "definición".

### Queda para el builder

- Estructura interna de los módulos y nombres exactos.
- Cómo mostrar la consulta de un cursor recortada (largo máximo).
- Orden de las tareas dentro del plan, siempre con la parte 1 primero.
