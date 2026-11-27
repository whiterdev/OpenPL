# Auditoría de búsqueda, historial y scripts

Dirección de `DESIGN.md`, ENERGY 1, RHYTHM 1 y MOTION 1. Diálogos rectos con componentes y tokens del tema.

| Área | Resultado | Evidencia |
| --- | --- | --- |
| Acciones y estados | PASS automatizado | Lupa, nombre y tipo, Buscar, carga, sin resultados, error, reintento y apertura del paquete. Reloj, historial vacío, Escape, ejecución simulada, cierre de la pestaña y recuperación sin ejecutar. Auto Replace, selección, eliminación, alta, edición, guardado, cierre, recarga y expansión con Tab. |
| Teclado y selección | PASS automatizado y revisión CSS | Foco inicial comprobado en Nombre, Escape cierra el diálogo. El foco usa el contorno global `--accent`. Los scripts seleccionados usan `aria-pressed` y borde de acento. Hover usa superficies del tema y los botones primarios conservan su contraste. Tab expande en el editor y el prompt. |
| Contraste Grafito | PASS medido | Texto sobre campo 10,77:1, texto sobre botones 8,17:1 en reposo y 7,10:1 en hover, texto secundario sobre diálogo 6,35:1 y error 5,56:1. Borde del campo 3,45:1 contra el fondo del campo, por encima del mínimo de 3:1 para controles. |
| Contenido y forma | PASS revisión de código | Etiquetas breves, botones con acción, íconos existentes, ancho acotado al viewport y listas desplazables que envuelven SQL e identificadores largos. Sin activos gráficos nuevos ni animaciones nuevas. |
| Compilación | PASS | Vite y Tauri de depuración generaron la aplicación. |
| Validación visual nativa | Pendiente | Los recorridos se ejecutaron con Vitest y jsdom. Falta la revisión visual en WebView y la consulta de catálogo contra Oracle real. |
