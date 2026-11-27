# Búsqueda, historial y scripts

**Objetivo.** Activar la lupa y el reloj del explorador y expandir scripts configurables con Tab. [Comportamiento](../../behavior/busqueda-historial-scripts.md).

**Restricciones.** Oracle 12.1+, solo consultas existentes de lectura en el catálogo. Sin dependencias nuevas. Sin persistencia del historial ni de valores de binds. Atajos en `keymap.ts`, diálogos con tokens del tema y foco gestionado.

1. **Búsqueda.** Agregar en `App.test.tsx` una prueba que busque un paquete y lo abra. Reutilizar `api.listObjects(sessionId, scope, type, name)` y el flujo de apertura de `App.tsx` desde el diálogo de búsqueda.
2. **Historial.** Agregar una prueba que ejecute SQL simulado, cierre la pestaña y recupere el texto. Publicar cada resultado desde `SqlWindow` mediante `onStatement(sql, ok)`; retener una lista acotada en la app. Abrir una pestaña sin ejecutar al seleccionar.
3. **Auto Replace.** Agregar una prueba de configuración, persistencia y Tab en CodeMirror. Compartir el cálculo de reemplazo entre `ProgramEditor` y `CommandConsole`. Mantener las selecciones y la sangría cuando no hay coincidencia.
4. **Verificación.** Completar los ciclos rojo y verde por comportamiento. Ejecutar TypeScript, Vitest, fmt, Clippy y las pruebas Rust sin credenciales Oracle. Registrar el recorrido de interfaz y el contraste.
