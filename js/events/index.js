// The events, in the order The Trials plays them, plus the ones still to come (shown greyed out).
import sprint from './sprint.js';
import hurdles from './hurdles.js';
import swimming from './swimming.js';
import diving from './diving.js';
import javelin from './javelin.js';
import polevault from './polevault.js';
import skijump from './skijump.js';
import speedskating from './speedskating.js';
import curling from './curling.js';
import bobsled from './bobsled.js';
import halfpipe from './halfpipe.js';
import biathlon from './biathlon.js';

export const EVENTS = [sprint, hurdles, swimming, diving, javelin, polevault, skijump, speedskating, curling, bobsled, halfpipe, biathlon];

export const SOON = [
];

export function eventById(id) { return EVENTS.find((e) => e.id === id) || EVENTS[0]; }

// Small menu icons, drawn as inline SVG.
const ICONS = {
  sprint: '<circle cx="34" cy="12" r="6"/><path d="M30 20l-8 10 8 6-4 14M30 20l10 6 8-4M34 34l10 6 2 10M22 30l-10 2"/>',
  skijump: '<path d="M6 16l30 22h22" class="snow"/><circle cx="42" cy="12" r="5"/><path d="M38 18l-10 10M28 28l-6 8M30 22l12 4"/><path d="M16 36l34-14" class="ski"/>',
  hurdles: '<circle cx="20" cy="12" r="6"/><path d="M18 20l-6 14 10 6M18 20l14 4M32 44V30h20v14M32 34h20"/>',
  javelin: '<circle cx="22" cy="14" r="6"/><path d="M22 22v16l-8 12M22 38l8 12M22 26l14-8M8 44L56 8"/>',
  biathlon: '<circle cx="18" cy="12" r="6"/><path d="M18 20l-4 18 8 10M16 26l14 4M8 52l40-6M38 22l14-6"/>',
  swimming: '<circle cx="44" cy="20" r="6"/><path d="M8 30c10-12 22-10 30-2M6 44c6 4 10 4 16 0s10-4 16 0 10 4 16 0 8-4 12-2M10 54c6 4 10 4 16 0s10-4 16 0 10 4 16 0"/>',
  diving: '<path d="M6 14h22"/><circle cx="40" cy="20" r="5"/><path d="M36 26c-4 6-2 12 4 16M44 26c4 4 4 10 0 16"/><ellipse cx="42" cy="52" rx="14" ry="6"/>',
  polevault: '<circle cx="30" cy="14" r="5"/><path d="M10 56C20 40 30 26 40 8M28 20l-6 12 8 6M48 30v26M60 30v26M44 32h20"/>',
  speedskating: '<circle cx="36" cy="12" r="5"/><path d="M32 18l-14 10 6 8-6 12M32 18l6 14 12 4M18 28l-8-4M12 52h16M40 40l12 8"/>',
  bobsled: '<path d="M6 40c16 8 36 8 52-4"/><path d="M14 34h30c6 0 10-4 10-8H22c-6 0-8 4-8 8z"/><circle cx="30" cy="18" r="5"/><path d="M12 46l40-4"/>',
  halfpipe: '<path d="M6 14v18c0 12 10 20 26 20s26-8 26-20V14"/><circle cx="46" cy="10" r="5"/><path d="M44 16l-4 10M36 30l14-6"/>',
  curling: '<ellipse cx="32" cy="40" rx="20" ry="8"/><path d="M14 38v-6c0-4 8-8 18-8s18 4 18 8v6M24 24c0-6 8-8 14-6"/>',
};
export function eventIcon(id) {
  return `<svg class="ev-ico" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="#1f1a17" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${ICONS[id] || ''}</svg>`;
}
