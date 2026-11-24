# Consola de comandos

`EDIT [esquema.]objeto` busca en el catálogo de la conexión de la consola. Las sugerencias muestran nombre y tipo. Las flechas cambian la selección y Enter abre el objeto en una pestaña. Para programas abre el editor y para las demás definiciones prepara su DDL en SQL.

Nuevo → Ventana de comando abre una sesión propia. La entrada `SQL>` envía con Enter y recupera el historial con ↑ y ↓. El editor permite ejecutar bloques o scripts de varias líneas y los resultados se pueden examinar en la grilla. La salida de la consola se presenta como texto y conserva las órdenes y mensajes de la sesión.

La consola implementa un subconjunto SQL*Plus local: `PROMPT`, `SET ECHO`, `SET SERVEROUTPUT` y `CLEAR SCREEN`. Las órdenes que quedan fuera del subconjunto se indican en la salida. Las transacciones usan los controles de la aplicación.
