# Consola de comandos

La ventana es una terminal. La transcripción, las líneas de continuación y el prompt comparten la misma área desplazable. Una sesión nueva empieza con `SQL>` arriba y cada comando terminado deja un prompt inmediatamente debajo de su salida. La ventana SQL es la opción para trabajar con editor y grilla.

El prompt admite SQL en varias líneas y ejecuta al recibir `;` o una línea con `/`. Los bloques PL/SQL se ejecutan al recibir `/` en su propia línea. Escape cancela la entrada en curso. El historial de salida muestra la consulta con encabezados y filas, además de la salida de Oracle.

`EDIT [esquema.]objeto` busca en el catálogo de la conexión de la consola. Las sugerencias muestran nombre y tipo. Las flechas cambian la selección y Enter abre el objeto en una pestaña. Para programas abre el editor y para las demás definiciones prepara su DDL en SQL.

Nuevo → Ventana de comando abre una sesión propia. Enter envía la entrada y ↑ y ↓ recuperan el historial. La salida conserva los comandos y mensajes de la sesión. Si la consulta supera la primera página, Ctrl+Shift+X permite exportar todas las filas mientras el resultado siga activo.

La consola implementa un subconjunto SQL*Plus local: `PROMPT`, `SET ECHO`, `SET SERVEROUTPUT` y `CLEAR SCREEN`. Las órdenes que quedan fuera del subconjunto se indican en la salida. Las transacciones usan los controles de la aplicación.
