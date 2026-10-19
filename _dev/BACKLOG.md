# Backlog: playtest notes collected for the next fix round

## Open
- **A wind-like sound in the background of the events.** It is the crowd murmur (`audio.js`
  `buildLoops`: band-passed white noise around 1.1 kHz whose filter wobbles at 0.7 Hz), on in every
  event at 0.2-0.5 of its level and louder with the excitement; noise with a moving filter is exactly
  what wind sounds like. (The ski jump also has a real fan/wind layer, which is meant to be there.)
  Fix idea: drop the noise bed and make the crowd out of sparse sounds instead: soft squeaks, little
  "ooh"s and claps whose rate follows the excitement, plus a quiet babble of short voiced blips; keep
  noise only for the ski hiss, the fan and the real wind.

## Done (v23)
- Ceremonies clear crowd members that would cover the podium; ski jump podium moved in front of the snowmen.
- Bobsled ceremony: podium past the parking row, the sleds lined up in front of it.
- Halfpipe: the rider settles, rides out of the pipe and skids to a stop before the score.
- Bobsled: always two runs, reverse order in run 2, split times against the leader.
