// Synthesised sound, no audio files: starter whistle, wooden footsteps, a squeaky stuffed-animal crowd,
// kazoo and toy-piano jingles, ski hiss, fan wind, thumps and clacks.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('tabletop-trials.muted') === '1'; } catch (e) { /* ignore */ }
    this.unlocked = false;
    this.wantMusic = false;
    this.musicOn = false;
    const unlock = () => {
      this.unlocked = true;
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, unlock, true);
      this.ensure();
      if (this.wantMusic) this.startMusic();
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, true);
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    if (!this.unlocked) return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0.2; this.music.connect(this.master);
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.buildLoops();
    return true;
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('tabletop-trials.muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  // ---------- building blocks ----------
  out(node, pan = 0) {
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-0.9, Math.min(0.9, pan));
      node.connect(p); p.connect(this.sfx);
    } else node.connect(this.sfx);
  }
  tone(freq, dur, { type = 'square', vol = 0.2, when = 0, slideTo = null, attack = 0.005, pan = 0, vib = 0, vibRate = 6, dest = null } = {}) {
    if (!this.ensure()) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    if (vib) {
      const l = ctx.createOscillator(); l.frequency.value = vibRate;
      const lg = ctx.createGain(); lg.gain.value = vib;
      l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.05);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    if (dest) g.connect(dest); else this.out(g, pan);
    o.start(t); o.stop(t + dur + 0.05);
  }
  noiseBurst(dur, { freq = 800, q = 1, vol = 0.3, type = 'lowpass', pan = 0, when = 0, attack = 0.002 } = {}) {
    if (!this.ensure()) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g);
    this.out(g, pan);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  sweep(dur, { from = 500, to = 2000, q = 1.2, vol = 0.1, type = 'bandpass', pan = 0, attack = 0.1, when = 0 } = {}) {
    if (!this.ensure()) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g);
    this.out(g, pan);
    s.start(t, Math.random() * 1.2); s.stop(t + dur + 0.05);
  }

  // continuous layers whose level the game sets every frame: crowd murmur, ski hiss, wind, fan hum
  buildLoops() {
    const ctx = this.ctx;
    const loop = (freq, q, type = 'bandpass') => {
      const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(f).connect(g).connect(this.sfx);
      s.start();
      return { s, f, g };
    };
    this.loops = {
      crowd: loop(1100, 0.6),
      hiss: loop(5200, 0.8, 'highpass'),
      wind: loop(700, 0.7),
      fan: loop(180, 3),
    };
    // a murmur needs movement: wobble the crowd filter
    const l = ctx.createOscillator(); l.frequency.value = 0.7;
    const lg = ctx.createGain(); lg.gain.value = 260;
    l.connect(lg).connect(this.loops.crowd.f.frequency); l.start();
  }
  // level 0..1 for 'crowd' | 'hiss' | 'wind' | 'fan'; freq optional (filter centre)
  setLoop(name, level, freq = null) {
    if (!this.ctx || !this.loops) return;
    const L = this.loops[name], t = this.ctx.currentTime;
    const scale = { crowd: 0.13, hiss: 0.09, wind: 0.14, fan: 0.07 }[name];
    L.g.gain.setTargetAtTime(Math.max(0, level) * scale, t, 0.08);
    if (freq) L.f.frequency.setTargetAtTime(freq, t, 0.08);
  }
  silenceLoops() { if (this.loops) for (const k in this.loops) this.setLoop(k, 0); }

  // ---------- event sounds ----------
  click() { this.tone(1500, 0.035, { type: 'triangle', vol: 0.06 }); }
  pick() { this.tone(988, 0.08, { type: 'triangle', vol: 0.08 }); this.tone(1319, 0.12, { type: 'triangle', vol: 0.07, when: 0.06 }); }
  // pea whistle: a warbling high tone
  whistle(dur = 0.45) {
    this.tone(2650, dur, { type: 'sine', vol: 0.16, vib: 140, vibRate: 34, attack: 0.01 });
    this.tone(2650 * 1.5, dur, { type: 'sine', vol: 0.03, vib: 200, vibRate: 34, attack: 0.01 });
    this.noiseBurst(dur, { freq: 2600, q: 6, type: 'bandpass', vol: 0.05 });
  }
  // "on your marks" / "set" cue: a soft wood block
  block(high = false) { this.tone(high ? 1250 : 900, 0.09, { type: 'sine', vol: 0.18 }); this.noiseBurst(0.03, { freq: 2500, type: 'bandpass', q: 3, vol: 0.06 }); }
  // a wooden foot on the floor; v 0..1
  step(v = 1, pan = 0) {
    this.tone(150 + Math.random() * 60, 0.05, { type: 'sine', vol: 0.05 + 0.06 * v, pan });
    this.noiseBurst(0.025, { freq: 1800 + Math.random() * 600, type: 'bandpass', q: 2.5, vol: 0.025 + 0.04 * v, pan });
  }
  stumble(pan = 0) { this.tone(260, 0.12, { type: 'triangle', vol: 0.1, slideTo: 170, pan }); }
  // wooden figurine toppling over
  clack(pan = 0) {
    this.tone(1900 + Math.random() * 500, 0.06, { type: 'sine', vol: 0.18, pan });
    this.tone(1300, 0.08, { type: 'sine', vol: 0.12, when: 0.07, pan });
    this.noiseBurst(0.05, { freq: 3800, type: 'highpass', vol: 0.08, pan });
  }
  thump(v = 1) { this.tone(80, 0.25, { type: 'sine', vol: 0.25 * v, slideTo: 45 }); this.noiseBurst(0.2, { freq: 400, vol: 0.12 * v }); }
  puff() { this.noiseBurst(0.5, { freq: 900, q: 0.5, type: 'lowpass', vol: 0.18, attack: 0.02 }); }
  whoosh(vol = 1) { this.sweep(0.7, { from: 300, to: 2400, q: 0.9, vol: 0.1 * vol, attack: 0.2 }); }
  pop() { this.tone(500, 0.12, { type: 'sine', vol: 0.16, slideTo: 1100 }); }
  // the stuffed-animal crowd: a burst of squeaks and a cheer swell
  cheer(big = 1) {
    this.sweep(1.6 * big, { from: 700, to: 1600, q: 0.5, vol: 0.12 * big, attack: 0.15 });
    for (let i = 0; i < 6 + 6 * big; i++) {
      const f = 900 + Math.random() * 1400;
      this.tone(f, 0.1 + Math.random() * 0.1, { type: 'sine', vol: 0.035, slideTo: f * (1.2 + Math.random() * 0.4), when: Math.random() * 1.1 * big, pan: Math.random() * 1.6 - 0.8 });
    }
  }
  aww() { this.sweep(1.0, { from: 900, to: 380, q: 0.6, vol: 0.1, attack: 0.1 }); }
  clap(n = 14) {
    for (let i = 0; i < n; i++) this.noiseBurst(0.04, { freq: 1500 + Math.random() * 1500, q: 1.2, type: 'bandpass', vol: 0.05, when: i * 0.07 + Math.random() * 0.05, pan: Math.random() * 1.4 - 0.7 });
  }
  // kazoo: buzzy sawtooth through a vowel-ish band
  kazoo(midi, dur, when = 0, vol = 0.09) {
    if (!this.ensure()) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(midi);
    const l = ctx.createOscillator(); l.frequency.value = 5.5;
    const lg = ctx.createGain(); lg.gain.value = mtof(midi) * 0.012;
    l.connect(lg).connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 1.3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t); l.start(t); o.stop(t + dur + 0.05); l.stop(t + dur + 0.05);
  }
  piano(midi, dur = 0.5, when = 0, vol = 0.12, dest = null) {
    this.tone(mtof(midi), dur, { type: 'triangle', vol, when, attack: 0.003, dest });
    this.tone(mtof(midi) * 2, dur * 0.5, { type: 'sine', vol: vol * 0.3, when, attack: 0.003, dest });
  }
  // a team's own little tune (4–6 notes from its seed), played on kazoo with a toy-piano bass
  jingle(seed = 1, big = false) {
    let s = seed * 9301 + 49297;
    const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const scale = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];
    const root = 62 + Math.floor(r() * 5);
    const n = big ? 6 : 4;
    let t = 0, idx = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      idx = Math.max(0, Math.min(scale.length - 1, idx + Math.floor(r() * 5) - 2));
      if (i === n - 1) idx = 7;
      const d = i === n - 1 ? 0.55 : r() < 0.5 ? 0.14 : 0.24;
      this.kazoo(root + scale[idx], d, t);
      if (i % 2 === 0) this.piano(root - 12 + (i === n - 1 ? 0 : scale[idx % 5]), d * 1.6, t, 0.08);
      t += d;
    }
    return t;
  }
  fanfare() {
    const seq = [[67, 0.14], [72, 0.14], [76, 0.14], [79, 0.32], [76, 0.14], [79, 0.6]];
    let t = 0;
    for (const [m, d] of seq) { this.kazoo(m, d + 0.03, t, 0.08); this.kazoo(m - 12, d + 0.03, t, 0.05); t += d; }
  }
  medal(place) {
    const base = place === 1 ? 84 : place === 2 ? 79 : 76;
    [0, 4, 7, 12].forEach((k, i) => this.piano(base + k, 0.4, i * 0.08, 0.1));
  }
  newRecord() { [76, 79, 83, 88].forEach((m, i) => this.piano(m, 0.3, i * 0.07, 0.11)); this.tone(1760, 0.6, { type: 'sine', vol: 0.06, when: 0.3, vib: 20 }); }

  // ---------- menu music: a toy piano and kazoo loop ----------
  startMusic() {
    this.wantMusic = true;
    if (this.musicOn || !this.ensure()) return;
    this.musicOn = true;
    const ctx = this.ctx;
    const step = 60 / 112 / 2;
    const bass = [48, 48, 55, 55, 53, 53, 55, 55, 48, 48, 55, 55, 53, 55, 48, 48];
    const lead = [72, 0, 76, 79, 0, 76, 77, 0, 76, 0, 74, 72, 0, 74, 76, 0, 72, 0, 76, 79, 0, 81, 79, 0, 77, 76, 74, 0, 72, 0, 0, 0];
    let next = ctx.currentTime + 0.1, i = 0;
    const tick = () => {
      if (!this.musicOn) return;
      while (next < ctx.currentTime + 0.3) {
        const b = bass[(i >> 1) % bass.length];
        if (i % 2 === 0) this.piano(b, step * 1.7, next - ctx.currentTime, 0.3, this.music);
        const l = lead[i % lead.length];
        if (l) this.piano(l, step * 1.2, next - ctx.currentTime, 0.22, this.music);
        next += step; i++;
      }
      this.musicTimer = setTimeout(tick, 70);
    };
    tick();
  }
  stopMusic() { this.wantMusic = false; this.musicOn = false; clearTimeout(this.musicTimer); }
}
