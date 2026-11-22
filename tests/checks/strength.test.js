// Part strength: joints give way when overloaded, more easily in weak or hot metal; brittle parts crack on impact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, ID, S, V, run, secs } from './helpers.js';
import { G } from '../../src/sim/grid.js';

// a bar hinged to the background at its left end, with an iron block of the given half-width hinged under its
// right end; everything held at T °C if given
function hang(mat, half, T, alloy) {
  Sim.loadPreset('blank'); G.broke = null;
  const bar = Sim.makePart(Sim.cellsRect(80, 40, 140, 45), ID[mat], alloy);
  const blk = Sim.makePart(Sim.cellsRect(136 - half, 46, 136 + half, 46 + 2 * half), ID[mat], alloy);
  Sim.makeJoint('hinge', bar, null, V(83 * S, 42.5 * S));
  Sim.makeJoint('hinge', blk, bar, V(136.5 * S, 44.5 * S));
  for (let f = 0; f < 240; f++) { if (T) { bar.temps.fill(T); blk.temps.fill(T); } Sim.step(); }
  return G.broke;
}

test('a lead hanger tears out under a load iron carries easily', () => {
  const lead = hang('Pb', 8), iron = hang('Fe', 8);
  assert.ok(lead && !lead.brittle, 'the lead hanger tore');
  assert.equal(iron, null, 'the iron hanger held');
});

test('red-hot iron gives way where cold iron holds, and steel holds hot', () => {
  assert.equal(hang('Fe', 8), null, 'cold iron held');
  assert.ok(hang('Fe', 8, 1150), 'iron at 1150 °C gave way');
  assert.equal(hang('Fe', 8, 1150, { h: ID.Fe, s: ID.C, x: 0.036 }), null, 'steel (0.8% carbon) at 1150 °C held');
});

test('brittle parts crack on impact; tough ones do not', () => {
  const drop = mat => { Sim.loadPreset('blank'); G.broke = null; Sim.makePart(Sim.cellsRect(110, 40, 129, 45), ID[mat]); run(240); return Sim.bodies.size; };
  assert.equal(drop('Fe'), 1, 'iron bar landed whole');
  assert.ok(drop('S') >= 2, 'sulfur bar broke in pieces');
  assert.ok(drop('Bi') >= 2, 'bismuth bar broke in pieces');
});

test('the machines run without anything giving way', () => {
  for (const [sc, s] of [['engine', 20], ['crank', 8], ['components', 15], ['wind', 8]]) {
    Sim.loadPreset(sc); G.broke = null;
    if (sc === 'crank') Sim.paint(34, 108, 'fire', 2);
    secs(s);
    assert.equal(G.broke, null, sc + ': ' + JSON.stringify(G.broke));
  }
});
