/* =====================================================================
   U.A. SURPRISE · script.js
   Arquitectura SPA en Vanilla JS (sin librerías).

   Módulos (en orden):
     00. Configuración y estado global
     01. Utilidades
     02. SFX       → sonidos sintetizados con Web Audio API
     03. Typewriter→ escritura letra a letra (cancelable)
     04. Images    → carga con fade-in + fallback
     05. Viewport  → altura real en móvil y detección de teclado
     06. Particles → partículas de energía alrededor de Deku (Pantalla 1)
     06b. Ambient  → fondo global: corazones bokeh + chispas (Pantallas 1 y 2)
     07. Boot      → sub-estado 1.A (secuencia de arranque)
     08. Stage1    → sub-estados 1.B y 1.C (consola + ruptura de protocolo)
     08b. DekuBuddy→ Deku en la esquina con diálogos aleatorios (Pantalla 2)
     08c. Troll    → el botón que esquiva los clics (Recuerdo 1 → 2)
     08d. Legend   → evento legendario a pantalla completa (Recuerdo 2 → 3)
     08e. Stage2   → carta de recuerdos con typewriter
     09. Router    → goToStage(n): navegación entre pantallas
     10. Arranque de la app
   ===================================================================== */
'use strict';

/* ─────────────────────── 00. CONFIGURACIÓN Y ESTADO ─────────────────────── */

// Todo lo "editable" vive aquí: textos, tiempos y cantidades.
const CONFIG = Object.freeze({
  bootDuration: 2500,    // ms del overlay de carga
  introTypeSpeed: 16,    // ms/carácter del mensaje institucional
  typeSpeed: 30,         // ms/carácter del mensaje personal
  particleCount: 26,     // entre 20 y 30

  messages: {
    intro: 'Credencial física detectada. Ingrese su nombre de aspirante para desencriptar el expediente asignado.',
    personal: 'Hola luuu 💚 sabía que eras tú. Primero que todo, verifiquemos que sí seas tú antes de abrir tu expediente oficial de la U.A...',
    emptyName: '⚠ CAMPO VACÍO // INGRESE SU NOMBRE DE ASPIRANTE',
  },

  status: {
    idle: 'ESPERANDO CREDENCIAL // NIVEL: ASPIRANTE',
    personal: 'IDENTIDAD DETECTADA // PROTOCOLO PERSONAL ACTIVO',
  },

  /* ── Pantalla 2 ── */
  memoryTypeSpeed: 34,   // ms/carácter de las cartas

  // `action` decide qué hace el botón de cada carta (ver Stage2.onNext)
  memories: [
    {
      title: 'Archivo #01 // Tradición de Vacaciones 🌙',
      text: 'Tenemos una tradición sagrada cada vez que llegan las vacaciones del colegio: quedarnos despiertos hasta tardísimo hablando en llamadas nocturnas tipo 3:00 a.m., arreglando el mundo o riéndonos de cualquier cosa mientras todos duermen...',
      button: 'Siguiente recuerdo ✨',
      action: 'troll',
    },
    {
      title: 'Archivo #02 // Dúo en Roblox 🎮',
      text: 'Nuestras noches no estarían completas sin nuestras partidas en Roblox jugando Flee the Facility y Rivals. No importa si ganamos o si fallamos todos los saltos, las risas están garantizadas al 100%...',
      button: 'Desbloquear último recuerdo ⚡',
      action: 'legend',
    },
    {
      title: 'Archivo #03 // Siempre en el mismo equipo 💚',
      text: 'Y lo más importante de todo: pase lo que pase, siempre nos apoyamos mutuamente en las buenas y en las malas. Gracias por ser una amiga tan increíble, luuu.',
      button: 'COMPLETAR VERIFICACIÓN Y CONTINUAR 🌟',
      action: 'finish',
    },
  ],

  // Los 3 textos que va diciendo el botón troll (intentos 1, 2 y 3)
  troll: ['tonta tontaaa', 'fucking idiot', 'ya ya mijo ya'],

  // Diálogos de Deku: 5 textos + 1 imagen (el HTML ya contiene la <img> de johncito)
  dekuLines: [
    { type: 'text', text: 'sic seven' },
    { type: 'text', text: 'luisa borra la cuenta 🗣️🗣️🗣️' },
    { type: 'text', text: 'la pagina del perro' },
    { type: 'text', text: 'que le dice un jardinero a otro? seamos felcies mientras podamos JAJAJAJAJ ay ya me callo perdon' },
    { type: 'text', text: 'adrian cristian hernandez' },
    { type: 'image' },
  ],
  dekuEvery: [4500, 6000],   // ms entre una intervención y la siguiente
  dekuVisible: [3500, 4000], // ms que el globo permanece visible
});

// Estado compartido por todas las pantallas (crecerá con la Pantalla 2, 3...)
const state = {
  stage: 1,
  aspirantName: '',
  audioOn: false,
  busy: false,           // evita dobles envíos mientras corre una animación
  transitioning: false,  // true mientras se cambia de pantalla
};

/* ─────────────────────── 01. UTILIDADES ─────────────────────── */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Promesa que se resuelve tras `ms` milisegundos (permite usar await). */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isFinePointer = window.matchMedia('(pointer: fine)').matches; // mouse/trackpad
const isMobileLayout = () => window.matchMedia('(max-width: 900px)').matches;

/** Número aleatorio entre min y max. */
const random = (min, max) => min + Math.random() * (max - min);

/** Vibración del teléfono (Android). En iPhone/PC no hace nada. */
const vibrate = (pattern) => { if (navigator.vibrate) navigator.vibrate(pattern); };

/**
 * Reinicia una animación CSS aunque la clase ya estuviera puesta.
 * Truco: quitar la clase, forzar un "reflow" leyendo offsetWidth, y volver a ponerla.
 */
function restartAnimation(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

/* ─────────────────────── 02. SFX · WEB AUDIO API ───────────────────────
   No usamos archivos: cada sonido es un oscilador con una "envolvente"
   de volumen (sube rápido, baja suave) para que suene como un pitido limpio.
   Los navegadores exigen un gesto del usuario para crear audio, por eso el
   AudioContext se crea cuando se pulsa el botón AUDIO.                     */

const SFX = (() => {
  let ctx = null;
  let master = null;
  let lastKeyTime = 0;

  function ensureContext() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();

      // Cadena: osciladores → master (volumen) → filtro pasa-bajos → altavoces
      master = ctx.createGain();
      master.gain.value = 0.7;
      const softener = ctx.createBiquadFilter();
      softener.type = 'lowpass';
      softener.frequency.value = 3200;   // recorta agudos ásperos
      master.connect(softener).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** Genera un tono. `to` hace un barrido de frecuencia (efecto "carga"). */
  function tone({ freq = 880, to = null, type = 'sine', duration = 0.08, volume = 0.05, delay = 0 }) {
    if (!state.audioOn || !ctx) return;

    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);

    // Envolvente: empezar en ~0 evita el "click" audible al iniciar/parar
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  /**
   * Ruido blanco filtrado: base de truenos, impactos y "swoosh".
   * Un buffer de valores aleatorios suena a "shhh"; el filtro le da color.
   */
  function noise({ duration = 0.3, volume = 0.05, filter = 'lowpass', freq = 1000, to = null, q = 1, delay = 0 }) {
    if (!state.audioOn || !ctx) return;

    const t0 = ctx.currentTime + delay;
    const length = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    const biquad = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = buffer;
    biquad.type = filter;
    biquad.Q.value = q;
    biquad.frequency.setValueAtTime(freq, t0);
    if (to) biquad.frequency.exponentialRampToValueAtTime(to, t0 + duration);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    src.connect(biquad).connect(gain).connect(master);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  return {
    enable() { ensureContext(); },
    disable() { if (ctx && ctx.state === 'running') ctx.suspend(); },

    toggleOn() {
      tone({ freq: 520, to: 1040, duration: 0.12, volume: 0.05 });
      tone({ freq: 1320, duration: 0.09, volume: 0.04, delay: 0.11 });
    },

    // Tecleo del usuario (limitado para que no se sature al escribir rápido)
    key() {
      const now = performance.now();
      if (now - lastKeyTime < 35) return;
      lastKeyTime = now;
      tone({ freq: 1500 + Math.random() * 500, type: 'square', duration: 0.03, volume: 0.016 });
    },

    // Tic suave del typewriter
    type() { tone({ freq: 2000 + Math.random() * 300, duration: 0.025, volume: 0.012 }); },

    hover() { tone({ freq: 660, to: 990, duration: 0.07, volume: 0.03 }); },

    error() {
      tone({ freq: 240, to: 150, type: 'sawtooth', duration: 0.16, volume: 0.03 });
      tone({ freq: 200, to: 120, type: 'sawtooth', duration: 0.16, volume: 0.028, delay: 0.13 });
    },

    // Acceso confirmado: arpegio Do-Mi-Sol-Do
    confirm() {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
        tone({ freq, type: 'triangle', duration: 0.18, volume: 0.05, delay: i * 0.07 }));
    },

    // Oleada de energía One For All
    surge() {
      tone({ freq: 110, to: 1400, type: 'sawtooth', duration: 0.7, volume: 0.022 });
      tone({ freq: 220, to: 1760, type: 'sine', duration: 0.75, volume: 0.035, delay: 0.05 });
    },

    /* ── Pantalla 2 ── */

    // Cambio de página de la carta
    page() { noise({ duration: 0.35, volume: 0.05, filter: 'bandpass', freq: 600, to: 2600, q: 0.8 }); },

    // "Voz" de Deku: sílabas cortas a tonos aleatorios
    babble(syllables = 5) {
      for (let i = 0; i < syllables; i++) {
        tone({ freq: random(380, 720), type: 'triangle', duration: 0.06, volume: 0.03, delay: i * 0.075 });
      }
    },

    // El botón troll se escapa
    boing() {
      tone({ freq: 220, to: 880, duration: 0.12, volume: 0.06 });
      tone({ freq: 880, to: 300, duration: 0.16, volume: 0.05, delay: 0.1 });
    },

    // Rayo: chasquido agudo + zumbido grave
    zap() {
      noise({ duration: 0.2, volume: 0.07, filter: 'highpass', freq: 1500 });
      tone({ freq: 95, to: 40, type: 'square', duration: 0.22, volume: 0.025 });
    },

    // Impacto épico: golpe grave + estruendo de ruido
    impact(power = 1) {
      tone({ freq: 90, to: 30, duration: 0.9, volume: 0.22 * power });
      tone({ freq: 60, to: 28, type: 'sawtooth', duration: 0.5, volume: 0.05 * power });
      noise({ duration: 1.2, volume: 0.25 * power, freq: 600, to: 70 });
    },

    // Fanfarria: arpegio ascendente + acorde mayor sostenido + destellos
    fanfare() {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
        tone({ freq, type: 'sawtooth', duration: 0.16, volume: 0.05, delay: i * 0.11 }));
      [523.25, 659.25, 783.99, 1046.5].forEach((freq) => {
        tone({ freq, type: 'sawtooth', duration: 1.6, volume: 0.03, delay: 0.5 });
        tone({ freq: freq / 2, type: 'triangle', duration: 1.6, volume: 0.04, delay: 0.5 });
      });
      const shimmer = [1567.98, 1760, 2093, 2349.3, 2637];
      for (let i = 0; i < 12; i++) {
        tone({ freq: shimmer[i % shimmer.length], duration: 0.2, volume: 0.018, delay: 0.55 + i * 0.07 });
      }
    },

    // Timbre de llamada entrante (dos tonos alternos)
    ring() {
      [0, 0.1, 0.2, 0.3].forEach((delay, i) =>
        tone({ freq: i % 2 ? 1660 : 1320, duration: 0.09, volume: 0.035, delay }));
    },
  };
})();

/* ─────────────────────── 03. TYPEWRITER ─────────────────────── */

let typingToken = 0; // cada escritura nueva invalida la anterior

/**
 * Escribe `text` dentro de `el` letra por letra.
 * - Array.from() separa por "code points": así el emoji 💚 (que en JS mide 2)
 *   se escribe como 1 solo carácter y no aparece roto a mitad.
 * - Devuelve una promesa → podemos hacer `await typewriter(...)`.
 */
function typewriter(el, text, { speed = 30, onChar } = {}) {
  const token = ++typingToken;
  const chars = Array.from(text);
  const node = document.createTextNode('');
  el.replaceChildren(node);

  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      if (token !== typingToken) return resolve(false);  // cancelado por otra escritura
      node.appendData(chars[i]);
      if (onChar && chars[i] !== ' ' && i % 2 === 0) onChar(chars[i]);
      i += 1;
      if (i < chars.length) setTimeout(tick, speed);
      else resolve(true);
    };
    tick();
  });
}

/* ─────────────────────── 04. IMÁGENES (carga + fallback) ─────────────────────── */

/**
 * Observa una imagen: si carga → .is-loaded (fade-in);
 * si falla → .is-broken en su contenedor .img-slot (muestra el texto fallback).
 * Comprobamos `img.complete` porque la imagen pudo terminar ANTES de que el
 * script se ejecutara (en ese caso los eventos load/error ya no se disparan).
 */
function watchImage(img) {
  const slot = img.closest('.img-slot');
  const onLoad = () => img.classList.add('is-loaded');
  const onError = () => slot?.classList.add('is-broken');

  if (img.complete) {
    img.naturalWidth > 0 ? onLoad() : onError();
  } else {
    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onError, { once: true });
  }
}

/* ─────────────────────── 05. VIEWPORT MÓVIL ───────────────────────
   En iOS el teclado no cambia 100dvh: tapa la página. visualViewport
   nos dice el alto REAL visible, y lo pasamos a CSS como --app-h.        */

const Viewport = (() => {
  const root = document.documentElement;
  let baseline = 0;
  let lastWidth = window.innerWidth;

  function update() {
    const vv = window.visualViewport;
    if (!vv || Math.abs(vv.scale - 1) > 0.01) return; // ignorar zoom con los dedos

    if (window.innerWidth !== lastWidth) {             // rotación → nueva referencia
      lastWidth = window.innerWidth;
      baseline = 0;
    }
    baseline = Math.max(baseline, vv.height);
    root.style.setProperty('--app-h', `${Math.round(vv.height)}px`);

    // Si el alto visible bajó mucho respecto al máximo → hay teclado abierto
    const keyboardOpen = isMobileLayout() && baseline - vv.height > 140;
    document.body.classList.toggle('kb-open', keyboardOpen);
    if (keyboardOpen) window.scrollTo(0, 0);           // iOS desplaza la página: la regresamos
  }

  return {
    init() {
      if (!window.visualViewport) return;
      update();
      window.visualViewport.addEventListener('resize', update);
    },
  };
})();

/* ─────────────────────── 06. PARTÍCULAS (canvas) ─────────────────────── */

const Particles = (() => {
  const COLORS = ['0, 255, 157', '0, 255, 157', '0, 184, 124', '245, 197, 66']; // ~75% verde, 25% dorado
  let canvas, ctx, width = 0, height = 0;
  let particles = [];
  let lastTime = 0;
  let boost = 1;          // multiplicador de velocidad/brillo (sube en 1.C)
  let running = false;

  function reset(p, anywhere) {
    // Concentradas alrededor del centro (donde está Deku)
    p.baseX = width * (0.5 + (Math.random() - 0.5) * 0.85);
    p.y = anywhere ? Math.random() * height : height + 10;
    p.r = 0.8 + Math.random() * 2.2;
    p.speed = (14 + Math.random() * 30) * (prefersReducedMotion ? 0.3 : 1); // px/segundo
    p.phase = Math.random() * Math.PI * 2;
    p.swayAmp = 6 + Math.random() * 16;
    p.swaySpeed = 0.4 + Math.random() * 0.9;
    p.alpha = 0.35 + Math.random() * 0.55;
    p.color = COLORS[Math.floor(Math.random() * COLORS.length)];
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // nitidez en pantallas retina
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function frame(now) {
    // dt en segundos: el movimiento no depende de los FPS del dispositivo
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    boost += (1 - boost) * dt * 0.8; // el boost vuelve suavemente a 1

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter'; // los brillos se suman (efecto luz)

    for (const p of particles) {
      p.y -= p.speed * boost * dt;
      p.phase += p.swaySpeed * dt;
      if (p.y < -12) reset(p, false);

      const x = p.baseX + Math.sin(p.phase) * p.swayAmp;
      // Aparecen abajo y se desvanecen al llegar arriba
      const life = Math.min(1, p.y / (height * 0.35)) * Math.min(1, (height - p.y) / 40 + 0.2);
      const a = Math.max(0, p.alpha * life * Math.min(boost, 1.6));

      ctx.beginPath();                                         // halo
      ctx.fillStyle = `rgba(${p.color}, ${a * 0.18})`;
      ctx.arc(x, p.y, p.r * 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();                                         // núcleo
      ctx.fillStyle = `rgba(${p.color}, ${a})`;
      ctx.arc(x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // requestAnimationFrame se pausa solo cuando la pestaña no está visible
    if (running) requestAnimationFrame(frame);
  }

  return {
    init(canvasEl) {
      canvas = canvasEl;
      ctx = canvas.getContext('2d');
      if (!ctx) return;
      resize();
      const count = prefersReducedMotion ? 12 : CONFIG.particleCount;
      particles = Array.from({ length: count }, () => {
        const p = {};
        reset(p, true);
        return p;
      });
      // ResizeObserver: reacciona a cambios de tamaño del contenedor (rotación, teclado...)
      new ResizeObserver(() => {
        resize();
        particles.forEach((p) => { p.baseX = Math.min(p.baseX, width); });
      }).observe(canvas);
      this.resume();
    },
    surge() { boost = prefersReducedMotion ? 1.2 : 3.2; },
    // Al salir de la Pantalla 1 detenemos el bucle: no gastamos batería en algo invisible
    pause() { running = false; },
    resume() {
      if (running || !ctx) return;
      running = true;
      lastTime = performance.now();
      requestAnimationFrame(frame);
    },
  };
})();

/* ─────────────────────── 06b. AMBIENT · FONDO GLOBAL ───────────────────────
   Corazones bokeh (desenfocados) que suben y laten + chispas de luz.
   Rendimiento: cada corazón desenfocado se dibuja UNA sola vez en un
   "sprite" (canvas pequeño fuera de pantalla) y luego solo lo copiamos
   con drawImage en cada frame, que es muy barato.                        */

const Ambient = (() => {
  // Colores de los corazones: verde OFA, dorado U.A. y blanco cálido
  const PALETTE = [
    { rgb: '0, 255, 157', alpha: 0.22 },
    { rgb: '245, 197, 66', alpha: 0.25 },
    { rgb: '255, 240, 220', alpha: 0.18 },
  ];
  const SPARK_COLORS = ['255, 236, 190', '0, 255, 157', '255, 255, 255'];
  const BLURS = [2, 6, 14];   // 3 niveles de desenfoque = 3 "profundidades"
  const BASE = 64;            // tamaño del corazón dentro del sprite (px)

  let canvas, ctx;
  let width = 0, height = 0, dpr = 1;
  let heartSprites = [];      // heartSprites[color][blur]
  let sparkSprites = [];
  let hearts = [], sparks = [], bursts = [];
  let lastTime = 0;

  /** Dibuja la silueta de un corazón (4 curvas de Bézier). */
  function heartPath(g, cx, top, size) {
    const t = size * 0.3;
    g.beginPath();
    g.moveTo(cx, top + t);
    g.bezierCurveTo(cx, top, cx - size / 2, top, cx - size / 2, top + t);
    g.bezierCurveTo(cx - size / 2, top + (size + t) / 2, cx, top + (size + t) / 2, cx, top + size);
    g.bezierCurveTo(cx, top + (size + t) / 2, cx + size / 2, top + (size + t) / 2, cx + size / 2, top + t);
    g.bezierCurveTo(cx + size / 2, top, cx, top, cx, top + t);
    g.closePath();
  }

  /**
   * Sprite de corazón desenfocado.
   * Truco del "desenfoque por sombra": dibujamos el corazón FUERA del lienzo
   * y desplazamos su sombra hacia dentro. Solo se ve la sombra, que sí admite
   * shadowBlur en todos los navegadores (ctx.filter no funciona en Safari).
   */
  function makeHeartSprite(rgb, blur) {
    const pad = blur * 2 + 6;
    const size = BASE + pad * 2;
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = size;
    const g = sprite.getContext('2d');
    const OFFSET = 2000;

    g.shadowOffsetX = OFFSET;
    g.shadowBlur = blur;

    // Relleno suave
    g.shadowColor = `rgba(${rgb}, 0.85)`;
    heartPath(g, size / 2 - OFFSET, pad + 2, BASE - 4);
    g.fill();

    // Borde algo más brillante (los bokeh reales tienen el contorno marcado)
    g.shadowColor = `rgba(${rgb}, 1)`;
    g.lineWidth = 2;
    g.stroke();

    return sprite;
  }

  /** Sprite de chispa: un punto con halo radial. */
  function makeSparkSprite(rgb) {
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 32;
    const g = sprite.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.2, `rgba(${rgb}, 0.9)`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return sprite;
  }

  /** Latido "lub-dub": dos picos suaves por ciclo (0 → 1). */
  function heartbeat(t) {
    const p = t % 1;
    return Math.exp(-((p - 0.12) ** 2) / 0.003) + 0.55 * Math.exp(-((p - 0.32) ** 2) / 0.003);
  }

  function makeHeart(anywhere) {
    const depth = Math.random();                  // 0 = lejos · 1 = cerca
    const blur = depth < 0.45 ? 0 : depth < 0.8 ? 1 : 2;
    const color = Math.floor(Math.random() * PALETTE.length);
    const slow = prefersReducedMotion ? 0.25 : 1;
    return {
      x: Math.random() * width,
      y: anywhere ? Math.random() * height : height + 80,
      size: 14 + depth * 50,
      speed: (7 + depth * 18) * slow,             // los cercanos suben más rápido (paralaje)
      phase: Math.random() * Math.PI * 2,
      swayAmp: 10 + Math.random() * 28,
      swaySpeed: 0.15 + Math.random() * 0.35,
      rot: random(-0.35, 0.35),
      beatOffset: Math.random(),
      beatRate: 0.75 + Math.random() * 0.5,       // latidos por segundo
      alpha: PALETTE[color].alpha * random(0.75, 1.25),
      color,
      blur,
    };
  }

  function makeSpark(anywhere) {
    return {
      x: Math.random() * width,
      y: anywhere ? Math.random() * height : height + 10,
      r: 2 + Math.random() * 5,
      speed: 3 + Math.random() * 9,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: 1 + Math.random() * 2.5,
      color: Math.floor(Math.random() * SPARK_COLORS.length),
    };
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5); // pantalla completa: 1.5 es suficiente
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  function drawSprite(sprite, x, y, drawSize, alpha, rotation = 0) {
    const scale = drawSize / BASE;
    const cos = Math.cos(rotation) * scale * dpr;
    const sin = Math.sin(rotation) * scale * dpr;
    // setTransform en una sola llamada: trasladar + rotar + escalar
    ctx.setTransform(cos, sin, -sin, cos, x * dpr, y * dpr);
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
  }

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    const t = now / 1000;
    lastTime = now;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1) Corazones bokeh
    ctx.globalCompositeOperation = 'source-over';
    for (const h of hearts) {
      h.y -= h.speed * dt;
      h.phase += h.swaySpeed * dt;
      if (h.y < -90) Object.assign(h, makeHeart(false));

      const x = h.x + Math.sin(h.phase) * h.swayAmp;
      const beat = prefersReducedMotion ? 0 : heartbeat(t * h.beatRate + h.beatOffset);
      const fade = Math.min(1, (height + 80 - h.y) / 160) * Math.min(1, (h.y + 90) / (height * 0.3));
      drawSprite(heartSprites[h.color][h.blur], x, h.y, h.size * (1 + beat * 0.07), h.alpha * fade, h.rot + Math.sin(h.phase) * 0.12);
    }

    // 2) Ráfagas de corazones (celebraciones)
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.life -= dt;
      if (b.life <= 0) { bursts.splice(i, 1); continue; }
      b.vx *= 0.97;
      b.vy = b.vy * 0.97 - 18 * dt;                // flotan hacia arriba
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      drawSprite(heartSprites[b.color][0], b.x, b.y, b.size, Math.min(1, b.life / 0.6) * 0.75, b.rot);
    }

    // 3) Chispas (se suman como luz)
    ctx.globalCompositeOperation = 'lighter';
    for (const sp of sparks) {
      sp.y -= sp.speed * dt;
      sp.twinkle += sp.twinkleSpeed * dt;
      if (sp.y < -10) Object.assign(sp, makeSpark(false));
      const a = 0.15 + 0.55 * (0.5 + 0.5 * Math.sin(sp.twinkle));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = a;
      ctx.drawImage(sparkSprites[sp.color], sp.x - sp.r, sp.y - sp.r, sp.r * 2, sp.r * 2);
    }

    requestAnimationFrame(frame);
  }

  return {
    init(canvasEl) {
      canvas = canvasEl;
      ctx = canvas?.getContext('2d');
      if (!ctx) return;

      heartSprites = PALETTE.map(({ rgb }) => BLURS.map((blur) => makeHeartSprite(rgb, blur)));
      sparkSprites = SPARK_COLORS.map(makeSparkSprite);
      resize();

      const compact = width < 900;
      const heartCount = prefersReducedMotion ? 10 : compact ? 16 : 28;
      const sparkCount = prefersReducedMotion ? 14 : compact ? 26 : 44;
      hearts = Array.from({ length: heartCount }, () => makeHeart(true));
      sparks = Array.from({ length: sparkCount }, () => makeSpark(true));

      window.addEventListener('resize', resize);
      lastTime = performance.now();
      requestAnimationFrame(frame);
    },

    /** Lanza una ráfaga de corazones desde (x, y) — en píxeles de pantalla. */
    burst(x, y, count = 18) {
      if (!ctx) return;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = random(80, 260);
        bursts.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 60,
          size: random(14, 30),
          rot: random(-0.4, 0.4),
          life: random(1.4, 2.4),
          color: Math.floor(Math.random() * PALETTE.length),
        });
      }
    },
  };
})();

/* ─────────────────────── 07. BOOT · SUB-ESTADO 1.A ─────────────────────── */

const Boot = {
  run() {
    const overlay = $('#boot');
    const fill = $('#boot-fill');
    const pct = $('#boot-pct');
    const lines = $$('.boot__line');
    const start = performance.now();
    const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    return new Promise((resolve) => {
      const frame = (now) => {
        const t = Math.min((now - start) / CONFIG.bootDuration, 1); // 0 → 1 en 2.5s
        const progress = easeInOut(t);

        fill.style.transform = `scaleX(${progress})`;
        pct.textContent = String(Math.round(progress * 100)).padStart(3, '0');

        // Cada línea aparece al llegar a su data-at; la anterior recibe [OK]
        lines.forEach((line, i) => {
          if (t >= Number(line.dataset.at) && !line.classList.contains('is-visible')) {
            line.classList.add('is-visible');
            lines[i - 1]?.classList.add('is-ok');
          }
        });

        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          lines.at(-1).classList.add('is-ok');
          resolve();
        }
      };
      requestAnimationFrame(frame);
    }).then(async () => {
      await wait(220);
      overlay.classList.add('is-done');          // opacity:0 + pointer-events:none
      overlay.setAttribute('aria-hidden', 'true');
    });
  },
};

/* ─────────────────────── 08. STAGE 1 · SUB-ESTADOS 1.B y 1.C ─────────────────────── */

const Stage1 = {
  init() {
    // Cacheamos los elementos una sola vez
    this.el = {
      hud: $('#hud'),
      hero: $('#hero'),
      status: $('#hud-status'),
      message: $('#hud-message-text'),
      messageSr: $('#hud-message-sr'),
      formWrap: $('#form-wrap'),
      form: $('#access-form'),
      input: $('#aspirant-name'),
      hint: $('#name-hint'),
      verifyWrap: $('#verify-wrap'),
      verifyBtn: $('#verify-btn'),
      sync: $('#ofa-sync'),
      clock: $('#hud-clock'),
    };

    const { form, input, verifyBtn } = this.el;

    // submit cubre tanto el clic en el botón como la tecla Enter
    form.addEventListener('submit', (e) => this.onSubmit(e));

    input.addEventListener('input', () => {
      SFX.key();
      if (input.classList.contains('is-invalid')) this.clearError();
    });

    input.addEventListener('animationend', () => input.classList.remove('is-shaking'));

    // En móvil: al enfocar el input, marcamos el teclado como abierto
    // (respaldo por si visualViewport no reporta el cambio)
    input.addEventListener('focus', () => {
      if (isMobileLayout() && !isFinePointer) document.body.classList.add('kb-open');
    });
    input.addEventListener('blur', () => {
      setTimeout(() => document.body.classList.remove('kb-open'), 120);
    });

    verifyBtn.addEventListener('click', () => {
      if (state.transitioning) return;
      SFX.confirm();
      goToStage(2);
    });

    this.startClock();
  },

  /** 1.B · Se llama cuando termina el boot: escribe el mensaje institucional. */
  async enter() {
    const { message, messageSr, input } = this.el;
    messageSr.textContent = CONFIG.messages.intro;
    await typewriter(message, CONFIG.messages.intro, { speed: CONFIG.introTypeSpeed });

    // Enfocar solo en escritorio: en móvil abriría el teclado sin permiso
    if (isFinePointer && !state.busy) input.focus({ preventScroll: true });
  },

  onSubmit(event) {
    event.preventDefault();
    if (state.busy) return;

    const name = this.el.input.value.trim();
    if (!name) {
      this.rejectEmpty();
      return;
    }
    this.breakProtocol(name);
  },

  /** Campo vacío → vibración horizontal + aviso. */
  rejectEmpty() {
    const { input, hint } = this.el;
    SFX.error();
    restartAnimation(input, 'is-shaking');
    input.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
    hint.textContent = CONFIG.messages.emptyName;
    if (navigator.vibrate) navigator.vibrate(60);   // vibración real en Android
    input.focus();
  },

  clearError() {
    const { input, hint } = this.el;
    input.classList.remove('is-invalid');
    input.removeAttribute('aria-invalid');
    hint.textContent = '';
  },

  /** 1.C · Ruptura de protocolo: reconocimiento personal. */
  async breakProtocol(name) {
    const { hud, hero, input, formWrap, message, messageSr } = this.el;
    state.busy = true;
    state.aspirantName = name;   // guardado para las siguientes pantallas

    // Paso 1 · Destello One For All en la consola + brillo detrás de Deku
    input.blur();                // cierra el teclado del móvil
    SFX.confirm();
    SFX.surge();
    restartAnimation(hud, 'is-flash');
    hud.classList.add('is-personal');
    hero.classList.add('is-charged');
    Particles.surge();
    this.countSync(8, 100, 1400);

    // Paso 2 · Ocultar input y botón (colapso animado) y desactivarlos
    formWrap.classList.add('is-collapsed');
    formWrap.setAttribute('aria-hidden', 'true');
    formWrap.inert = true;       // inert: ya no se puede enfocar ni pulsar

    // Paso 3 · Nuevo estado en verde
    await this.setStatus(CONFIG.status.personal);
    await wait(350);

    // Paso 4 · Mensaje personal letra a letra (30 ms/carácter)
    messageSr.textContent = CONFIG.messages.personal;
    await typewriter(message, CONFIG.messages.personal, {
      speed: CONFIG.typeSpeed,
      onChar: () => SFX.type(),
    });

    // Paso 5 · Aparece el botón de verificación
    await wait(250);
    this.revealVerify();
  },

  /** Cambia el texto de estado con un pequeño fundido. */
  async setStatus(text) {
    const { status } = this.el;
    status.classList.add('is-swapping');
    await wait(250);
    status.textContent = text;
    status.classList.remove('is-swapping');
  },

  revealVerify() {
    const { verifyWrap, verifyBtn } = this.el;
    verifyWrap.classList.remove('is-collapsed');
    verifyWrap.removeAttribute('aria-hidden');
    verifyWrap.inert = false;    // vuelve a ser interactivo
    setTimeout(() => verifyWrap.classList.add('is-settled'), 600); // tras la transición
    if (isFinePointer) setTimeout(() => verifyBtn.focus({ preventScroll: true }), 400);
    state.busy = false;
  },

  /** Contador "SINCRONÍA OFA" animado de `from` a `to`. */
  countSync(from, to, duration) {
    const { sync } = this.el;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const value = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      sync.textContent = String(value).padStart(2, '0');
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },

  startClock() {
    const update = () => {
      this.el.clock.textContent = new Date().toLocaleTimeString('es', { hour12: false });
    };
    update();
    setInterval(update, 1000);
  },

  leave() { Particles.pause(); },
};

/* ─────────────────────── 08b. DEKU BUDDY · DIÁLOGOS ALEATORIOS ───────────────────────
   Deku en la esquina "habla" cada 4.5–6 s (o al tocarlo).
   Para que no se repita y todas las frases salgan pronto usamos una
   "bolsa barajada": se sacan las 6 opciones en orden aleatorio y,
   al vaciarse, se vuelve a barajar (sin repetir la última).             */

const DekuBuddy = {
  bag: [],
  lastIndex: -1,
  timers: { next: null, hide: null, swap: null },
  active: false,
  paused: false,

  init() {
    this.el = {
      root: $('#deku-buddy'),
      button: $('#deku-buddy-btn'),
      speech: $('#deku-speech'),
      text: $('#deku-speech-text'),
    };
    this.el.button.addEventListener('click', () => this.talk());
  },

  start() {
    this.active = true;
    this.paused = false;
    this.schedule(2200);                 // la primera intervención llega pronto
  },

  stop() {
    this.active = false;
    this.clearTimers();
    this.hide();
  },

  // Durante el evento legendario Deku se calla (y luego retoma)
  pause() {
    this.paused = true;
    this.clearTimers();
    this.hide();
  },

  resume() {
    this.paused = false;
    if (this.active) this.schedule(2500);
  },

  clearTimers() {
    Object.values(this.timers).forEach(clearTimeout);
  },

  schedule(delay = random(...CONFIG.dekuEvery)) {
    clearTimeout(this.timers.next);
    this.timers.next = setTimeout(() => this.talk(), delay);
  },

  /** Saca la siguiente frase de la bolsa barajada. */
  pick() {
    if (this.bag.length === 0) {
      const indexes = CONFIG.dekuLines.map((_, i) => i);
      // Barajado Fisher–Yates: cada orden tiene la misma probabilidad
      for (let i = indexes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
      }
      // Evita que la primera de la bolsa nueva sea igual a la última que salió
      if (indexes[0] === this.lastIndex) [indexes[0], indexes[1]] = [indexes[1], indexes[0]];
      this.bag = indexes;
    }
    this.lastIndex = this.bag.shift();
    return CONFIG.dekuLines[this.lastIndex];
  },

  talk() {
    if (!this.active || this.paused) return;
    const { speech } = this.el;
    clearTimeout(this.timers.hide);
    clearTimeout(this.timers.swap);

    const line = this.pick();
    const show = () => {
      speech.classList.toggle('is-image', line.type === 'image');
      this.el.text.textContent = line.type === 'text' ? line.text : '';
      speech.classList.add('is-visible');
      restartAnimation(this.el.root, 'is-talking');   // animation: talkingBounce
      SFX.babble(line.type === 'image' ? 3 : Math.min(9, 3 + Math.round(line.text.length / 14)));
      this.timers.hide = setTimeout(() => this.hide(), random(...CONFIG.dekuVisible));
    };

    // Si el globo ya estaba visible, primero se cierra y luego aparece el nuevo
    if (speech.classList.contains('is-visible')) {
      this.hide();
      this.timers.swap = setTimeout(show, 220);
    } else {
      show();
    }
    this.schedule();                                 // próxima intervención
  },

  hide() {
    this.el.speech.classList.remove('is-visible');
  },

  /** Rectángulos de Deku y de su globo (el botón troll los evita al saltar). */
  rects() {
    const rects = [this.el.root.getBoundingClientRect()];
    if (this.el.speech.classList.contains('is-visible')) rects.push(this.el.speech.getBoundingClientRect());
    return rects;
  },
};

/* ─────────────────────── 08c. TROLL · EL BOTÓN QUE ESQUIVA ───────────────────────
   Intento 1 y 2: el botón salta a una posición aleatoria segura.
   Intento 3: se rinde, dice "ya ya mijo ya" y avanza al Recuerdo 2.      */

const Troll = {
  attempts: 0,
  loose: false,
  margin: 14,

  init(button, home) {
    this.button = button;
    this.home = home;          // contenedor original dentro de la carta
    this.label = button.querySelector('.btn__label');
    // Si la pantalla cambia de tamaño con el botón suelto, lo recolocamos dentro
    window.addEventListener('resize', () => {
      if (this.loose) this.moveTo(this.randomPosition());
    });
  },

  reset() {
    this.attempts = 0;
    this.restore();
  },

  /** Devuelve 'dodge' si esquivó, o 'surrender' en el tercer intento. */
  attempt() {
    this.attempts += 1;
    const text = CONFIG.troll[Math.min(this.attempts, 3) - 1];

    if (this.attempts < 3) {
      this.dodge(text);
      return 'dodge';
    }
    this.label.textContent = text;
    this.button.classList.add('is-surrender');
    SFX.confirm();
    return 'surrender';
  },

  dodge(text) {
    const { button } = this;
    const hadFocus = document.activeElement === button;

    if (!this.loose) {
      // Lo sacamos de la carta y lo ponemos en <body>: dentro de un ancestro con
      // backdrop-filter o transform, position:fixed se mediría respecto a ese
      // ancestro y no respecto a la pantalla.
      const from = button.getBoundingClientRect();
      document.body.appendChild(button);
      button.classList.add('is-loose');
      button.style.left = `${from.left}px`;
      button.style.top = `${from.top}px`;
      this.loose = true;
    }

    this.label.textContent = text;
    void button.offsetWidth;                 // aplica la posición de partida antes de animar
    this.moveTo(this.randomPosition());

    if (hadFocus) button.focus({ preventScroll: true });
    SFX.boing();
    vibrate(35);
  },

  moveTo({ x, y }) {
    this.button.style.left = `${x}px`;
    this.button.style.top = `${y}px`;
  },

  /**
   * Posición aleatoria SIEMPRE visible: usamos window.innerWidth/innerHeight
   * menos el tamaño del botón y un margen. Probamos varias candidatas y nos
   * quedamos con la que esté más lejos de la actual sin tapar a Deku ni al
   * botón de audio.
   */
  randomPosition() {
    const { button, margin } = this;
    const bw = button.offsetWidth;
    const bh = button.offsetHeight;
    const maxX = Math.max(margin, window.innerWidth - bw - margin);
    const maxY = Math.max(margin, window.innerHeight - bh - margin);
    const current = button.getBoundingClientRect();
    const avoid = [...DekuBuddy.rects(), $('#audio-toggle').getBoundingClientRect()];

    const overlaps = (x, y, r) => x < r.right && x + bw > r.left && y < r.bottom && y + bh > r.top;

    let best = { x: margin, y: margin };
    let bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const x = random(margin, maxX);
      const y = random(margin, maxY);
      const distance = Math.hypot(x - current.left, y - current.top);
      const penalty = avoid.some((r) => overlaps(x, y, r)) ? 100000 : 0;
      const score = distance - penalty;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    return best;
  },

  /** Devuelve el botón a la carta con su estilo normal. */
  restore() {
    const { button } = this;
    button.classList.remove('is-loose', 'is-surrender');
    button.style.left = '';
    button.style.top = '';
    if (this.loose) this.home.appendChild(button);
    this.loose = false;
  },
};

/* ─────────────────────── 08d. LEGEND · EVENTO LEGENDARIO ───────────────────────
   LegendFX dibuja en su propio <canvas>: rayos (relámpagos), explosión de
   partículas y brasas doradas. Legend orquesta la secuencia con await.   */

const LegendFX = (() => {
  let canvas, ctx;
  let width = 0, height = 0, dpr = 1;
  let bolts = [], sparks = [];
  let running = false, lastTime = 0, nextStrike = 0, embers = false;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  /**
   * Relámpago por "desplazamiento del punto medio": partimos de una línea
   * recta y, en cada generación, movemos el punto medio de cada tramo hacia
   * un lado al azar. 6 generaciones = 64 tramos en zigzag.
   */
  function jagged(x1, y1, x2, y2, generations = 6) {
    let points = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
    let offset = Math.hypot(x2 - x1, y2 - y1) * 0.22;
    for (let g = 0; g < generations; g++) {
      const next = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const shift = (Math.random() - 0.5) * offset;
        // Perpendicular al tramo: (-dy, dx) normalizado
        next.push({ x: (a.x + b.x) / 2 - ((b.y - a.y) / len) * shift, y: (a.y + b.y) / 2 + ((b.x - a.x) / len) * shift }, b);
      }
      points = next;
      offset /= 2;
    }
    return points;
  }

  function makeBolt() {
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.12;
    // Nace en un borde (casi siempre arriba) y muere cerca del centro
    const fromTop = Math.random() < 0.7;
    const sx = fromTop ? random(0, width) : (Math.random() < 0.5 ? 0 : width);
    const sy = fromTop ? 0 : random(0, height * 0.6);
    const ex = cx + random(-radius, radius);
    const ey = cy + random(-radius, radius);
    const main = jagged(sx, sy, ex, ey);

    // 1–2 ramificaciones cortas
    const branches = Array.from({ length: 1 + Math.floor(Math.random() * 2) }, () => {
      const p = main[Math.floor(random(8, main.length - 8))];
      return jagged(p.x, p.y, p.x + random(-160, 160), p.y + random(40, 180), 4);
    });

    return {
      paths: [main, ...branches],
      color: Math.random() < 0.55 ? '245, 197, 66' : '0, 255, 157',
      life: 0.35,
      maxLife: 0.35,
      width: random(2, 4),
    };
  }

  function drawPath(points) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    const t = now / 1000;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Rayos automáticos cada 0.5–1.2 s
    if (t > nextStrike) {
      api.strike(Math.random() < 0.35 ? 2 : 1);
      nextStrike = t + random(0.5, 1.2);
    }

    // Relámpagos: trazo ancho con resplandor + núcleo blanco fino
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.life -= dt;
      if (b.life <= 0) { bolts.splice(i, 1); continue; }
      const a = b.life / b.maxLife;
      ctx.shadowBlur = 24;
      ctx.shadowColor = `rgba(${b.color}, ${a})`;
      ctx.strokeStyle = `rgba(${b.color}, ${a * 0.9})`;
      ctx.lineWidth = b.width;
      b.paths.forEach(drawPath);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(255, 255, 255, ${a})`;
      ctx.lineWidth = 1;
      b.paths.forEach(drawPath);
    }

    // Brasas que suben desde el centro (aura del Lemon Horse)
    if (embers && sparks.length < 260) {
      for (let k = 0; k < 2; k++) {
        sparks.push({
          x: width / 2 + random(-width * 0.18, width * 0.18),
          y: height / 2 + random(-40, height * 0.2),
          vx: random(-20, 20), vy: random(-90, -30),
          life: random(1, 2), maxLife: 2, size: random(1, 2.6),
          color: Math.random() < 0.7 ? '255, 214, 102' : '0, 255, 157',
          drag: 0.99,
        });
      }
    }

    // Partículas: explosión + brasas
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.life -= dt;
      if (p.life <= 0) { sparks.splice(i, 1); continue; }
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + 40 * dt * (p.gravity || 0);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const a = Math.min(1, p.life / p.maxLife * 1.5);
      ctx.fillStyle = `rgba(${p.color}, ${a * 0.25})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${p.color}, ${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(frame);
  }

  const api = {
    init(canvasEl) {
      canvas = canvasEl;
      ctx = canvas.getContext('2d');
      window.addEventListener('resize', () => running && resize());
    },
    start() {
      if (!ctx || running) return;
      resize();
      running = true;
      lastTime = performance.now();
      nextStrike = lastTime / 1000 + 0.6;
      requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      embers = false;
      bolts = [];
      sparks = [];
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    },
    strike(count = 1) {
      if (!running) return;
      for (let i = 0; i < count; i++) bolts.push(makeBolt());
      restartAnimation($('#legend-flash'), 'is-strike');
      SFX.zap();
    },
    explode(count = 140) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = random(180, 720);
        sparks.push({
          x: width / 2, y: height / 2,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life: random(0.8, 1.8), maxLife: 1.8, size: random(1.2, 3.4),
          color: ['255, 214, 102', '0, 255, 157', '255, 255, 255'][i % 3],
          drag: 0.955, gravity: 1,
        });
      }
    },
    embers(on) { embers = on; },
  };
  return api;
})();

const Legend = {
  playing: false,

  init() {
    this.el = {
      root: $('#legend'),
      stage: $('#legend-stage'),
      power: $('#legend-power'),
      button: $('#legend-continue'),
    };
    LegendFX.init($('#legend-fx'));
    this.el.button.addEventListener('click', () => this.finish());
  },

  /** Reproduce el evento completo. La promesa se resuelve al pulsar CONTINUAR. */
  play() {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.run();
    });
  },

  async run() {
    const { root, stage, button } = this.el;
    this.playing = true;
    DekuBuddy.pause();
    button.disabled = true;

    // 0 · Se oscurece todo y la pantalla tiembla
    root.hidden = false;
    void root.offsetWidth;                    // fuerza el estado inicial para que la transición se vea
    root.classList.add('is-active');
    LegendFX.start();
    LegendFX.strike(3);
    SFX.impact();
    this.quake();
    vibrate([400, 100, 400]);

    // 1 · Rayos de luz divina girando desde el centro
    await wait(550);
    root.classList.add('is-rays');
    LegendFX.strike(2);

    // 2 · Letrero de invocación
    await wait(450);
    root.classList.add('is-title');
    SFX.impact(0.6);
    this.quake();

    // 3 · Emerge el Lemon Horse: zoom, aura sagrada, explosión y fanfarria
    await wait(800);
    root.classList.add('is-summon');
    LegendFX.explode();
    LegendFX.embers(true);
    SFX.fanfare();
    vibrate([200, 80, 200, 80, 600]);
    this.countPower(1600);

    // 4 · Vibra como llamada entrante mítica (3 timbrazos)
    await wait(1100);
    root.classList.add('is-ringing');
    for (let i = 0; i < 3 && this.playing; i++) {
      SFX.ring();
      vibrate([120, 60, 120]);
      await wait(1400);
      if (i === 0) {
        // 5 · Aparece el botón para continuar (tras el primer timbrazo)
        root.classList.add('is-ready');
        button.disabled = false;
        if (isFinePointer) button.focus({ preventScroll: true });
      }
    }
  },

  quake() {
    restartAnimation($('#app'), 'is-quaking');
    restartAnimation(this.el.stage, 'is-quaking');
  },

  /** Contador "PODER ONE FOR ALL" hasta 1.000.000 % */
  countPower(duration) {
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const value = Math.round(1000000 * (1 - Math.pow(1 - t, 4)));
      this.el.power.textContent = value.toLocaleString('es-CO');
      if (t < 1 && this.playing) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },

  async finish() {
    const { root, button } = this.el;
    if (button.disabled) return;
    button.disabled = true;
    this.playing = false;
    SFX.confirm();

    root.classList.add('is-leaving');
    await wait(650);
    root.className = 'legend';                // limpia todas las fases
    root.hidden = true;
    this.el.power.textContent = '0';
    LegendFX.stop();
    DekuBuddy.resume();
    this.resolve?.();
  },
};

/* ─────────────────────── 08e. STAGE 2 · CARTA DE RECUERDOS ─────────────────────── */

const Stage2 = {
  index: 0,
  busy: false,

  init() {
    this.el = {
      card: $('#memory-card'),
      counter: $('#memory-counter'),
      title: $('#memory-title'),
      sr: $('#memory-sr'),
      ghost: $('#memory-ghost'),
      typed: $('#memory-typed'),
      actions: $('#memory-actions'),
      next: $('#memory-next'),
      nextLabel: $('#memory-next-label'),
      dots: $$('.memory-card__dots li'),
    };

    this.el.next.addEventListener('click', () => this.onNext());

    DekuBuddy.init();
    Troll.init(this.el.next, this.el.actions);
    Legend.init();
  },

  enter() {
    this.showMemory(0, { first: true });
    DekuBuddy.start();
  },

  leave() {
    DekuBuddy.stop();
    Troll.reset();
  },

  setReady(ready) {
    this.el.actions.classList.toggle('is-ready', ready);
    this.el.next.disabled = !ready;
  },

  async showMemory(i, { first = false } = {}) {
    const memory = CONFIG.memories[i];
    const { card, counter, title, sr, ghost, typed, nextLabel, dots } = this.el;
    const pad = (n) => String(n).padStart(2, '0');

    this.index = i;
    this.busy = true;
    this.setReady(false);

    // Pasar página: la carta sale, cambiamos el contenido y vuelve a entrar
    if (!first) {
      card.classList.remove('is-turn-in');
      restartAnimation(card, 'is-turn-out');
      SFX.page();
      await wait(380);
    }

    counter.textContent = `#${pad(i + 1)} / #${pad(CONFIG.memories.length)}`;
    title.textContent = memory.title;
    nextLabel.textContent = memory.button;
    dots.forEach((dot, d) => {
      dot.classList.toggle('is-active', d === i);
      dot.classList.toggle('is-done', d < i);
    });

    // "Fantasma": el texto completo invisible reserva el alto final de la carta,
    // así la carta no crece (ni salta) mientras el texto se escribe encima.
    ghost.replaceChildren(memory.text, Object.assign(document.createElement('span'), { className: 'memory-card__cursor' }));
    typed.textContent = '';
    sr.textContent = `${memory.title}. ${memory.text}`;

    card.classList.remove('is-turn-out');
    restartAnimation(card, 'is-turn-in');

    await wait(first ? 700 : 350);
    const completed = await typewriter(typed, memory.text, {
      speed: CONFIG.memoryTypeSpeed,
      onChar: () => SFX.type(),
    });
    if (!completed || this.index !== i) return;

    if (memory.action === 'troll') Troll.reset();
    await wait(200);
    this.setReady(true);
    this.busy = false;
  },

  async onNext() {
    if (this.busy) return;
    const { action } = CONFIG.memories[this.index];

    // Recuerdo 1 → 2: el botón troll
    if (action === 'troll') {
      if (Troll.attempt() === 'dodge') return;
      this.busy = true;
      this.el.actions.classList.remove('is-ready');
      await wait(900);                    // tiempo para leer "ya ya mijo ya"
      Troll.restore();
      this.showMemory(1);
      return;
    }

    // Recuerdo 2 → 3: evento legendario y luego la última carta
    if (action === 'legend') {
      this.busy = true;
      this.setReady(false);
      await Legend.play();
      this.showMemory(2);
      return;
    }

    // Recuerdo 3: fin de la Pantalla 2
    if (action === 'finish') {
      this.busy = true;
      setTimeout(() => { this.busy = false; }, 1000);
      const r = this.el.next.getBoundingClientRect();
      Ambient.burst(r.left + r.width / 2, r.top + r.height / 2, 26);
      SFX.confirm();
      goToStage(3);
    }
  },
};


/* ─────────────────────── 09. ROUTER · goToStage(n) ───────────────────────
   Cada pantalla es un <section class="stage" data-stage="N"> + un objeto
   con init() (eventos, 1 vez), enter() (al mostrarse) y leave() (al salir).
   Para añadir la Pantalla 3: crea su <section data-stage="3"> y un Stage3.  */

const STAGES = {
  1: Stage1,
  2: Stage2,
  // 3: Stage3,   ← próxima fase
};

function goToStage(n) {
  if (state.transitioning) return;

  const current = $(`.stage[data-stage="${state.stage}"]`);
  const next = $(`.stage[data-stage="${n}"]`);

  // Efecto visual común: destello global + latido del panel principal (data-pulse)
  restartAnimation($('#flash'), 'is-active');
  const pulseTarget = current?.querySelector('[data-pulse]');
  if (pulseTarget) restartAnimation(pulseTarget, 'is-pulse');

  console.log(`Transición a Pantalla ${n} lista`);

  // Si la pantalla aún no existe, nos quedamos aquí (terreno preparado)
  if (!next) return;

  state.transitioning = true;
  STAGES[state.stage]?.leave?.();
  current?.classList.add('is-leaving');           // fundido de salida (CSS)

  setTimeout(() => {
    current?.classList.remove('is-active', 'is-leaving');
    next.classList.add('is-active', 'is-entering'); // fundido de entrada (CSS)
    state.stage = n;
    STAGES[n]?.enter?.();

    setTimeout(() => {
      next.classList.remove('is-entering');
      state.transitioning = false;
    }, 800);
  }, 550);
}

// Expuesto en window para poder probarlo desde la consola del navegador
window.goToStage = goToStage;

/* ─────────────────────── 10. ARRANQUE DE LA APP ─────────────────────── */

function initAudioToggle() {
  const toggle = $('#audio-toggle');
  const label = $('#audio-state');

  toggle.addEventListener('click', () => {
    state.audioOn = !state.audioOn;
    if (state.audioOn) {
      SFX.enable();      // crea/reanuda el AudioContext dentro del gesto del usuario
      SFX.toggleOn();
    } else {
      SFX.disable();
    }
    toggle.setAttribute('aria-pressed', String(state.audioOn));
    label.textContent = state.audioOn ? 'ON' : 'OFF';
  });
}

/** Pitido al pasar el mouse por cualquier botón (solo con mouse, no en táctil). */
function initHoverSounds() {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const btn = e.target.closest('button');
    // relatedTarget dentro del mismo botón = el mouse se movió entre sus hijos
    if (btn && !btn.contains(e.relatedTarget) && !btn.disabled) SFX.hover();
  });
}

async function init() {
  $$('img').forEach(watchImage);
  Viewport.init();
  Ambient.init($('#bg-canvas'));
  initAudioToggle();
  initHoverSounds();
  Particles.init($('#particles'));
  Object.values(STAGES).forEach((stage) => stage.init()); // cada pantalla prepara sus eventos

  await Boot.run();          // 1.A
  await wait(300);
  STAGES[state.stage].enter(); // 1.B
}

// Con `defer` el DOM ya está listo, pero esto lo hace seguro en cualquier caso
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
