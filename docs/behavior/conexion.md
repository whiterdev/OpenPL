# Comportamiento: arranque y conexión

Redactado con palabras propias a partir del diseño (§7.1) y del mockup "4 · Conexión".

## Arranque
- Al abrir, OpenPL comprueba el cliente Oracle.
- Si no lo encuentra (DPI-1047 u otro error de carga): muestra el código, un mensaje corto,
  la ayuda según el sistema operativo y un campo para indicar la carpeta del cliente.
  "Guardar" la recuerda y pide reiniciar; "Reintentar" vuelve a comprobar. Si no se puede
  guardar la carpeta, el error queda a la vista.
- Si lo encuentra, pasa al diálogo de conexión.

## Diálogo de conexión
- Izquierda: perfiles guardados agrupados por entorno (Desarrollo, Calidad, Producción,
  Sin entorno), con buscador. Clic en un perfil rellena el formulario y, si hay contraseña
  guardada, también la contraseña.
- Derecha: Usuario, Contraseña, Base de datos (alias TNS o host:puerto/servicio), Rol
  (Normal, SYSDBA, SYSOPER), Entorno, Nombre del perfil, "Guardar contraseña".
- Botones: Guardar perfil, Eliminar perfil (si el perfil existe, pide confirmación con el
  nombre del perfil), Cancelar (si ya hay una conexión abierta o mientras se conecta),
  Conectar. Enter conecta. El botón Conectar no muestra atajo.
- Al guardar, el nombre del perfil se arma con el usuario y el servicio actuales, como
  `HR en DEVPDB`, si no se escribió otro o si cambiaron el usuario o la base.
- Mientras conecta, el botón dice "Conectando…" y queda deshabilitado. Cancelar deja de
  esperar; si la conexión llega después, se cierra sola. A los 20 s sin respuesta la app
  corta el intento y muestra "No se alcanzó el servidor.".
- Error al conectar: bajo la contraseña, código ORA y texto corto. La contraseña se vacía
  solo cuando el error es de credenciales (ORA-01017, ORA-01005, ORA-01045); con cualquier
  otro error se conserva, igual que el resto de los campos. Cuenta bloqueada (ORA-28000) y
  clave vencida (ORA-28001) tienen su propio mensaje, el segundo con el paso a seguir.
- Si falla la carga de perfiles guardados, el error se ve en el diálogo.
- El foco queda dentro del diálogo: Tab y Shift+Tab recorren sus controles y Escape lo
  cierra cuando se puede cancelar. Al cerrarse, el foco vuelve a donde estaba.
- La contraseña solo se guarda en el almacén seguro del sistema y solo si se marca la casilla.
  Desmarcarla y guardar borra la guardada.

## Barra de conexiones
- En la barra de título: la conexión activa con la franja de color de su entorno, su nombre
  y la versión del servidor. Si la combinación cliente/servidor tiene advertencia, un ícono
  la indica (el texto en el tooltip).
- Si la sesión se pierde: "Desconectado" y botón "Reconectar". Reconectar también reconecta
  las ventanas SQL de esa conexión; si alguna falla, el error queda en su pestaña.
- Al volver a la ventana de la app, OpenPL comprueba la conexión y las sesiones SQL libres,
  como mucho una vez cada 10 s. Una sesión que no responde se marca caída con el motivo.
- **Desconectar** con ventanas SQL que tienen transacción abierta pregunta antes. Al confirmar
  cierra también las sesiones de esas ventanas, que quedan marcadas como desconectadas; los
  programas con cambios no se pierden. Si la desconexión falla, se avisa.
- Al conectar con un perfil que tenía pestañas guardadas aparece "Restaurar N pestañas" con
  Restaurar y Descartar. Restaurar abre los objetos desde Oracle en lectura y las ventanas SQL
  con su texto, sin ejecutarlo. Los archivos locales vuelven como borrador, sin ruta.
  Descartar borra lo guardado. Las pestañas se guardan solas mientras hay un perfil guardado
  conectado; no se guardan consolas, historial ni contraseñas.
- Atajos: Conectar Ctrl Shift L (no se muestra en el botón del diálogo).
