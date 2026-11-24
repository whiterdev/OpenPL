# Cierre de OpenPL v1

El flujo visible parte del editor y la grilla de variables de OpenPL, según [la nota de comportamiento](../../behavior/prueba.md). El código generado se ejecuta solo a petición del usuario desde su sesión SQL independiente. Los agentes verifican con mocks y pruebas unitarias. Las ejecuciones con efecto lateral y la calificación de instaladores se validan por separado.

1. Estabilizar la prueba de apertura SQL en `App.test.tsx` sincronizando la carga de módulos en el montaje de pruebas. Conservar los asserts de teclado, sesión, transacción y cierre.
2. Ampliar `routineTest.ts` y `SqlWindow.tsx` para representar el parámetro opcional, la devolución y las salidas. Regenerar solo bloques sin ediciones manuales. Para tipos compuestos nombrados, preparar declaraciones locales para que el usuario las inicialice.
3. Extender la ejecución SQL con salidas tipadas y cursores acotados en `openpl-core`, IPC y frontend. Usar la misma infraestructura de salida, cancelación y transacción. Probar el despacho y la presentación con mocks y la preparación del bloque con firmas sintéticas.
4. Conectar **Probar** desde el explorador y **Nueva prueba**. Reusar el diálogo de archivos para guardar y abrir `.tst`, con formato versionado, validación y sin configuración de conexión ni secretos. Conservar los valores en memoria durante la sesión.
5. Correr las cinco verificaciones de OpenPL, auditar la interfaz y compilar los paquetes que permita el entorno. Registrar las verificaciones manuales de Oracle y el estado de CI antes de cerrar la v1.
