// Vibration on phones: a tick under the thumb for every stroke, a thump for the big moments.
// Quietly does nothing where the browser or the device has no vibration.
let on = true;
try { on = localStorage.getItem('tabletop-trials.haptics') !== 'off'; } catch (e) { /* storage unavailable */ }
const PATTERNS = { tick: 8, tap: 12, good: [14, 40, 22], bad: [40, 50, 40], thump: 35, go: 60 };
let last = 0;

export function hapticsOn() { return on; }
export function setHaptics(v) { on = !!v; try { localStorage.setItem('tabletop-trials.haptics', on ? 'on' : 'off'); } catch (e) { /* ignore */ } }
export function buzz(kind = 'tick') {
  if (!on || typeof navigator === 'undefined' || !navigator.vibrate) return;
  const now = performance.now();
  // a new tick would cut a longer buzz short: let the big ones finish
  if (kind === 'tick' && now - last < 30) return;
  last = kind === 'tick' ? last : now + 60;
  try { navigator.vibrate(PATTERNS[kind] ?? kind); } catch (e) { /* not allowed yet */ }
}
