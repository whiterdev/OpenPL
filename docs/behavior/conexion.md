# Comportamiento: arranque y conexión

Redactado con palabras propias a partir del diseño (§7.1) y del mockup "4 · Conexión".

## Arranque
- Al abrir, OpenPL comprueba el cliente Oracle.
- Si no lo encuentra (DPI-1047 u otro error de carga): muestra el código, un mensaje corto,
  la ayuda según el sistema operativo y un campo para indicar la carpeta del cliente.
  "Guardar" la recuerda y pide reiniciar; "Reintentar" vuelve a comprobar.
- Si lo encuentra, pasa al diálogo de conexión.

## Diálogo de conexión
- Izquierda: perfiles guardados agrupados por entorno (Desarrollo, Calidad, Producción,
  Sin entorno), con buscador. Clic en un perfil rellena el formulario y, si hay contraseña
  guardada, también la contraseña.
- Derecha: Usuario, Contraseña, Base de datos (alias TNS o host:puerto/servicio), Rol
  (Normal, SYSDBA, SYSOPER), Entorno, Nombre del perfil, "Guardar contraseña".
- Botones: Guardar perfil, Eliminar perfil (si el perfil existe), Cancelar (si ya hay una
  conexión abierta), Conectar. Enter conecta.
- Error al conectar: bajo la contraseña, código ORA y texto corto. Se vacía la contraseña;
  el resto de los campos se mantiene.
- La contraseña solo se guarda en el almacén seguro del sistema y solo si se marca la casilla.
  Desmarcarla y guardar borra la guardada.

## Barra de conexiones
- En la barra de título: la conexión activa con la franja de color de su entorno, su nombre
  y la versión del servidor. Si la combinación cliente/servidor tiene advertencia, un ícono
  la indica (el texto en el tooltip).
- Si la sesión se pierde: "Desconectado" y botón "Reconectar".
- Atajos: Conectar Ctrl Shift L.
