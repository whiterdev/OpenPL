# Ventana SQL

Observación previa por uso normal: [observaciones-referencia.md](observaciones-referencia.md#ventana-sql-y-grilla).

- **Nueva ventana SQL** (Ctrl N o **Nuevo → Ventana SQL**) necesita una conexión activa. Abre una sesión propia con los mismos datos de la conexión: su transacción y su cancelación no afectan al explorador ni a otras ventanas. La pestaña muestra el color del entorno.
- **Ejecutar** (F8 o Ctrl Enter) ejecuta la selección o, sin selección, la sentencia bajo el cursor. **Ejecutar script** (Shift F8) ejecuta todas en orden y se detiene en el primer error.
- Las sentencias se separan por `;` o por `/` en una línea sola. Los bloques PL/SQL (`DECLARE`, `BEGIN`, `CREATE PROCEDURE`, `FUNCTION`, `PACKAGE`, `TRIGGER`, `TYPE`) terminan solo con `/`. Los comandos SQL*Plus (`SET`, `PROMPT`, `SPOOL`, `@archivo`...) no se envían: aparecen en Salida como omitidos y el script sigue.
- **Variables:** si la sentencia usa `:nombre` o `&nombre`, el panel Variables pide su valor y tipo (Texto, Número, Fecha). Los valores se recuerdan mientras la ventana está abierta.
- **Resultados:** grilla con número de fila; `NULL` se ve distinto de un texto vacío. Se traen 200 filas y más al llegar al final; **Traer todas** completa la consulta. El pie indica filas y tiempo.
- **Salida:** líneas de `DBMS_OUTPUT` de cada ejecución, más los mensajes (filas afectadas, comandos omitidos, errores con código).
- **Historial:** sentencias ejecutadas en la ventana, la más reciente arriba. Clic la vuelve a poner en el editor.
- **Errores:** código y mensaje de Oracle en Salida; la posición se marca en el editor.
- **Cancelar** (Shift Esc) interrumpe la sentencia en curso.
- **Transacción:** la barra superior indica si la ventana activa tiene una transacción abierta. **Commit** (F10) y **Rollback** (Shift F10) actúan sobre esa ventana. Cerrar la ventana con transacción abierta pregunta Commit, Rollback o Cancelar.
- **Editar** (Ctrl E) en Resultados vuelve a ejecutar la consulta con el ROWID oculto y habilita la edición. Solo se edita una consulta sobre una tabla, sin joins, agrupaciones, `DISTINCT`, uniones ni subconsultas en el `FROM`; las columnas que no son de la tabla o de tipos no editables (BLOB, LONG, RAW, objetos) quedan en solo lectura.
- En edición: doble clic, Enter, F2 o escribir edita la celda; Enter confirma y baja, Tab avanza, Escape cancela; Supr deja la celda en NULL; las flechas recorren la grilla y Ctrl C copia la celda. **Agregar fila** suma una fila nueva al final; **Borrar fila** marca la fila seleccionada (otra vez, la recupera). Cada fila cambiada lleva un ícono y un color: modificada, nueva, borrada o en conflicto.
- **Aplicar cambios** (Ctrl Shift Enter) bloquea cada fila tocada con `SELECT ... FOR UPDATE NOWAIT` y compara sus valores con los leídos. Si alguna está bloqueada, cambió o ya no existe, no se aplica nada y el panel Conflictos muestra cada fila con el valor actual: **Reintentar con valores actuales** o **Descartar cambios en conflicto**. Si todo coincide, aplica UPDATE, DELETE e INSERT por ROWID en la transacción de la ventana, sin commit. **Descartar** vuelve a lo leído.
- En una conexión de producción, la edición muestra el aviso "Editando datos de producción".
- **Editar datos** en el explorador (tablas) abre la ventana con `SELECT * FROM esquema.tabla` en edición.
- **Consultar datos** en el explorador (tablas, vistas, vistas materializadas) abre una ventana con `SELECT * FROM esquema.objeto` y la ejecuta.
