# U.A. Surprise

Experiencia web interactiva inspirada en la Academia U.A. (My Hero Academia).
Vanilla HTML5 + CSS3 + JavaScript ES6+, sin librerías.

## Estructura

```
ua_surprise/            ← equivale a la carpeta UA-Surprise/
├── index.html          ← estructura SPA: cada pantalla es <section class="stage" data-stage="N">
├── style.css           ← tokens de diseño, layout, animaciones y responsive
├── script.js           ← módulos: SFX, Typewriter, Particles, Boot, Stage1, Router
└── assets/
    └── images/
        ├── deku.png
        └── ua-logo.png
```

## Cómo probarlo

Abre la carpeta en VS Code → clic derecho en `index.html` → **Open with Live Server**.
Para probar en el celular, entra desde el teléfono a la IP local que muestra Live Server
(misma red Wi-Fi), por ejemplo `http://192.168.1.10:5500`.

## Pantallas

| # | Pantalla | Estado |
|---|----------|--------|
| 1 | Terminal de acceso (boot → consola → ruptura de protocolo) | ✅ |
| 2 | Verificación de identidad | 🔜 `goToStage(2)` ya está preparado |
