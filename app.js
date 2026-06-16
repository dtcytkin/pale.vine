'use strict';

/* ---------- State ---------- */
const state = {
  mode: 'canvas',            // 'canvas' | 'mask'
  mask: null,                // HTMLImageElement
  // artboard = logical drawing space in px (matches mask native size on load)
  artboard: { w: 1200, h: 1200 },
  // mask placement inside artboard
  maskT: { x: 0, y: 0, scale: 1, rot: 0 },
  // view transform (preview only, never exported)
  view: { x: 0, y: 0, scale: 1, rot: 0 },
  params: {
    size: 6, spacing: 14, influence: 0.7, sizeVar: 0.15,
    posVar: 0.2, threshold: 0.5, invert: false,
    dotColor: '#111111', bgColor: '#ffffff',
  },
  exportPx: 3000,
};

let maskSampler = null;       // { data, w, h } imageData of mask placed in artboard
let dotsCanvas = null;        // offscreen artboard render of dots
let dotsDirty = true;
let samplerDirty = true;

const screen = document.getElementById('screen');
const sctx = screen.getContext('2d');
let DPR = Math.min(window.devicePixelRatio || 1, 2.5);

/* ---------- Deterministic jitter (stable per grid cell) ---------- */
function hash2(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000; // 0..1
}

/* ---------- Mask sampling ---------- */
function rebuildSampler() {
  samplerDirty = false;
  const { w, h } = state.artboard;
  // sample at reduced res for speed, but enough detail
  const sw = Math.min(w, 1400);
  const scale = sw / w;
  const sh = Math.round(h * scale);
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.fillStyle = '#ffffff';
  cx.fillRect(0, 0, sw, sh);

  if (state.mask) {
    const t = state.maskT;
    cx.save();
    cx.scale(scale, scale);
    cx.translate(t.x + (state.mask.width * t.scale) / 2, t.y + (state.mask.height * t.scale) / 2);
    cx.rotate(t.rot);
    cx.scale(t.scale, t.scale);
    cx.drawImage(state.mask, -state.mask.width / 2, -state.mask.height / 2);
    cx.restore();
  }
  const img = cx.getImageData(0, 0, sw, sh);
  maskSampler = { data: img.data, w: sw, h: sh, sx: sw / w, sy: sh / h };
}

// returns luminance 0(black)..1(white) at artboard coords
function sampleLum(ax, ay) {
  if (!maskSampler) return 1;
  let x = Math.floor(ax * maskSampler.sx);
  let y = Math.floor(ay * maskSampler.sy);
  if (x < 0 || y < 0 || x >= maskSampler.w || y >= maskSampler.h) return 1;
  const i = (y * maskSampler.w + x) * 4;
  const d = maskSampler.data;
  const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
  return lum;
}

/* ---------- Dot rendering (artboard space) ---------- */
function renderDots(ctx, w, h, sup = 1) {
  const p = state.params;
  ctx.save();
  ctx.fillStyle = p.bgColor;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = p.dotColor;

  const step = p.spacing * sup;
  const baseR = (p.size * sup) / 2;
  const thr = p.threshold;

  for (let gy = step / 2; gy < h; gy += step) {
    for (let gx = step / 2; gx < w; gx += step) {
      const ix = Math.round(gx / step), iy = Math.round(gy / step);
      // sample at artboard coords (divide out supersample)
      let lum = sampleLum(gx / sup, gy / sup);
      if (p.invert) lum = 1 - lum;

      // darkness 0..1 (1 = fully black)
      const dark = 1 - lum;
      // threshold gate: need dark enough
      if (dark < (1 - thr)) continue;

      // brightness -> size: darker = bigger
      const darkNorm = thr > 0 ? Math.min(1, (dark - (1 - thr)) / thr) : 1;
      const sizeFactor = (1 - p.influence) + p.influence * darkNorm;

      // size dispersion
      const rs = (hash2(ix, iy) - 0.5) * 2;        // -1..1
      const sizeJit = 1 + rs * p.sizeVar;

      let r = baseR * sizeFactor * sizeJit;
      if (r <= 0.2) continue;

      // position dispersion
      const jx = (hash2(ix + 7, iy + 13) - 0.5) * 2 * p.posVar * step;
      const jy = (hash2(ix + 31, iy + 17) - 0.5) * 2 * p.posVar * step;

      ctx.beginPath();
      ctx.arc(gx + jx, gy + jy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function rebuildDots() {
  dotsDirty = false;
  const { w, h } = state.artboard;
  if (!dotsCanvas) dotsCanvas = document.createElement('canvas');
  dotsCanvas.width = w; dotsCanvas.height = h;
  const ctx = dotsCanvas.getContext('2d');
  renderDots(ctx, w, h, 1);
}

/* ---------- Screen composite ---------- */
function resizeScreen() {
  const r = screen.getBoundingClientRect();
  screen.width = Math.round(r.width * DPR);
  screen.height = Math.round(r.height * DPR);
  draw();
}

function artboardToScreenBase() {
  // base fit transform: center artboard in stage with contain
  const sw = screen.width, sh = screen.height;
  const { w, h } = state.artboard;
  const fit = Math.min(sw / w, sh / h) * 0.92;
  return { fit, ox: (sw - w * fit) / 2, oy: (sh - h * fit) / 2 };
}

let rafPending = false;
function draw() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    _draw();
  });
}

function _draw() {
  if (samplerDirty) rebuildSampler();
  if (dotsDirty) rebuildDots();

  const sw = screen.width, sh = screen.height;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, sw, sh);

  const { fit, ox, oy } = artboardToScreenBase();
  const v = state.view;

  // apply view transform around stage center
  sctx.translate(sw / 2 + v.x * DPR, sh / 2 + v.y * DPR);
  sctx.rotate(v.rot);
  sctx.scale(v.scale, v.scale);
  sctx.translate(-sw / 2, -sh / 2);

  // then base fit
  sctx.translate(ox, oy);
  sctx.scale(fit, fit);

  const { w, h } = state.artboard;

  if (state.mode === 'mask') {
    // show dots faint as reference
    if (dotsCanvas) { sctx.globalAlpha = 0.25; sctx.drawImage(dotsCanvas, 0, 0); sctx.globalAlpha = 1; }
    // artboard frame
    sctx.fillStyle = '#ffffff'; sctx.globalAlpha = 0.04; sctx.fillRect(0, 0, w, h); sctx.globalAlpha = 1;
    // mask itself
    if (state.mask) {
      const t = state.maskT;
      sctx.save();
      sctx.translate(t.x + (state.mask.width * t.scale) / 2, t.y + (state.mask.height * t.scale) / 2);
      sctx.rotate(t.rot);
      sctx.scale(t.scale, t.scale);
      sctx.globalAlpha = 0.9;
      sctx.drawImage(state.mask, -state.mask.width / 2, -state.mask.height / 2);
      sctx.restore();
    }
    // artboard border
    sctx.lineWidth = 2 / fit / v.scale; sctx.strokeStyle = '#4f8cff'; sctx.strokeRect(0, 0, w, h);
  } else {
    if (dotsCanvas) sctx.drawImage(dotsCanvas, 0, 0);
  }
}

/* ---------- Export ---------- */
function exportPNG() {
  if (!state.mask) { alert('Сначала загрузи маску.'); return; }
  const { w, h } = state.artboard;
  const long = Math.max(w, h);
  const sup = state.exportPx / long;
  const ow = Math.round(w * sup), oh = Math.round(h * sup);

  const c = document.createElement('canvas');
  c.width = ow; c.height = oh;
  const ctx = c.getContext('2d');
  // render dots directly at high res so circles stay crisp
  renderDots(ctx, ow, oh, sup);

  c.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `palevine_${ow}x${oh}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}

/* ---------- Mask load ---------- */
// logical artboard resolution is independent of mask pixel size:
// a small mask is only a luminance source — the grid lives in this space.
const ARTBOARD_LONG = 2400;

function loadFile(file) {
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    state.mask = img;
    const ar = img.width / img.height;
    state.artboard = ar >= 1
      ? { w: ARTBOARD_LONG, h: Math.round(ARTBOARD_LONG / ar) }
      : { w: Math.round(ARTBOARD_LONG * ar), h: ARTBOARD_LONG };
    state.view = { x: 0, y: 0, scale: 1, rot: 0 };
    fitMask();                 // place mask to fill artboard
    samplerDirty = true; dotsDirty = true;
    document.getElementById('empty-hint').style.display = 'none';
    updateExportInfo();
    draw();
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
}

/* ---------- Gestures (pointer events) ---------- */
const pointers = new Map();
let gesture = null;

function targetT() { return state.mode === 'mask' ? state.maskT : state.view; }

screen.addEventListener('pointerdown', (e) => {
  screen.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  startGesture();
});
screen.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  updateGesture();
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) gesture = null;
  if (pointers.size >= 1) startGesture();
}
screen.addEventListener('pointerup', endPointer);
screen.addEventListener('pointercancel', endPointer);

function pointsArr() { return [...pointers.values()]; }
function centroid(pts) {
  return pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
}

function startGesture() {
  const pts = pointsArr();
  const t = targetT();
  const c = centroid(pts);
  let dist = 0, ang = 0;
  if (pts.length >= 2) {
    const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
    dist = Math.hypot(dx, dy); ang = Math.atan2(dy, dx);
  }
  gesture = { c, dist, ang, start: { x: t.x, y: t.y, scale: t.scale, rot: t.rot }, n: pts.length };
}

function updateGesture() {
  if (!gesture) return;
  const pts = pointsArr();
  const t = targetT();
  const c = centroid(pts);

  // pan (1 or 2 fingers)
  t.x = gesture.start.x + (c.x - gesture.c.x);
  t.y = gesture.start.y + (c.y - gesture.c.y);

  if (pts.length >= 2 && gesture.n >= 2 && gesture.dist > 0) {
    const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
    const dist = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const sc = dist / gesture.dist;
    t.scale = gesture.start.scale * sc;
    t.rot = gesture.start.rot + (ang - gesture.ang);
  }

  if (state.mode === 'mask') samplerDirty = true;
  draw();
}

/* ---------- UI wiring ---------- */
const $ = (id) => document.getElementById(id);

function bindRange(id, key, fmt, transform) {
  const el = $(id), out = $('v-' + id);
  const apply = () => {
    const raw = parseFloat(el.value);
    state.params[key] = transform ? transform(raw) : raw;
    if (out) out.textContent = fmt ? fmt(raw) : raw;
    dotsDirty = true; draw();
  };
  el.addEventListener('input', apply);
  apply();
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('#mode-switch .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  $('mode-badge').textContent = mode === 'mask' ? 'Маска' : 'Canvas';
  $('view-actions').hidden = mode !== 'canvas';
  $('mask-actions').hidden = mode !== 'mask';
  gesture = null;
  draw();
}

function updateExportInfo() {
  const { w, h } = state.artboard;
  const long = Math.max(w, h);
  const sup = state.exportPx / long;
  const ow = Math.round(w * sup), oh = Math.round(h * sup);
  $('export-info').textContent = `${ow} × ${oh} px  ·  ${(ow / 11.7).toFixed(0)} dpi @ A4`;
}

function fitMask() {
  if (!state.mask) return;
  const { w, h } = state.artboard;
  const s = Math.min(w / state.mask.width, h / state.mask.height);
  state.maskT = {
    x: (w - state.mask.width * s) / 2,
    y: (h - state.mask.height * s) / 2,
    scale: s, rot: 0,
  };
  samplerDirty = true; draw();
}

function init() {
  bindRange('size', 'size', v => v);
  bindRange('spacing', 'spacing', v => v);
  bindRange('influence', 'influence', v => v, v => v / 100);
  bindRange('sizevar', 'sizeVar', v => v, v => v / 100);
  bindRange('posvar', 'posVar', v => v, v => v / 100);
  bindRange('threshold', 'threshold', v => v, v => v / 100);

  $('invert').addEventListener('change', e => { state.params.invert = e.target.checked; dotsDirty = true; draw(); });
  $('dot-color').addEventListener('input', e => { state.params.dotColor = e.target.value; dotsDirty = true; draw(); });
  $('bg-color').addEventListener('input', e => { state.params.bgColor = e.target.value; dotsDirty = true; draw(); });

  $('exportpx').addEventListener('input', e => {
    state.exportPx = parseInt(e.target.value, 10);
    $('v-exportpx').textContent = state.exportPx;
    updateExportInfo();
  });

  $('file').addEventListener('change', e => loadFile(e.target.files[0]));
  $('load-btn').addEventListener('click', () => $('file').click());
  $('load-empty').addEventListener('click', () => $('file').click());
  $('export-btn').addEventListener('click', exportPNG);
  $('reset-view').addEventListener('click', () => { state.view = { x: 0, y: 0, scale: 1, rot: 0 }; draw(); });
  $('fit-mask').addEventListener('click', fitMask);

  document.querySelectorAll('#mode-switch .seg-btn').forEach(b =>
    b.addEventListener('click', () => setMode(b.dataset.mode)));

  $('panel-toggle').addEventListener('click', () => {
    document.getElementById('app').classList.add('panel-collapsed');
    $('panel-open').hidden = false;
  });
  $('panel-open').addEventListener('click', () => {
    document.getElementById('app').classList.remove('panel-collapsed');
    $('panel-open').hidden = true;
  });

  window.addEventListener('resize', () => { DPR = Math.min(window.devicePixelRatio || 1, 2.5); resizeScreen(); });
  resizeScreen();
  updateExportInfo();
}

init();

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
