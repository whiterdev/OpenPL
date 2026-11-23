# OpenPL

IDE de escritorio open source para desarrollo Oracle PL/SQL, alternativa libre a PL/SQL Developer.
Rust + Tauri v2 + React. Windows y Linux.

**Estado:** en desarrollo. Hoy: conexión (host/puerto/servicio o alias TNS, perfiles con
contraseña en el almacén seguro del sistema), explorador de objetos con 35 tipos y menú contextual
(copiar DDL, recompilar). Lo que sigue: ventana de programa, ventana SQL con edición en grilla y
ventana de prueba. Detalle en [docs/ESTADO.md](docs/ESTADO.md).

## Requisitos

- Oracle Database 12.1 o superior.
- Oracle Instant Client 19 o 21 (64 bits) en el `PATH` (Windows) o `LD_LIBRARY_PATH` (Linux), o
  indicar su carpeta en la pantalla de arranque.
- Para compilar: Rust stable, Node.js 22+; en Windows, Visual Studio Build Tools con C++.

## Ejecutar en desarrollo

```
cd app
npm install
npm run tauri dev
```

(En PowerShell con scripts restringidos: `npm.cmd`.)

## Probar

```
cargo test --workspace
cd app && npm test
```

## Contribuir

Lee [AGENTS.md](AGENTS.md): reglas (clean-room, sin datos reales, TDD), mapa del código y cómo
hacer los cambios típicos.

## Licencia

Apache-2.0 o MIT, a elección del usuario.
