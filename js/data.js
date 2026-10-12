'use strict';
/* Static data: perforated sheet materials, stamp shapes, fill patterns. */
(function () {
  const IN = 25.4;
  const TAU = Math.PI * 2;

  // Open area (%) of a round-hole sheet: 60° stagger = 90.69·(d/c)², square / 45° = 78.54·(d/c)²
  const openArea = (d, c, p) => (p === '60' ? 90.69 : 78.54) * (d / c) ** 2;

  const m = (group, label, d, c, p = '60') => ({ id: label, group, label, d, c, p });
  const MATERIALS = [
    m('Metric — 60° staggered (Rd Tc)', 'R1.0 T2.0', 1.0, 2.0),
    m('Metric — 60° staggered (Rd Tc)', 'R1.5 T2.5', 1.5, 2.5),
    m('Metric — 60° staggered (Rd Tc)', 'R2.0 T3.0', 2.0, 3.0),
    m('Metric — 60° staggered (Rd Tc)', 'R2.0 T3.5', 2.0, 3.5),
    m('Metric — 60° staggered (Rd Tc)', 'R2.5 T3.5', 2.5, 3.5),
    m('Metric — 60° staggered (Rd Tc)', 'R3.0 T4.0', 3.0, 4.0),
    m('Metric — 60° staggered (Rd Tc)', 'R3.0 T5.0', 3.0, 5.0),
    m('Metric — 60° staggered (Rd Tc)', 'R4.0 T6.0', 4.0, 6.0),
    m('Metric — 60° staggered (Rd Tc)', 'R5.0 T7.0', 5.0, 7.0),
    m('Metric — 60° staggered (Rd Tc)', 'R5.0 T8.0', 5.0, 8.0),
    m('Metric — 60° staggered (Rd Tc)', 'R6.0 T9.0', 6.0, 9.0),
    m('Metric — 60° staggered (Rd Tc)', 'R8.0 T12.0', 8.0, 12.0),
    m('Metric — 60° staggered (Rd Tc)', 'R10.0 T15.0', 10.0, 15.0),
    m('Imperial — 60° staggered', '1/16" on 3/32"', IN / 16, IN * 3 / 32),
    m('Imperial — 60° staggered', '1/16" on 1/8"', IN / 16, IN / 8),
    m('Imperial — 60° staggered', '3/32" on 5/32"', IN * 3 / 32, IN * 5 / 32),
    m('Imperial — 60° staggered', '1/8" on 3/16"', IN / 8, IN * 3 / 16),
    m('Imperial — 60° staggered', '5/32" on 3/16"', IN * 5 / 32, IN * 3 / 16),
    m('Imperial — 60° staggered', '3/16" on 1/4"', IN * 3 / 16, IN / 4),
    m('Imperial — 60° staggered', '1/4" on 3/8"', IN / 4, IN * 3 / 8),
    m('Imperial — 60° staggered', '3/8" on 1/2"', IN * 3 / 8, IN / 2),
    m('Square / straight (Rd Uc)', 'R3.0 U5.0', 3.0, 5.0, 'square'),
    m('Square / straight (Rd Uc)', 'R5.0 U8.0', 5.0, 8.0, 'square'),
    m('45° staggered (Rd Zc)', 'R3.0 Z5.0', 3.0, 5.0, '45'),
    m('45° staggered (Rd Zc)', 'R5.0 Z8.0', 5.0, 8.0, '45'),
  ];

  const QUICK_SIZES = [
    { label: 'Bookshelf 200 × 300', shape: 'rect', width: 200, height: 300, radius: 8 },
    { label: 'Floorstander 220 × 900', shape: 'rect', width: 220, height: 900, radius: 10 },
    { label: 'Centre 520 × 200', shape: 'rect', width: 520, height: 200, radius: 10 },
    { label: 'Sub 12" round Ø330', shape: 'ellipse', width: 330, height: 330, radius: 0 },
    { label: 'Sub 15" round Ø400', shape: 'ellipse', width: 400, height: 400, radius: 0 },
    { label: 'Car 6×9" oval 180 × 250', shape: 'ellipse', width: 250, height: 180, radius: 0 },
    { label: 'Guitar cab 2×12 680 × 400', shape: 'rect', width: 680, height: 400, radius: 4 },
  ];

  // ---- Stamps: SVG path data in a 0..100 box ----
  const poly = (n, rot = -90) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      const a = (rot * Math.PI) / 180 + (i / n) * TAU;
      s += (i ? 'L' : 'M') + (50 + 50 * Math.cos(a)).toFixed(2) + ' ' + (50 + 50 * Math.sin(a)).toFixed(2);
    }
    return s + 'Z';
  };
  const star = (n, inner) => {
    let s = '';
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + (i / (n * 2)) * TAU, r = i & 1 ? 50 * inner : 50;
      s += (i ? 'L' : 'M') + (50 + r * Math.cos(a)).toFixed(2) + ' ' + (50 + r * Math.sin(a)).toFixed(2);
    }
    return s + 'Z';
  };
  const circ = (cx, cy, r) => `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
  const gear = (teeth = 12) => {
    let s = '';
    const steps = teeth * 4;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * TAU, r = (i % 4 < 2) ? 50 : 40;
      s += (i ? 'L' : 'M') + (50 + r * Math.cos(a)).toFixed(2) + ' ' + (50 + r * Math.sin(a)).toFixed(2);
    }
    return s + 'Z' + circ(50, 50, 16);
  };
  const sineBand = () => {
    let top = '', bot = '';
    for (let i = 0; i <= 40; i++) {
      const x = i * 2.5, y = 50 + 30 * Math.sin((x / 100) * TAU * 1.5);
      top += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + (y - 10).toFixed(2);
      bot = 'L' + x.toFixed(2) + ' ' + (y + 10).toFixed(2) + bot;
    }
    return top + bot + 'Z';
  };

  const STAMPS = [
    { id: 'circle', name: 'Circle', d: circ(50, 50, 50) },
    { id: 'ring', name: 'Ring', d: circ(50, 50, 50) + circ(50, 50, 32) },
    { id: 'heart', name: 'Heart', d: 'M50 95C22 72 0 54 0 30C0 13 13 3 28 3C38 3 46 9 50 17C54 9 62 3 72 3C87 3 100 13 100 30C100 54 78 72 50 95Z' },
    { id: 'star5', name: 'Star', d: star(5, 0.4) },
    { id: 'star6', name: 'Star 6', d: star(6, 0.55) },
    { id: 'burst', name: 'Burst', d: star(16, 0.72) },
    { id: 'hex', name: 'Hexagon', d: poly(6, 0) },
    { id: 'tri', name: 'Triangle', d: poly(3) },
    { id: 'diamond', name: 'Diamond', d: poly(4) },
    { id: 'oct', name: 'Octagon', d: poly(8, 22.5) },
    { id: 'plus', name: 'Plus', d: 'M35 0H65V35H100V65H65V100H35V65H0V35H35Z' },
    { id: 'arrow', name: 'Arrow', d: 'M0 35H55V8L100 50L55 92V65H0Z' },
    { id: 'bolt', name: 'Bolt', d: 'M62 0L14 58H44L34 100L86 38H56L62 0Z' },
    { id: 'moon', name: 'Moon', d: 'M62 2A49 49 0 1 0 98 70A40 40 0 1 1 62 2Z' },
    { id: 'drop', name: 'Drop', d: 'M50 0C50 0 14 44 14 64A36 36 0 0 0 86 64C86 44 50 0 50 0Z' },
    { id: 'note', name: 'Note', d: 'M38 12L92 0V72A15 12 0 1 1 80 61V24L50 30V84A15 12 0 1 1 38 73Z' },
    { id: 'speaker', name: 'Speaker', d: 'M0 34H22L50 8V92L22 66H0Z M60 30Q72 50 60 70L66 74Q82 50 66 26Z M74 16Q94 50 74 84L81 88Q104 50 81 12Z' },
    { id: 'gear', name: 'Gear', d: gear(12) },
    { id: 'wave', name: 'Wave', d: sineBand() },
    { id: 'target', name: 'Target', d: circ(50, 50, 50) + circ(50, 50, 38) + circ(50, 50, 26) + circ(50, 50, 14) },
  ];

  // ---- Patterns: whole-grille fills. `test` → boolean, `density` → 0..1 (ordered-dithered) ----
  const frac = (v) => v - Math.floor(v);
  const PATTERNS = {
    rings: {
      name: 'Concentric rings',
      params: [['spacing', 'Spacing (mm)', 3, 200, 1, 20], ['width', 'Ring width (mm)', 1, 100, 0.5, 7]],
      test: (p) => (x, y) => frac(Math.hypot(x, y) / p.spacing) < p.width / p.spacing,
    },
    spokes: {
      name: 'Radial spokes',
      params: [['count', 'Spokes', 2, 72, 1, 16], ['duty', 'Spoke width (%)', 5, 95, 1, 45], ['hub', 'Hub radius (mm)', 0, 300, 1, 0]],
      test: (p) => (x, y) => Math.hypot(x, y) >= p.hub && frac((Math.atan2(y, x) / TAU) * p.count) < p.duty / 100,
    },
    spiral: {
      name: 'Spiral',
      params: [['arms', 'Arms', 1, 16, 1, 3], ['spacing', 'Arm spacing (mm)', 5, 300, 1, 60], ['duty', 'Arm width (%)', 5, 95, 1, 45]],
      test: (p) => (x, y) => frac(Math.hypot(x, y) / p.spacing + (Math.atan2(y, x) / TAU) * p.arms) < p.duty / 100,
    },
    stripes: {
      name: 'Stripes',
      params: [['angle', 'Angle (°)', 0, 180, 1, 45], ['spacing', 'Spacing (mm)', 3, 200, 1, 20], ['duty', 'Stripe width (%)', 5, 95, 1, 50]],
      test: (p) => {
        const ca = Math.cos((p.angle * Math.PI) / 180), sa = Math.sin((p.angle * Math.PI) / 180);
        return (x, y) => frac((x * ca + y * sa) / p.spacing + 0.5 * p.duty / 100) < p.duty / 100;
      },
    },
    waves: {
      name: 'Waves',
      params: [['amp', 'Amplitude (mm)', 0, 200, 1, 15], ['len', 'Wavelength (mm)', 10, 500, 1, 120], ['spacing', 'Spacing (mm)', 4, 200, 1, 25], ['duty', 'Line width (%)', 5, 95, 1, 45]],
      test: (p) => (x, y) => frac((y + p.amp * Math.sin((x / p.len) * TAU)) / p.spacing) < p.duty / 100,
    },
    checker: {
      name: 'Checkerboard',
      params: [['size', 'Square size (mm)', 4, 300, 1, 30]],
      test: (p) => (x, y) => ((Math.floor(x / p.size + 0.5) + Math.floor(y / p.size + 0.5)) & 1) === 0,
    },
    radial: {
      name: 'Radial gradient (dithered)',
      params: [['inner', 'Centre density (%)', 0, 100, 1, 100], ['outer', 'Edge density (%)', 0, 100, 1, 10]],
      density: (p, g) => {
        const R = Math.hypot(g.W, g.H);
        return (x, y) => { const t = Math.min(1, Math.hypot(x, y) / R * 1.15); return (p.inner + (p.outer - p.inner) * t) / 100; };
      },
    },
    linear: {
      name: 'Linear gradient (dithered)',
      params: [['angle', 'Angle (°)', 0, 360, 1, 90], ['start', 'Start density (%)', 0, 100, 1, 100], ['end', 'End density (%)', 0, 100, 1, 0]],
      density: (p, g) => {
        const ca = Math.cos((p.angle * Math.PI) / 180), sa = Math.sin((p.angle * Math.PI) / 180);
        const ext = Math.abs(g.W * ca) + Math.abs(g.H * sa) || 1;
        return (x, y) => { const t = ((x * ca + y * sa) / ext + 1) / 2; return (p.start + (p.end - p.start) * t) / 100; };
      },
    },
    halftone: {
      name: 'Halftone dots',
      params: [['cell', 'Cell size (mm)', 6, 200, 1, 30], ['min', 'Centre dot (% of cell)', 0, 100, 1, 90], ['max', 'Edge dot (% of cell)', 0, 100, 1, 25]],
      test: (p, g) => {
        const R = Math.hypot(g.W, g.H), h = Math.sqrt(3) / 2;
        return (x, y) => {
          // hex-packed dot centres
          const row = Math.round(y / (p.cell * h)), cy = row * p.cell * h;
          const off = (row & 1) ? p.cell / 2 : 0;
          const cx = Math.round((x - off) / p.cell) * p.cell + off;
          const t = Math.min(1, Math.hypot(cx, cy) / R * 1.2);
          const rad = ((p.min + (p.max - p.min) * t) / 100) * p.cell * 0.5;
          return Math.hypot(x - cx, y - cy) <= rad;
        };
      },
    },
    border: {
      name: 'Border frame',
      params: [['width', 'Frame width (mm)', 2, 200, 1, 20], ['offset', 'Inset from edge (mm)', 0, 200, 1, 0]],
      test: (p, g) => (x, y) => { const d = -g.sd(x, y) - g.margin; return d >= p.offset && d < p.offset + p.width; },
    },
    random: {
      name: 'Random scatter',
      params: [['density', 'Density (%)', 0, 100, 1, 35], ['seed', 'Seed', 1, 9999, 1, 7]],
      randomDensity: true,
    },
    voronoi: {
      name: 'Cells (Voronoi)',
      params: [['cells', 'Cell count', 3, 300, 1, 40], ['gap', 'Gap width (mm)', 1, 50, 0.5, 5], ['seed', 'Seed', 1, 9999, 1, 3]],
      test: (p, g) => {
        let s = p.seed * 9301 + 49297;
        const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
        const pts = [];
        for (let i = 0; i < p.cells; i++) pts.push([(rnd() * 2 - 1) * g.W, (rnd() * 2 - 1) * g.H]);
        return (x, y) => {
          let d1 = Infinity, d2 = Infinity, i1 = -1;
          for (let i = 0; i < pts.length; i++) {
            const d = Math.hypot(x - pts[i][0], y - pts[i][1]);
            if (d < d1) { d2 = d1; d1 = d; i1 = i; } else if (d < d2) d2 = d;
          }
          return i1 >= 0 && (d2 - d1) / 2 > p.gap / 2;
        };
      },
    },
  };

  window.GD_DATA = { MATERIALS, QUICK_SIZES, STAMPS, PATTERNS, openArea };
})();
