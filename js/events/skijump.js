// Placeholder: replaced by the real event.
import * as THREE from '../../vendor/three.bundle.js';
import { Figurine, POSES } from '../figurine.js';
import { floorMaterial } from '../props.js';

class Placeholder {
  constructor(ctx) { this.ctx = ctx; this.t = 0; this.figs = []; }
  async build() {
    const { kit, R } = this.ctx;
    R.setLighting({ sunDir: [-0.5, 1, 0.6], sunIntensity: 2.4, hemiIntensity: 0.75, background: 0x3b2f27 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), floorMaterial());
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; kit.group.add(floor);
    this.ctx.competitors.forEach((c, i) => {
      const f = new Figurine({ paint: c.paint, seed: c.seed, number: c.number });
      f.root.position.set(i * 12 - 18, 0, 0); kit.group.add(f.root); this.figs.push(f);
    });
  }
  attract() {}
  start() { this.t = 0; }
  update(dt) {
    this.t += dt;
    for (let i = 0; i < this.ctx.competitors.length; i++) this.ctx.presses(i);
    if (!this.ctx.attract && this.t > 2 && this.ctx.time() > 0) this.ctx.finish(this.ctx.competitors.map((c, i) => ({ value: 10 + i, text: (10 + i).toFixed(2) })));
  }
  frame() { this.figs.forEach((f, i) => f.setPose(POSES.bounce(this.ctx.time() + i))); this.ctx.R.orbit(0, 4, 0, { yaw: 0.3 + this.ctx.time() * 0.05, pitch: 0.35, width: 70 }); }
}
export default { id: 'skijump', name: 'Ski jump', season: 'Winter', blurb: 'Coming together.', venue: 'Placeholder venue.', how: [{ verb: 'Test', text: 'Placeholder.' }], better: 'higher', create: (ctx) => new Placeholder(ctx) };
