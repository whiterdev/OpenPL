# Dirección de diseño de OpenPL

Fuente de dirección para toda interfaz nueva. Se aplica junto con el filtro antislop (`antislop`, `antislop-ui`, `antislop-human`; `antislop-code` para comentarios). Los valores viven en `app/src/theme.css`; este archivo dice por qué.

**Lectura de diseño:** IDE de escritorio para desarrolladores PL/SQL que pasan el día en el editor, con lenguaje visual sobrio de paneles rectos, diales ENERGY 1 / RHYTHM 1 / MOTION 1.

- **ENERGY 1:** la herramienta no compite con el código. El protagonista de cada pantalla es el editor, la grilla o el árbol.
- **RHYTHM 1:** la uniformidad es una decisión: el usuario reconoce paneles, filas y barras iguales en todas las ventanas.
- **MOTION 1:** solo estados de hover, foco y presionado. Sin animaciones de entrada ni bucles.

## Identidad

- **Motivo propio:** el ocre del logo (base de datos con la tapa abierta) es el único acento. Marca foco, selección principal, el botón primario y la pestaña activa sin entorno. El color del entorno (desarrollo, calidad, producción) reemplaza al ocre en el borde superior de la pestaña y en la franja de la conexión, porque saber contra qué base se trabaja es la información que más errores evita.
- **Temas:** Grafito (oscuro) es el tema por defecto, porque la herramienta se usa jornadas completas frente a código. Hay cinco temas predefinidos: Grafito, Papel (claro), Medianoche, Bosque y Alto contraste (`app/src/themes.ts`). El usuario puede crear temas propios a partir de uno existente; se guardan en `localStorage` del equipo y el tema activo se aplica al arrancar. El botón Sol/Luna de la barra de título alterna entre el último tema oscuro y el último claro usados. **Personalizar interfaz** (Ctrl+,, menú Ver) edita los colores con vista previa en vivo y avisa cuando un par baja del contraste mínimo, sin bloquear. Los umbrales son 7:1 para el texto sobre el editor y 4,5:1 para el texto secundario y la sintaxis. `themes.test.ts` comprueba los avisos de la paleta Papel. Un tema propio se guarda aunque tenga avisos.
- **Colores de entorno fijos:** `--env-dev`, `--env-qa` y `--env-prod` no forman parte de ningún tema ni se editan. Saber contra qué base se trabaja no depende del tema elegido.

## Color

Valores del tema Grafito. Los demás temas redefinen los mismos tokens, salvo los de entorno.

| Token | Valor | Motivo |
|---|---|---|
| `--s0` | `#212327` | Fondo del editor y de la barra superior: la superficie de trabajo, la más oscura. |
| `--s1` | `#282a2f` | Paneles laterales y barras de herramientas. |
| `--s2` / `--s3` | `#34373d` / `#3d4047` | Hover y elemento presionado o seleccionado. |
| `--s-menu` | `#2e3035` | Menús: un paso sobre `--s1` para separarlos del panel que tapan. |
| `--line` / `--line2` | `#17191c` / `#3a3d43` | Divisiones de 1 px entre paneles y bordes decorativos. No sirven para campos. |
| `--field-line` | `#72767e` | Borde de campos de texto: 3.15:1 sobre `--s1`, para que un campo se reconozca como tal. |
| `--text` | `#dad5cc` | Texto principal, cálido para combinar con el ocre. 7.1:1 sobre `--s3`. |
| `--muted` | `#b1aca2` | Texto secundario y atajos. Mínimo 4.59:1 (sobre `--s3`). |
| `--faint` | `#6e6b66` | Solo controles deshabilitados (WCAG los exime). Nunca texto informativo. |
| `--accent` | `#c99a3b` | Ocre del logo. 5.59:1 sobre `--s1`. |
| `--err` | `#ec8478` | Errores y excepciones. 4.62:1 sobre `--s2` (fila en hover). |
| `--env-dev/qa/prod` | verde, ámbar, rojo | Entorno de la conexión. Siempre acompañado de texto. |
| Sintaxis | `--kw`, `--ty`, `--st`, `--nu`, `--cm` | En Grafito los comentarios usan terracota apagada y cursiva, con un contraste de al menos 4,5:1 sobre el editor. |

Papel usa un gris perla (`#e7e9ed`) para el editor, superficies vecinas gris azuladas y acento azul. El código base queda en carbón frío (`#202833`). Las palabras clave en verde `#0b8e4a` y los comentarios en rojo `#f2280d` respetan la paleta elegida por el usuario y muestran avisos de contraste.

Todo par nuevo de texto y fondo se mide con `contrast-check.py` de antislop-human antes de usarlo. Nada de colores sueltos fuera de `theme.css`.

## Tipografía

- **IBM Plex Sans** en la interfaz e **IBM Plex Mono** en código y atajos: misma familia, así el texto de interfaz y el código conviven sin choque. Plex Mono distingue bien `0/O` y `1/l/I`, frecuentes en nombres Oracle. Se empaquetan con la app (sin red).
- Tamaños: 13 px interfaz, 12 a 13 px código, 11 a 11.5 px etiquetas secundarias. Sin mayúsculas con espaciado amplio.

## Forma y espacio

- Filas de 22 a 24 px y barras de 26 a 38 px: densidad de IDE, mucha información visible sin desplazar.
- Radio de 4 px en botones y campos, 3 px en filas, 6 px en menús y diálogos. Nada con forma de píldora.
- Paneles separados por líneas de 1 px, sin tarjetas.

## Estructura del programa

- Cada entrada lleva una insignia cuadrada con la letra de su clase: P procedimiento, F función, C cursor, V variable, N constante, T tipo, E excepción, K paquete, G trigger. Una letra se distingue mejor que un pictograma a 16 px y remite a la palabra clave que se escribe. El color repite el de la sintaxis de esa clase (todas sobre 4.6:1 en hover). El nombre completo de la clase va en el tooltip y en el nombre accesible.

## Sombras

- Solo en capas que flotan sobre el contenido: menús (`0 12px 32px`) y diálogos (`0 24px 60px`). La sombra separa la capa del panel que tapa. Paneles, barras y botones no llevan sombra.

## Íconos

- Phosphor, peso regular, siempre con texto o nombre accesible. Cada tipo de objeto del explorador tiene un ícono y un color por familia (código, datos, seguridad, planificador) para escanear el árbol. Sin íconos decorativos.

## Estados y controles

- Toda vista con datos tiene carga, vacío y error. El vacío dice qué falta y ofrece la acción siguiente. El error muestra el código Oracle y el mensaje en pantalla, con una acción para reintentar.
- Una función que todavía no existe aparece deshabilitada con la marca **Próximamente** (en menús) o en el tooltip (botones de la barra), y lleva `// TODO(plan N)` en el código. No se dejan menús vacíos ni botones sin acción.
- En listas y selectores, evitar franjas de acento laterales y marcos decorativos para marcar selección. Usar un fondo de superficie y, cuando haga falta distinguirla del hover, una marca de verificación. Conservar el estado accesible de selección.
- Foco visible con contorno ocre de 2 px en todo control. Ningún `outline: none` sin reemplazo.
- Cursor de mano en controles habilitados, `not-allowed` en deshabilitados, `col-resize` en divisores.
- Todo comando con atajo, registrado en `app/src/keymap.ts` y visible en menú, botón o tooltip.

## Textos

- Español, cortos, sin frases explicativas en pantalla, sin rayas (—), sin adjetivos de marketing. Los ejemplos usan datos genéricos (`HR`, `PKG_VENTAS`, `db.example.com:1521/DEVPDB`).

## Cierre de cada entrega con interfaz

Correr el Delivery Gate de antislop y dejar el informe PASS/FAIL en la respuesta, con el recorrido de clics de lo que cambió. Revisar selección, hover y foco por separado en cada control afectado y registrar si la comprobación fue visual o automatizada.
