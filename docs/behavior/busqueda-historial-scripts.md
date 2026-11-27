# Búsqueda, historial y scripts

- La lupa del explorador busca por nombre y tipo entre objetos propios o todos los accesibles. Al seleccionar un resultado se abre su fuente en la pestaña de programa o su DDL en una pestaña de solo lectura. Los tipos sin DDL abren el inspector de metadatos. El DDL se muestra como texto y no se ejecuta.
- El reloj abre el historial de la conexión activa. Incluye sentencias SQL y PL/SQL enviadas desde ventanas SQL, de prueba y de comandos. Muestra el resultado de la ejecución. Seleccionar una entrada abre el texto en una pestaña SQL sin ejecutarlo. Conserva hasta 200 entradas en memoria durante la ejecución de OpenPL.
- Auto Replace permite agregar, editar y eliminar abreviaturas de scripts. La configuración se guarda en el equipo. `SEL` viene configurada con `select * from tabla`. Tab expande la abreviatura completa sin distinguir mayúsculas, en los editores editables y en el prompt de comandos. Si no coincide, queda el comportamiento habitual de Tab.
- La búsqueda usa el catálogo existente de solo lectura. Las pruebas del agente usan datos simulados y no ejecutan escrituras ni PL/SQL en Oracle.
