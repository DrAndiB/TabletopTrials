// Players' controls: every player has three inputs, LEFT, RIGHT and ACTION, on a shared keyboard
// (Tabletop Turbo's four key groups) or on touch pads. Events never read keys directly: each player
// gets a Pad whose presses are queued with precise timestamps (seconds) and whose held state can be read.
const DEFAULT_BINDINGS = [
  { left: 'ArrowLeft', right: 'ArrowRight', action: 'ArrowUp' },
  { left: 'KeyA', right: 'KeyD', action: 'KeyW' },
  { left: 'KeyJ', right: 'KeyL', action: 'KeyI' },
  { left: 'Numpad4', right: 'Numpad6', action: 'Numpad8' },
];
const STORE = 'tabletop-trials.bindings.v1';
const PRETTY = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Enter: 'Enter',
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Minus: '-', Equal: '=',
};
export const BUTTONS = ['left', 'right', 'action'];

const now = () => performance.now() / 1000;

// One player's three buttons.
export class Pad {
  constructor() {
    this.held = { left: false, right: false, action: false };
    this.queue = [];      // {b: 'left'|'right'|'action', down: bool, t}
    this.lastDown = { left: -1, right: -1, action: -1 };
  }
  push(b, down, t = now()) {
    if (this.held[b] === down) return;
    this.held[b] = down;
    if (down) this.lastDown[b] = t;
    this.queue.push({ b, down, t });
    if (this.queue.length > 64) this.queue.shift();
  }
  // take all queued events (oldest first)
  drain() { const q = this.queue; this.queue = []; return q; }
  clear() { this.queue = []; for (const b of BUTTONS) this.held[b] = false; }
  get steer() { return (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0); }
}

export class Input {
  constructor() {
    this.bindings = this.loadBindings();
    this.pads = [new Pad(), new Pad(), new Pad(), new Pad()];
    this.listeners = [];
    this.capture = null;
    this.layout = null;
    this.downKeys = new Set();
    window.addEventListener('keydown', (e) => this.onKey(e, true), { passive: false });
    window.addEventListener('keyup', (e) => this.onKey(e, false), { passive: false });
    window.addEventListener('blur', () => { this.downKeys.clear(); for (const p of this.pads) for (const b of BUTTONS) p.push(b, false); });
    if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
      navigator.keyboard.getLayoutMap().then((m) => { this.layout = m; this.emit('layout'); }).catch(() => {});
    }
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data) { for (const f of this.listeners) f(type, data); }

  loadBindings() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (Array.isArray(s) && s.length === 4 && s.every((b) => b && BUTTONS.every((k) => typeof b[k] === 'string'))) return s;
    } catch (e) { /* storage unavailable */ }
    return DEFAULT_BINDINGS.map((b) => ({ ...b }));
  }
  saveBindings() { try { localStorage.setItem(STORE, JSON.stringify(this.bindings)); } catch (e) { /* ignore */ } }
  resetBindings() { this.bindings = DEFAULT_BINDINGS.map((b) => ({ ...b })); this.saveBindings(); }

  keyFor(code) {
    for (let i = 0; i < 4; i++) for (const b of BUTTONS) if (this.bindings[i][b] === code) return { slot: i, b };
    return null;
  }

  onKey(e, isDown) {
    if (this.capture && isDown) {
      e.preventDefault();
      const fn = this.capture; this.capture = null;
      fn(e.code);
      return;
    }
    const tag = (e.target && e.target.tagName) || '';
    const k = this.keyFor(e.code);
    if (k && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
      e.preventDefault();
      // event timestamps share performance.now()'s clock: exact tap timing even at a low frame rate
      const t = (e.timeStamp > 1e3 ? e.timeStamp : performance.now()) / 1000;
      this.pads[k.slot].push(k.b, isDown, t);
    }
    if (isDown) {
      if (!this.downKeys.has(e.code)) { this.downKeys.add(e.code); this.emit('keydown', e); }
    } else this.downKeys.delete(e.code);
  }

  keyLabel(code) {
    if (!code) return '—';
    if (this.layout && this.layout.get(code)) {
      const k = this.layout.get(code);
      return k.length === 1 ? k.toUpperCase() : k;
    }
    if (PRETTY[code]) return PRETTY[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
    return code;
  }

  // Touch: one set of three pads per touch player, side by side along the bottom of the screen.
  // `slots` = player indexes using touch. Builds the buttons into `root`.
  buildTouch(root, slots, colors) {
    root.innerHTML = '';
    root.classList.toggle('show', slots.length > 0);
    root.dataset.n = String(slots.length);
    for (const slot of slots) {
      const zone = document.createElement('div');
      zone.className = 'tz';
      zone.style.setProperty('--pc', colors[slot] || '#fff');
      for (const b of ['left', 'action', 'right']) {
        const el = document.createElement('div');
        el.className = 'tb tb-' + b;
        el.innerHTML = `<span>${b === 'left' ? '◀' : b === 'right' ? '▶' : '●'}</span>`;
        const set = (down) => (e) => {
          e.preventDefault();
          if (down && e.pointerId != null) { try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
          this.pads[slot].push(b, down, (e.timeStamp > 1e3 ? e.timeStamp : performance.now()) / 1000);
          el.classList.toggle('down', down);
        };
        el.addEventListener('pointerdown', set(true));
        el.addEventListener('pointerup', set(false));
        el.addEventListener('pointercancel', set(false));
        el.addEventListener('lostpointercapture', set(false));
        zone.appendChild(el);
      }
      root.appendChild(zone);
    }
  }
}
