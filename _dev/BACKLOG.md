# Backlog: playtest notes collected for the next fix round

## Open
- Phone mode was tuned against scripted gestures, not thumbs: after a playtest on a real phone, look at the
  sprint's tapping speed for full effort (`MASH.ref` in `js/sizes.js`, 9.5 taps a second now), the swipe beat
  in swimming and speed skating (`TARGET_PH`), the javelin's degrees per unit pulled, the curling pull length
  and the biathlon sight speed (`PH_SIGHT`).
- In portrait the javelin, pole vault and halfpipe athletes are still on the small side; landscape frames them
  better.

## Done (v27)
- Phone mode: one touch player plays with gestures on the whole screen instead of the three pads; every event
  reworked to one natural gesture (see the README table), a hint pill with an animated finger instead of the
  sentences, vibration for every stroke, a phone HUD (flags instead of names, nothing under the corner buttons,
  meters out of the athlete's way in landscape) and a closer camera on an upright phone.
- Playing alone: computer turns fast-forward by themselves, the fly-in shows once per event, "Again" skips the
  intro and the ceremony and shows the house record to beat.
- Android app: Capacitor wrapper in `app/`, built by GitHub Actions into the android-preview release.

## Done (v26)
- Crowd sounds removed for now; quiet chip-tune music instead (menu theme, summer march, winter waltz).
- Placement check across all events; fixed: halfpipe riders waiting in mid-air past the end of the deck, the curler crouching inside the eraser, ski jumpers, banners and snowmen sunk into or floating over the rugs, a snowman floating off the end of the sofa, bobsleds parked through their crews.

## Done (v25)
- The toy-voice crowd was too much: a human stadium crowd instead (a quiet murmur of many people talking, roars, groans, whistles, applause), kept low so the athletes are heard.

## Done (v24)
- The wind-like crowd murmur is gone: crowds chatter in their own voices; rooms got reverb and background sounds; a little opening tune for the fly-in; fanfare at the ceremony.

## Done (v23)
- Ceremonies clear crowd members that would cover the podium; ski jump podium moved in front of the snowmen.
- Bobsled ceremony: podium past the parking row, the sleds lined up in front of it.
- Halfpipe: the rider settles, rides out of the pipe and skids to a stop before the score.
- Bobsled: always two runs, reverse order in run 2, split times against the leader.
