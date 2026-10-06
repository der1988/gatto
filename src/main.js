import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/playfair-display/latin-400.css';
import { Cat } from './cat.js';
import { Room, roomTerrain as terrain, ROOM_BOUNDS } from './room.js';
import { AmbientAudio } from './audio.js';

const canvas = document.querySelector('#scene');
const ctx = canvas.getContext('2d', { alpha: false });
const cat = new Cat({ x: -25, terrain });
const world = new Room();
const audio = new AmbientAudio();
const keys = new Set();
const pointerHolds = new Map();
let jumpPressed = false;
let paused = false;
let skeleton = false;
let lastDirection = 1;
let cameraX = 0;
let w = innerWidth;
let h = innerHeight;
let scale = 1.6;
let time = 0;
let explored = false;
let autoChase = false;
let modalWasPaused = false;
let accumulator = 0;
let lastTime = 0;
let uiTime = 0;
const FIXED_STEP = 1 / 120;

const pauseButton = document.querySelector('#pause');
const skeletonButton = document.querySelector('#skeleton');
const instructions = document.querySelector('#instructions');
const instinctButton = document.querySelector('#instinct');

function resize() {
  w = innerWidth; h = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scale = Math.min(1.2, Math.max(.8, w * .87 / (ROOM_BOUNDS.max - ROOM_BOUNDS.min)), h * .66 / -ROOM_BOUNDS.ceiling);
  cameraX = cameraTarget();
  world.draw(ctx, w, h, cameraX, scale, time, cat, skeleton);
}

function held(action) {
  const codes = { left: 'ArrowLeft', right: 'ArrowRight', run: 'KeyA', jump: 'KeyS' };
  return keys.has(codes[action]) || [...pointerHolds.values()].includes(action);
}

function clearInput() {
  keys.clear(); pointerHolds.clear(); jumpPressed = false;
  updateKeyStyles();
}

function updateKeyStyles() {
  for (const key of document.querySelectorAll('[data-hold]')) key.classList.toggle('active', held(key.dataset.hold));
}

function setPaused(value) {
  paused = value;
  pauseButton.setAttribute('aria-pressed', String(paused));
  pauseButton.setAttribute('aria-label', paused ? 'Riprendi' : 'Metti in pausa');
  document.querySelector('#pause-overlay').hidden = !paused || instructions.open;
  if (paused) clearInput();
}

function toggleSkeleton() {
  skeleton = !skeleton;
  skeletonButton.setAttribute('aria-pressed', String(skeleton));
  document.querySelector('#anatomy-label').hidden = !skeleton;
  document.querySelector('#anatomy-status').textContent = skeleton ? 'ANATOMIA IN VISTA' : 'MOVIMENTO PROCEDURALE';
}

function reset() {
  cat.reset(-25, terrain);
  cameraX = cameraTarget();
  world.reset();
  audio.contacts.clear(); audio.wasGrounded = true;
  setAutoChase(false);
  explored = false;
  document.body.classList.remove('has-explored', 'moving');
  clearInput();
  setPaused(false);
  updateTelemetry();
}

function beginExploring() {
  if (explored) return;
  explored = true;
  document.body.classList.add('has-explored');
}

function setAutoChase(value) {
  autoChase = value;
  instinctButton.setAttribute('aria-pressed', String(value));
  instinctButton.setAttribute('aria-label', value ? 'Ferma l’inseguimento automatico' : 'Insegui il laser automaticamente');
  document.querySelector('#instinct-caption').textContent = value ? 'istinto attivo' : 'segui il laser';
  if (value) { clearInput(); beginExploring(); }
}

function cameraTarget() {
  const halfView = w / (2 * scale);
  if (halfView >= (ROOM_BOUNDS.max - ROOM_BOUNDS.min) / 2) return 0;
  return Math.max(ROOM_BOUNDS.min + halfView - 30, Math.min(ROOM_BOUNDS.max - halfView + 30, cat.x + cat.vx * .15));
}

document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || instructions.open) return;
  if (event.code === 'Space' && event.target.closest?.('button, a, input, select, textarea')) return;
  if (!['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyS', 'KeyX', 'KeyR', 'KeyI', 'Space'].includes(event.code)) return;
  event.preventDefault();
  if (!event.repeat) {
    if (event.code === 'Space') { setPaused(!paused); return; }
    if (event.code === 'KeyX') { toggleSkeleton(); return; }
    if (event.code === 'KeyR') { reset(); return; }
    if (event.code === 'KeyI') { setAutoChase(!autoChase); return; }
    if (!paused && event.code === 'KeyS') { jumpPressed = true; beginExploring(); }
    if (event.code === 'ArrowLeft') lastDirection = -1;
    if (event.code === 'ArrowRight') lastDirection = 1;
  }
  if (!paused) {
    if (['ArrowLeft', 'ArrowRight', 'KeyS'].includes(event.code)) setAutoChase(false);
    keys.add(event.code);
  }
  updateKeyStyles();
});

document.addEventListener('keyup', event => {
  keys.delete(event.code); updateKeyStyles();
});

for (const button of document.querySelectorAll('[data-hold]')) {
  const keyboardToken = `keyboard-${button.dataset.hold}`;
  button.addEventListener('keydown', event => {
    if (!['Space', 'Enter'].includes(event.code)) return;
    event.preventDefault(); event.stopPropagation();
    if (paused || event.repeat || pointerHolds.has(keyboardToken)) return;
    setAutoChase(false);
    pointerHolds.set(keyboardToken, button.dataset.hold);
    if (button.dataset.hold === 'jump') { jumpPressed = true; beginExploring(); }
    if (button.dataset.hold === 'left') lastDirection = -1;
    if (button.dataset.hold === 'right') lastDirection = 1;
    updateKeyStyles();
  });
  button.addEventListener('keyup', event => {
    if (!['Space', 'Enter'].includes(event.code)) return;
    event.preventDefault(); event.stopPropagation();
    pointerHolds.delete(keyboardToken); updateKeyStyles();
  });
  button.addEventListener('blur', () => {
    pointerHolds.delete(keyboardToken); updateKeyStyles();
  });
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    if (paused) return;
    setAutoChase(false);
    button.setPointerCapture(event.pointerId);
    pointerHolds.set(event.pointerId, button.dataset.hold);
    if (button.dataset.hold === 'jump') { jumpPressed = true; beginExploring(); }
    if (button.dataset.hold === 'left') lastDirection = -1;
    if (button.dataset.hold === 'right') lastDirection = 1;
    updateKeyStyles();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, event => {
    pointerHolds.delete(event.pointerId); updateKeyStyles();
  });
}

pauseButton.addEventListener('click', () => setPaused(!paused));
document.querySelector('#resume').addEventListener('click', () => setPaused(false));
document.querySelector('#reset').addEventListener('click', reset);
skeletonButton.addEventListener('click', toggleSkeleton);
instinctButton.addEventListener('click', () => setAutoChase(!autoChase));
canvas.addEventListener('pointerdown', event => {
  if (paused || instructions.open) return;
  const point = world.screenToWorld(event.clientX, event.clientY, w, h, cameraX, scale);
  world.laser.place(point.x, point.y);
});
document.querySelector('#sound').addEventListener('click', async event => {
  const button = event.currentTarget;
  try {
    const enabled = await audio.toggle();
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', enabled ? 'Disattiva suoni ambientali' : 'Attiva suoni ambientali');
  } catch {
    button.setAttribute('aria-label', 'Suoni non disponibili in questo browser');
  }
});

document.querySelector('#help').addEventListener('click', () => {
  modalWasPaused = paused;
  instructions.showModal();
  setPaused(true);
});
for (const id of ['close-help', 'explore']) document.querySelector(`#${id}`).addEventListener('click', () => instructions.close());
instructions.addEventListener('click', event => {
  if (event.target !== instructions) return;
  const bounds = instructions.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) instructions.close();
});
instructions.addEventListener('close', () => setPaused(modalWasPaused));
window.addEventListener('resize', resize);
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => {
  clearInput(); lastTime = 0; accumulator = 0;
  if (document.hidden) setPaused(true);
});

function updateTelemetry() {
  const state = cat.getTelemetry();
  document.querySelector('#speed').textContent = (Math.abs(cat.vx) / 150).toFixed(1);
  const gait = !cat.grounded ? (cat.vy < -20 ? 'IN SALTO' : 'IN VOLO') : Math.abs(cat.vx) < 4 ? 'A RIPOSO' : Math.abs(cat.vx) > 220 ? 'GALOPPO' : Math.abs(cat.vx) > 150 ? 'TROTTO' : 'AL PASSO';
  document.querySelector('#gait').textContent = gait;
  document.querySelector('#score').textContent = String(world.laser.score).padStart(2, '0');
  document.querySelector('#score-mobile').textContent = `${world.laser.score} PUNTINI PRESI`;
  document.body.classList.toggle('moving', state.speed > 4 && !paused);
}

function frame(stamp) {
  if (!lastTime) lastTime = stamp;
  const elapsed = Math.min((stamp - lastTime) / 1000, .08);
  lastTime = stamp;
  if (!paused) {
    accumulator = Math.min(accumulator + elapsed, .12);
    while (accumulator >= FIXED_STEP) {
      const left = held('left'); const right = held('right');
      const direction = left && right ? lastDirection : (right ? 1 : 0) - (left ? 1 : 0);
      if (direction || jumpPressed) beginExploring();
      const input = autoChase ? world.laser.inputFor(cat) : { direction, run: held('run'), jumpPressed, jumpHeld: held('jump') };
      cat.update(FIXED_STEP, input, terrain);
      jumpPressed = false;
      world.update(FIXED_STEP, cat);
      audio.update(FIXED_STEP, cat, paused);
      time += FIXED_STEP;
      accumulator -= FIXED_STEP;
    }
    const target = cameraTarget();
    cameraX += (target - cameraX) * (1 - Math.exp(-elapsed * 4));
  } else accumulator = 0;
  world.draw(ctx, w, h, cameraX, scale, time, cat, skeleton);
  uiTime += elapsed;
  if (uiTime > .08) { updateTelemetry(); uiTime = 0; }
  requestAnimationFrame(frame);
}

// A read-only snapshot for inspecting the simulation and automated smoke tests.
window.felis = Object.freeze({
  getState: () => ({
    x: cat.x, y: cat.y, vx: cat.vx, vy: cat.vy,
    facing: cat.facing, grounded: cat.grounded, jumpCount: cat.jumpCount,
    terrainY: terrain(cat.x), supportHeight: cat.supportHeight, size: cat.size,
    supportY: cat.supportY ?? 0, platformId: cat.platformId ?? null,
    phase: cat.phase, suspension: cat.pose.suspension ?? false,
    motionPhase: cat.pose.motionPhase ?? (cat.grounded ? cat.gait : 'salto'),
    paused, skeleton, gait: cat.getTelemetry().gait,
    room: 'salotto', autoChase, score: world.laser.score,
    laser: { x: world.laser.x, y: world.laser.y },
    view: { width: w, height: h, scale, cameraX, floor: world.floor(h, w) },
  }),
  getRig: () => ({
    size: cat.size,
    body: structuredClone(cat.pose),
    legs: cat.legs.map(leg => ({ kind: leg.kind, far: leg.far, stance: leg.stance, paw: { ...leg.paw }, pose: structuredClone(leg.pose) })),
  }),
});
resize();
updateTelemetry();
requestAnimationFrame(frame);
