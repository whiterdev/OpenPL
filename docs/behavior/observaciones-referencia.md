# Observaciones de la herramienta de referencia

Fecha: 2026-11-23. Observación por uso normal (versión 16, 64 bits) sobre una
base de desarrollo Oracle 12c. Sin inspeccionar el binario
ni copiar recursos: solo qué hace la interfaz y qué fricciones tiene, para decidir
qué conservar y qué mejorar en OpenPL.

## Estructura general

- Cinta de opciones (ribbon) arriba, con pestañas por área: Archivo, Proyecto,
  Editar, Sesión, Herramientas, Configurar, Ver, Ayuda, Plug-ins. Gran parte del
  alto útil se va en la cinta.
- Panel de objetos a la izquierda: selector de usuario (usuario actual / otros),
  selector de alcance ("todos los objetos"), caja de filtro y un árbol de
  carpetas por tipo (objetos recientes, papelera, funciones, procedimientos,
  paquetes, cuerpos de paquete, tipos, triggers, tablas, índices, vistas,
  secuencias, usuarios, roles, sinónimos, jobs, etc.). Paquetes y cuerpos de
  paquete aparecen como carpetas separadas.
- Ventanas abiertas como pestañas en una sola fila, cada una con el nombre del
  objeto y la conexión (`OBJETO@CONEXION`).
- Barra de estado inferior: posición del cursor, conexión activa y el resultado
  de la última acción ("15 filas en 0,028 s").

## Ventana de programa (paquete)

- Dos sub-pestañas con **el mismo nombre** (spec y body) que solo se distinguen
  por el icono. Fácil confundirlas. → OpenPL: rotular "Spec" y "Body".
- Panel "contenido del código" a la izquierda del editor: lista de
  funciones/procedimientos/declaraciones del paquete, con orden alfabético
  opcional. Clic navega.
- Barra de navegación encima del editor que muestra dónde está el cursor
  (declaración / función).
- Editor con números de línea, plegado de código y resaltado de sintaxis.
- El menú contextual de un elemento del panel de contenido ofrece "Probar".
  Si el elemento es **privado** (solo en el body), la herramienta muestra un
  diálogo de error ("no existe dentro del paquete") y **aun así abre una
  ventana de prueba vacía**. → OpenPL: deshabilitar "Probar" para elementos
  privados y explicar por qué antes de que el usuario haga clic.

## Menú contextual de un paquete en el explorador

Ofrece, entre otras: nuevo, refrescar, copiar nombres separados por coma,
propiedades, describir, ver, editar, ver spec y body, editar spec y body,
eliminar, navegar, recompilar, agregar información de depuración, recompilar
objetos dependientes, comparar con, obtener DDL (DBMS_METADATA), agregar a una
carpeta propia, generar documentación. → v1 de OpenPL: editar, recompilar,
describir, copiar nombre, refrescar; el resto en fases posteriores.

## Ventana SQL y grilla

- Sub-pestañas: SQL, Salida, Estadísticas.
- Barra de la grilla con: candado "Editar datos", insertar fila, borrar fila,
  aplicar (post), traer siguiente/última página, refrescar, buscar, limpiar,
  vista de un solo registro, filtro, orden, exportar, gráfico.
- La grilla pinta filas alternadas y celdas nulas con fondo amarillo claro; las
  columnas largas tienen un botón "…" para abrir un editor.
- El encabezado de cada columna tiene un botón propio (filtro/orden por
  columna).
- Los íconos de la barra no tienen texto; hay que pasar el mouse para saber qué
  hace cada uno. → OpenPL: texto en las acciones principales (Editar, Aplicar
  cambios, Commit, Rollback) e íconos solo en las secundarias.

## Ventana de prueba

- Sub-pestañas: script de prueba, salida DBMS_OUTPUT, estadísticas, profiler,
  trace.
- Barra de ejecución y depuración (ejecutar, paso a paso, etc.).
- Editor del bloque de prueba arriba y tabla de variables abajo (variable,
  tipo, valor).

## Command Window

- Sub-pestañas: Diálogo (consola tipo SQL*Plus) y Editor.
- Al abrir muestra versión del servidor y usuario conectado; ejecuta un script
  de login. `EDIT objeto` abre el objeto en una ventana de programa.

## Sesión

- Cinta "Sesión": conectar, desconectar, conexión principal, cambiar
  contraseña, ejecutar, commit, rollback (deshabilitados si no hay transacción),
  interrumpir, matar, SQL trace.
- El estado de transacción no se ve fuera de esa cinta. → OpenPL: indicador
  permanente de transacción abierta.

## Resumen: qué conservar y qué mejorar

| Conservar | Mejorar en OpenPL |
|---|---|
| Spec y Body en pestañas separadas | Rotularlas, no depender del icono |
| Panel de contenido del paquete | Marcar público/privado |
| `OBJETO@CONEXION` en cada pestaña | Color por entorno en pestaña y barra |
| Candado para editar datos | Acciones con texto, vista previa del SQL a aplicar |
| Tabla de variables en pruebas | No ofrecer pruebas de elementos privados |
| Commit/Rollback a mano | Estado de transacción siempre visible |
| Densidad alta de información | Menos espacio para la cinta, más para el código |
