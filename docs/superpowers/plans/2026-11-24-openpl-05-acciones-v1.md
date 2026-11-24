# Opciones pendientes para OpenPL 1.0

Cada entrega va en su rama. El cierre integra por PR y compila desde `main`. Las pruebas de los agentes usan mocks y solo lectura segura de metadatos. Las operaciones administrativas se preparan para revisión en el editor SQL.

1. **Consola:** ampliar `SqlWindow` con entrada interactiva, historial y transcripción. Registrar Nuevo y el atajo. Probar ejecución, salida y comandos locales con IPC simulado.
2. **Paleta:** presentar las acciones disponibles de `keymap.ts` con filtro y navegación de teclado. Probar selección, Escape y el atajo.
3. **Plan:** usar la sentencia bajo el cursor y devolver el plan en la misma ventana mediante un comando de Oracle para el usuario. Verificar los metadatos y aislar su transacción de la ventana.
4. **Explorador:** conectar descripción, propiedades, comparación, privilegios, generación de borradores para alta, edición de usuarios, renombre y eliminación. Conectar exportación CSV. Probar las acciones con catálogo y archivos simulados.
5. **Integración:** pruebas completas, auditoría de interfaz, CI del PR y compilación final de Windows y Linux.
