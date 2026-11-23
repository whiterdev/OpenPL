# Logo de OpenPL

Símbolo: base de datos con la tapa abierta ("Open"). Elegido en la ronda 3 (`concepts-r3/`).

## Archivos

| Archivo | Uso |
|---|---|
| `final/openpl-symbol.svg` | Maestro (negro), tamaños desde 32 px |
| `final/openpl-symbol-small.svg` | Corte simplificado de dos discos, hasta 24 px |
| `final/export/openpl-mono-c99a3b.svg` | Un color, ocre, sobre fondos oscuros |
| `final/export/openpl-white.svg` / `openpl-black.svg` | Un color, invertido / negro |
| `final/export/openpl-full-app-icon.svg` | Ícono de la app (fuente de `app/src-tauri/icons`) |
| `final/export/favicon.*`, `icon-*.png` | Íconos web |

Los íconos de Tauri se regeneran con:

```
cd app
npm run tauri icon ../design/logo/final/export/openpl-full-app-icon-1024.png
```

(y se borran las carpetas `android/` e `ios/`, la app es solo de escritorio).

## Colores

- Ocre `#C99A3B` (acento del tema grafito)
- Grafito `#26282C` (fondo del ícono)

## Uso

- Tamaño mínimo: 16 px con el corte simplificado; 32 px con el maestro.
- Espacio libre alrededor: al menos la altura de un disco.
- No deformar, no rotar, no agregar sombras ni degradados.
- En la interfaz se usa el componente `app/src/components/Logo.tsx`, que elige el corte según el tamaño.
