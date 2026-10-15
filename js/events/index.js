// The events, in the order The Trials plays them, plus the ones still to come (shown greyed out).
import sprint from './sprint.js';
import hurdles from './hurdles.js';
import javelin from './javelin.js';
import skijump from './skijump.js';
import curling from './curling.js';

export const EVENTS = [sprint, hurdles, javelin, skijump, curling];

export const SOON = [
  { id: 'biathlon', name: 'Biathlon', season: 'Winter', icon: 'biathlon' },
];

export function eventById(id) { return EVENTS.find((e) => e.id === id) || EVENTS[0]; }

// Small menu icons, drawn as inline SVG.
const ICONS = {
  sprint: '<circle cx="34" cy="12" r="6"/><path d="M30 20l-8 10 8 6-4 14M30 20l10 6 8-4M34 34l10 6 2 10M22 30l-10 2"/>',
  skijump: '<path d="M6 16l30 22h22" class="snow"/><circle cx="42" cy="12" r="5"/><path d="M38 18l-10 10M28 28l-6 8M30 22l12 4"/><path d="M16 36l34-14" class="ski"/>',
  hurdles: '<circle cx="20" cy="12" r="6"/><path d="M18 20l-6 14 10 6M18 20l14 4M32 44V30h20v14M32 34h20"/>',
  javelin: '<circle cx="22" cy="14" r="6"/><path d="M22 22v16l-8 12M22 38l8 12M22 26l14-8M8 44L56 8"/>',
  biathlon: '<circle cx="18" cy="12" r="6"/><path d="M18 20l-4 18 8 10M16 26l14 4M8 52l40-6M38 22l14-6"/>',
  curling: '<ellipse cx="32" cy="40" rx="20" ry="8"/><path d="M14 38v-6c0-4 8-8 18-8s18 4 18 8v6M24 24c0-6 8-8 14-6"/>',
};
export function eventIcon(id) {
  return `<svg class="ev-ico" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="#1f1a17" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${ICONS[id] || ''}</svg>`;
}
