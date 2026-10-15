// In-game overlay shared by all events: competitor chips (flag, name, live info), centre messages and
// short flashes. Events add their own meters inside #event-hud.
export class Hud {
  constructor(root) {
    this.root = root;
    this.chipsEl = root.querySelector('#chips');
    this.msgEl = root.querySelector('#msg');
    this.flashEl = root.querySelector('#flash');
    this.eventEl = root.querySelector('#event-hud');
    this.chips = [];
    this.msgTimer = null;
  }
  setup(competitors) {
    this.chipsEl.innerHTML = '';
    this.chips = competitors.map((c) => {
      const el = document.createElement('div');
      el.className = 'chip';
      el.innerHTML = `<img src="${c.flag}" alt=""><span class="chip-name">${c.short || c.name}</span><span class="chip-info"></span>`;
      this.chipsEl.appendChild(el);
      return { el, info: el.querySelector('.chip-info'), _i: null, _c: null };
    });
    this.flashEl.innerHTML = '';
    this.message('');
    this.visible(true);
  }
  visible(v) { this.root.classList.toggle('hidden', !v); }
  chip(i, info, cls = '') {
    const c = this.chips[i];
    if (!c) return;
    if (c._i !== info) { c.info.textContent = info; c._i = info; }
    if (c._c !== cls) { c.el.className = 'chip' + (cls ? ' ' + cls : ''); c._c = cls; }
  }
  // kind: '' | 'big' | 'small'; pop animates it in. dur (s) hides it again.
  message(text, kind = '', color = '#fff', dur = 0) {
    clearTimeout(this.msgTimer);
    this.msgEl.textContent = text || '';
    this.msgEl.className = 'msg' + (kind ? ' ' + kind : '') + (text ? ' show' : '');
    this.msgEl.style.setProperty('--mc', color);
    if (text) { this.msgEl.classList.remove('pop'); void this.msgEl.offsetWidth; this.msgEl.classList.add('pop'); }
    if (dur) this.msgTimer = setTimeout(() => this.message(''), dur * 1000);
  }
  flash(text, color = '#fff') {
    const el = document.createElement('div');
    el.className = 'flash-item';
    el.style.setProperty('--fc', color);
    el.textContent = text;
    this.flashEl.appendChild(el);
    setTimeout(() => el.remove(), 1900);
  }
}
