# Tabletop Trials: how to build an event

Tabletop Trials is a browser multi-sport game (three.js r186, ES modules, no build step): kids stage
summer and winter games in their playroom with painted wooden figurines while stuffed animals cheer.
Every event is one file in `js/events/<id>.js`, registered in `js/events/index.js`.

## Units, axes, look
- 1 unit = 1 cm. A figurine stands ~8.3 tall (`js/figurine.js`), faces +z by default (its left is +x).
- y is up; the floor is y = 0. Side-on events run along +x; the camera looks from +z.
- The world is a real playroom photographed with a macro lens: floorboards, rugs, books, cushions, toys,
  crayons, letter blocks, cardboard, tape, flour or cotton-wool "snow". Real objects at roughly real
  sizes (a hardcover book ~24 × 17 × 2.5, a crayon ~9 long, a letter block ~5–6 on a side).
  Everything is improvised by kids: imperfection is the style. No brands, no real logos, and no
  reference to the Olympic Games (no rings, torch, anthems or the word).
- Quality bar: three levels of detail (landmarks, medium props, fine scatter), proper materials
  (roughness, clearcoat, procedural normal maps), contact shadows (`K.contact`) under props, everything
  casts shadows. See Tabletop Turbo's worlds for the standard.

## Shared building blocks
- `js/figurine.js`: `new Figurine({ paint, seed, number })` → `.root` (place and rotate it),
  `.setPose(pose)`, `.setGear('sprint' | 'ski' | 'none')`, `.setExpression('happy' | 'focus' | 'wow' | 'sad')`,
  `.ground` (true = keep the lower foot on the floor; false for jumps and flight).
  Poses: `POSES.stand(t)`, `bounce(t)`, `walk(phase)`, `run(phase, effort)`, `crouch(set)`, `tuck(wobble)`,
  `flight(lean, wobble)`, `telemark(k)`, `cheer(t)`, `wave(t)`, `heap()`; `blendPose(a, b, t)`.
  Pose keys include `pitch` (whole-body tilt about the soles) and `vee` (ski V-spread).
- `js/props.js`: `floorMaterial()`, `crowd(parent, spots, seed)` (stuffed animals; `update(t, level)`),
  `banner(code, width, {seed})` (kid-painted country flag on pencils), `letterBlock(letters, size, seed)`,
  `crayon(i, len)`, `paintedFlagTexture(code)`.
- `js/kit.js` (`ctx.kit`): materials (`std`, `phys`, `plastic`, `paint`, `felt`, `metal`, `glass`),
  `mesh`, `add`, `instances`, `contact`, `lathe`, `merge`, plus `K.TX` (procedural textures:
  `woodTextures`, `mottledTextures`, `feltTextures`, `paint`, `makeCanvas`, `toTexture`, `noiseField`,
  `normalFromHeight`, `labelTexture`). Add everything under `ctx.kit.group`; it is disposed with the event.
- `js/verbs.js`: `Rhythm` (alternate left/right; `press(side, t)` → 'first' | 'stride' | 'stumble';
  `effort(t)` 0..1.06 against a target cadence), `timingScore`, `Power`, `Steer`, `BotTapper`
  (drives a computer player's pad), `CPU_SKILL` presets.
- `js/fx.js`: `Particles` (dust, flour puffs, chalk) and `SkidMarks`.
- `js/audio.js` (`ctx.sound`): `whistle`, `block`, `step`, `stumble`, `clack`, `thump`, `puff`, `whoosh`,
  `pop`, `cheer(big)`, `aww`, `clap`, `kazoo`, `jingle(seed)`, `fanfare`, and loops
  `setLoop('crowd' | 'hiss' | 'wind' | 'fan', level, freq)`.

## The event module
```js
export default {
  id: 'sprint', name: 'Sprint', season: 'Summer',
  blurb: 'One line for the menu.',
  venue: 'One line about the venue for the intro card.',
  how: [{ verb: 'Rhythm', text: 'Tap <b>left</b> and <b>right</b> in turn to run.' }, ...],
  better: 'lower' | 'higher',      // how results rank
  resultsDelay: 2.5,               // seconds between finish() and the results screen
  create(ctx) { return new MyEvent(ctx); },
};
```
The instance:
- `async build()`: venue, figurines, lights (`ctx.R.setLighting({...})`), camera start, HUD elements.
- `attract()` (optional): idle animation for the title screen (no race; `ctx.attract` is true).
- `start()`: the event begins (countdowns are the event's job).
- `update(dt)`: fixed 1/120 s step. Read input here: `ctx.presses(i)` returns competitor i's presses
  since the last call as `[{ b: 'left' | 'right' | 'action', down, t }]` on the game clock
  (`ctx.time()`); `ctx.held(i)` gives `{left, right, action}`. Computer players use their own pad:
  `ctx.competitors[i].pad` (push presses with `BotTapper` or `pad.push(b, down, t)`), so the same code
  path reads humans and computers.
- `frame(dt, paused)`: per rendered frame: animation, camera (`ctx.R.orbit(...)` or `ctx.R.look(...)`),
  particles, HUD. Never create materials here (warm-up compiles the scene before the event starts).
- `dispose()` (optional): anything not under `ctx.kit.group` (DOM, listeners).
- When it is over: `ctx.finish(results)` with `results[i] = { value, text, short?, sub?, dnf? }` for each
  competitor (value ranks; text shows in results; sub is a small second line).

`ctx` also has: `competitors` (`{index, slot, type, human, code, name, short, paint, seed, number, flag, color}`),
`skill` (CPU preset), `rand` (seeded RNG), `quality`, `hud` (`el` for your own meters, `message(text,
kind, color, dur)`, `flash(text, color)`, `chip(i, info, cls)`), `sound`, `R` (renderer), `THREE`.

## Fairness rule for rhythm
Use `Rhythm.effort()`: full effort at the target cadence, at most +6 % above it, and only erratic
tapping (coefficient of variation > 0.32) costs anything. Keyboard and touch players must be able
to reach the same result.

## Testing
Serve the repo root (`python3 -m http.server 8140`), then `_dev/tools/tt.py` drives the game in test
mode: `python3 _dev/tools/tt.py "autostart=1&event=<id>&p=cpu,cpu,cpu,cpu&quality=low" "sim:3;;shot:<id>_a;;sim:5;;shot:<id>_b"`.
Steps: `sim:<seconds>` (advances the fixed-step clock, then renders), `shot:<name>`, `js:<code>`
(`window.__tt` has `game`, `R`, `run()`, `screen()`). Screenshots go to `$TT_OUT` (default `./out`, ignored by git).
Lint: `npx eslint -c _dev/tools/eslint.config.mjs js`.
