// Copy, cut and paste: clips carry cells, devices, whole parts and their joints, and turn and mirror correctly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, run, V, S, ID } from './helpers.js';

function machine() {
  Sim.loadPreset('blank');
  const post = Sim.makePart(Sim.cellsRect(20, 60, 23, 90), ID.Fe), bar = Sim.makePart(Sim.cellsRect(10, 55, 40, 58), ID.Fe);
  Sim.makeJoint('weld', post, null, V(21.5 * S, 88 * S));
  const m = Sim.makeJoint('motor', bar, post, V(21.5 * S, 56.5 * S)); Sim.setMotor(m, 2, 500);
  const L = Sim.makePart([...Sim.cellsRect(50, 60, 51, 70), ...Sim.cellsRect(52, 69, 58, 70)], ID.Cu);
  Sim.fill(60, 80, 66, 90, 'sand');
  Sim.setPaintDir(1); Sim.paint(64, 70, 'fan', 1, 1); Sim.paint(68, 70, 'pump', 0);
  return { post, bar, L };
}
const footprint = rb => rb.foot.map(i => [i % Sim.W, (i / Sim.W) | 0]);

test('a pasted copy brings its parts, joints, sand and devices, and its motor runs', () => {
  const { bar } = machine();
  const clip = Sim.copyRegion(5, 50, 70, 95);
  assert.equal(clip.parts.length, 3);
  assert.deepEqual(clip.joints.map(j => j.kind).sort(), ['motor', 'weld']);
  const sand0 = Sim.type.reduce((n, t, i) => n + (t === ID.sand && Sim.st[i] ? 1 : 0), 0);
  const made = Sim.pasteClip(clip, 130, 50);
  assert.equal(made.length, 3); assert.equal(Sim.bodies.size, 6); assert.equal(Sim.jrecs.length, 4);
  const sand1 = Sim.type.reduce((n, t, i) => n + (t === ID.sand && Sim.st[i] ? 1 : 0), 0);
  assert.equal(sand1, 2 * sand0, 'the sand came too');
  assert.equal(Sim.fan[70 * Sim.W + 64 + 125], 1, 'the fan came too, blowing the same way');
  run(90);
  const copyBar = made.find(r => r.w === bar.w && r.h === bar.h);
  assert.ok(Math.abs(copyBar.b.getAngularVelocity() - bar.b.getAngularVelocity()) < 0.05, 'the copy turns like the original');
});

test('mirroring flips parts, fans and pumps, and runs motors the other way', () => {
  const { bar, L } = machine();
  const clip = Sim.mirrorClip(Sim.copyRegion(5, 50, 70, 95));
  const made = Sim.pasteClip(clip, 150, 50);
  const Lm = made.find(r => r.mat === ID.Cu), a = footprint(L), b = footprint(Lm);
  // the original's tall stroke is on its left; the mirror image's is on its right
  const tallX = cs => cs.filter(([, y]) => y < 66).map(([x]) => x);
  const minX = cs => Math.min(...cs.map(([x]) => x)), maxX = cs => Math.max(...cs.map(([x]) => x));
  assert.ok(Math.min(...tallX(a)) === minX(a) && Math.max(...tallX(b)) === maxX(b));
  assert.equal(a.length, b.length);
  assert.equal(Sim.fan[70 * Sim.W + (150 + 65 - (64 - 5))], 2, 'the fan blows left now');
  assert.equal(Sim.ddir[70 * Sim.W + (150 + 65 - (68 - 5))], 2, 'the pump faces left now');
  run(60);
  const mb = made.find(r => r.w === bar.w && r.h === bar.h);
  assert.ok(bar.b.getAngularVelocity() > 1 && mb.b.getAngularVelocity() < -1, 'the mirrored motor turns the other way');
});

test('four quarter turns or two mirrors give back the same clip; a clip survives being written out', () => {
  machine();
  const c = Sim.copyRegion(5, 50, 70, 95);
  const t = Sim.cloneClip(c); for (let k = 0; k < 4; k++) Sim.turnClip(t);
  assert.deepEqual(t.cells, c.cells); assert.deepEqual(t.devs, c.devs);
  for (let k = 0; k < c.parts.length; k++) {
    assert.ok(Math.abs(t.parts[k].X - c.parts[k].X) < 1e-3 && Math.abs(t.parts[k].Y - c.parts[k].Y) < 1e-3);
    assert.ok(Math.abs(Math.cos(t.parts[k].a) - Math.cos(c.parts[k].a)) < 1e-3);
  }
  assert.deepEqual(Sim.mirrorClip(Sim.mirrorClip(Sim.cloneClip(c))), c);
  assert.deepEqual(JSON.parse(JSON.stringify(c)), c);
  // a turned L stands the right way: its foot now runs up the left side
  const turned = Sim.turnClip(Sim.copyRegion(45, 55, 65, 75));
  Sim.loadPreset('blank');
  const [L] = Sim.pasteClip(turned, 100, 55), cs = footprint(L);
  const top = Math.min(...cs.map(([, y]) => y));
  assert.equal(cs.filter(([, y]) => y <= top + 1).length, 22, 'the long stroke lies along the top');
});

test('cutting takes the parts, their joints and the loose cells away', () => {
  machine();
  const clip = Sim.cutRegion(5, 50, 70, 95);
  assert.equal(clip.parts.length, 3);
  assert.equal(Sim.bodies.size, 0); assert.equal(Sim.jrecs.length, 0);
  assert.equal(Sim.type.reduce((n, t, i) => n + (t === ID.sand && Sim.st[i] ? 1 : 0), 0), 0);
  assert.equal(Sim.fan[70 * Sim.W + 64], 0);
});
