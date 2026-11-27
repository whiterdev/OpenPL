# Auditoría antislop del editor inteligente

Alcance: ficha de símbolo (`SymbolCard`, `.cm-symbol-tooltip`), subrayado de Ctrl+clic
(`.cm-symbol-link`) y los ítems nuevos del menú contextual. Skills: `antislop`, `antislop-ui`,
`antislop-human`.

- **PASS, contraste de texto.** Medido con `contrast.ts` sobre `--s1`, fondo de la ficha:

  | Tema | `--text` | `--muted` |
  |---|---|---|
  | grafito | 9.83 | 6.35 |
  | papel | 11.66 | 5.66 |
  | medianoche | 11.83 | 7.30 |
  | bosque | 10.84 | 6.90 |
  | alto-contraste | 19.80 | 13.62 |

- **PASS con nota, borde.** `--line2` sobre `--s1` queda entre 1.32 y 1.46 (4.61 en alto
  contraste). Es el mismo borde de menús y diálogos de la app; la ficha además lleva sombra. No es
  un control: no aplica el mínimo de 3:1 de componentes.
- **PASS, tokens.** Sin colores nuevos: `--s1`, `--line`, `--line2`, `--text`, `--muted`,
  `--font-code`. IBM Plex Mono para firmas y tipos.
- **PASS, teclado.** La ficha se abre sin mouse con Ctrl+Shift+Espacio y se cierra con Esc. Los
  tres comandos de navegación tienen atajo en `keymap.ts` y aparecen en el menú contextual con su
  atajo.
- **PASS, no tapa la escritura.** La ficha se abre arriba del nombre, se cierra al escribir o
  mover el cursor y no toma el foco.
- **PASS, estados.** Sin resultado no hay ficha. Fuente no legible: "Fuente no disponible". Sin
  cuerpo: "Cuerpo no disponible". Sin conexión: solo lo local, nunca queda cargando.
- **PASS, copia.** Textos cortos en español: "Sin valor inicial", "Expresión", "Columna",
  "N columnas más", nombres de los comandos.
- **Pendiente, escritorio.** Probar en la app real: pasar el puntero sobre una constante de un
  paquete, Ctrl+clic en una llamada a otro paquete y F12 sobre una tabla en una ventana SQL.
