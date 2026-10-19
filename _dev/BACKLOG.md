# Backlog: playtest notes collected for the next fix round

## Open
- **Ski jump ceremony: snowmen block the podium.** The gift podium by the Christmas tree stands in the
  middle of the snowman crowd; the snowmen in front hide the silver and bronze medallists (screenshot,
  19 Oct). Fix idea: in `Ceremony`, hide crowd members within a radius of the podium (and any between the
  camera and the podium), or move the ski jump spot in front of the snowmen. Check every venue for the
  same problem once the generic fix is in.
- **Bobsled ceremony: the podium stands in the parked sleds.** The boxes podium by the finish is placed
  where the crews park their sleds (`home` at RT + 18 + i·7 from the track), so a sled cuts through the
  bronze step and the bronze medallist stands on it (screenshot, 19 Oct). Fix idea: put the podium
  beyond the parking row (or between the row and the track) and line the sleds up neatly in front of
  it, or hide the sleds in `ceremonySpot()`.
