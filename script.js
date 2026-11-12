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
     06. Particles → partículas de energía en <canvas>
     07. Boot      → sub-estado 1.A (secuencia de arranque)
     08. Stage1    → sub-estados 1.B y 1.C (consola + ruptura de protocolo)
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
});

// Estado compartido por todas las pantallas (crecerá con la Pantalla 2, 3...)
const state = {
  stage: 1,
  aspirantName: '',
  audioOn: false,
  busy: false,           // evita dobles envíos mientras corre una animación
};

/* ─────────────────────── 01. UTILIDADES ─────────────────────── */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Promesa que se resuelve tras `ms` milisegundos (permite usar await). */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isFinePointer = window.matchMedia('(pointer: fine)').matches; // mouse/trackpad
const isMobileLayout = () => window.matchMedia('(max-width: 900px)').matches;

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
    requestAnimationFrame(frame);
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
      lastTime = performance.now();
      requestAnimationFrame(frame);
    },
    surge() { boost = prefersReducedMotion ? 1.2 : 3.2; },
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
      if (verifyBtn.disabled) return;
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
};

/* ─────────────────────── 09. ROUTER · goToStage(n) ───────────────────────
   Cada pantalla es un <section class="stage" data-stage="N">.
   Para añadir la Pantalla 2: crea su <section data-stage="2"> en el HTML
   y (opcional) un objeto Stage2 con init()/enter() registrado en STAGES.   */

const STAGES = {
  1: Stage1,
  // 2: Stage2,   ← próxima fase
};

function goToStage(n) {
  const next = $(`.stage[data-stage="${n}"]`);
  const flash = $('#flash');
  const hud = $('#hud');
  const verifyBtn = $('#verify-btn');

  // Efecto visual de pulso (destello global + latido de la consola)
  restartAnimation(flash, 'is-active');
  restartAnimation(hud, 'is-pulse');
  Particles.surge();

  // Bloqueo breve para evitar clics repetidos
  verifyBtn.disabled = true;
  setTimeout(() => { verifyBtn.disabled = false; }, 900);

  console.log(`Transición a Pantalla ${n} lista`);

  // Si la pantalla aún no existe, nos quedamos aquí (terreno preparado)
  if (!next) return;

  // Cuando exista: ocultar la actual, mostrar la siguiente y llamar a su enter()
  setTimeout(() => {
    $(`.stage[data-stage="${state.stage}"]`)?.classList.remove('is-active');
    next.classList.add('is-active');
    state.stage = n;
    STAGES[n]?.enter?.();
  }, 450);
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
  initAudioToggle();
  initHoverSounds();
  Particles.init($('#particles'));
  STAGES[state.stage].init();

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
