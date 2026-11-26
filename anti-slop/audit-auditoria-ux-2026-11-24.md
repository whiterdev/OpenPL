# Auditoría antislop de la rama `feat/auditoria-ux`

Alcance: lo que cambiaron los briefs 1 a 59 del [plan de auditoría UX](../docs/superpowers/plans/2026-11-25-openpl-auditoria-ux.md).
Base: el código actual de la rama, sus pruebas automáticas y `contrast-check.py` de antislop-human.
La app no se abrió durante la rama. Lo marcado **no verificado en la app real** solo tiene
cobertura de tests o de lectura de código.

Lectura de diseño (de [DESIGN.md](../DESIGN.md)): IDE de escritorio para desarrolladores PL/SQL,
paneles rectos, diales ENERGY 1 / RHYTHM 1 / MOTION 1. La rama no agrega color, tipografía,
sombra ni animación nuevos; DESIGN.md no cambia.

## Contraste medido

| Par | Uso | Razón | Resultado |
|---|---|---|---|
| `--accentText` `#1e1a12` sobre `--accent` `#c99a3b` | Celda activa de la grilla (Grafito) | 6,74:1 | PASS |
| `#f4f6fa` sobre `#385880` | Celda activa de la grilla (Papel) | 6,75:1 | PASS |
| `--text` `#dad5cc` sobre `--s3` `#3d4047` | Rango seleccionado (Grafito) | 7,10:1 | PASS |
| `#202833` sobre `#cfd5de` | Rango seleccionado (Papel) | 10,07:1 | PASS |
| `--accent` `#c99a3b` sobre `--s0` `#212327` | Prompt de consola con foco (Grafito) | 6,12:1 | PASS |
| `#385880` sobre `#e7e9ed` | Prompt de consola con foco (Papel) | 6,01:1 | PASS |
| `--text` sobre `--errSoft` `#3e2526` | Franja de producción (Grafito) | 9,60:1 | PASS |
| `#202833` sobre `#ecd6d0` | Franja de producción (Papel) | 10,69:1 | PASS |

Medianoche, Bosque y Alto contraste no se midieron en esta auditoría: usan los mismos tokens y
`themes.ts` avisa cuando un par baja del mínimo. **No verificado en la app real.**

## Por área

### Teclado y atajos (briefs 1, 5, 50, 59)

- **R-32 PASS (tests).** Las teclas sin acción ya no se bloquean (Ctrl+A, Ctrl+Shift+End,
  Shift+F10) y las del webview siguen bloqueadas (`keymap.test.ts`, `App.test.tsx`). Alt abre
  la barra de menús y ← → cambian de menú (`MenuBar.test.tsx`). **No verificado en la app real.**
- **R-26 PASS (código).** Todo atajo nuevo tiene acción o queda sin efecto a propósito (consola
  sin F8, F5, Ctrl+S, Ctrl+E y Ctrl+Shift+X). Los atajos viven solo en `keymap.ts`.
- **R-39 PASS (código).** Los ítems deshabilitados de la barra de menús dicen el motivo en `title`.

### Editor (briefs 3, 4, 6, 7, 8)

- **R-32 PASS (tests).** El menú contextual abre con Shift+F10 y la tecla Menú, anclado al
  cursor. El foco vuelve al editor al activar la pestaña y al cerrar la descripción.
  **No verificado en la app real**: es una de las pruebas manuales pendientes.
- **R-26 PASS (tests).** Cortar, Copiar y Pegar se deshabilitan cuando no aplican; nada queda
  habilitado sin acción.
- **C-4, rendimiento.** Los tests con fuente grande confirman que tipear no convierte el
  documento a texto por tecla. **No medido**: la fluidez real queda para el usuario.

### Conexión y sesiones (briefs 9 a 13, 58)

- **R-27 PASS (tests).** El diálogo tiene carga ("Conectando…", botón deshabilitado), error
  visible (incluida la carga de perfiles) y cancelación. Las pestañas SQL caídas muestran su
  estado con texto ("Sesión caída") y una acción para reconectar.
- **R-32 PASS (tests).** `useFocusTrap` cicla Tab y Shift+Tab, cierra con Escape y devuelve el
  foco en los diálogos de conexión y temas. **No verificado en la app real.**
- **Color solo.** El estado de sesión y el de producción siempre llevan texto. PASS.

### Explorador (brief 14)

- **R-32 PASS (tests).** Un solo punto de tabulación, flechas, Inicio y Fin, roles `tree` y
  `treeitem` con nivel y estado expandido. El foco usa el contorno global de `theme.css`.
- **R-39 PASS (código).** Los botones deshabilitados de la cabecera llevan "Próximamente" en
  `title` y `aria-describedby`.

### Ventana SQL y SQL*Plus (briefs 15 a 27, 42 a 47)

- **R-27 PASS (tests).** Los errores muestran código, mensaje y "Línea X, columna Y"; el bloque
  que falla muestra antes su salida. Los comandos no admitidos lo dicen con el nombre completo.
- **R-26 PASS (tests).** Commit y Rollback se deshabilitan mientras hay una operación SQL, en
  lugar de quedar activos sin efecto.
- **R-38 PASS.** La confirmación de producción y el aviso de cambios sin aplicar dicen lo que
  pasa con cifras reales del estado ("Hay N cambios sin aplicar").
- Ejecución contra Oracle (fechas, LOB, bloque que falla, OUT): **no verificado con base**.

### Grilla (briefs 28 a 34, 48, 49)

- **Selección sin borde de color PASS (código).** Rango con fondo `--s3`, celda activa con fondo
  `--accent` (`SqlWindow.css:84-85`). Sin franjas ni marcos de acento. El borde de acento que
  queda es el del campo de edición de celda, que es un campo.
- **R-27 PASS (tests).** Totales parciales, "Ordenado sobre N filas cargadas", aviso de copia con
  filas pendientes y visor que avisa del tope de LOB.
- **R-32 PASS (tests).** RePág, AvPág, Ctrl+Inicio y Ctrl+Fin; Shift+flechas extienden; el botón de
  orden de cada encabezado responde a Enter; Shift+Space abre el visor, que atrapa el foco. **No verificado en la app real.**
- **R-25 PASS (medido).** Ver la tabla de contraste.

### Consola (briefs 35 a 41, 51)

- **R-32 PASS con reemplazo.** El textarea quita el contorno (`CommandConsole.css:9`) y lo
  reemplaza con el prompt en color de acento y el cursor de acento, medidos arriba. Es una
  terminal: el indicador es la línea activa, no una caja.
- **R-27 PASS (tests).** Carga con "Ejecutando N s", error con código, línea, columna y `^`, tope
  de 500 filas que se anuncia, recorte de transcripción con la cantidad omitida.
- **Foco PASS (tests).** El foco vuelve al prompt al montar, al activar la pestaña, al terminar y
  al volver a la ventana. **No verificado en la app real.**

### Pestañas, archivos y espacio de trabajo (briefs 53 a 57)

- **R-26 PASS (tests).** Restaurar y Descartar hacen lo que dicen; soltar un tipo no admitido
  avisa con el nombre del archivo.
- **R-32 PASS (tests).** Reordenar tiene atajo además del arrastre.
- Arrastre real en Windows y restauración con un perfil real: **no verificado en la app real**.

### Avisos (brief 52)

- **R-27 PASS (tests).** Un error queda hasta cerrarlo y un aviso informativo no lo reemplaza.
- **R-39 PASS (código).** El botón de cierre es solo ícono y tiene `aria-label="Cerrar aviso"`.

## Delivery Gate

| Regla | Resultado | Evidencia |
|---|---|---|
| R-02 sin em dash | PASS | Búsqueda en los textos nuevos y en esta documentación. |
| R-17, R-18, R-36, R-38 sin datos inventados | PASS | Los textos muestran conteos del estado real. Ejemplos con `HR` y `DEVPDB`. |
| R-23 sin recursos nuevos | PASS | No hay logos, avatares ni imágenes nuevas. |
| R-24, R-26 sin controles muertos | PASS | Ver áreas. Lo pendiente se deshabilita con motivo. |
| R-25 contraste | PASS en Grafito y Papel | Medido. Los demás temas, sin medir. |
| R-27 estados | PASS | Carga, vacío y error en diálogo, grilla, consola y avisos. |
| R-32 teclado y foco | PASS en tests | Sin recorrido en la app real. |
| R-33 sin parches por script | PASS | Cambios en el código fuente. |
| R-34 temas | PASS en tokens | Ningún color suelto nuevo; todo sale de tokens. |
| R-35 verificar antes de entregar | FAIL de verificación | No hubo recorrido de clics en la app real. Queda en las pruebas manuales de [ESTADO](../docs/ESTADO.md). |
| R-37 dirección | PASS | DESIGN.md, sin cambios de reglas. |
| R-39 semántica | PASS en código | Nombres accesibles, `title` en deshabilitados, roles de árbol. |
| R-01 a R-22 técnicas | PASS | Sin gradientes, brillos, sombras ni animaciones nuevas. |
| Liveliness | PASS | Diales 1/1/1 sostenidos; el ocre sigue como único acento. |

La rama no se integra hasta que el usuario cierre el R-35 con el recorrido manual.
