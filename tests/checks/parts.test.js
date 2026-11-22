// Building with the Part tool: drawing over other parts, which then pass through each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, W, S, ID, V, run, parts } from './helpers.js';

const stroke = (pts, r, mat) => { for (const [x, y] of pts) Sim.paint(x, y, 'part', r, mat); return Sim.finishPart(); };
const rect = (x0, y0, x1, y1) => { const p = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.push([x, y]); return p; };
const yOf = rb => rb.b.getPosition().y / S;

test('a part can be drawn over another part, and the two pass through each other', () => {
  Sim.loadPreset('blank');
  stroke(rect(100, 120, 139, 129), 0, ID.Fe);                // a slab
  const slab = parts()[0];
  run(120);                                                  // let it settle on the floor
  const slabY = yOf(slab);
  assert.equal(stroke(rect(115, 110, 124, 140), 0, ID.Al), 1, 'the bar drawn across the slab becomes one whole part');
  const bar = parts().find(rb => rb !== slab);
  assert.ok(bar.h >= 25, `the bar keeps the cells drawn over the slab (it is ${bar.h} tall)`);
  assert.ok(Sim.passPairs.has(Sim.pairKey(slab.id, bar.id)), 'the pair is recorded');
  run(180);
  assert.ok(Math.abs(yOf(slab) - slabY) < 1, 'the slab was not shoved by the bar inside it');
  const bottom = rb => yOf(rb) + rb.h / 2;
  assert.ok(Math.abs(bottom(bar) - bottom(slab)) < 2, `the bar sank through the slab to the floor (bar bottom ${bottom(bar).toFixed(1)}, slab bottom ${bottom(slab).toFixed(1)})`);
});

test('parts drawn apart still collide', () => {
  Sim.loadPreset('blank');
  stroke(rect(100, 120, 139, 129), 0, ID.Fe);
  const slab = parts()[0];
  stroke(rect(115, 90, 124, 99), 0, ID.Al);                  // above the slab, not touching
  const block = parts().find(rb => rb !== slab);
  run(240);
  assert.ok(yOf(block) < yOf(slab) - 6, `the block lands on the slab (block ${yOf(block).toFixed(1)}, slab ${yOf(slab).toFixed(1)})`);
});

test('a crank built by hand: rod drawn across the flywheel, hinged at both ends, piston on a slider', () => {
  Sim.loadPreset('blank');
  const disc = []; for (let y = 60; y <= 100; y++) for (let x = 140; x <= 180; x++) if ((x - 160) ** 2 + (y - 80) ** 2 <= 400) disc.push([x, y]);
  stroke(disc, 0, ID.Fe);
  stroke(rect(60, 76, 79, 84), 0, ID.Fe);                    // piston
  const line = []; for (let x = 80; x <= 172; x++) line.push([x, 80]);
  stroke(line, 1, ID.Al);                                    // rod from the piston, across the wheel, to a pin near the rim
  const [wheel, piston, rod] = parts();
  assert.equal(Sim.bodies.size, 3);
  assert.ok(Sim.passPairs.has(Sim.pairKey(wheel.id, rod.id)), 'the rod passes through the wheel');
  Sim.makeJoint('hinge', wheel, null, V(160.5 * S, 80.5 * S));
  Sim.makeJoint('hinge', rod, wheel, V(172.5 * S, 80.5 * S));
  Sim.makeJoint('hinge', rod, piston, V(80.5 * S, 80.5 * S));
  Sim.makeJoint('slider', piston, null, V(70 * S, 80.5 * S), V(1, 0));
  const g = Sim.grab(piston, 70, 80);
  let x = 70, a0 = wheel.b.getAngle();
  for (let f = 0; f < 120; f++) { x -= 0.1; g.setTarget(V(x * S, 80.5 * S)); Sim.step(); }   // pull the piston 12 cells
  Sim.ungrab(g);
  const turned = Math.abs(wheel.b.getAngle() - a0);
  assert.ok(turned > 0.5, `pulling the piston turns the wheel (${(turned * 57.3).toFixed(0)}°)`);
  const snap = Sim.snapshot();
  Sim.restore(snap);
  assert.ok(Sim.passPairs.has(Sim.pairKey(wheel.id, rod.id)), 'Rewind keeps the rod passing through the wheel');
});
