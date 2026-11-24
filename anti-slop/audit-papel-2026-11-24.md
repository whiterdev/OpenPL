# Auditoría antislop de Papel y comentarios

- **PASS, jerarquía de lectura.** Para una superficie de lectura prolongada, las guías de Impeccable y Antislop favorecen una paleta contenida. Papel pasa de `#fbfaf7` a `#e9e5dc`. El malva apagado y la cursiva distinguen comentarios de línea y de bloque, con el código base en primer plano.
- **PASS, contraste.** Código y comentarios sobre el editor dan 11,87:1 y 5,13:1 en Papel, y 10,77:1 y 5,32:1 en Grafito. Las pruebas de los cinco temas incluidos cubren también comentario sobre línea activa y sobre las filas agregadas y eliminadas del comparador.
- **PASS automatizado, resaltado.** Una prueba pasa texto SQL por el analizador del editor y verifica los rangos de comentario. El editor se comparte con la ventana SQL. La vista previa de temas también usa cursiva.
- **Pendiente, recorrido visual de escritorio.** Ver → Personalizar interfaz → Papel → abrir un editor SQL o PL/SQL con comentarios de línea y bloque. Revisar la línea activa, la selección y el comparador.
