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
  sprint: '<circle cx="40" cy="10" r="6"/><path d="M37 18l-8 15M36 20l9 6 6-3M36 20l-9 3-5 7M29 33l10 7-3 13M29 33l-8 9H11"/>',
  skijump: '<path d="M4 22c14 2 20 10 26 22s12 12 30 12"/><path d="M22 34L58 18"/><circle cx="49" cy="8" r="5"/><path d="M37 28l8-14M44 16l-10 5"/>',
  hurdles: '<circle cx="26" cy="9" r="5"/><path d="M27 16l4 13M28 18l11-2M28 18l-9 5M31 29h13l6 4M31 29l-8 5-7-4M20 44h28M24 44v12M44 44v12"/>',
  javelin: '<circle cx="30" cy="11" r="5"/><path d="M8 30L58 6M29 18l-4 17M28 21l-10 6M28 21l10 5 4-4M25 35l10 7 2 12M25 35l-7 9-8 2"/>',
  biathlon: '<circle cx="24" cy="9" r="5"/><path d="M25 16l5 16M10 14l10 18M27 22l9 5M36 27l8 22M30 32l10 8v10M30 32l-6 9-6 9M8 54h48"/>',
  swimming: '<circle cx="44" cy="20" r="6"/><path d="M8 30c10-12 22-10 30-2M6 44c6 4 10 4 16 0s10-4 16 0 10 4 16 0 8-4 12-2M10 54c6 4 10 4 16 0s10-4 16 0 10 4 16 0"/>',
  diving: '<path d="M4 12h18M8 12v10"/><path d="M22 6l16 22"/><circle cx="47" cy="31" r="5"/><path d="M38 28c0 8 2 14 6 18M26 54c4 3 8 3 12 0s8-3 12 0 8 3 12 0"/>',
  polevault: '<circle cx="24" cy="10" r="5"/><path d="M6 40L46 6M24 17l-2 15M23 21l7 0M22 32l8 10-2 12M22 32l-6 10-8 4M48 30h14M50 30v26M60 30v26"/>',
  speedskating: '<circle cx="36" cy="12" r="5"/><path d="M32 18l-14 10 6 8-6 12M32 18l6 14 12 4M18 28l-8-4M12 52h16M40 40l12 8"/>',
  bobsled: '<path d="M6 40c16 8 36 8 52-4"/><path d="M14 34h30c6 0 10-4 10-8H22c-6 0-8 4-8 8z"/><circle cx="30" cy="18" r="5"/><path d="M12 46l40-4"/>',
  halfpipe: '<path d="M6 14v18c0 12 10 20 26 20s26-8 26-20V14"/><circle cx="46" cy="10" r="5"/><path d="M44 16l-4 10M36 30l14-6"/>',
  curling: '<ellipse cx="32" cy="40" rx="20" ry="8"/><path d="M14 38v-6c0-4 8-8 18-8s18 4 18 8v6M24 24c0-6 8-8 14-6"/>',
};
export function eventIcon(id) {
  return `<svg class="ev-ico" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="#1f1a17" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${ICONS[id] || ''}</svg>`;
}
