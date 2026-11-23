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
