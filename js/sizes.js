// Player sizes: how big the hands on the buttons are. A Little player taps a slower beat, gets wider
// timing windows and helpers that take over the extra rules, so each event comes down to one trick;
// a Kid gets a slower beat and somewhat wider windows. Big plays the full game. A perfect beat from a
// smaller player is worth a touch less top speed (`top`), so a computer kid on normal still keeps up.
// Computer kids are always Big (their own difficulty does the rest).
export const SIZES = {
  little: { id: 'little', label: 'Little', ages: '3–5', beat: 0.4, top: 0.94, win: 2.5, help: 2 },
  kid: { id: 'kid', label: 'Kid', ages: '6–9', beat: 0.65, top: 0.97, win: 1.6, help: 1 },
  big: { id: 'big', label: 'Big', ages: '10+', beat: 1, top: 1, win: 1, help: 0 },
};
export const SIZE_ORDER = ['little', 'kid', 'big'];

export function sizeOf(c) { return c && c.human ? (SIZES[c.size] || SIZES.big) : SIZES.big; }
// the rhythm target for this competitor: the event's beat, scaled to the size of the hands
export function beatFor(c, target) { return target * sizeOf(c).beat; }
// a timing window (or a tolerance) for this competitor
export function winFor(c, w) { return w * sizeOf(c).win; }
// does this competitor get the helper at this level (1 = Kid and Little, 2 = Little only)?
export function helped(c, level = 2) { return sizeOf(c).help >= level; }
// fit a Rhythm to the player: slower beat, more forgiving of uneven taps, and for Little players any
// button is the next step
export function fitRhythm(r, c) {
  const z = sizeOf(c);
  r.k = z.beat;
  r.top = z.top;
  r.hold = 1.5 + (z.win - 1) * 0.45;
  r.slack = 0.32 + (z.win - 1) * 0.08;
  r.any = z.help >= 2;
  return r;
}
