# Tabletop Trials

A playroom multi-sport game for the browser. Kids stage their own summer and winter games with painted
wooden figurines, a chalk track on the floorboards and a big book as a ski jump, while the stuffed
animals cheer from cardboard-box stands. Sibling of [Tabletop Turbo](https://github.com/DrAndiB/TabletopTurbo).

## Play
- **The Trials**: every event in a row, chocolate-coin medals, a running medal table and a closing ceremony.
- **One event**: pick an event and play it on its own.
- Up to four players on one keyboard (each player has left, right and action), on touch screens, or
  against computer kids (easy, normal, hard). Every team picks a country: real flags, a capital and a
  fun fact on the way in.

| Event | Season | How it plays |
|---|---|---|
| Sprint | Summer | Hold action in the blocks and let go on the whistle; tap left and right in turn to run: smooth out of the blocks, a steady beat, a little faster at the end. |
| Hurdles | Summer | The sprint with ten pencil-and-domino hurdles per lane: tap action to jump at the chalk mark. |
| Javelin | Summer | A pencil down the living-room rug: rhythm run-up, hold action to draw back, let go at 30-40° before the red line. Three throws. |
| Ski jump | Winter | Down an ironing board onto a cushion mountain: tap to start, keep your balance, tap in the green zone, lean against announced fan gusts, tap at LAND! for a telemark. Two jumps. |
| Curling | Winter | Bottle caps down the kitchen table: aim (they curl back to the middle), hold for strength, sweep with a toothbrush in rhythm. |
| Biathlon | Winter | Mass start round the coffee table: skate, take the cushion climb steady, tuck downhill, steer the curve, then shoot five bottle caps; each miss is a penalty loop. |

Default keys: P1 ← → ↑ · P2 A D W · P3 J L I · P4 Num 4, Num 6, Num 8 (all can be changed under Keys).

## Run it locally
No build step. Serve the folder and open it in a browser:

```powershell
python -m http.server 8140
# then open http://localhost:8140/
```

## Under the hood
- three.js r186 as a single local ES module bundle (`vendor/`), plain ES modules, no framework.
- Figurines are one skinned mesh each, posed from flat numeric poses (`js/figurine.js`).
- Events plug in through a small contract (`_dev/EVENT_GUIDE.md`), share input "verbs"
  (`js/verbs.js`: rhythm, timing, power, steer) and run on a fixed 120 Hz step, so keyboard, touch and
  computer players go through the same code path.
- Flags are drawn from their official constructions on canvas (`js/flags.js`); sound is synthesised
  with Web Audio (`js/audio.js`).

## Checks
Headless checks use Playwright with the bundled Chromium (`_dev/tools/tt.py`), for example the full
Trials flow and computer-jumper distances in `_dev/tools/checks/`. The ski jump physics can be tuned
without a browser: `node _dev/tools/checks/skijump_sim.mjs`.
