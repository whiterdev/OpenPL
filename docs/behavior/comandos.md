# Consola de comandos

Nuevo → Ventana de comando abre una sesión propia. La entrada `SQL>` envía con Enter y recupera el historial con ↑ y ↓. El editor permite ejecutar bloques o scripts de varias líneas y los resultados se pueden examinar en la grilla. La salida de la consola se presenta como texto y conserva las órdenes y mensajes de la sesión.

La consola implementa un subconjunto SQL*Plus local: `PROMPT`, `SET ECHO`, `SET SERVEROUTPUT` y `CLEAR SCREEN`. Las órdenes que quedan fuera del subconjunto se indican en la salida. Las transacciones usan los controles de la aplicación.
