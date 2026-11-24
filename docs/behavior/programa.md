# Ventana de programa

La observación previa por uso normal está en [observaciones-referencia.md](observaciones-referencia.md#ventana-de-programa-paquete).

- **Abrir** (Enter o doble clic) y **Ver** muestran la fuente. **Editar** habilita un borrador local. Los programas abiertos aparecen en pestañas identificadas por objeto y conexión.
- Un paquete abre una ventana con **Spec** y **Body**. Se alternan con Alt+S y Alt+B. Ctrl+\ permite ver ambos. Un paquete sin cuerpo sigue abriendo su Spec.
- La estructura sigue la parte activa. Los problemas obtenidos del diccionario indican línea y columna. Seleccionar una entrada lleva al editor.
- **Programa** en la barra superior o **Archivo → Nuevo programa** abre un borrador. **Abrir programa** acepta archivos UTF-8 con extensión `.pks`, `.pkb` o `.sql`. El editor usa saltos de línea LF.
- **Guardar** abre el selector del sistema y escribe la parte activa en un archivo local. Si se cancela el selector, el borrador conserva su estado. Cerrar la pestaña o la aplicación pide confirmación si hay cambios.
- **Clic derecho** sobre un identificador o **Alt+Enter** en el cursor abre sus acciones de objeto cuando el diccionario lo reconoce. **Describir** muestra el nombre, tipo y nulabilidad de las columnas de tablas y vistas. **Ver fuente** abre objetos PL/SQL en otra pestaña si corresponde. También se puede copiar el nombre o el DDL.
- La búsqueda usa la sesión del programa. Para un archivo local usa la conexión activa. Acepta nombres como `VENTAS`, `HR.VENTAS` y `"Ventas 2026"`. La búsqueda contempla sinónimos privados o públicos con destino local directo. Los alias de consulta, las cadenas de sinónimos y los enlaces remotos quedan pendientes.
- **Comparar con Oracle** (Alt+Shift+D) vuelve a leer la parte activa en la sesión del programa. Señala si la fuente o su marca de DDL cambió desde la apertura y resalta las diferencias de texto con el borrador local. Cerrar la comparación conserva el borrador.
