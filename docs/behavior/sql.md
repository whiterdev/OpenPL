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
- **Consultar datos** en el explorador (tablas, vistas, vistas materializadas) abre una ventana con `SELECT * FROM esquema.objeto` y la ejecuta.
