# Ventana SQL

Observación previa por uso normal: [observaciones-referencia.md](observaciones-referencia.md#ventana-sql-y-grilla).

- **Nueva ventana SQL** (Ctrl N o **Nuevo → Ventana SQL**) necesita una conexión activa. Abre una sesión propia con los mismos datos de la conexión: su transacción y su cancelación no afectan al explorador ni a otras ventanas. La pestaña muestra el color del entorno.
- **Ejecutar** (F8 o Ctrl Enter) ejecuta la selección o, sin selección, la sentencia bajo el cursor. **Ejecutar script** (Shift F8) ejecuta todas en orden y se detiene en el primer error.
- Las sentencias se separan por `;` o por `/` en una línea sola. Los bloques PL/SQL (`DECLARE`, `BEGIN`, `CREATE PROCEDURE`, `FUNCTION`, `PACKAGE`, `TRIGGER`, `TYPE`) terminan solo con `/`. Los comandos SQL*Plus (`SET`, `PROMPT`, `SPOOL`, `@archivo`...) no se envían: aparecen en Salida como omitidos y el script sigue.
- **Variables:** si la sentencia usa `:nombre` o `&nombre`, el panel Variables pide su valor y tipo (Texto, Número, Fecha). Los valores se recuerdan mientras la ventana está abierta.
- **Resultados:** la carga inicial muestra hasta 50 filas. **Traer todas** (Ctrl+Shift+End), junto a las pestañas de resultados, usa el cursor abierto para traer las restantes. El desplazamiento recorre las filas cargadas. Las filas alternan dos tonos de grafito y los cambios de edición conservan sus indicadores. El pie indica filas y tiempo.
- El editor ocupa inicialmente el 70 % del espacio que comparte con Resultados. El divisor se puede arrastrar o mover con las flechas cuando tiene foco. Las pestañas abiertas con **Probar** usan la misma distribución.
- F5 muestra un plan estimado de la sentencia SQL bajo el cursor en la pestaña **Plan**. Oracle lo genera en una sesión independiente. La sentencia analizada queda sin ejecutar.
- Si falla la carga de filas restantes, la grilla conserva las filas ya recibidas y muestra el error. F8 vuelve a ejecutar la consulta.
- **Salida:** líneas de `DBMS_OUTPUT` de cada ejecución, más los mensajes (filas afectadas, comandos omitidos, errores con código).
- **Historial:** sentencias ejecutadas en la ventana, la más reciente arriba. Clic la vuelve a poner en el editor.
- **Errores:** código y mensaje de Oracle en Salida; la posición se marca en el editor.
- **Cancelar** (Shift Esc) interrumpe la sentencia en curso.
- **Transacción:** la barra superior indica si la ventana activa tiene una transacción abierta. **Commit** (F10) y **Rollback** (Shift F10) actúan sobre esa ventana. Cerrar la ventana con transacción abierta pregunta Commit, Rollback o Cancelar.
- **Editar** (Ctrl E) en Resultados vuelve a ejecutar la consulta con el ROWID oculto y habilita la edición. Solo se edita una consulta sobre una tabla, sin joins, agrupaciones, `DISTINCT`, uniones ni subconsultas en el `FROM`; las columnas que no son de la tabla o de tipos no editables (BLOB, LONG, RAW, objetos) quedan en solo lectura.
- La esquina superior izquierda (Ctrl+A con foco en la grilla) selecciona las filas cargadas. El número de fila selecciona esa fila. El menú contextual copia la selección como texto tabulado o CSV y suma las columnas numéricas de las filas seleccionadas. Ctrl+C copia la selección o la celda activa.
- En edición: doble clic, Enter, F2 o escribir edita la celda; Enter confirma y baja, Tab avanza, Escape cancela; Supr deja la celda en NULL y las flechas recorren la grilla. **Agregar fila** agrega una fila vacía al final. **Borrar fila** marca la fila del cursor y **Borrar selección** marca las filas seleccionadas. Los cambios esperan **Aplicar cambios**.
- **Aplicar cambios** (Ctrl Shift Enter) bloquea cada fila tocada con `SELECT ... FOR UPDATE NOWAIT` y compara sus valores con los leídos. Si alguna está bloqueada, cambió o ya no existe, no se aplica nada y el panel Conflictos muestra cada fila con el valor actual: **Reintentar con valores actuales** o **Descartar cambios en conflicto**. Si todo coincide, aplica UPDATE, DELETE e INSERT por ROWID en la transacción de la ventana, sin commit. **Descartar** vuelve a lo leído.
- En una conexión de producción, la edición muestra el aviso "Editando datos de producción".
- **Editar datos** en el explorador (tablas) abre la ventana con `SELECT * FROM esquema.tabla` en edición.
- **Consultar datos** en el explorador (tablas, vistas, vistas materializadas) abre una ventana con `SELECT * FROM esquema.objeto` y la ejecuta.
