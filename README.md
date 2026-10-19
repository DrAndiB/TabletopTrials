# Tabletop Trials

A playroom multi-sport game for the browser. Kids stage their own summer and winter games with painted
wooden figurines, a chalk track on the floorboards and a big book as a ski jump, while the stuffed
animals cheer from cardboard-box stands. Sibling of [Tabletop Turbo](https://github.com/DrAndiB/TabletopTurbo).

## Play
- **The Trials**: the events you pick (all twelve, summer, winter or a quick four) in a row, chocolate-coin medals, a running medal table and a closing ceremony.
- **One event**: pick an event and play it on its own.
- Up to four players on one keyboard (each player has left, right and action), on touch screens, or
  against computer kids (easy, normal, hard). Every team picks a country: real flags, a capital and a
  fun fact on the way in.
- **A room for every event**: the front hall on a sunny morning, a bathroom, a bedroom at dusk, the
  living room on a Sunday afternoon, the playroom, the living room in December, a night kitchen, a winter
  breakfast table, the attic on a snowy day, the garage and a fireside evening, each with its own crowd
  (rubber ducks, gingerbread people, snowmen, egg cups, robots, penguins) and something alive in it
  (a cat, a sleeping dog, a robot vacuum, a goldfish, a toy train, flickering fire and fairy lights).
- **Player sizes**: every human player is Little (3–5), Kid (6–9) or Big (10+). Smaller players tap a
  slower beat, get wider timing windows, and Little players get helpers that take over the extra rules,
  so each event comes down to one trick (the helpers are listed on each event's intro). Nobody is left
  out on the course: a player still racing well after the winner jogs, paddles or glides home.
- **Fly-ins and medal ceremonies**: every event opens with a camera flight through its room, and the
  medallists get their chocolate coins at the room's best spot: on a rubber ring floating in the bathtub,
  on the arm of the sofa, on presents under the Christmas tree, on a stack of bricks by the fire. Action
  skips both.

| Event | Season | How it plays |
|---|---|---|
| Sprint | Summer | Hold action in the blocks and let go on the whistle; tap left and right in turn to run: smooth out of the blocks, a steady beat, a little faster at the end (chalk bands on the track show where the beat changes). |
| Hurdles | Summer | Two buttons: tap left or right on a steady beat to run, action to jump; at the beat it's tap, tap, tap, tap, jump at the chalk mark before each pencil-and-domino hurdle. |
| Swimming | Summer | Two lengths of the bathtub: hold action on the soap bar and let go on the whistle, tap left and right for the strokes, tap action to breathe before the air runs out and over the green tiles for a tumble turn. |
| Diving | Summer | Off a ruler on a tower of books into the goldfish bowl: three bounces timed on a closing ring, hold action to tuck and spin, let go when the dial turns green, left/right for half twists. Called dives (1½, 1½ with a twist, your choice), five plush judges. |
| Javelin | Summer | A pencil down the living-room rug: rhythm run-up, then hold action to draw back (you keep your speed, no more tapping), let go at 30-40° before the red line. Three throws. |
| Pole vault | Summer | A bendy straw over a skewer bar on two rulers: rhythm run-up, press and hold action on the green tape as the ring closes on your feet to plant, let go when the needle is in the green to push off (worth up to 80 cm). Everyone has their own bar (Little opens at 3.20 m, Kid at 4.00 m, Big at 4.80 m), up 40 cm per clearance below 4.80 m and 20 cm above; two misses at a height and you're out. |
| Ski jump | Winter | Down an ironing board onto a cushion mountain: tap to start, keep your balance, tap in the green zone, lean against announced fan gusts, tap at LAND! for a telemark. Two jumps. |
| Speed skating | Winter | Two laps of an ice oval in a baking tray: long steady strokes, tap action at the sweets to lean into a bend and again after it to stand up. |
| Curling | Winter | Bottle caps down the kitchen table: aim (straight goes straight, aimed to one side the cap curls back to the middle, a dotted line shows the path), hold for strength, sweep with a toothbrush in rhythm. |
| Bobsled | Winter | Poster tubes from the toy chest to the floor: a flight down the course first, push off in rhythm, jump in on the green stripe, hold left/right to keep on the red line through the bends, a mini map in the corner. Two runs of about 30 s, the times add up; the second run goes in reverse order (the leader last), and yellow timing lines give split times against the leader. |
| Halfpipe | Winter | A cardboard U dusted with icing sugar: drop in with speed, pump at the bottom, hold left/right to spin and action to grab in the air, let go of both before landing. Two runs, the best counts. |
| Biathlon | Winter | Three laps round the coffee table, over a sofa cushion and through felt fir trees: easy beat on the flat, harder uphill, tuck downhill but stand up before the curve; after laps 1 and 2 the stadium fork leads to the range (steer the drifting sight onto five caps), after lap 3 to the finish. |

Default keys: P1 ← → ↑ · P2 A D W · P3 J L I · P4 Num 4, Num 6, Num 8 (all can be changed under Keys).

## Run it locally
No build step. Serve the folder and open it in a browser:

```powershell
python -m http.server 8140
# then open http://localhost:8140/
```

## Under the hood
- three.js r186 as a single local ES module bundle (`vendor/`), plain ES modules, no framework.
- Lighting and post-processing: reflections tinted to each room, mirror reflections on the ice, the
  polished kitchen table and the bath water, tilt-shift blur for the miniature look, a colour grade,
  bloom on lights and fire and ambient occlusion (half resolution on Medium). Auto starts on High with a
  graphics card, Medium otherwise, and lowers the resolution, then the quality, if frames drop.
- Figurines are one skinned mesh each, posed from flat numeric poses (`js/figurine.js`).
- Events plug in through a small contract (`_dev/EVENT_GUIDE.md`), share input "verbs"
  (`js/verbs.js`: rhythm, timing, power, steer) and run on a fixed 120 Hz step, so keyboard, touch and
  computer players go through the same code path.
- Flags are drawn from their official constructions on canvas (`js/flags.js`); sound is synthesised
  with Web Audio (`js/audio.js`): every crowd chatters in its own voice (squeaky plush toys, rubber
  ducks, snowmen, gingerbread people, egg cups, robots, penguins), and every room has its own reverb
  and quiet background life (birds outside, a dripping tap, the kitchen clock, the fire crackling).

## Checks
Headless checks use Playwright with the bundled Chromium (`_dev/tools/tt.py`), for example the full
Trials flow and computer-jumper distances in `_dev/tools/checks/`. The ski jump physics can be tuned
without a browser: `node _dev/tools/checks/skijump_sim.mjs`.
