// Flags drawn from their official constructions with simple vector shapes on a 2D canvas.
// drawFlag(ctx, code, w, h) fills (0,0)-(w,h); pass h = w * country.ratio. No coats of arms: Spain uses
// its civil flag.
import { countryByCode } from './data/countries.js';

const TAU = Math.PI * 2;

function rect(g, c, x, y, w, h) { g.fillStyle = c; g.fillRect(x, y, w, h); }
function hStripes(g, w, h, cols, parts = cols.map(() => 1)) {
  const tot = parts.reduce((a, b) => a + b, 0);
  let y = 0;
  cols.forEach((c, i) => { const hh = (parts[i] / tot) * h; rect(g, c, 0, y, w, hh + 0.5); y += hh; });
}
function vStripes(g, w, h, cols) {
  cols.forEach((c, i) => rect(g, c, (i * w) / cols.length, 0, w / cols.length + 0.5, h));
}
// n-pointed star centred at (x, y), outer radius R, inner radius r, first point at angle rot (0 = up)
export function star(g, x, y, R, r, n = 5, rot = 0) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n - Math.PI / 2;
    const rr = i % 2 ? r : R;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}
const STAR5 = 0.382; // inner/outer radius of a regular five-pointed star
function circle(g, c, x, y, r) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
// Nordic cross: horizontal units (hoist field, cross, fly) and vertical units (top, cross, bottom)
function nordic(g, w, h, field, cross, hu, vu, border = null, bu = 0) {
  rect(g, field, 0, 0, w, h);
  const W = hu.reduce((a, b) => a + b, 0), H = vu.reduce((a, b) => a + b, 0);
  const sx = w / W, sy = h / H;
  const cx = hu[0] * sx, cw = hu[1] * sx, cy = vu[0] * sy, ch = vu[1] * sy;
  if (border) { rect(g, border, cx - bu * sx, 0, cw + 2 * bu * sx, h); rect(g, border, 0, cy - bu * sy, w, ch + 2 * bu * sy); }
  rect(g, cross, cx, 0, cw, h); rect(g, cross, 0, cy, w, ch);
}

// Union Jack in (x, y, w, h) with w = 2h, from the standard 60 x 30 construction
function unionJack(g, x, y, w, h) {
  g.save();
  g.translate(x, y); g.scale(w / 60, h / 30);
  g.beginPath(); g.rect(0, 0, 60, 30); g.clip();
  rect(g, '#012169', 0, 0, 60, 30);
  g.lineCap = 'butt';
  const diag = () => { g.beginPath(); g.moveTo(0, 0); g.lineTo(60, 30); g.moveTo(60, 0); g.lineTo(0, 30); };
  g.strokeStyle = '#FFFFFF'; g.lineWidth = 6; diag(); g.stroke();
  // St Patrick's red saltire, counterchanged: only one half of each diagonal shows red
  g.save();
  g.beginPath();
  g.moveTo(30, 15); g.lineTo(60, 15); g.lineTo(60, 30); g.closePath();
  g.moveTo(30, 15); g.lineTo(30, 30); g.lineTo(0, 30); g.closePath();
  g.moveTo(30, 15); g.lineTo(0, 15); g.lineTo(0, 0); g.closePath();
  g.moveTo(30, 15); g.lineTo(30, 0); g.lineTo(60, 0); g.closePath();
  g.clip();
  g.strokeStyle = '#C8102E'; g.lineWidth = 4; diag(); g.stroke();
  g.restore();
  g.strokeStyle = '#FFFFFF'; g.lineWidth = 10;
  g.beginPath(); g.moveTo(30, 0); g.lineTo(30, 30); g.moveTo(0, 15); g.lineTo(60, 15); g.stroke();
  g.strokeStyle = '#C8102E'; g.lineWidth = 6; g.stroke();
  g.restore();
}

// Canadian maple leaf (11 points), from the official 9600 x 4800 artwork
const MAPLE = 'm 4890,4430 -45,-863 a 95,95 0 0 1 111,-98 l 859,151 -116,-320 a 65,65 0 0 1 20,-73 l 941,-762 -212,-99 a 65,65 0 0 1 -34,-79 l 186,-572 -542,115 a 65,65 0 0 1 -73,-38 l -105,-247 -423,454 a 65,65 0 0 1 -111,-57 l 204,-1052 -327,189 a 65,65 0 0 1 -91,-27 l -332,-652 -332,652 a 65,65 0 0 1 -91,27 l -327,-189 204,1052 a 65,65 0 0 1 -111,57 l -423,-454 -105,247 a 65,65 0 0 1 -73,38 l -542,-115 186,572 a 65,65 0 0 1 -34,79 l -212,99 941,762 a 65,65 0 0 1 20,73 l -116,320 859,-151 a 95,95 0 0 1 111,98 l -45,863 z';
let maplePath = null;

const DRAW = {
  AT: (g, w, h) => hStripes(g, w, h, ['#C8102E', '#FFFFFF', '#C8102E']),
  AU: (g, w, h) => {
    rect(g, '#012169', 0, 0, w, h);
    unionJack(g, 0, 0, w / 2, h / 2);
    g.fillStyle = '#FFFFFF';
    // Commonwealth Star in the lower hoist quarter, Southern Cross in the fly
    star(g, w / 4, (3 * h) / 4, (3 / 20) * h, (3 / 20) * h * (4 / 9), 7); g.fill();
    const c = (3 * w) / 4, R = h / 14, r = R * (4 / 9);
    star(g, c, (5 * h) / 6, R, r, 7); g.fill();            // Alpha Crucis
    star(g, c, h / 6, R, r, 7); g.fill();                  // Gamma Crucis
    star(g, c - h / 4, h / 2 - h / 16, R, r, 7); g.fill(); // Beta Crucis
    star(g, c + (2 * h) / 9, h / 2 - (31 * h) / 240, R, r, 7); g.fill(); // Delta Crucis
    star(g, c + h / 10, h / 2 + h / 24, h / 24, (h / 24) * (4 / 9), 5); g.fill(); // Epsilon Crucis
  },
  BE: (g, w, h) => vStripes(g, w, h, ['#000000', '#FAE042', '#ED2939']),
  BR: (g, w, h) => {
    rect(g, '#009C3B', 0, 0, w, h);
    const u = w / 20;
    g.fillStyle = '#FFDF00';
    g.beginPath(); g.moveTo(1.7 * u, h / 2); g.lineTo(w / 2, 1.7 * u); g.lineTo(w - 1.7 * u, h / 2); g.lineTo(w / 2, h - 1.7 * u); g.closePath(); g.fill();
    const R = 3.5 * u;
    circle(g, '#002776', w / 2, h / 2, R);
    // the white band arcs across the disc (its motto is left off at this size)
    g.save(); g.beginPath(); g.arc(w / 2, h / 2, R, 0, TAU); g.clip();
    g.strokeStyle = '#FFFFFF'; g.lineWidth = 0.5 * u;
    g.beginPath(); g.arc(w / 2 - 2 * u, h / 2 + 12 * u - 0.15 * u, 8.5 * u + 0.25 * u + 3.25 * u, Math.PI * 1.22, Math.PI * 1.62); g.stroke();
    g.fillStyle = '#FFFFFF';
    for (const [x, y, s] of [[0.3, 1.6, 1], [-1.2, 1.2, 0.9], [1.6, 1.0, 0.8], [-0.4, 2.4, 0.7], [0.9, 2.3, 0.7], [-2.0, 0.6, 0.6], [2.3, 0.2, 0.6], [-1.6, 2.1, 0.55], [1.9, 1.8, 0.55], [0.2, -1.4, 0.75]]) {
      star(g, w / 2 + x * u, h / 2 + y * u, 0.28 * u * s, 0.28 * u * s * STAR5); g.fill();
    }
    g.restore();
  },
  CA: (g, w, h) => {
    rect(g, '#FFFFFF', 0, 0, w, h);
    rect(g, '#D80621', 0, 0, w / 4, h); rect(g, '#D80621', (3 * w) / 4, 0, w / 4, h);
    if (!maplePath && typeof Path2D !== 'undefined') maplePath = new Path2D(MAPLE);
    if (maplePath) { g.save(); g.scale(w / 9600, h / 4800); g.fillStyle = '#D80621'; g.fill(maplePath); g.restore(); }
  },
  CH: (g, w, h) => {
    rect(g, '#DA291C', 0, 0, w, h);
    const u = w / 32;
    rect(g, '#FFFFFF', 13 * u, 6 * u, 6 * u, 20 * u);
    rect(g, '#FFFFFF', 6 * u, 13 * u, 20 * u, 6 * u);
  },
  CL: (g, w, h) => {
    rect(g, '#FFFFFF', 0, 0, w, h / 2);
    rect(g, '#D52B1E', 0, h / 2, w, h / 2);
    rect(g, '#0039A6', 0, 0, h / 2, h / 2);
    g.fillStyle = '#FFFFFF'; star(g, h / 4, h / 4, h / 8, (h / 8) * STAR5); g.fill();
  },
  CN: (g, w, h) => {
    rect(g, '#EE1C25', 0, 0, w, h);
    const u = w / 30;
    g.fillStyle = '#FFDE00';
    star(g, 5 * u, 5 * u, 3 * u, 3 * u * STAR5); g.fill();
    for (const [x, y] of [[10, 2], [12, 4], [12, 7], [10, 9]]) {
      // each small star points at the centre of the big one
      const rot = Math.atan2(5 - y, 5 - x) + Math.PI / 2;
      star(g, x * u, y * u, u, u * STAR5, 5, rot); g.fill();
    }
  },
  DE: (g, w, h) => hStripes(g, w, h, ['#000000', '#DD0000', '#FFCE00']),
  DK: (g, w, h) => nordic(g, w, h, '#C8102E', '#FFFFFF', [12, 4, 21], [12, 4, 12]),
  ES: (g, w, h) => hStripes(g, w, h, ['#AA151B', '#F1BF00', '#AA151B'], [1, 2, 1]),
  FI: (g, w, h) => nordic(g, w, h, '#FFFFFF', '#002F6C', [5, 3, 10], [4, 3, 4]),
  FR: (g, w, h) => vStripes(g, w, h, ['#002654', '#FFFFFF', '#CE1126']),
  GB: (g, w, h) => unionJack(g, 0, 0, w, h),
  GH: (g, w, h) => {
    hStripes(g, w, h, ['#CE1126', '#FCD116', '#006B3F']);
    g.fillStyle = '#000000'; star(g, w / 2, h / 2 + h * 0.012, h / 6, (h / 6) * STAR5); g.fill();
  },
  GR: (g, w, h) => {
    const s = h / 9;
    for (let i = 0; i < 9; i++) rect(g, i % 2 ? '#FFFFFF' : '#0D5EAF', 0, i * s, w, s + 0.5);
    rect(g, '#0D5EAF', 0, 0, 5 * s, 5 * s);
    rect(g, '#FFFFFF', 2 * s, 0, s, 5 * s);
    rect(g, '#FFFFFF', 0, 2 * s, 5 * s, s);
  },
  IE: (g, w, h) => vStripes(g, w, h, ['#169B62', '#FFFFFF', '#FF883E']),
  IN: (g, w, h) => {
    hStripes(g, w, h, ['#FF9933', '#FFFFFF', '#138808']);
    const R = (h / 3) * 0.44, cx = w / 2, cy = h / 2;
    g.strokeStyle = '#000080'; g.fillStyle = '#000080';
    g.lineWidth = R * 0.1;
    g.beginPath(); g.arc(cx, cy, R * 0.95, 0, TAU); g.stroke();
    circle(g, '#000080', cx, cy, R * 0.18);
    g.lineWidth = R * 0.045;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92); g.stroke();
    }
  },
  IT: (g, w, h) => vStripes(g, w, h, ['#009246', '#FFFFFF', '#CE2B37']),
  JM: (g, w, h) => {
    rect(g, '#009B3A', 0, 0, w, h);
    g.fillStyle = '#000000';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w / 2, h / 2); g.lineTo(0, h); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(w, 0); g.lineTo(w / 2, h / 2); g.lineTo(w, h); g.closePath(); g.fill();
    g.strokeStyle = '#FED100'; g.lineWidth = h / 6; g.lineCap = 'square';
    g.save(); g.beginPath(); g.rect(0, 0, w, h); g.clip();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
    g.restore();
  },
  JP: (g, w, h) => { rect(g, '#FFFFFF', 0, 0, w, h); circle(g, '#BC002D', w / 2, h / 2, (3 / 10) * h); },
  KR: (g, w, h) => {
    rect(g, '#FFFFFF', 0, 0, w, h);
    const cx = w / 2, cy = h / 2, r = h / 4;
    const ang = Math.atan2(h, w); // the circle and trigrams line up on the flag's diagonals
    g.save(); g.translate(cx, cy); g.rotate(ang);
    // taegeuk: red above the diagonal, blue below; the red swirl reaches down on the hoist side
    circle(g, '#0047A0', 0, 0, r);
    g.fillStyle = '#CD2E3A'; g.beginPath(); g.arc(0, 0, r, Math.PI, TAU); g.fill();
    circle(g, '#CD2E3A', -r / 2, 0, r / 2);
    circle(g, '#0047A0', r / 2, 0, r / 2);
    g.restore();
    // trigrams: bar length h/4, bar thickness h/24, gaps h/48
    const L = h / 4, T = h / 24, gap = h / 48;
    const tri = (dir, pattern) => {
      const dx = Math.cos(dir), dy = Math.sin(dir);
      const d0 = r + h / 8;
      g.save(); g.translate(cx + dx * d0, cy + dy * d0); g.rotate(dir);
      g.fillStyle = '#000000';
      pattern.forEach((solid, i) => {
        const x = i * (T + gap);
        if (solid) g.fillRect(x, -L / 2, T, L);
        else { g.fillRect(x, -L / 2, T, L / 2 - gap / 2); g.fillRect(x, gap / 2, T, L / 2 - gap / 2); }
      });
      g.restore();
    };
    const a = Math.atan2(h / 2, w / 2);
    tri(Math.PI + a, [1, 1, 1]);   // geon, upper hoist
    tri(-a, [0, 1, 0]);            // gam, upper fly
    tri(Math.PI - a, [1, 0, 1]);   // ri, lower hoist
    tri(a, [0, 0, 0]);             // gon, lower fly
  },
  LU: (g, w, h) => hStripes(g, w, h, ['#EF3340', '#FFFFFF', '#00A3E0']),
  MA: (g, w, h) => {
    rect(g, '#C1272D', 0, 0, w, h);
    const R = h * 0.24;
    g.strokeStyle = '#006233'; g.lineWidth = h * 0.05; g.lineJoin = 'miter';
    g.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
      const x = w / 2 + Math.cos(a) * R, y = h / 2 + h * 0.02 + Math.sin(a) * R;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.stroke();
  },
  NG: (g, w, h) => vStripes(g, w, h, ['#008751', '#FFFFFF', '#008751']),
  NL: (g, w, h) => hStripes(g, w, h, ['#AE1C28', '#FFFFFF', '#21468B']),
  NO: (g, w, h) => nordic(g, w, h, '#BA0C2F', '#00205B', [7, 2, 13], [7, 2, 7], '#FFFFFF', 1),
  NZ: (g, w, h) => {
    rect(g, '#012169', 0, 0, w, h);
    unionJack(g, 0, 0, w / 2, h / 2);
    const c = (3 * w) / 4;
    for (const [x, y, R] of [[c, h * 0.22, h * 0.065], [c - h * 0.23, h * 0.46, h * 0.06], [c + h * 0.21, h * 0.4, h * 0.05], [c, h * 0.8, h * 0.07]]) {
      g.fillStyle = '#FFFFFF'; star(g, x, y, R * 1.32, R * 1.32 * STAR5); g.fill();
      g.fillStyle = '#C8102E'; star(g, x, y, R, R * STAR5); g.fill();
    }
  },
  PL: (g, w, h) => hStripes(g, w, h, ['#FFFFFF', '#DC143C']),
  SE: (g, w, h) => nordic(g, w, h, '#006AA7', '#FECC00', [5, 2, 9], [4, 2, 4]),
  TH: (g, w, h) => hStripes(g, w, h, ['#A51931', '#F4F5F8', '#2D2A4A', '#F4F5F8', '#A51931'], [1, 1, 2, 1, 1]),
  TR: (g, w, h) => {
    rect(g, '#E30A17', 0, 0, w, h);
    const G = h;
    circle(g, '#FFFFFF', 0.5 * G, h / 2, 0.25 * G);
    circle(g, '#E30A17', 0.5625 * G, h / 2, 0.2 * G);
    g.fillStyle = '#FFFFFF';
    // star with one point towards the hoist
    star(g, (0.5 + 1 / 3) * G, h / 2, G / 8, (G / 8) * STAR5, 5, -Math.PI / 2); g.fill();
  },
  UA: (g, w, h) => hStripes(g, w, h, ['#0057B7', '#FFD700']),
  US: (g, w, h) => {
    const s = h / 13;
    for (let i = 0; i < 13; i++) rect(g, i % 2 ? '#FFFFFF' : '#B22234', 0, i * s, w, s + 0.5);
    const H = h, cw = 0.76 * H, ch = 7 * s;
    rect(g, '#3C3B6E', 0, 0, cw, ch);
    g.fillStyle = '#FFFFFF';
    const E = 0.054 * H, Gs = 0.063 * H, R = 0.0616 * H / 2;
    for (let row = 0; row < 9; row++) {
      const n = row % 2 ? 5 : 6;
      for (let k = 0; k < n; k++) {
        const x = (row % 2 ? 2 : 1) * Gs + k * 2 * Gs;
        star(g, x, E * (row + 1), R, R * STAR5); g.fill();
      }
    }
  },
  ZA: (g, w, h) => {
    // 900 x 600 construction: red over blue, the green Y edged in white, the black triangle edged in gold
    g.save(); g.scale(w / 900, h / 600);
    rect(g, '#E03C31', 0, 0, 900, 300);
    rect(g, '#001489', 0, 300, 900, 300);
    g.beginPath(); g.rect(0, 0, 900, 600); g.clip();
    const Y = () => { g.beginPath(); g.moveTo(0, 0); g.lineTo(450, 300); g.lineTo(900, 300); g.moveTo(0, 600); g.lineTo(450, 300); };
    g.lineJoin = 'miter'; g.lineCap = 'butt';
    g.strokeStyle = '#FFFFFF'; g.lineWidth = 200; Y(); g.stroke();
    g.fillStyle = '#FFB81C';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(450, 300); g.lineTo(0, 600); g.closePath(); g.fill();
    g.fillStyle = '#000000';
    g.beginPath(); g.moveTo(0, 120); g.lineTo(270, 300); g.lineTo(0, 480); g.closePath(); g.fill();
    g.strokeStyle = '#007749'; g.lineWidth = 120; Y(); g.stroke();
    g.restore();
  },
};

export function drawFlag(g, code, w, h) {
  const f = DRAW[code];
  g.save();
  if (f) f(g, w, h); else rect(g, '#cccccc', 0, 0, w, h);
  g.restore();
}

// A new canvas, `width` px wide, with the flag in its official proportions.
export function flagCanvas(code, width = 240) {
  const c = document.createElement('canvas');
  const ratio = countryByCode(code).ratio;
  c.width = Math.round(width); c.height = Math.round(width * ratio);
  drawFlag(c.getContext('2d'), code, c.width, c.height);
  return c;
}

// Data URL of the flag for the menus (cached).
const urlCache = new Map();
export function flagURL(code, width = 120) {
  const k = code + '@' + width;
  if (!urlCache.has(k)) urlCache.set(k, flagCanvas(code, width).toDataURL());
  return urlCache.get(k);
}
