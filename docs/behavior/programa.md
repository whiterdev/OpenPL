# Ventana de programa

La observación previa por uso normal está en [observaciones-referencia.md](observaciones-referencia.md#ventana-de-programa-paquete).

- **Abrir** (Enter o doble clic) y **Ver** muestran la fuente. **Editar** habilita un borrador local. Los programas abiertos aparecen en pestañas identificadas por objeto y conexión.
- Un paquete abre una ventana con **Spec** y **Body**. Se alternan con Alt+S y Alt+B. Ctrl+\ permite ver ambos. Un paquete sin cuerpo sigue abriendo su Spec.
- La estructura sigue la parte activa. Los problemas obtenidos del diccionario indican línea y columna. Seleccionar una entrada lleva al editor.
- **Programa** en la barra superior o **Archivo → Nuevo programa** abre un borrador. **Abrir programa** acepta archivos UTF-8 con extensión `.pks`, `.pkb` o `.sql`. El editor usa saltos de línea LF.
- **Guardar** abre el selector del sistema y escribe la parte activa en un archivo local. Si se cancela el selector, el borrador conserva su estado. Cerrar la pestaña o la aplicación pide confirmación si hay cambios.
