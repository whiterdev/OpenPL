# Auditoría con emil-design-eng

Revisión de código de controles compartidos, menús, paleta, consola, paneles y diálogos. Los paneles de trabajo y la paleta abren sin animaciones. No se encontraron transiciones de layout ni entradas con escala cero en las hojas de estilo revisadas.

| Antes | Después | Motivo |
| --- | --- | --- |
| Los botones tenían hover y foco, pero no respuesta al presionar. | Los botones compartidos dan feedback inmediato. La escala se omite con movimiento reducido. | Confirmar la pulsación sin retrasar la acción. |
| El menú principal no enfocaba su primera acción ni devolvía el foco al cerrar con Escape. | Las flechas abren y recorren las acciones disponibles. Escape devuelve el foco al disparador. | Mantener el control del flujo con teclado. |
| La barra principal fijaba el ancho de los desplegables. | El menú conserva un mínimo y crece según rótulo y atajo. | Mantener una fila por acción. |

**PASS** de revisión de código. **FAIL** de verificación visual en la aplicación instalada con Oracle, pendiente.
