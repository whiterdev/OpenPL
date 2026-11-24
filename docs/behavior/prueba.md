# Ventana de prueba

Nota de comportamiento escrita con palabras propias. Los puntos marcados "a confirmar" no
están cerrados y no deben tomarse como definitivos.

## Propósito

Ejecutar una rutina (procedimiento o función, suelta o de paquete) o un bloque anónimo
cualquiera sin salir de OpenPL, pasarle valores de entrada y leer lo que devuelve.

## Flujo

1. El usuario elige "Probar" sobre una rutina (ver Puntos de entrada).
2. Si la rutina tiene sobrecargas, OpenPL pregunta cuál probar. La firma se lee del
   diccionario de datos.
3. Se abre una ventana nueva con un bloque anónimo ya armado: la llamada usa parámetros
   nombrados y una variable bind por cada parámetro, más una para el retorno si es una
   función. El bloque es texto común y se puede editar.
4. El usuario completa los valores de entrada en la grilla de variables.
5. F8 ejecuta el bloque en la sesión propia de la ventana.
6. Al terminar, la grilla muestra los valores de salida y la pestaña de salida muestra lo
   que se escribió con DBMS_OUTPUT, junto con el estado y el tiempo de la ejecución.
7. El usuario decide si confirma o deshace con Commit o Rollback. Teclas: a confirmar para
   esta ventana.

## Variables

- **Variables** muestra el nombre, el tipo y el valor de entrada. Las salidas aparecen debajo,
  con su nombre, una vez ejecutado el bloque.
- **Usar** solo se ofrece para entradas con valor predeterminado. Al desmarcarla se omite el
  parámetro de la llamada. Las casillas se deshabilitan si se modifica manualmente el bloque.
- Tipos escalares de v1: VARCHAR2, CHAR, NUMBER, INTEGER, DATE, TIMESTAMP, BOOLEAN y CLOB.
- BOOLEAN se carga como 0/1 y el bloque hace la conversión. Las salidas se muestran como
  TRUE, FALSE o NULL. Las sobrecargas conservan variables locales con el tipo de la firma.

## Registros, colecciones y objetos

Un parámetro de tipo registro, colección u objeto no entra en la grilla. OpenPL lo declara
como variable local en la sección `declare` del bloque, con un comentario `-- completar`
donde el usuario tiene que asignarle valores a mano antes de ejecutar.

## REF CURSOR de salida

Si la rutina devuelve un REF CURSOR, como salida o retorno, **Variables** muestra las primeras
50 filas en una grilla de solo lectura. La interfaz indica si se limitó la vista.

## Transacción

- La ventana tiene su propia sesión, igual que la ventana SQL. La prueba puede modificar
  datos.
- Nada se confirma solo: después de ejecutar, la transacción queda abierta hasta que el
  usuario elige Commit o Rollback.
- Si se cierra la ventana con una transacción pendiente, OpenPL pregunta qué hacer: Commit,
  Rollback o Cancelar (Cancelar deja la ventana abierta).

## Archivo .tst

- El contenido de la prueba se guarda en un archivo `.tst` propio, en texto plano organizado
  por líneas, y se puede volver a abrir.
- Guarda el bloque y los metadatos de los binds. Los valores que se escriben en los campos
  quedan en memoria. El archivo no guarda la conexión ni credenciales.
- **Archivo → Abrir** reabre la prueba en una sesión SQL propia de la conexión activa.

## Puntos de entrada

OpenPL ofrece **Probar** en el explorador, el menú de una declaración pública y **Estructura**.
Un paquete permite elegir una rutina del spec. La acción carga la firma, presenta las
sobrecargas y abre una pestaña **Prueba** con el bloque editable y los argumentos alineados.
**Variables** abre debajo del editor. **Nuevo → Ventana de prueba** abre una prueba vacía.

- "Probar" en el menú contextual del explorador, sobre procedimientos y funciones sueltos o
  de paquete.
- "Probar" en el panel de estructura de la ventana de programa.
- "Probar" se deshabilita en rutinas privadas de un paquete (las que están solo en el
  cuerpo), porque no se pueden llamar desde afuera.
- Abrir una prueba vacía con Ctrl+Alt+T.

## Fuera de v1

Estadísticas de la sesión, profiler, trace y depuración paso a paso.

## Aspecto visual

Pendiente de mockup. Distribución de paneles, proporciones, barra de la ventana y aspecto de
la grilla se definen ahí.

## Enlaces

- Plan: [plan 4, ventana de prueba](../superpowers/plans/2026-11-24-openpl-04-ventana-prueba.md)
- Spec: [diseño de OpenPL, §7.6](../superpowers/specs/2026-11-23-openpl-design.md)
- Decisiones vigentes: [ESTADO](../ESTADO.md)
