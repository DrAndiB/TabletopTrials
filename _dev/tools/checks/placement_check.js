// Physical placement: are the figurines, the crowd and the banners standing on something, not floating or
// sunk into it? For each event: just after the start, partway through and at the end, cast a ray down
// from the lowest point of each and report gaps (+ floating, - sunk) bigger than the tolerance.
// Expected reports: swimmers in the water (it does not count as a surface) and ACTIVE figures in the
// air (diving, vaulting, jumping). Everything else is worth a look.
(async () => {
  const T = await import('/vendor/three.bundle.js');
  const g = __tt.game, evs = (await import('/js/events/index.js')).EVENTS;
  const TOL = 0.8, out = [];
  const comps = g.competitors.map((c) => ({ ...c, type: 'cpu', human: false }));
  const ray = new T.Raycaster(), down = new T.Vector3(0, -1, 0), v = new T.Vector3(), box = new T.Box3();
  const isPart = (o, key) => { for (let p = o; p; p = p.parent) if (p.userData[key]) return true; return false; };
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const surfaces = () => {
    const list = [];
    g.kit.group.traverse((o) => {
      if (!o.isMesh || !shown(o) || o.isSkinnedMesh) return;
      if (isPart(o, 'fig') || isPart(o, 'crowdMember') || isPart(o, 'stands') || o.userData.crowd) return;
      const m = o.material;
      if (m && m.transparent && (m.opacity < 0.6 || m.blending === T.AdditiveBlending)) return;
      if (m && m.depthWrite === false) return;
      list.push(o);
    });
    return list;
  };
  // is the point inside a closed mesh? count crossings along a ray (both faces counted)
  const inside = (S, x, y, z) => {
    const saved = S.map((o) => { const m = Array.isArray(o.material) ? o.material : [o.material]; const k = m.map((q) => q.side); m.forEach((q) => { q.side = T.DoubleSide; }); return k; });
    ray.set(v.set(x, y, z), new T.Vector3(1, 0.013, 0.007).normalize()); ray.far = 2000;
    const hits = ray.intersectObjects(S, false), per = new Map();
    for (const h of hits) per.set(h.object, (per.get(h.object) || 0) + 1);
    S.forEach((o, i) => { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((q, j) => { q.side = saved[i][j]; }); });
    // only closed shapes can be inside-tested this way (a plane or an open tube has no inside)
    const closed = (o) => /^(Box|RoundedBox|Sphere|Capsule|Cone|Torus|Dodecahedron|Icosahedron)Geometry$/.test(o.geometry.type) || (o.geometry.type === 'CylinderGeometry' && !o.geometry.parameters.openEnded);
    for (const [o, n] of per) if (n % 2 === 1 && !o.isInstancedMesh && closed(o)) return o.name || o.geometry.type;
    return null;
  };
  const gapAt = (S, x, y, z) => {
    ray.set(v.set(x, y + 2.5, z), down); ray.far = 600;
    const h = ray.intersectObjects(S, false)[0];
    return h ? y - h.point.y : null;
  };
  const check = (id, when) => {
    const S = surfaces(), ev = g.ev, bad = [];
    const active = new Set([ev.cur?.fig?.root, ev.cur?.fig, ev.cur?.rig].filter(Boolean));
    g.kit.group.traverse((o) => {
      if (!shown(o)) return;
      if (o.userData.fig) {
        o.updateMatrixWorld(true);
        box.setFromObject(o, true);
        const c = box.getCenter(new T.Vector3()), gap = gapAt(S, c.x, box.min.y, c.z);
        let mine = false; for (let p = o; p; p = p.parent) if (active.has(p)) mine = true;
        if (gap == null || Math.abs(gap) > TOL) bad.push(`${mine ? 'ACTIVE ' : ''}figure at (${c.x.toFixed(0)}, ${box.min.y.toFixed(1)}, ${c.z.toFixed(0)}) gap ${gap == null ? 'nothing below' : gap.toFixed(1)}`);
        for (const [py, part] of [[box.min.y + 1, 'feet'], [c.y, 'body']]) { const w = inside(S, c.x, py, c.z); if (w) bad.push(`${mine ? 'ACTIVE ' : ''}figure's ${part} inside a ${w} at (${c.x.toFixed(0)}, ${py.toFixed(1)}, ${c.z.toFixed(0)})`); }
      } else if (o.userData.stands || o.userData.crowdMember) {
        o.getWorldPosition(v); const p = v.clone(), gap = gapAt(S, p.x, p.y, p.z);
        if (gap == null || Math.abs(gap) > TOL) bad.push(`${o.userData.stands ? 'banner' : 'plush'} at (${p.x.toFixed(0)}, ${p.y.toFixed(1)}, ${p.z.toFixed(0)}) gap ${gap == null ? 'nothing below' : gap.toFixed(1)}`);
      } else if (o.userData.crowd && !o.userData.crowdChecked) {
        o.userData.crowdChecked = true;
        const cr = o.userData.crowd; if (cr.checked) return; cr.checked = true;
        for (const sp of cr.spots) { if (sp.float) continue; v.set(sp.x, sp.y || 0, sp.z); o.parent.localToWorld(v); const gap = gapAt(S, v.x, v.y, v.z); if (gap == null || Math.abs(gap) > TOL) bad.push(`crowd member at (${v.x.toFixed(0)}, ${v.y.toFixed(1)}, ${v.z.toFixed(0)}) gap ${gap == null ? 'nothing below' : gap.toFixed(1)}`); }
      }
    });
    out.push(`${id} ${when}: ${bad.length ? bad.join(' | ') : 'ok'}`);
  };
  for (const def of evs) {
    await g.load(def, comps, { skill: 'normal', seed: 3 });
    g.start();
    g.simulate(1.5); check(def.id, 'start');
    g.simulate(12); check(def.id, 'mid');
    let s = 0; while (g.state !== 'done' && s < 500) { g.simulate(1); s++; }
    g.simulate(1); check(def.id, 'end');
  }
  return out;
})()
