# Consola de comandos

La ventana es una terminal. La transcripción, las líneas de continuación y el prompt `SQL>` comparten la misma área desplazable. El prompt es la última línea de la transcripción, sin caja propia; con foco, el prompt y el cursor toman el color de acento. El foco vuelve al prompt al abrir la consola, al volver a su pestaña o a la ventana y al terminar cada comando. Un clic en cualquier parte de la terminal lo enfoca, salvo que haya texto seleccionado. La salida nueva solo baja la vista si el usuario ya estaba al final; quien sube a leer no pierde su lugar.

El prompt admite SQL en varias líneas y ejecuta al recibir `;` o una línea con `/`. Los bloques PL/SQL se ejecutan al recibir `/` en su propia línea. Cada línea pendiente muestra su número de continuación. Shift+Enter siempre agrega una línea. La sangría escrita se conserva.

↑ y ↓ recuperan el historial solo con el cursor en la primera o la última línea; en el medio mueven el cursor. El historial es de la sesión y no repite el mismo comando seguido.

Mientras corre un comando, la terminal muestra los segundos transcurridos y se puede seguir escribiendo: lo que se envía queda en cola y corre en orden al terminar. Pegar varias líneas equivale a tipearlas: las sentencias completas se ejecutan en orden y lo incompleto queda en el prompt.

Si un comando necesita un valor de sustitución (`&x`), el prompt pasa a "Ingrese valor para x:" y la respuesta no entra al historial. Escape cancela la pregunta.

Teclas propias: Ctrl+C copia la selección o, sin selección y con un comando en curso, lo detiene. Ctrl+L limpia la transcripción. Ctrl+A selecciona el texto del prompt. Escape borra la entrada en curso y, si no hay nada escrito, no hace nada. Los atajos del editor SQL (F8, F5, Ctrl+S, Ctrl+E, Ctrl+Shift+X) no actúan en la consola.

Un SELECT muestra el resultado como texto en columnas, con encabezado y ancho según LINESIZE, PAGESIZE y HEADING, y termina con la cantidad de filas. Trae hasta 500 filas y cierra el cursor; si hay más, lo dice. Un error muestra código, mensaje, línea y columna, y la parte del texto señalada con `^`. La terminal conserva las últimas 2.000 líneas.

`EDIT objeto` busca en el esquema del usuario conectado y muestra los nombres sin prefijo. `EDIT esquema.objeto` busca los objetos visibles de ese esquema y muestra el nombre calificado. Las flechas cambian la selección y Enter abre el objeto en una pestaña. Una tabla abre sus filas en la grilla editable. Un programa abre en el editor y las demás definiciones abren como DDL en SQL.

Nuevo → Ventana de comando abre una sesión propia. Las transacciones usan los controles de la aplicación.

La consola entiende los mismos comandos SQL*Plus que la ventana SQL (SET, SHOW, DEFINE, VARIABLE, PRINT, SPOOL, `@archivo`, DESC y EXEC, ver [sql.md](sql.md)), más `PROMPT`, `REM`, `SET ECHO` y `CLEAR SCREEN`. Lo que queda fuera, como CONNECT, responde "Comando no admitido". En un perfil de producción, lo que escribe pide confirmación antes de ejecutarse.
