'use strict';
(() => {
  const { MATERIALS, QUICK_SIZES, STAMPS, PATTERNS, openArea } = window.GD_DATA;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString();
  const STORE_KEY = 'grille-designer:v1';
  const MAX_HOLES = 400000;

  const DEFAULT_CFG = {
    material: 'R2.0 T3.5', d: 2.0, c: 3.5, pattern: '60', orient: 'h', thickness: 1.0,
    shape: 'rect', width: 250, height: 400, radius: 10, margin: 8,
    mount: { on: true, count: 4, d: 4, inset: 8, keepout: 3 },
  };

  const FINISHES = {
    silver: { metal: '#b9bec5', sheen: true, hole: '#0b0c0e' },
    black: { metal: '#2b2d31', sheen: true, hole: '#060607' },
    white: { metal: '#e9e7e2', sheen: false, hole: '#141414' },
    brass: { metal: '#b89b5e', sheen: true, hole: '#0c0a06' },
    copper: { metal: '#b8734d', sheen: true, hole: '#0c0705' },
    bronze: { metal: '#6d5a44', sheen: true, hole: '#070604' },
  };

  // ---------------------------------------------------------------- state
  const S = {
    cfg: structuredClone(DEFAULT_CFG),
    n: 0, xs: null, ys: null, li: null, lk: null, on: new Uint8Array(0),
    hash: null, nbrs: null,
    tool: 'brush', mode: 1, brush: 8, filled: true, snap: true,
    sym: { type: 'none', n: 6 },
    text: { str: 'HI-FI', size: 40, font: 'Arial Black, Arial, sans-serif', bold: true, rot: 0 },
    stamp: 'heart',
    guides: [],
    display: 'edit', finish: 'silver', backlight: false,
    view: { scale: 1, ox: 0, oy: 0 },
    preview: null, previewVal: 1, previewSrc: null,
    cursor: null,
    undo: [], redo: [],
  };

  const cv = $('#cv');
  const ctx = cv.getContext('2d');

  // ---------------------------------------------------------------- geometry
  function latticeSteps(p, c) {
    if (p === '60') return { dx: c, dy: (c * Math.sqrt(3)) / 2, st: true };
    if (p === '45') return { dx: c * Math.SQRT2, dy: c / Math.SQRT2, st: true };
    return { dx: c, dy: c, st: false };
  }

  // signed distance to the grille outline (negative inside), origin at centre
  function sdFace(x, y, cfg = S.cfg) {
    const W = cfg.width / 2, H = cfg.height / 2;
    if (cfg.shape === 'ellipse') {
      const k0 = Math.hypot(x / W, y / H), k1 = Math.hypot(x / (W * W), y / (H * H));
      return k1 === 0 ? -Math.min(W, H) : (k0 * (k0 - 1)) / k1;
    }
    const R = Math.min(cfg.radius, W, H);
    const qx = Math.abs(x) - (W - R), qy = Math.abs(y) - (H - R);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - R;
  }

  function faceArea(cfg = S.cfg) {
    const W = cfg.width / 2, H = cfg.height / 2;
    if (cfg.shape === 'ellipse') return Math.PI * W * H;
    const R = Math.min(cfg.radius, W, H);
    return 4 * W * H - (4 - Math.PI) * R * R;
  }

  function facePath(c, inset = 0, cfg = S.cfg) {
    const W = cfg.width / 2 - inset, H = cfg.height / 2 - inset;
    if (W <= 0 || H <= 0) return;
    if (cfg.shape === 'ellipse') { c.ellipse(0, 0, W, H, 0, 0, TAU); return; }
    const R = clamp(Math.min(cfg.radius, cfg.width / 2, cfg.height / 2) - inset, 0, Math.min(W, H));
    c.moveTo(-W + R, -H);
    c.arcTo(W, -H, W, H, R); c.arcTo(W, H, -W, H, R);
    c.arcTo(-W, H, -W, -H, R); c.arcTo(-W, -H, W, -H, R);
    c.closePath();
  }

  function mountPoints(cfg = S.cfg) {
    const m = cfg.mount;
    if (!m.on) return [];
    const W = cfg.width / 2, H = cfg.height / 2, pts = [];
    if (cfg.shape === 'rect') {
      const ax = W - m.inset, ay = H - m.inset;
      pts.push({ x: -ax, y: -ay }, { x: ax, y: -ay }, { x: ax, y: ay }, { x: -ax, y: ay });
      if (m.count >= 8) pts.push({ x: 0, y: -ay }, { x: 0, y: ay }, { x: -ax, y: 0 }, { x: ax, y: 0 });
      else if (m.count >= 6) {
        if (W >= H) pts.push({ x: 0, y: -ay }, { x: 0, y: ay });
        else pts.push({ x: -ax, y: 0 }, { x: ax, y: 0 });
      }
    } else {
      for (let k = 0; k < m.count; k++) {
        const a = ((k + 0.5) / m.count) * TAU;
        pts.push({ x: (W - m.inset) * Math.cos(a), y: (H - m.inset) * Math.sin(a) });
      }
    }
    return pts;
  }

  // ---------------------------------------------------------------- hole grid
  const hkey = (ix, iy) => (ix + 32768) * 65536 + (iy + 32768);
  function buildHash(xs, ys, n, cell) {
    const m = new Map();
    for (let i = 0; i < n; i++) {
      const k = hkey(Math.floor(xs[i] / cell), Math.floor(ys[i] / cell));
      let a = m.get(k);
      if (!a) m.set(k, (a = []));
      a.push(i);
    }
    return { m, cell, xs, ys };
  }
  function nearestIn(h, x, y, maxD) {
    if (!h) return -1;
    maxD = Math.min(maxD, h.cell);
    const ix = Math.floor(x / h.cell), iy = Math.floor(y / h.cell);
    let best = -1, bd = maxD * maxD;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const arr = h.m.get(hkey(ix + a, iy + b));
      if (!arr) continue;
      for (const j of arr) {
        const d2 = (h.xs[j] - x) ** 2 + (h.ys[j] - y) ** 2;
        if (d2 <= bd) { bd = d2; best = j; }
      }
    }
    return best;
  }
  const nearest = (x, y, maxD = S.cfg.c) => nearestIn(S.hash, x, y, maxD);

  function estimateHoles(cfg) {
    const { dx, dy } = latticeSteps(cfg.pattern, cfg.c);
    return (cfg.width * cfg.height) / (dx * dy);
  }

  function generate(keep) {
    const cfg = S.cfg;
    const old = keep && S.n ? { hash: S.hash, on: S.on, c: S.hash.cell } : null;
    const { dx, dy, st } = latticeSteps(cfg.pattern, cfg.c);
    const r = cfg.d / 2, inset = r + cfg.margin, vert = cfg.orient === 'v';
    const W = cfg.width / 2, H = cfg.height / 2;
    const EU = vert ? H : W, EV = vert ? W : H;
    const nk = Math.ceil(EV / dy) + 1, ni = Math.ceil(EU / dx) + 1;
    const mp = mountPoints(), mr = cfg.mount.d / 2 + cfg.mount.keepout + r;
    const xs = [], ys = [], li = [], lk = [];
    for (let k = -nk; k <= nk; k++) {
      const v = k * dy, off = st && k & 1 ? dx / 2 : 0;
      for (let i = -ni - 1; i <= ni; i++) {
        const u = i * dx + off;
        const x = vert ? v : u, y = vert ? u : v;
        if (sdFace(x, y) > -inset) continue;
        let blocked = false;
        for (const p of mp) if (Math.hypot(p.x - x, p.y - y) < mr) { blocked = true; break; }
        if (blocked) continue;
        xs.push(x); ys.push(y); li.push(i); lk.push(k);
      }
    }
    S.n = xs.length;
    S.xs = Float64Array.from(xs); S.ys = Float64Array.from(ys);
    S.li = Int32Array.from(li); S.lk = Int32Array.from(lk);
    S.hash = buildHash(S.xs, S.ys, S.n, cfg.c);
    S.nbrs = null;
    S.preview = null;
    const on = new Uint8Array(S.n);
    if (old) {
      const md = Math.max(old.c, cfg.c) * 0.6;
      for (let i = 0; i < S.n; i++) {
        const j = nearestIn(old.hash, S.xs[i], S.ys[i], md);
        if (j >= 0) on[i] = old.on[j];
      }
    }
    S.on = on;
  }

  function neighbors() {
    if (S.nbrs) return S.nbrs;
    const lim = (S.cfg.c * 1.05) ** 2, h = S.hash, out = new Array(S.n);
    for (let i = 0; i < S.n; i++) {
      const x = S.xs[i], y = S.ys[i], ix = Math.floor(x / h.cell), iy = Math.floor(y / h.cell), nb = [];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const arr = h.m.get(hkey(ix + a, iy + b));
        if (arr) for (const j of arr) if (j !== i && (S.xs[j] - x) ** 2 + (S.ys[j] - y) ** 2 <= lim) nb.push(j);
      }
      out[i] = nb;
    }
    return (S.nbrs = out);
  }

  // ---------------------------------------------------------------- symmetry
  const mul = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]];
  function symMats() {
    const I = [1, 0, 0, 1], FX = [-1, 0, 0, 1], FY = [1, 0, 0, -1];
    const { type, n } = S.sym;
    if (type === 'x') return [I, FX];
    if (type === 'y') return [I, FY];
    if (type === 'xy') return [I, FX, FY, [-1, 0, 0, -1]];
    if (type === 'radial' || type === 'kaleido') {
      const out = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU, R = [Math.cos(a), -Math.sin(a), Math.sin(a), Math.cos(a)];
        out.push(R);
        if (type === 'kaleido') out.push(mul(R, FX));
      }
      return out;
    }
    return [I];
  }

  // Which holes does `shape` ({test, bbox}) cover, including every symmetric copy?
  function forEachHit(shape, fn) {
    const mats = symMats(), bb = shape.bbox, t = shape.test;
    const xs = S.xs, ys = S.ys;
    for (let i = 0; i < S.n; i++) {
      const x = xs[i], y = ys[i];
      for (let m = 0; m < mats.length; m++) {
        const M = mats[m];
        // inverse of an orthogonal matrix is its transpose
        const px = M[0] * x + M[2] * y, py = M[1] * x + M[3] * y;
        if (bb && (px < bb.x0 || px > bb.x1 || py < bb.y0 || py > bb.y1)) continue;
        if (t(px, py)) { fn(i); break; }
      }
    }
  }
  function computeHits(shape) {
    const hits = new Uint8Array(S.n);
    if (shape) forEachHit(shape, (i) => (hits[i] = 1));
    return hits;
  }
  function applyHits(hits, val) {
    for (let i = 0; i < S.n; i++) if (hits[i]) S.on[i] = val;
    changed();
  }

  // ---------------------------------------------------------------- shapes
  const minHalf = () => S.cfg.c * 0.5; // guarantees gap-free single-row lines
  const strokeW = () => Math.max(S.brush, S.cfg.c);

  function capsule(a, b, hw) {
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy, hw2 = hw * hw;
    return {
      bbox: { x0: Math.min(a.x, b.x) - hw, x1: Math.max(a.x, b.x) + hw, y0: Math.min(a.y, b.y) - hw, y1: Math.max(a.y, b.y) + hw },
      test: (x, y) => {
        let t = L ? ((x - a.x) * dx + (y - a.y) * dy) / L : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = x - a.x - t * dx, ey = y - a.y - t * dy;
        return ex * ex + ey * ey <= hw2;
      },
    };
  }

  const rcv = document.createElement('canvas');
  const rctx = rcv.getContext('2d', { willReadFrequently: true });
  // Rasterise a drawing (in mm coordinates) and return a point test.
  function rasterShape(bbox, draw) {
    const w = bbox.x1 - bbox.x0, h = bbox.y1 - bbox.y0;
    const ppm = clamp(1600 / Math.max(w, h, 1), 0.3, 10);
    const cw = Math.max(1, Math.ceil(w * ppm)), ch = Math.max(1, Math.ceil(h * ppm));
    rcv.width = cw; rcv.height = ch;
    rctx.setTransform(ppm, 0, 0, ppm, -bbox.x0 * ppm, -bbox.y0 * ppm);
    rctx.fillStyle = rctx.strokeStyle = '#000';
    rctx.lineCap = rctx.lineJoin = 'round';
    draw(rctx);
    const data = rctx.getImageData(0, 0, cw, ch).data;
    return {
      bbox,
      test: (x, y) => {
        const px = ((x - bbox.x0) * ppm) | 0, py = ((y - bbox.y0) * ppm) | 0;
        if (px < 0 || py < 0 || px >= cw || py >= ch) return false;
        return data[(py * cw + px) * 4 + 3] > 127;
      },
    };
  }

  function boxFrom(a, b, e) {
    let x0, y0, x1, y1;
    let dx = b.x - a.x, dy = b.y - a.y;
    if (e.shiftKey) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
    if (e.altKey) { x0 = a.x - dx; x1 = a.x + dx; y0 = a.y - dy; y1 = a.y + dy; }
    else { x0 = a.x; x1 = a.x + dx; y0 = a.y; y1 = a.y + dy; }
    return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
  }
  const pad = (bb, p) => ({ x0: bb.x0 - p, y0: bb.y0 - p, x1: bb.x1 + p, y1: bb.y1 + p });

  const stampCache = new Map();
  const stampPath = (id) => {
    if (!stampCache.has(id)) stampCache.set(id, new Path2D((STAMPS.find((s) => s.id === id) || STAMPS[0]).d));
    return stampCache.get(id);
  };

  function dragShape(tool, a, b, e) {
    const hw = strokeW() / 2;
    if (tool === 'line') {
      let end = b;
      if (e.shiftKey) {
        const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 12)) * (Math.PI / 12);
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        end = { x: a.x + L * Math.cos(ang), y: a.y + L * Math.sin(ang) };
      }
      return capsule(a, end, Math.max(S.brush / 2, minHalf()));
    }
    let bb = boxFrom(a, b, e);
    if (tool === 'stamp' && bb.x1 - bb.x0 < 1 && bb.y1 - bb.y0 < 1) {
      const s = Math.min(S.cfg.width, S.cfg.height) * 0.35;
      bb = { x0: a.x - s / 2, y0: a.y - s / 2, x1: a.x + s / 2, y1: a.y + s / 2 };
    }
    const w = bb.x1 - bb.x0, h = bb.y1 - bb.y0;
    if (w < 0.5 && h < 0.5) return null;
    const filled = S.filled;
    return rasterShape(pad(bb, hw + 1), (c) => {
      c.lineWidth = hw * 2;
      c.beginPath();
      if (tool === 'rect') c.rect(bb.x0, bb.y0, w, h);
      else if (tool === 'ellipse') c.ellipse((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2, w / 2, h / 2, 0, 0, TAU);
      else if (tool === 'stamp') {
        const p = new Path2D();
        p.addPath(stampPath(S.stamp), new DOMMatrix().translate(bb.x0, bb.y0).scale(w / 100, h / 100));
        if (filled) c.fill(p, 'evenodd'); else c.stroke(p);
        return;
      }
      if (filled) c.fill(); else c.stroke();
    });
  }

  const mctx = document.createElement('canvas').getContext('2d');
  function textShape(p) {
    const t = S.text, lines = (t.str || ' ').split('\n');
    const font = `${t.bold ? 'bold ' : ''}${t.size}px ${t.font}`;
    mctx.font = font;
    const wmax = Math.max(...lines.map((l) => mctx.measureText(l).width), 1);
    const lh = t.size * 1.15, R = Math.hypot(wmax, lh * lines.length) / 2 + 2;
    return rasterShape({ x0: p.x - R, y0: p.y - R, x1: p.x + R, y1: p.y + R }, (c) => {
      c.translate(p.x, p.y);
      c.rotate((t.rot * Math.PI) / 180);
      c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
      lines.forEach((l, i) => c.fillText(l, 0, (i - (lines.length - 1) / 2) * lh));
    });
  }

  function floodFill(p, val) {
    const nb = neighbors(), mats = symMats();
    let count = 0;
    for (const M of mats) {
      const seed = nearest(M[0] * p.x + M[1] * p.y, M[2] * p.x + M[3] * p.y);
      if (seed < 0) continue;
      const target = S.on[seed];
      if (target === val) continue;
      const stack = [seed];
      S.on[seed] = val;
      while (stack.length) {
        const i = stack.pop(); count++;
        for (const j of nb[i]) if (S.on[j] === target) { S.on[j] = val; stack.push(j); }
      }
    }
    changed();
    return count;
  }

  // ---------------------------------------------------------------- patterns & image
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bayer = (i, k) => (BAYER[((k & 3) << 2) | (i & 3)] + 0.5) / 16;
  const hash01 = (i, seed) => {
    let h = (i * 374761393 + seed * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const insideGuides = (x, y) => S.guides.some((g) => Math.hypot(x - g.x, y - g.y) <= g.d / 2);

  function patternHits(id, p) {
    const def = PATTERNS[id];
    const g = { W: S.cfg.width / 2, H: S.cfg.height / 2, sd: (x, y) => sdFace(x, y), margin: S.cfg.margin };
    const hits = new Uint8Array(S.n);
    const onlyGuides = $('#patGuides').checked && S.guides.length;
    const t = def.test && def.test(p, g), dn = def.density && def.density(p, g);
    for (let i = 0; i < S.n; i++) {
      const x = S.xs[i], y = S.ys[i];
      if (onlyGuides && !insideGuides(x, -y)) continue;
      if (t) hits[i] = t(x, y) ? 1 : 0;
      else if (dn) hits[i] = dn(x, y) > bayer(S.li[i], S.lk[i]) ? 1 : 0;
      else if (def.randomDensity) hits[i] = hash01(i, p.seed) < p.density / 100 ? 1 : 0;
    }
    return hits;
  }

  let img = null;
  function imageHits() {
    if (!img) return null;
    const W = S.cfg.width, H = S.cfg.height;
    const ppm = clamp(1500 / Math.max(W, H), 0.5, 6);
    const cw = Math.ceil(W * ppm), ch = Math.ceil(H * ppm);
    rcv.width = cw; rcv.height = ch;
    rctx.setTransform(1, 0, 0, 1, 0, 0);
    rctx.fillStyle = '#fff'; rctx.fillRect(0, 0, cw, ch);
    const sc = Math.min(W / img.width, H / img.height) * (+$('#imgScale').value / 100);
    const iw = img.width * sc, ih = img.height * sc;
    const ox = +$('#imgX').value || 0, oy = +$('#imgY').value || 0;
    rctx.setTransform(ppm, 0, 0, ppm, (W / 2) * ppm, (H / 2) * ppm);
    rctx.drawImage(img, -iw / 2 + ox, -ih / 2 - oy, iw, ih);
    const data = rctx.getImageData(0, 0, cw, ch).data;
    const thr = +$('#imgThr').value, dither = $('#imgDither').checked, inv = $('#imgInvert').checked;
    const hits = new Uint8Array(S.n);
    for (let i = 0; i < S.n; i++) {
      const px = clamp(((S.xs[i] + W / 2) * ppm) | 0, 0, cw - 1), py = clamp(((S.ys[i] + H / 2) * ppm) | 0, 0, ch - 1);
      const o = (py * cw + px) * 4;
      let lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      if (inv) lum = 255 - lum;
      if (dither) hits[i] = clamp((255 - lum) / 255 + (128 - thr) / 255, 0, 1) > bayer(S.li[i], S.lk[i]) ? 1 : 0;
      else hits[i] = lum < thr ? 1 : 0;
    }
    return hits;
  }

  function applyReplace(hits, val, replace) {
    pushUndo();
    if (replace) for (let i = 0; i < S.n; i++) S.on[i] = hits[i] ? val : 1 - val;
    else for (let i = 0; i < S.n; i++) if (hits[i]) S.on[i] = val;
    changed();
  }

  function setPreview(hits, val, src) { S.preview = hits; S.previewVal = val; S.previewSrc = src; dirty(); }
  function clearPreview() { if (S.preview) { S.preview = null; S.previewSrc = null; dirty(); } }

  // ---------------------------------------------------------------- undo
  function snapshot() { return { cfg: JSON.stringify(S.cfg), on: S.on.slice() }; }
  function pushUndo() {
    S.undo.push(snapshot());
    const max = clamp(Math.floor(6e7 / Math.max(S.n, 1)), 10, 200);
    while (S.undo.length > max) S.undo.shift();
    S.redo.length = 0;
    updateUndoBtns();
  }
  function restore(snap) {
    if (snap.cfg !== JSON.stringify(S.cfg)) { S.cfg = JSON.parse(snap.cfg); generate(false); syncUI(); }
    if (snap.on.length === S.n) S.on = snap.on.slice();
    changed();
  }
  function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); updateUndoBtns(); }
  function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); updateUndoBtns(); }
  function updateUndoBtns() { $('#undoBtn').disabled = !S.undo.length; $('#redoBtn').disabled = !S.redo.length; }

  // ---------------------------------------------------------------- rendering
  let needsRender = true;
  const dirty = () => { if (!needsRender) { needsRender = true; requestAnimationFrame(render); } };

  function view() {
    const w = cv.clientWidth, h = cv.clientHeight, v = S.view;
    return { w, h, s: v.scale, tx: w / 2 + v.ox, ty: h / 2 + v.oy };
  }
  function toMM(sx, sy) { const v = view(); return { x: (sx - v.tx) / v.s, y: (sy - v.ty) / v.s }; }

  function drawGrille(c, s, opts) {
    const cfg = S.cfg, real = opts.real, fin = FINISHES[S.finish] || FINISHES.silver;
    const px = 1 / s, r = cfg.d / 2, W = cfg.width / 2, H = cfg.height / 2;
    // sheet
    c.save();
    if (opts.shadow) { c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 24; c.shadowOffsetY = 6; }
    c.beginPath(); facePath(c);
    c.fillStyle = real ? fin.metal : '#e3e6ea';
    c.fill();
    c.restore();
    if (real && fin.sheen) {
      const g = c.createLinearGradient(-W, -H, W, H);
      g.addColorStop(0, 'rgba(255,255,255,.22)'); g.addColorStop(0.45, 'rgba(255,255,255,0)');
      g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.22)');
      c.beginPath(); facePath(c); c.fillStyle = g; c.fill();
    }
    if (!real) {
      c.beginPath(); facePath(c, cfg.margin);
      c.setLineDash([4 * px, 4 * px]); c.strokeStyle = 'rgba(40,60,90,.35)'; c.lineWidth = px; c.stroke(); c.setLineDash([]);
    }
    // holes
    const big = r * s >= 1.2, xs = S.xs, ys = S.ys, on = S.on, pv = opts.preview ? S.preview : null;
    const pOn = new Path2D(), pOff = new Path2D(), pPv = new Path2D();
    const add = (p, x, y) => { if (big) { p.moveTo(x + r, y); p.arc(x, y, r, 0, TAU); } else p.rect(x - r, y - r, 2 * r, 2 * r); };
    for (let i = 0; i < S.n; i++) {
      if (pv && pv[i]) add(pPv, xs[i], ys[i]);
      if (on[i]) add(pOn, xs[i], ys[i]);
      else if (!real) add(pOff, xs[i], ys[i]);
    }
    if (!real) {
      if (r * s > 2.5) { c.strokeStyle = 'rgba(30,45,65,.30)'; c.lineWidth = px; c.stroke(pOff); }
      else { c.fillStyle = 'rgba(30,45,65,.14)'; c.fill(pOff); }
      c.fillStyle = '#1c2633'; c.fill(pOn);
    } else {
      c.fillStyle = S.backlight ? '#ffd27a' : fin.hole;
      if (S.backlight) { c.save(); c.shadowColor = 'rgba(255,190,90,.9)'; c.shadowBlur = Math.min(20, r * s * 2); c.fill(pOn); c.restore(); }
      else c.fill(pOn);
    }
    if (pv) { c.fillStyle = S.previewVal ? 'rgba(46,160,255,.85)' : 'rgba(255,80,80,.85)'; c.fill(pPv); }
    // mounting holes
    const mp = mountPoints();
    if (mp.length) {
      const mr = cfg.mount.d / 2;
      c.beginPath();
      for (const p of mp) { c.moveTo(p.x + mr, p.y); c.arc(p.x, p.y, mr, 0, TAU); }
      c.fillStyle = opts.bg; c.fill();
      if (!real) {
        c.strokeStyle = '#d06a1a'; c.lineWidth = 1.5 * px; c.stroke();
        c.beginPath();
        for (const p of mp) { c.moveTo(p.x + mr + cfg.mount.keepout + r, p.y); c.arc(p.x, p.y, mr + cfg.mount.keepout + r, 0, TAU); }
        c.setLineDash([3 * px, 3 * px]); c.strokeStyle = 'rgba(208,106,26,.5)'; c.lineWidth = px; c.stroke(); c.setLineDash([]);
      }
    }
  }

  function render() {
    needsRender = false;
    const dpr = window.devicePixelRatio || 1;
    const { w, h, s, tx, ty } = view();
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const bg = '#0f1114';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);
    const real = S.display === 'preview';
    drawGrille(ctx, s, { real, preview: true, shadow: true, bg });
    const px = 1 / s, W = S.cfg.width / 2, H = S.cfg.height / 2;

    if (!real) {
      // driver guides
      ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = 'rgba(255,170,40,.9)'; ctx.lineWidth = 1.5 * px;
      ctx.font = `${12 * px}px system-ui`; ctx.fillStyle = 'rgba(255,170,40,.95)'; ctx.textAlign = 'center';
      for (const g of S.guides) {
        ctx.beginPath(); ctx.arc(g.x, -g.y, g.d / 2, 0, TAU); ctx.stroke();
        ctx.fillText(`Ø${fmt(g.d)}`, g.x, -g.y + 4 * px);
      }
      ctx.setLineDash([]);
      // symmetry axes
      const t = S.sym.type;
      if (t !== 'none') {
        const L = Math.hypot(W, H) * 1.05;
        ctx.strokeStyle = 'rgba(255,110,200,.55)'; ctx.lineWidth = px; ctx.setLineDash([8 * px, 5 * px]);
        ctx.beginPath();
        const ray = (a, both) => { ctx.moveTo(both ? -L * Math.cos(a) : 0, both ? -L * Math.sin(a) : 0); ctx.lineTo(L * Math.cos(a), L * Math.sin(a)); };
        if (t === 'x' || t === 'xy') ray(Math.PI / 2, true);
        if (t === 'y' || t === 'xy') ray(0, true);
        if (t === 'radial') for (let k = 0; k < S.sym.n; k++) ray(-Math.PI / 2 + (k / S.sym.n) * TAU, false);
        if (t === 'kaleido') for (let k = 0; k < S.sym.n; k++) ray(Math.PI / 2 + (k / S.sym.n) * Math.PI, true);
        ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // cursor
    const cur = S.cursor;
    if (cur && (S.tool === 'brush')) {
      const hw = Math.max(S.brush / 2, minHalf());
      ctx.strokeStyle = S.mode ? 'rgba(46,160,255,.9)' : 'rgba(255,80,80,.9)'; ctx.lineWidth = 1.2 * px;
      ctx.beginPath();
      for (const M of symMats()) {
        const x = M[0] * cur.x + M[1] * cur.y, y = M[2] * cur.x + M[3] * cur.y;
        ctx.moveTo(x + hw, y); ctx.arc(x, y, hw, 0, TAU);
      }
      ctx.stroke();
    }
    updateStatus();
  }

  // ---------------------------------------------------------------- UI: status / stats
  function updateStatus() {
    const c = S.cursor;
    const tool = S.tool[0].toUpperCase() + S.tool.slice(1);
    $('#status').textContent = `${tool} · ${S.mode ? 'Punch' : 'Blank'}` +
      (c ? ` · X ${fmt(c.x + S.cfg.width / 2)}  Y ${fmt(S.cfg.height / 2 - c.y)} mm` : '') +
      ` · Zoom ${Math.round(S.view.scale * 100)}%`;
  }

  let statsTimer = 0, saveTimer = 0;
  function changed() {
    dirty();
    clearTimeout(statsTimer); statsTimer = setTimeout(updateStats, 60);
    clearTimeout(saveTimer); saveTimer = setTimeout(autosave, 600);
  }

  function updateStats() {
    let k = 0;
    for (let i = 0; i < S.n; i++) k += S.on[i];
    const r = S.cfg.d / 2, area = faceArea();
    const oaDesign = ((k * Math.PI * r * r) / area) * 100;
    const oaMax = ((S.n * Math.PI * r * r) / area) * 100;
    const cls = oaDesign >= 30 ? 'ok' : 'warn';
    $('#stats').innerHTML = `
      <span>Hole positions</span><span>${S.n.toLocaleString()}</span>
      <span>Punched</span><span>${k.toLocaleString()} (${fmt((k / Math.max(S.n, 1)) * 100)}%)</span>
      <span>Open area (design)</span><span class="${cls}">${fmt(oaDesign)}%</span>
      <span>Open area (all punched)</span><span>${fmt(oaMax)}%</span>
      <span>Face area</span><span>${fmt(area / 100, 0)} cm²</span>
      <span>Mounting holes</span><span>${mountPoints().length}</span>
      <span class="full ${cls}">${oaDesign >= 30 ? 'Good: ≥30% open area is acoustically near-transparent.' : 'Tip: under ~30% open area can colour treble — keep the area over tweeters open.'}</span>`;
  }

  function updateMaterialInfo() {
    const { d, c, pattern, thickness } = S.cfg;
    const web = c - d, oa = openArea(d, c, pattern);
    const notes = [];
    if (d >= c) notes.push('<span class="warn">Hole Ø must be smaller than the pitch.</span>');
    if (d < thickness) notes.push('<span class="warn">Hole Ø is less than sheet thickness — hard to punch cleanly.</span>');
    if (web < thickness) notes.push('<span class="warn">Web (bridge) is thinner than the sheet — fragile / may distort.</span>');
    if (!notes.length) notes.push('<span class="ok">Punchable geometry ✓</span>');
    const { dx, dy } = latticeSteps(pattern, c);
    $('#materialInfo').innerHTML = `Sheet open area <b>${fmt(oa)}%</b> · web <b>${fmt(web, 2)} mm</b><br>
      ≈ ${Math.round(1e6 / (dx * dy)).toLocaleString()} holes / m²<br>${notes.join('<br>')}`;
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------------------------------------------------------------- UI wiring
  const getPath = (o, p) => p.split('.').reduce((a, k) => a[k], o);
  const setPath = (o, p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

  function buildMaterialSelect() {
    const sel = $('#materialSel');
    const groups = {};
    for (const m of MATERIALS) (groups[m.group] ||= []).push(m);
    let html = '';
    for (const [g, list] of Object.entries(groups)) {
      html += `<optgroup label="${g}">` + list.map((m) =>
        `<option value="${m.id}">${m.label} — Ø${fmt(m.d, 2)} @ ${fmt(m.c, 2)} mm (${fmt(openArea(m.d, m.c, m.p), 0)}%)</option>`).join('') + '</optgroup>';
    }
    html += '<option value="custom">Custom…</option>';
    sel.innerHTML = html;
    sel.addEventListener('change', () => {
      const m = MATERIALS.find((x) => x.id === sel.value);
      if (!m) return;
      reconfigure(() => { S.cfg.material = m.id; S.cfg.d = +m.d.toFixed(4); S.cfg.c = +m.c.toFixed(4); S.cfg.pattern = m.p; });
    });
  }

  function reconfigure(mutate) {
    const before = JSON.stringify(S.cfg);
    const next = JSON.parse(before);
    const saved = S.cfg; S.cfg = next; mutate(); S.cfg = saved;
    const c = next;
    c.width = clamp(c.width || 10, 10, 5000); c.height = clamp(c.height || 10, 10, 5000);
    c.c = clamp(c.c || 1, 0.5, 100); c.d = clamp(c.d || 0.5, 0.3, c.c * 0.98);
    c.radius = clamp(c.radius || 0, 0, Math.min(c.width, c.height) / 2);
    c.margin = clamp(c.margin || 0, 0, Math.min(c.width, c.height) / 2);
    if (estimateHoles(c) > MAX_HOLES) { toast(`That would be over ${MAX_HOLES.toLocaleString()} holes — choose a larger pitch or smaller grille.`); syncUI(); return; }
    if (JSON.stringify(c) === before) { syncUI(); return; }
    pushUndo();
    S.cfg = c;
    generate(true);
    syncUI();
    changed();
  }

  function syncUI() {
    const cfg = S.cfg;
    $('#materialSel').value = MATERIALS.some((m) => m.id === cfg.material) ? cfg.material : 'custom';
    $$('[data-cfg]').forEach((el) => {
      const v = getPath(cfg, el.dataset.cfg);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = typeof v === 'number' ? +v.toFixed(3) : v;
    });
    $('#radiusLbl').style.display = cfg.shape === 'rect' ? '' : 'none';
    $('#brush').value = S.brush; $('#brushVal').textContent = `${fmt(S.brush)} mm`;
    $('#filled').checked = S.filled; $('#snap').checked = S.snap;
    $('#txtStr').value = S.text.str; $('#txtSize').value = S.text.size; $('#txtRot').value = S.text.rot;
    $('#txtFont').value = S.text.font; $('#txtBold').checked = S.text.bold;
    $('#symN').value = S.sym.n; $('#symNVal').textContent = S.sym.n;
    $('#symNRow').style.display = S.sym.type === 'radial' || S.sym.type === 'kaleido' ? '' : 'none';
    $$('#symSeg button').forEach((b) => b.classList.toggle('active', b.dataset.sym === S.sym.type));
    $$('#tools button').forEach((b) => b.classList.toggle('active', b.dataset.tool === S.tool));
    $$('#modeSeg button').forEach((b) => b.classList.toggle('active', +b.dataset.mode === S.mode));
    $$('#viewSeg button').forEach((b) => b.classList.toggle('active', b.dataset.view === S.display));
    $$('#stamps button').forEach((b) => b.classList.toggle('active', b.dataset.stamp === S.stamp));
    $('#finishSel').value = S.finish; $('#backlight').checked = S.backlight;
    $('#textOpts').style.display = S.tool === 'text' ? '' : 'none';
    $('#filledRow').style.display = ['rect', 'ellipse', 'stamp'].includes(S.tool) ? '' : 'none';
    renderGuideList();
    updateMaterialInfo();
    updateUndoBtns();
    cv.style.cursor = S.tool === 'pan' ? 'grab' : 'crosshair';
    dirty();
  }

  $$('[data-cfg]').forEach((el) => el.addEventListener('change', () => {
    const p = el.dataset.cfg;
    let v = el.type === 'checkbox' ? el.checked : el.type === 'number' || 'num' in el.dataset ? parseFloat(el.value) : el.value;
    if (typeof v === 'number' && !Number.isFinite(v)) { syncUI(); return; }
    reconfigure(() => {
      setPath(S.cfg, p, v);
      if (p === 'd' || p === 'c' || p === 'pattern') S.cfg.material = 'custom';
    });
  }));

  const qs = $('#quickSize');
  QUICK_SIZES.forEach((q, i) => qs.insertAdjacentHTML('beforeend', `<option value="${i}">${q.label}</option>`));
  qs.addEventListener('change', () => {
    const q = QUICK_SIZES[+qs.value];
    qs.value = '';
    if (!q) return;
    reconfigure(() => Object.assign(S.cfg, { shape: q.shape, width: q.width, height: q.height, radius: q.radius }));
    fitView();
  });

  function setTool(t) { S.tool = t; clearPreview(); syncUI(); }
  $$('#tools button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $$('#modeSeg button').forEach((b) => b.addEventListener('click', () => { S.mode = +b.dataset.mode; syncUI(); }));
  $$('#viewSeg button').forEach((b) => b.addEventListener('click', () => { S.display = b.dataset.view; syncUI(); }));
  $$('#symSeg button').forEach((b) => b.addEventListener('click', () => { S.sym.type = b.dataset.sym; syncUI(); autosave(); }));
  $('#symN').addEventListener('input', (e) => { S.sym.n = +e.target.value; syncUI(); });
  $('#brush').addEventListener('input', (e) => { S.brush = +e.target.value; $('#brushVal').textContent = `${fmt(S.brush)} mm`; dirty(); });
  $('#filled').addEventListener('change', (e) => (S.filled = e.target.checked));
  $('#snap').addEventListener('change', (e) => (S.snap = e.target.checked));
  $('#txtStr').addEventListener('input', (e) => (S.text.str = e.target.value));
  $('#txtSize').addEventListener('input', (e) => (S.text.size = clamp(+e.target.value || 5, 2, 2000)));
  $('#txtRot').addEventListener('input', (e) => (S.text.rot = +e.target.value || 0));
  $('#txtFont').addEventListener('change', (e) => (S.text.font = e.target.value));
  $('#txtBold').addEventListener('change', (e) => (S.text.bold = e.target.checked));
  $('#finishSel').addEventListener('change', (e) => { S.finish = e.target.value; if (S.display !== 'preview') S.display = 'preview'; syncUI(); });
  $('#backlight').addEventListener('change', (e) => { S.backlight = e.target.checked; if (S.display !== 'preview') S.display = 'preview'; syncUI(); });

  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);
  const setAll = (fn) => { pushUndo(); for (let i = 0; i < S.n; i++) S.on[i] = fn(S.on[i]); changed(); };
  $('#allBtn').addEventListener('click', () => setAll(() => 1));
  $('#clearBtn').addEventListener('click', () => setAll(() => 0));
  $('#invertBtn').addEventListener('click', () => setAll((v) => 1 - v));
  $('#fitBtn').addEventListener('click', fitView);

  // stamps
  $('#stamps').innerHTML = STAMPS.map((s) =>
    `<button data-stamp="${s.id}" title="${s.name}"><svg viewBox="-6 -6 112 112"><path d="${s.d}" fill-rule="evenodd"/></svg></button>`).join('');
  $$('#stamps button').forEach((b) => b.addEventListener('click', () => { S.stamp = b.dataset.stamp; setTool('stamp'); }));

  // guides
  function renderGuideList() {
    $('#guideList').innerHTML = S.guides.map((g, i) =>
      `<li>Ø${fmt(g.d)} at (${fmt(g.x)}, ${fmt(g.y)})<button data-i="${i}" title="Remove">✕</button></li>`).join('');
    $$('#guideList button').forEach((b) => b.addEventListener('click', () => { S.guides.splice(+b.dataset.i, 1); syncUI(); autosave(); }));
  }
  $('#addGuide').addEventListener('click', () => {
    const d = +$('#gD').value, x = +$('#gX').value || 0, y = +$('#gY').value || 0;
    if (!(d > 0)) return;
    S.guides.push({ d, x, y }); syncUI(); autosave();
  });
  $('#punchGuides').addEventListener('click', () => {
    if (!S.guides.length) { toast('Add a driver guide first.'); return; }
    const hits = new Uint8Array(S.n);
    for (let i = 0; i < S.n; i++) hits[i] = insideGuides(S.xs[i], -S.ys[i]) ? 1 : 0;
    applyReplace(hits, S.mode, false);
  });

  // patterns
  const patSel = $('#patSel');
  patSel.innerHTML = Object.entries(PATTERNS).map(([id, p]) => `<option value="${id}">${p.name}</option>`).join('');
  const patValues = {};
  function buildPatParams() {
    const id = patSel.value, def = PATTERNS[id];
    patValues[id] ||= Object.fromEntries(def.params.map((q) => [q[0], q[5]]));
    $('#patParams').innerHTML = def.params.map(([k, label, min, max, step]) =>
      `<label>${label} <b id="pv_${k}">${patValues[id][k]}</b><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${patValues[id][k]}"></label>`).join('');
    $$('#patParams input').forEach((el) => el.addEventListener('input', () => {
      patValues[id][el.dataset.k] = +el.value; $('#pv_' + el.dataset.k).textContent = el.value; previewPattern();
    }));
  }
  function previewPattern() { setPreview(patternHits(patSel.value, patValues[patSel.value]), S.mode, 'pattern'); }
  patSel.addEventListener('change', () => { buildPatParams(); previewPattern(); });
  $('#patGuides').addEventListener('change', previewPattern);
  $('#patApply').addEventListener('click', () => {
    applyReplace(patternHits(patSel.value, patValues[patSel.value]), S.mode, $('#patReplace').checked);
    clearPreview();
  });
  $('#patCancel').addEventListener('click', clearPreview);
  buildPatParams();

  // image
  $('#imgFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const im = new Image();
    im.onload = () => { img = im; $('#imgOpts').classList.remove('disabled'); updImgLabels(); previewImage(); };
    im.onerror = () => toast('Could not read that image.');
    im.src = URL.createObjectURL(f);
  });
  const updImgLabels = () => { $('#imgThrVal').textContent = $('#imgThr').value; $('#imgScaleVal').textContent = $('#imgScale').value + '%'; };
  const previewImage = () => { const h = imageHits(); if (h) setPreview(h, S.mode, 'image'); };
  ['#imgThr', '#imgScale', '#imgX', '#imgY', '#imgDither', '#imgInvert'].forEach((s) =>
    $(s).addEventListener('input', () => { updImgLabels(); previewImage(); }));
  $('#imgApply').addEventListener('click', () => { const h = imageHits(); if (h) { applyReplace(h, S.mode, $('#imgReplace').checked); clearPreview(); } });
  $('#imgCancel').addEventListener('click', clearPreview);
  updImgLabels();

  // ---------------------------------------------------------------- canvas interaction
  let drag = null, spaceDown = false;
  const snapPt = (p) => {
    if (!S.snap) return p;
    const j = nearest(p.x, p.y);
    return j >= 0 ? { x: S.xs[j], y: S.ys[j] } : p;
  };
  const evPt = (e) => { const r = cv.getBoundingClientRect(); return toMM(e.clientX - r.left, e.clientY - r.top); };

  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = evPt(e);
    if (e.button === 1 || S.tool === 'pan' || spaceDown) {
      drag = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: S.view.ox, oy: S.view.oy };
      cv.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const val = e.button === 2 ? 1 - S.mode : S.mode;
    if (S.previewSrc === 'pattern' || S.previewSrc === 'image') clearPreview();
    switch (S.tool) {
      case 'brush': {
        pushUndo();
        drag = { type: 'brush', last: p, val };
        forEachHit(capsule(p, p, Math.max(S.brush / 2, minHalf())), (i) => (S.on[i] = val));
        changed();
        break;
      }
      case 'line': case 'rect': case 'ellipse': case 'stamp': {
        const a = snapPt(p);
        drag = { type: 'shape', a, val };
        setPreview(computeHits(dragShape(S.tool, a, a, e)), val, 'shape');
        break;
      }
      case 'text': {
        pushUndo();
        applyHits(computeHits(textShape(p)), val);
        clearPreview();
        break;
      }
      case 'fill': {
        pushUndo();
        if (!floodFill(p, val)) { S.undo.pop(); updateUndoBtns(); }
        break;
      }
    }
  });

  let textPreviewPending = false;
  cv.addEventListener('pointermove', (e) => {
    const p = evPt(e);
    S.cursor = p;
    if (!drag) {
      if (S.tool === 'text' && !textPreviewPending) {
        textPreviewPending = true;
        requestAnimationFrame(() => {
          textPreviewPending = false;
          if (S.tool === 'text' && S.cursor) setPreview(computeHits(textShape(S.cursor)), S.mode, 'shape');
        });
      }
      dirty();
      return;
    }
    if (drag.type === 'pan') {
      S.view.ox = drag.ox + e.clientX - drag.sx; S.view.oy = drag.oy + e.clientY - drag.sy;
    } else if (drag.type === 'brush') {
      forEachHit(capsule(drag.last, p, Math.max(S.brush / 2, minHalf())), (i) => (S.on[i] = drag.val));
      drag.last = p;
      changed();
    } else if (drag.type === 'shape') {
      drag.b = snapPt(p); drag.ev = { shiftKey: e.shiftKey, altKey: e.altKey };
      setPreview(computeHits(dragShape(S.tool, drag.a, drag.b, drag.ev)), drag.val, 'shape');
    }
    dirty();
  });

  const endDrag = (e) => {
    if (!drag) return;
    if (drag.type === 'shape') {
      const shape = dragShape(S.tool, drag.a, drag.b || drag.a, drag.ev || { shiftKey: e.shiftKey, altKey: e.altKey });
      if (shape) { pushUndo(); applyHits(computeHits(shape), drag.val); }
      clearPreview();
    }
    if (drag.type === 'pan') cv.style.cursor = S.tool === 'pan' ? 'grab' : 'crosshair';
    drag = null;
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('pointerleave', () => { S.cursor = null; if (S.previewSrc === 'shape' && !drag) clearPreview(); dirty(); });

  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  function zoomAt(sx, sy, f) {
    const before = toMM(sx, sy), v = S.view;
    v.scale = clamp(v.scale * f, 0.02, 200);
    v.ox = sx - cv.clientWidth / 2 - before.x * v.scale;
    v.oy = sy - cv.clientHeight / 2 - before.y * v.scale;
    dirty();
  }
  function fitView() {
    const w = cv.clientWidth, h = cv.clientHeight;
    S.view.scale = Math.max(0.02, Math.min((w - 60) / S.cfg.width, (h - 60) / S.cfg.height));
    S.view.ox = S.view.oy = 0;
    dirty();
  }
  new ResizeObserver(dirty).observe(cv);

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); saveProject(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tools = { b: 'brush', l: 'line', r: 'rect', o: 'ellipse', s: 'stamp', t: 'text', f: 'fill', h: 'pan' };
    if (tools[k]) setTool(tools[k]);
    else if (k === 'x') { S.mode = 1 - S.mode; syncUI(); }
    else if (k === 'p') { S.display = S.display === 'edit' ? 'preview' : 'edit'; syncUI(); }
    else if (k === 'i') $('#invertBtn').click();
    else if (k === '0') fitView();
    else if (k === '[' || k === ']') { S.brush = clamp(S.brush + (k === ']' ? 1 : -1) * Math.max(0.5, S.brush * 0.15), 1, 120); syncUI(); }
    else if (k === 'escape') { clearPreview(); drag = null; }
    else if (e.code === 'Space') { spaceDown = true; cv.style.cursor = 'grab'; e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { spaceDown = false; cv.style.cursor = S.tool === 'pan' ? 'grab' : 'crosshair'; }
  });

  // ---------------------------------------------------------------- export
  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const baseName = () => `grille-${fmt(S.cfg.width, 0)}x${fmt(S.cfg.height, 0)}-${(S.cfg.material || 'custom').replace(/[^\w.]+/g, '_')}`;
  const n4 = (v) => (Math.round(v * 1e4) / 1e4).toString();

  function exportSVG() {
    const { width: Wd, height: Hd, d } = S.cfg, W = Wd / 2, H = Hd / 2, r = d / 2;
    // record the outline path in a mock context to reuse facePath
    let path = '';
    const rec = {
      moveTo: (x, y) => (path += `M${n4(x + W)} ${n4(y + H)}`),
      lineTo: (x, y) => (path += `L${n4(x + W)} ${n4(y + H)}`),
      closePath: () => (path += 'Z'),
      ellipse: () => (path += `M${n4(0)} ${n4(H)}A${n4(W)} ${n4(H)} 0 1 0 ${n4(Wd)} ${n4(H)}A${n4(W)} ${n4(H)} 0 1 0 0 ${n4(H)}Z`),
    };
    if (S.cfg.shape === 'ellipse') rec.ellipse();
    else {
      const R = Math.min(S.cfg.radius, W, H);
      path = `M${n4(R)} 0H${n4(Wd - R)}` + (R ? `A${n4(R)} ${n4(R)} 0 0 1 ${n4(Wd)} ${n4(R)}` : '') +
        `V${n4(Hd - R)}` + (R ? `A${n4(R)} ${n4(R)} 0 0 1 ${n4(Wd - R)} ${n4(Hd)}` : '') +
        `H${n4(R)}` + (R ? `A${n4(R)} ${n4(R)} 0 0 1 0 ${n4(Hd - R)}` : '') +
        `V${n4(R)}` + (R ? `A${n4(R)} ${n4(R)} 0 0 1 ${n4(R)} 0` : '') + 'Z';
    }
    const holes = [];
    for (let i = 0; i < S.n; i++) if (S.on[i]) holes.push(`<circle cx="${n4(S.xs[i] + W)}" cy="${n4(S.ys[i] + H)}" r="${n4(r)}"/>`);
    const mounts = mountPoints().map((p) => `<circle cx="${n4(p.x + W)}" cy="${n4(p.y + H)}" r="${n4(S.cfg.mount.d / 2)}"/>`);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Grille Designer export: ${Wd} x ${Hd} mm, holes Ø${d} mm @ ${S.cfg.c} mm ${S.cfg.pattern}, ${holes.length} holes -->
<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}mm" height="${Hd}mm" viewBox="0 0 ${Wd} ${Hd}">
  <g id="outline" fill="none" stroke="#ff0000" stroke-width="0.1"><path d="${path}"/></g>
  <g id="mounting" fill="none" stroke="#0000ff" stroke-width="0.1">${mounts.join('')}</g>
  <g id="holes" fill="none" stroke="#000000" stroke-width="0.1">
${holes.join('\n')}
  </g>
</svg>`;
    download(baseName() + '.svg', svg, 'image/svg+xml');
  }

  function exportDXF() {
    const { width: Wd, height: Hd, d } = S.cfg, W = Wd / 2, H = Hd / 2;
    const out = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '3'];
    [['OUTLINE', 1], ['HOLES', 7], ['MOUNTING', 5]].forEach(([n, col]) => out.push('0', 'LAYER', '2', n, '70', '0', '62', String(col), '6', 'CONTINUOUS'));
    out.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
    // DXF is Y-up; origin at bottom-left of the grille
    const X = (x) => n4(x + W), Y = (y) => n4(H - y);
    const circle = (layer, x, y, r) => out.push('0', 'CIRCLE', '8', layer, '10', X(x), '20', Y(y), '30', '0', '40', n4(r));
    const line = (x1, y1, x2, y2) => out.push('0', 'LINE', '8', 'OUTLINE', '10', n4(x1), '20', n4(y1), '30', '0', '11', n4(x2), '21', n4(y2), '31', '0');
    const arc = (cx, cy, r, a0, a1) => out.push('0', 'ARC', '8', 'OUTLINE', '10', n4(cx), '20', n4(cy), '30', '0', '40', n4(r), '50', String(a0), '51', String(a1));
    if (S.cfg.shape === 'ellipse') {
      if (Math.abs(W - H) < 1e-6) circle('OUTLINE', 0, 0, W);
      else {
        const N = 720;
        for (let k = 0; k < N; k++) {
          const a0 = (k / N) * TAU, a1 = ((k + 1) / N) * TAU;
          line(W + W * Math.cos(a0), H + H * Math.sin(a0), W + W * Math.cos(a1), H + H * Math.sin(a1));
        }
      }
    } else {
      const R = Math.min(S.cfg.radius, W, H);
      line(R, 0, Wd - R, 0); line(Wd, R, Wd, Hd - R); line(Wd - R, Hd, R, Hd); line(0, Hd - R, 0, R);
      if (R > 0) { arc(Wd - R, R, R, 270, 360); arc(Wd - R, Hd - R, R, 0, 90); arc(R, Hd - R, R, 90, 180); arc(R, R, R, 180, 270); }
    }
    for (const p of mountPoints()) circle('MOUNTING', p.x, p.y, S.cfg.mount.d / 2);
    for (let i = 0; i < S.n; i++) if (S.on[i]) circle('HOLES', S.xs[i], S.ys[i], d / 2);
    out.push('0', 'ENDSEC', '0', 'EOF');
    download(baseName() + '.dxf', out.join('\r\n'), 'application/dxf');
  }

  function exportCSV() {
    const { width: Wd, height: Hd, d } = S.cfg;
    const rows = ['type,x_mm,y_mm,diameter_mm'];
    for (const p of mountPoints()) rows.push(`mount,${n4(p.x + Wd / 2)},${n4(Hd / 2 - p.y)},${n4(S.cfg.mount.d)}`);
    for (let i = 0; i < S.n; i++) if (S.on[i]) rows.push(`hole,${n4(S.xs[i] + Wd / 2)},${n4(Hd / 2 - S.ys[i])},${n4(d)}`);
    download(baseName() + '.csv', rows.join('\n'), 'text/csv');
  }

  function exportPNG() {
    const ppm = clamp(4000 / Math.max(S.cfg.width, S.cfg.height), 1, 10), padPx = 40;
    const c = document.createElement('canvas');
    c.width = Math.ceil(S.cfg.width * ppm + padPx * 2); c.height = Math.ceil(S.cfg.height * ppm + padPx * 2);
    const x = c.getContext('2d');
    const bg = '#151515';
    x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);
    x.setTransform(ppm, 0, 0, ppm, c.width / 2, c.height / 2);
    drawGrille(x, ppm, { real: true, preview: false, shadow: false, bg });
    c.toBlob((b) => download(baseName() + '.png', b), 'image/png');
  }

  $('#expSvg').addEventListener('click', exportSVG);
  $('#expDxf').addEventListener('click', exportDXF);
  $('#expCsv').addEventListener('click', exportCSV);
  $('#expPng').addEventListener('click', exportPNG);

  // ---------------------------------------------------------------- project save / load
  function packBits(on) {
    const b = new Uint8Array(Math.ceil(on.length / 8));
    for (let i = 0; i < on.length; i++) if (on[i]) b[i >> 3] |= 1 << (i & 7);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unpackBits(str, n) {
    const s = atob(str), on = new Uint8Array(n);
    for (let i = 0; i < n; i++) on[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
    return on;
  }
  function projectData() {
    return { app: 'grille-designer', version: 1, cfg: S.cfg, n: S.n, holes: packBits(S.on),
      sym: S.sym, guides: S.guides, text: S.text, brush: S.brush, finish: S.finish, backlight: S.backlight };
  }
  function loadProject(data, quiet) {
    if (!data || data.app !== 'grille-designer') throw new Error('Not a Grille Designer project');
    const cfg = structuredClone(DEFAULT_CFG);
    Object.assign(cfg, data.cfg || {}, { mount: Object.assign({}, DEFAULT_CFG.mount, (data.cfg || {}).mount) });
    S.cfg = cfg;
    generate(false);
    if (data.holes && data.n === S.n) S.on = unpackBits(data.holes, S.n);
    else if (!quiet) toast('Hole layout changed — design could not be restored.');
    if (data.sym) S.sym = Object.assign({ type: 'none', n: 6 }, data.sym);
    S.guides = Array.isArray(data.guides) ? data.guides : [];
    if (data.text) Object.assign(S.text, data.text);
    if (data.brush) S.brush = data.brush;
    if (data.finish && FINISHES[data.finish]) S.finish = data.finish;
    S.backlight = !!data.backlight;
    S.undo.length = S.redo.length = 0;
    syncUI(); changed();
  }
  function saveProject() { download(baseName() + '.json', JSON.stringify(projectData()), 'application/json'); }
  function autosave() { try { localStorage.setItem(STORE_KEY, JSON.stringify(projectData())); } catch (_) { /* storage full or blocked */ } }

  $('#saveBtn').addEventListener('click', saveProject);
  $('#loadBtn').addEventListener('click', () => $('#loadFile').click());
  $('#loadFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { loadProject(JSON.parse(await f.text())); fitView(); toast('Project loaded'); }
    catch (err) { toast('Could not open: ' + err.message); }
  });
  $('#newBtn').addEventListener('click', () => {
    if (!confirm('Start a new design? Unsaved work will be lost.')) return;
    S.cfg = structuredClone(DEFAULT_CFG); S.guides = []; S.sym = { type: 'none', n: 6 };
    generate(false); S.undo.length = S.redo.length = 0; syncUI(); changed(); fitView();
  });

  // ---------------------------------------------------------------- boot
  buildMaterialSelect();
  let restored = false;
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) { loadProject(JSON.parse(saved), true); restored = true; }
  } catch (_) { /* ignore corrupt autosave */ }
  if (!restored) { generate(false); syncUI(); changed(); }
  requestAnimationFrame(() => { fitView(); render(); });

  window.GD = { S, generate, render, exportSVG, exportDXF }; // handy for debugging
})();
