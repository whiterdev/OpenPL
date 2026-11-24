# Comportamiento: explorador de objetos

Redactado con palabras propias a partir del diseño (§7.3) y del mockup "1 · Ventana de programa".

- Panel izquierdo. Cabecera con íconos Objetos / Buscar / Historial (en v1 solo Objetos) y el
  selector Míos / Todos.
- Caja de filtro: "contiene", sin distinguir mayúsculas; `_` y `%` se buscan literalmente.
  Vuelve a consultar 300 ms después de dejar de escribir.
- Árbol por tipo, en este orden: Paquetes, Procedimientos, Funciones, Triggers, Tipos,
  Tablas, Vistas, Secuencias, Sinónimos. Nada se consulta hasta expandir un tipo.
- Cada objeto: ícono teñido por tipo, nombre tal como está en el diccionario (con dueño
  delante en "Todos": `HR.PKG_A`), y "inválido" en rojo si el spec o el body no compilan.
  Contador de objetos junto a cada tipo una vez cargado.
- Doble clic o Enter sobre un objeto lo abre (en v1 avisa que la edición llega después).
- Refrescar (Ctrl R) vuelve a consultar los tipos expandidos.
- Si la conexión se pierde al consultar, la barra de conexión pasa a "Desconectado".
- Listas largas (miles de objetos) se dibujan virtualizadas para no trabar la ventana.

## Menú contextual (clic derecho)

Observado en la herramienta de referencia y adaptado. Las opciones de ventanas que aún no
existen se ven deshabilitadas para que se sepa dónde estarán.

- **Objeto:** **Abrir** (Enter) · **Ver / Editar** (paquetes y tipos: Ver / Editar Spec y Body;
  procedimientos, funciones y triggers) · Probar (Ctrl T, paquetes, procedimientos y funciones) ·
  **Consultar datos** / **Editar datos** (Ctrl E) / Exportar datos (ver "Por tipo") · Describir · Propiedades ·
  **Recompilar** (código, vistas, Java; en producción pide confirmación) · **Copiar DDL**
  (DBMS_METADATA) · Comparar con… · **Copiar nombre** (Ctrl C) · **Copiar nombre con esquema** ·
  Renombrar (tablas, vistas, secuencias, sinónimos) · Eliminar · **Refrescar** (Ctrl R).
- Por tipo (`app/src/objectMenu.ts`):
  - Tabla: **Consultar datos** abre una ventana SQL con `SELECT t.* FROM "DUEÑO"."NOMBRE" t`;
    **Editar datos** (Ctrl E) usa la misma consulta en modo edición. Exportar datos, deshabilitado.
  - Vista y vista materializada: **Consultar datos** con la misma consulta. Editar datos se ve
    deshabilitado: no hay un ROWID útil para editar filas.
  - Usuario: Editar usuario y Privilegios, deshabilitados (Próximamente), y **Copiar DDL**.
- **Carpeta de tipo:** Expandir / Contraer · Nuevo… · **Copiar nombres separados por coma** ·
  **Refrescar**.
- En negrita: habilitado hoy. Al recompilar o copiar el DDL aparece un aviso breve.
