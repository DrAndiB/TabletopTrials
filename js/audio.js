// Synthesised sound, no audio files: starter whistle, wooden footsteps, kazoo and toy-piano jingles,
// ski hiss, fan wind, thumps and clacks; quiet chip-tune background music in the style of the old
// home-computer sports games (original tunes); and for every room a little reverb and its own quiet
// background life (birds outside the front door, a dripping tap, the fire crackling).
// The crowd is silent for now (its sounds are no-ops; earlier attempts are in the git history).
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// vowel formants (Hz)
const VOWELS = { a: [850, 1350], e: [520, 2100], i: [330, 2500], o: [520, 900], u: [380, 760] };
// each room: reverb length (s), brightness 0..1, how much of it; and what you hear in the background
const ROOMS = {
  hall: { decay: 1.1, bright: 0.6, wet: 0.2, amb: ['birds'] },
  bathroom: { decay: 1.7, bright: 0.85, wet: 0.3, amb: ['drip'] },
  bedroom: { decay: 0.55, bright: 0.4, wet: 0.12, amb: ['bubbles', 'crickets'] },
  living: { decay: 0.75, bright: 0.45, wet: 0.14, amb: ['clock', 'snore'] },
  playroom: { decay: 0.75, bright: 0.5, wet: 0.14, amb: ['train'] },
  december: { decay: 0.75, bright: 0.45, wet: 0.14, amb: ['bells', 'clock'] },
  kitchenNight: { decay: 0.95, bright: 0.6, wet: 0.18, amb: ['fridge', 'clock', 'purr'] },
  kitchen: { decay: 0.95, bright: 0.65, wet: 0.18, amb: ['clock', 'spoon', 'birds'] },
  attic: { decay: 1.25, bright: 0.45, wet: 0.2, amb: ['creak'] },
  garage: { decay: 1.5, bright: 0.55, wet: 0.25, amb: ['buzz'] },
  fireside: { decay: 0.6, bright: 0.35, wet: 0.12, amb: ['crackle', 'clock'] },
  menu: { decay: 0.8, bright: 0.5, wet: 0.1, amb: [] },
};
// the room each event is in
const SCENES = {
  sprint: 'hall', hurdles: 'hall', swimming: 'bathroom', diving: 'bedroom', javelin: 'living', polevault: 'playroom',
  skijump: 'december', speedskating: 'kitchenNight', curling: 'kitchen', bobsled: 'attic', halfpipe: 'garage', biathlon: 'fireside',
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('tabletop-trials.muted') === '1'; } catch (e) { /* ignore */ }
    this.unlocked = false;
    this.wantSong = null;
    this.musicLevel = 1;
    const unlock = () => {
      this.unlocked = true;
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, unlock, true);
      this.ensure();
      if (this.wantSong) this.playMusic(this.wantSong, this.musicLevel);
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
    // the music: a little softened at the top, like the filter on an old sound chip
    this.music = ctx.createGain(); this.music.gain.value = 0;
    const mlp = ctx.createBiquadFilter(); mlp.type = 'lowpass'; mlp.frequency.value = 4600; mlp.Q.value = 0.6;
    this.music.connect(mlp).connect(this.master);
    // the room: everything but the music goes through a little reverb as well
    this.verb = ctx.createConvolver();
    this.send = ctx.createGain(); this.send.gain.value = 0.12;
    this.sfx.connect(this.send).connect(this.verb).connect(this.master);
    // the room's background sounds
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 1; this.ambBus.connect(this.sfx);
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.buildLoops();
    this.setScene(this.sceneId ?? null, true);
    this.startTicker();
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

  // continuous layers whose level the game sets every frame: ski hiss, wind, fan hum
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
      hiss: loop(5200, 0.8, 'highpass'),
      wind: loop(700, 0.7),
      fan: loop(180, 3),
    };
  }
  // level 0..1 for 'crowd' | 'hiss' | 'wind' | 'fan'; freq optional (filter centre)
  setLoop(name, level, freq = null) {
    if (name === 'crowd') return;   // the crowd is silent for now
    if (!this.ctx || !this.loops) return;
    const L = this.loops[name], t = this.ctx.currentTime;
    const scale = { hiss: 0.09, wind: 0.14, fan: 0.07 }[name];
    L.g.gain.setTargetAtTime(Math.max(0, level) * scale, t, 0.08);
    if (freq) L.f.frequency.setTargetAtTime(freq, t, 0.08);
  }
  silenceLoops() { if (this.loops) for (const k in this.loops) this.setLoop(k, 0); }

  // ---------- the scene: who is watching, and which room ----------
  // id: an event id (see SCENES), 'menu', or null for silence
  setScene(id, force = false) {
    if (id === this.sceneId && !force) return;
    this.sceneId = id;
    const roomId = SCENES[id] || (id === 'menu' ? 'menu' : null);
    this.room = ROOMS[roomId] || null;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // the reverb for this room
    const R = this.room || ROOMS.menu;
    this.verb.buffer = this.impulse(R.decay, R.bright);
    this.send.gain.setTargetAtTime(R.wet, t, 0.1);
    // the steady background hums stop; the new room's start
    if (this.hums) for (const h of this.hums) { h.g.gain.setTargetAtTime(0, t, 0.2); h.stop(t + 1.5); }
    this.hums = [];
    this.amb = {};
    for (const a of (this.room ? this.room.amb : [])) {
      if (a === 'fridge') this.hum([50, 100, 150], 0.006, 220);
      else if (a === 'buzz') this.hum([120, 240, 360], 0.004, 900);
      else this.amb[a] = t + rand(0.5, 3);
    }
  }

  // a room's reverb: a decaying burst of (more or less) filtered noise, a short gap first
  impulse(decay, bright) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = Math.round(rate * decay), pre = Math.round(rate * 0.012);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / rate, k = (0.12 + 0.8 * bright) * Math.exp(-t * 2 / decay);   // darker as it dies away
        lp += k * (Math.random() * 2 - 1 - lp);
        d[i] = lp * Math.exp((-t * 6.9) / decay);
      }
    }
    return buf;
  }

  // a steady hum (the fridge, a strip light): a few harmonics through a low-pass
  hum(freqs, vol, cut) {
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 1.5);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut;
    g.connect(f).connect(this.ambBus);
    const oscs = freqs.map((fr, i) => { const o = ctx.createOscillator(); o.type = i ? 'sine' : 'triangle'; o.frequency.value = fr; const og = ctx.createGain(); og.gain.value = 1 / (i + 1); o.connect(og).connect(g); o.start(t); return o; });
    this.hums.push({ g, stop: (when) => oscs.forEach((o) => o.stop(when)) });
  }

  // ---------- the scheduler: the room's sounds, a little ahead of time ----------
  startTicker() {
    if (this.tickTimer) return;
    this.schedT = 0;
    const tick = () => {
      this.tickTimer = setTimeout(tick, 70);
      if (!this.ctx || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      const t0 = Math.max(this.schedT, now), t1 = now + 0.25;
      if (t1 > t0) this.schedule(t0, t1);
      this.schedT = t1;
    };
    tick();
  }

  schedule(t0, t1) {
    // the room
    for (const k in this.amb) {
      let t = this.amb[k];
      while (t < t1) t += this.ambient(k, Math.max(t, t0));
      this.amb[k] = t;
    }
  }

  // ---------- small sounds for the rooms ----------
  // one syllable: a buzzy little voice through two vowel formants
  syllable(t, f0, dur, { vowel = 'a', vol = 0.05, slide = 1, pan = 0, dest = this.ambBus, type = 'sawtooth' } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.3));
    g.gain.setValueAtTime(vol, t + dur * 0.55); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const [F1, F2] = VOWELS[vowel];
    for (const [F, q, a] of [[F1, 5, 1], [F2, 7, 0.55]]) {
      const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = F * 1.25; b.Q.value = q;
      const bg = ctx.createGain(); bg.gain.value = a * 2.2;
      o.connect(b).connect(bg).connect(g);
    }
    this.place(g, pan, dest);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // a plain tone at an absolute time
  blip(t, f, dur, { type = 'sine', vol = 0.03, slide = 1, pan = 0, dest = this.ambBus, attack = 0.004 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f, t); if (slide !== 1) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    this.place(g, pan, dest);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  // a click of noise at an absolute time
  tick(t, dur, { freq = 3000, q = 1, type = 'bandpass', vol = 0.02, pan = 0, dest = this.ambBus } = {}) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g);
    this.place(g, pan, dest);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
  }
  place(node, pan, dest) {
    if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-0.9, Math.min(0.9, pan)); node.connect(p).connect(dest); } else node.connect(dest);
  }

  // ---------- the room's background life; returns seconds until the next one ----------
  ambient(kind, t) {
    const pan = rand(-0.7, 0.7), A = this.ambBus;
    switch (kind) {
      case 'birds': {    // outside the front door: a short phrase of chirps
        const f = rand(3200, 4400), n = 3 + Math.floor(Math.random() * 4);
        for (let k = 0; k < n; k++) this.blip(t + k * 0.09, f * rand(0.92, 1.12), 0.06, { vol: 0.007, slide: rand(1.1, 1.4), pan, dest: A });
        return rand(4, 9);
      }
      case 'drip': {     // the tap drips into the bath: bloop
        this.blip(t, rand(800, 1100), 0.09, { vol: 0.03, slide: 2.1, pan: 0.3, dest: A });
        return rand(2.5, 6);
      }
      case 'bubbles': {  // the goldfish bowl
        for (let k = 0; k < 2 + Math.floor(Math.random() * 4); k++) this.blip(t + k * rand(0.05, 0.12), rand(500, 900), 0.05, { vol: 0.012, slide: 1.8, pan: -0.2, dest: A });
        return rand(3, 7);
      }
      case 'crickets': { // out in the garden at dusk
        for (let k = 0; k < 4; k++) this.blip(t + k * 0.055, 4700, 0.03, { vol: 0.0035, pan: 0.6, dest: A });
        return rand(1.2, 3.5);
      }
      case 'clock': {    // tick, tock
        this.tock = !this.tock;
        this.tick(t, 0.02, { freq: this.tock ? 2400 : 2900, q: 6, vol: 0.007, pan: -0.5 });
        return 1;
      }
      case 'snore': {    // the dog asleep in its basket
        this.syllable(t, 68, 1.3, { vowel: 'u', vol: 0.025, slide: 0.9, pan: -0.4, dest: A });
        this.syllable(t + 1.6, 90, 0.7, { vowel: 'u', vol: 0.012, slide: 1.1, pan: -0.4, dest: A });
        return rand(6, 10);
      }
      case 'train': {    // the toy train going round: clickety-clack, then a toot
        for (let k = 0; k < 8; k++) this.tick(t + k * 0.21 + (k % 2) * 0.06, 0.03, { freq: 1500, q: 3, vol: 0.01, pan: -0.6 + k * 0.15 });
        this.blip(t + 1.8, 784, 0.45, { type: 'triangle', vol: 0.012, pan: 0.5, dest: A }); this.blip(t + 1.8, 988, 0.45, { type: 'triangle', vol: 0.01, pan: 0.5, dest: A });
        return rand(12, 20);
      }
      case 'bells': {    // sleigh bells somewhere outside
        for (let k = 0; k < 7; k++) this.blip(t + k * rand(0.05, 0.09), rand(3400, 5200), 0.12, { vol: 0.005, pan, dest: A });
        return rand(10, 18);
      }
      case 'purr': {     // the cat on the worktop
        for (let k = 0; k < 10; k++) this.syllable(t + k * 0.26, 52, 0.22, { vowel: 'u', vol: 0.014, slide: k % 2 ? 1.05 : 0.95, pan: 0.6, dest: A });
        return rand(14, 24);
      }
      case 'spoon': {    // a spoon on a cup
        const f = rand(2900, 3400);
        this.blip(t, f, 0.35, { vol: 0.008, pan, dest: A }); this.blip(t, f * 2.4, 0.2, { vol: 0.003, pan, dest: A });
        return rand(7, 14);
      }
      case 'creak': {    // the old attic floor
        this.syllable(t, rand(80, 110), rand(0.4, 0.7), { vowel: 'o', vol: 0.02, slide: rand(1.2, 1.5), pan, dest: A });
        return rand(7, 14);
      }
      case 'crackle': {  // the fire
        this.tick(t, rand(0.004, 0.012), { freq: rand(1800, 4000), q: 0.8, type: 'highpass', vol: rand(0.008, 0.03), pan: rand(-0.2, 0.2) });
        if (Math.random() < 0.05) this.tick(t, 0.03, { freq: 900, q: 1, vol: 0.05, pan: 0 });
        return rand(0.06, 0.35);
      }
      default: return 999;
    }
  }

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
  // the crowd's reactions: silent for now (the events still call them, so they can come back)
  cheer() {}
  aww() {}
  ooh() {}
  clap() {}
  // the jingle voice: a chip pulse with vibrato (it used to be a kazoo, hence the name)
  kazoo(midi, dur, when = 0, vol = 0.09) {
    if (!this.ensure()) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.setPeriodicWave(this.pulseWave(0.25)); o.frequency.value = mtof(midi);
    const l = ctx.createOscillator(); l.frequency.value = 5.5;
    const lg = ctx.createGain(); lg.gain.value = mtof(midi) * 0.008;
    l.connect(lg).connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200; f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 0.7, t + 0.01);
    g.gain.setValueAtTime(vol * 0.7, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
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

  // ---------- background music: three-voice chip tunes ----------
  // name: 'menu' | 'summer' | 'winter'; level: 1 in the menus, lower during the events
  playMusic(name, level = 1) {
    this.wantSong = name; this.musicLevel = level;
    if (!this.ensure()) return;   // it starts with the first tap or key
    const t = this.ctx.currentTime, S = SONGS[name];
    if (!S) return;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setTargetAtTime(MUSIC_VOL * level, t, 0.4);
    if (this.song && this.song.name === name && !this.song.stopping) return;
    if (!S.bars) S.bars = S.lead.map(parseBar);
    this.song = { name, S, k: 0, t: t + 0.15, dur: 60 / S.bpm / 4 };
    if (!this.musicTimer) {
      const tick = () => {
        this.musicTimer = setTimeout(tick, 60);
        const song = this.song;
        if (!song || this.ctx.state !== 'running') return;
        const until = this.ctx.currentTime + 0.25;
        if (song.t < this.ctx.currentTime - 0.5) song.t = this.ctx.currentTime;   // the tab was asleep
        while (song.t < until) { this.musicStep(song, song.k, song.t); song.t += song.dur; song.k++; }
      };
      tick();
    }
  }
  stopMusic(fade = 0.5) {
    this.wantSong = null;
    if (!this.ctx || !this.song) return;
    const t = this.ctx.currentTime, song = this.song;
    song.stopping = true;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setTargetAtTime(0, t, fade / 3);
    setTimeout(() => { if (this.song === song) this.song = null; }, fade * 1000 + 200);
  }
  // the old name the menus use
  startMusic() { this.playMusic('menu', 1); }

  musicStep(song, k, t) {
    const S = song.S, per = S.beats * 4, nb = S.bars.length, bar = Math.floor(k / per) % nb, s = k % per, d = song.dur;
    const names = S.chords[bar].split(' '), ch = chordOf(names[Math.min(names.length - 1, Math.floor((s * names.length) / per))]);
    // the tune
    for (const n of S.bars[bar]) if (n.at === s && n.m) this.chipLead(t, mtof(n.m), n.len * d);
    // the bass
    const beat = s % 4 === 0, b = s / 4;
    if (S.style === 'waltz') {
      if (s === 0) this.chipBass(t, mtof(ch.root - 12), d * 3.6);
      if (s === 4 || s === 8) this.chipArp(t, ch, d * 2.6);
    } else if (S.style === 'march') {
      if (beat) this.chipBass(t, mtof(ch.root - 12 + (b % 2 ? 7 : 0)), d * 1.8);
      if (s % 4 === 2) this.chipArp(t, ch, d * 1.4);
    } else {
      if (s % 2 === 0) this.chipBass(t, mtof(ch.root - 12 + (s % 4 === 2 ? 12 : 0)), d * 1.6);
      if (s % 8 === 4) this.chipArp(t, ch, d * 3);
    }
    // the drums: soft
    if (S.style === 'waltz') { if (s === 0) this.chipKick(t); else if (beat) this.chipHat(t, 0.6); }
    else {
      if (s === 0 || s === per / 2 || (S.style === 'pop' && s === per / 2 + 2)) this.chipKick(t);
      if (s === 4 || s === 12) this.chipSnare(t);
      if (s % 2 === 0) this.chipHat(t, beat ? 0.7 : 1);
    }
  }

  pulseWave(duty) {
    this.pulses = this.pulses || {};
    if (!this.pulses[duty]) {
      const n = 28, re = new Float32Array(n), im = new Float32Array(n);
      for (let i = 1; i < n; i++) re[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
      this.pulses[duty] = this.ctx.createPeriodicWave(re, im);
    }
    return this.pulses[duty];
  }
  // the lead: a 25% pulse with a little vibrato that comes in after the attack
  chipLead(t, f, dur) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.setPeriodicWave(this.pulseWave(0.25)); o.frequency.value = f;
    const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.6;
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.25, dur * 0.6));
    l.connect(lg).connect(o.frequency);
    const end = t + Math.max(0.06, dur * 0.92);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 0.008); g.gain.setTargetAtTime(0.06, t + 0.01, 0.06);
    g.gain.setValueAtTime(0.06, end - 0.03); g.gain.linearRampToValueAtTime(0.0001, end);
    o.connect(g).connect(this.music);
    o.start(t); l.start(t); o.stop(end + 0.02); l.stop(end + 0.02);
  }
  // the bass: a triangle
  chipBass(t, f, dur) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2, t + 0.006); g.gain.setTargetAtTime(0.11, t + 0.01, 0.08); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.music);
    o.start(t); o.stop(t + dur + 0.02);
  }
  // the chord: the old sound-chip trick, one thin voice running through the chord notes 50 times a second
  chipArp(t, ch, dur) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.setPeriodicWave(this.pulseWave(0.125));
    const notes = ch.iv.map((iv) => mtof(ch.root + 12 + iv));
    for (let k = 0, u = 0; u < dur; k++, u += 0.02) o.frequency.setValueAtTime(notes[k % notes.length], t + u);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.035, t + 0.006); g.gain.setTargetAtTime(0.0001, t + dur * 0.4, dur * 0.25);
    o.connect(g).connect(this.music);
    o.start(t); o.stop(t + dur + 0.05);
  }
  chipKick(t) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(this.music); o.start(t); o.stop(t + 0.16);
  }
  chipSnare(t) {
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8;
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    s.connect(f).connect(g).connect(this.music); s.start(t, Math.random()); s.stop(t + 0.14);
  }
  chipHat(t, v = 1) {
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise; f.type = 'highpass'; f.frequency.value = 7500;
    g.gain.setValueAtTime(0.018 * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    s.connect(f).connect(g).connect(this.music); s.start(t, Math.random()); s.stop(t + 0.05);
  }
}

// ---------- the tunes (our own, in the spirit of the old 8-bit sports games) ----------
const MUSIC_VOL = 0.42;
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midiOf(n) {
  const m = /^([A-G])(#|b)?(\d)$/.exec(n);
  return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const QUALITY = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11] };
function chordOf(name) {
  const m = /^([A-G][#b]?)(.*)$/.exec(name);
  return { root: midiOf(m[1] + '3'), iv: QUALITY[m[2]] || QUALITY[''] };
}
// one bar of tune: 'E5:4 G5:2 R:2' (a note, or R for a rest, and its length in sixteenths)
function parseBar(str) {
  let at = 0;
  return str.trim().split(/\s+/).map((tok) => {
    const [n, l] = tok.split(':'), len = +l;
    const ev = { at, len, m: n === 'R' ? 0 : midiOf(n) };
    at += len;
    return ev;
  });
}
const SONGS = {
  // the menus: a bright, bouncy theme in G
  menu: {
    bpm: 118, beats: 4, style: 'pop',
    chords: ['G', 'C', 'D', 'G', 'Em', 'C', 'D', 'G'],
    lead: ['D5:2 G5:2 B5:4 A5:2 G5:2 D5:4', 'E5:4 G5:4 C6:6 B5:2', 'A5:4 F#5:2 D5:2 A5:4 F#5:4', 'G5:8 R:8',
      'B5:4 G5:2 E5:2 B5:4 G5:4', 'C6:6 B5:2 A5:4 G5:4', 'F#5:2 G5:2 A5:2 F#5:2 D5:4 F#5:4', 'G5:12 R:4'],
  },
  // the summer events: a sunny march in C
  summer: {
    bpm: 128, beats: 4, style: 'march',
    chords: ['C', 'Am', 'F', 'G', 'C', 'Em', 'F G', 'C', 'F', 'G', 'Em', 'Am', 'Dm', 'G', 'C', 'G7'],
    lead: ['E5:4 G5:2 E5:2 C5:4 G4:4', 'A4:2 C5:2 E5:4 D5:2 C5:2 A4:4', 'F4:4 A4:2 C5:2 F5:6 E5:2', 'D5:4 B4:2 G4:2 D5:8',
      'E5:2 E5:2 G5:4 C6:4 B5:2 A5:2', 'G5:4 E5:2 B4:2 E5:8', 'F5:2 E5:2 D5:2 C5:2 D5:2 E5:2 F5:2 D5:2', 'C5:12 R:4',
      'A5:4 G5:2 F5:2 C5:4 F5:4', 'G5:6 F5:2 E5:4 D5:4', 'E5:2 G5:2 B5:4 G5:2 E5:2 B4:4', 'C5:2 E5:2 A5:4 G5:2 E5:2 C5:4',
      'D5:4 F5:4 A5:4 F5:4', 'G5:6 A5:2 B5:4 G5:4', 'C6:4 G5:4 E5:4 G5:4', 'F5:2 E5:2 D5:2 B4:2 G4:4 R:4'],
  },
  // the winter events: a skating waltz in A minor
  winter: {
    bpm: 112, beats: 3, style: 'waltz',
    chords: ['Am', 'F', 'C', 'G', 'Am', 'Dm', 'E', 'E7', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'C', 'E'],
    lead: ['E5:8 A5:4', 'C6:6 B5:2 A5:4', 'G5:8 E5:4', 'D5:12', 'C5:4 E5:4 A5:4', 'F5:8 D5:4', 'B4:4 E5:4 G#5:4', 'B5:12',
      'A5:8 C6:4', 'B5:6 A5:2 G5:4', 'E5:8 G5:4', 'A5:12', 'F5:4 E5:4 D5:4', 'B4:4 D5:4 G5:4', 'E5:6 D5:2 C5:4', 'B4:12'],
  },
};
