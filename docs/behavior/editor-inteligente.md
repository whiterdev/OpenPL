# Ficha y navegación en el editor

Aplica a la ventana de programa, la ventana SQL y la ventana de prueba. La ventana de comando no
tiene ficha.

## Ficha

- Aparece al dejar el puntero quieto unos 400 ms sobre un nombre. Se cierra al moverlo o al
  escribir. **Mostrar ficha** (Ctrl+Shift+Espacio) la abre en el cursor; Esc la cierra.
- **Rutinas y cursores:** firma completa con modos y tipos de parámetros y `RETURN`. Un cursor
  muestra también las primeras líneas de su consulta.
- **Constantes y variables:** tipo y valor declarado (`:=` o `DEFAULT`). Sin valor declarado
  dice "Sin valor inicial". No se lee el valor que tiene en una sesión.
- **Parámetros, tipos y subtipos:** su declaración.
- **Campos y columnas:** `registro.campo` resuelve el tipo del registro: `%ROWTYPE` de una tabla o
  de un cursor, `RECORD` propio, colecciones (`t(i).campo`) y `%TYPE`. En un SELECT, `alias.columna`
  muestra la columna de la tabla. Una columna de cursor que es una expresión muestra
  "Expresión".
- **Tipos objeto:** `variable.atributo` y `variable.metodo` muestran el atributo o el método del
  tipo (`CREATE TYPE … AS OBJECT` o `UNDER padre`, con lo heredado); un método lleva a su
  implementación en el `TYPE BODY`.
- **Cursores de otro paquete:** `pkg.cursor%ROWTYPE` resuelve las columnas de ese cursor.
- **Tablas y vistas:** todas las columnas con tipo y `NOT NULL`. Se puede desplazar la ficha cuando la lista supera su altura.
- Cada ficha dice dónde está la declaración (línea, y objeto y parte si es de otro objeto) y el
  comentario pegado arriba de ella o al final de su línea.
- Las sobrecargas muestran una ficha por firma.
- Un objeto con la fuente envuelta (`wrapped`) o sin permiso de lectura dice "Fuente no disponible".
  Si solo el cuerpo está envuelto, la ficha usa la spec.

## Orden de búsqueda

1. Declaraciones locales visibles en el cursor: la más interna gana sobre una global con el
   mismo nombre.
2. Declaraciones del paquete abierto, en Spec y Body.
3. Dentro del texto de una sentencia SQL, sus alias y tablas van antes que las variables (como en
   Oracle). El destino de `INTO` no cuenta como alias, y después del `LOOP` de un FOR con consulta
   vuelven a valer las variables.
4. Objetos del catálogo, con la conexión principal. Un paquete abierto en otra pestaña se lee del
   editor, aunque tenga cambios sin guardar.

Sin conexión solo se resuelve lo que está en el documento. La fuente de otros objetos se guarda
por conexión y se vuelve a pedir al compilar, refrescar el explorador o reconectar.

## Navegación

| Comando | Atajo | Destino |
|---|---|---|
| Ir a la definición | F12, Ctrl+clic | El cuerpo de la rutina; si no tiene, su declaración |
| Ir a la declaración | Ctrl+F12 | La declaración en la Spec; si no hay, el cuerpo |
| Ir a la implementación | Ctrl+Shift+F12 | El cuerpo; sin cuerpo, la declaración y el aviso "Cuerpo no disponible" |

- Con Ctrl apretado, el nombre bajo el puntero se subraya. Ctrl+clic donde no hay destino ubica el
  cursor como un clic normal. Agregar un cursor pasa a Alt+clic y la selección en columna a
  Alt+Shift+arrastrar.
- Con varias firmas, un selector lista cada destino.
- Un destino en otro objeto abre ese objeto (o activa su pestaña) en la línea de la declaración.
- Si mientras se busca el destino se escribe, se mueve el cursor o se cambia de pestaña, no se navega.
- Sobre una tabla o vista, los tres comandos abren su descripción.
- El menú contextual de un nombre suma los tres comandos arriba de Describir, Ver fuente y Copiar.
