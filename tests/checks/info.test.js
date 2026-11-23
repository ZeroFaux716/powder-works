// The inspector's live information: real units, consistent with each other and with the motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, ID, S, V, run } from './helpers.js';
import { jrecs } from '../../src/sim/joints.js';

const get = (list, key) => list.find(r => r.key === key).value;

test('a part reads the mass the physics moves, and spin agrees with its hinge', () => {
  Sim.loadPreset('blank');
  const wheel = Sim.makePart(Sim.cellsDisc(120, 70, 12), ID.Fe);
  const n = wheel.occ.reduce((a, v) => a + v, 0);
  const rec = Sim.makeJoint('motor', wheel, null, V(120.5 * S, 70.5 * S));
  Sim.setMotor(rec, 30 / (60 / (2 * Math.PI)), 1e6);           // 30 rpm clockwise, plenty of torque
  run(120);
  const p = Sim.partInfo(wheel, [rec]), j = Sim.jointInfo(rec);
  assert.ok(Math.abs(get(p, 'mass') - wheel.b.getMass() * Sim.MASS_SCALE) < 1e-6 && get(p, 'mass') < n * 7.874 && get(p, 'mass') > 0.6 * n * 7.874,
    `iron: ${get(p, 'mass').toFixed(1)} kg for ${n} cells (solid: ${(n * 7.874).toFixed(0)} kg)`);
  assert.ok(Math.abs(get(p, 'spin') - 30) < 1 && Math.abs(get(j, 'rpm') - 30) < 1, `part ${get(p, 'spin').toFixed(1)} rpm, motor ${get(j, 'rpm').toFixed(1)} rpm, set to 30 clockwise`);
  assert.ok(Math.abs(get(j, 'set') - 30) < 1e-6);
  const I = wheel.b.getInertia() * (get(p, 'mass') / wheel.b.getMass()), w = wheel.b.getAngularVelocity();
  assert.ok(Math.abs(get(p, 're') - 0.5 * I * w * w) < 1e-6 * get(p, 're') + 1e-9, 'spinning energy is ½Iω²');
});

test('a motor holding a weight up shows torque, and power is torque times speed', () => {
  Sim.loadPreset('blank');
  const arm = Sim.makePart(Sim.cellsRect(100, 60, 140, 63), ID.Fe);
  const rec = Sim.makeJoint('motor', arm, null, V(100.5 * S, 61.5 * S));
  Sim.setMotor(rec, 0, 1e6);                                    // hold still
  run(60);
  const j = Sim.jointInfo(rec);
  // the arm's own weight about the pivot: m g d (d: the centre, 20 cells out)
  const m = Sim.partInfo(arm, []).find(r => r.key === 'mass').value, expect = m * 14 * 20 * 0.1;
  assert.ok(Math.abs(get(j, 'torque') - expect) < 0.1 * expect, `torque ${get(j, 'torque').toFixed(0)} N·m, weight about the pivot ${expect.toFixed(0)} N·m`);
  assert.ok(get(j, 'power') < 0.01 * get(j, 'torque') + 1, 'holding still uses no power');
});

test('a spring shows its stretch, force and stored energy', () => {
  Sim.loadPreset('blank');
  const blk = Sim.makePart(Sim.cellsRect(115, 60, 124, 67), ID.Fe);
  const rec = Sim.makeJoint('spring', blk, null, V(119.5 * S, 60 * S), V(119.5 * S, 30 * S));
  run(400);
  const j = Sim.jointInfo(rec);
  assert.ok(get(j, 'stretch') > 0 && get(j, 'force') > 0, `stretch ${get(j, 'stretch').toFixed(1)} cells, force ${get(j, 'force').toFixed(0)} N`);
  const m = Sim.partInfo(blk, []).find(r => r.key === 'mass').value;
  assert.ok(Math.abs(get(j, 'force') - m * 14) < 0.15 * m * 14, `hanging still, the spring carries the weight: ${get(j, 'force').toFixed(0)} N vs ${(m * 14).toFixed(0)} N`);
});
