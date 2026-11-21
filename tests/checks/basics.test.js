// The bench itself: every material works, gases sort by weight, edges, springs, Rewind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, W, H, S, ID, MATS, run, count, parts, planck } from './helpers.js';

test('every material can be painted and simulated without breaking the numbers', () => {
  // Painted in batches of patches spread over the bench (one at a time would take minutes);
  // a batch that goes wrong is tried again one material at a time to name the culprit.
  const broken = () => { for (let i = 0; i < W * H; i++) if (!Number.isFinite(Sim.temp[i]) || !Number.isFinite(Sim.P[i])) return true; return false; };
  const trial = list => {
    Sim.loadPreset('blank');
    list.forEach((m, k) => { const x = 20 + (k % 10) * 20, y = 20 + ((k / 10) | 0) * 20; Sim.fill(x, y, x + 3, y + 3, null); for (let q = y; q <= y + 3; q++) for (let p = x; p <= x + 3; p++) Sim.paint(p, q, 'brush', 0, m.id); });
    run(20);
    return broken();
  };
  const all = MATS.filter(m => m.id !== 0 && !m.special);
  const bad = [];
  for (let k = 0; k < all.length; k += 60) {
    const batch = all.slice(k, k + 60);
    if (trial(batch)) for (const m of batch) if (trial([m])) bad.push(m.key);
  }
  assert.deepEqual(bad, [], 'materials that made NaN temperatures or pressures');
  assert.ok(all.length > 1000, 'the element and compound tables are all there (' + all.length + ' materials)');
});

test('a heavy gas sinks below a light one', () => {
  Sim.loadPreset('blank');
  Sim.fill(99, 40, 100, 145, 'wall'); Sim.fill(141, 40, 142, 145, 'wall'); Sim.fill(99, 38, 142, 39, 'wall');
  for (let y = 80; y < 110; y++) for (let x = 101; x < 141; x++) Sim.paint(x, y, 'brush', 0, (x + y) % 2 ? ID.He : ID.Xe);
  run(900);
  const row = key => { let s = 0, n = 0; for (let i = 0; i < W * H; i++) if (Sim.type[i] === ID[key]) { s += (i / W) | 0; n++; } return s / n; };
  assert.ok(row('Xe') - row('He') > 10, `xenon (mean row ${row('Xe').toFixed(0)}) should sit well below helium (${row('He').toFixed(0)})`);
});

test('open edges let gas leave the bench; walled edges keep it', () => {
  const left = open => {
    Sim.loadPreset('blank'); Sim.setOpenEdges(open);
    Sim.fill(100, 20, 140, 60, 'H');
    const before = count('H');
    run(900);
    return count('H') / before;
  };
  const walled = left(false), open = left(true);
  Sim.setOpenEdges(true);
  assert.ok(walled > 0.95, `walled bench kept ${(walled * 100).toFixed(0)}% of the hydrogen`);
  assert.ok(open < 0.6, `open bench still has ${(open * 100).toFixed(0)}% of the hydrogen`);
});

test('a block hangs on a spring, and Rewind brings back the spring as it was', () => {
  Sim.loadPreset('blank');
  const blk = Sim.addBody(Sim.cellsRect(100, 60, 109, 67), ID.Fe);
  const rec = Sim.makeJoint('spring', blk, null, planck.Vec2(104.5 * S, 60 * S), planck.Vec2(104.5 * S, 30 * S));
  run(360);
  const y = () => parts()[0].b.getPosition().y / S;
  const hung = y();
  assert.ok(hung > 40 && hung < 100, `block should hang below the anchor, not fall away (row ${hung.toFixed(1)})`);
  assert.ok(Math.abs(parts()[0].b.getLinearVelocity().y) < 2 * S, 'the bounce has died down');
  const len0 = rec.len;
  const snap = Sim.snapshot();
  Sim.setSpring(rec, 1, 0.1, 10);
  run(120);
  assert.notEqual(y().toFixed(1), hung.toFixed(1), 'a softer, shorter spring moves the block');
  Sim.restore(snap);
  assert.equal(Sim.jrecs.length, 1);
  assert.equal(Sim.jrecs[0].kind, 'spring');
  assert.ok(Math.abs(Sim.jrecs[0].len - len0) < 1e-6, 'spring length restored');
  assert.ok(Math.abs(y() - hung) < 0.5, 'block is back where it was');
  run(60);
  assert.ok(Math.abs(y() - hung) < 3, 'and stays there after the rewind');
});
