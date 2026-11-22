// Alloys: molten metals take in what touches them, spread it, and melt lower for it; solids keep what they have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, W, ID, box, run } from './helpers.js';
import { sx, sol, sh } from '../../src/sim/grid.js';

const hold = T => { for (let y = 62; y <= 119; y++) for (let x = 62; x <= 179; x++) Sim.temp[y * W + x] = T; };
function stats(host) {
  let n = 0, sum = 0, max = 0;
  for (let y = 62; y <= 119; y++) for (let x = 62; x <= 179; x++) { const i = y * W + x; if (Sim.type[i] !== ID[host]) continue; n++; if (Sim.solute(i)) { sum += sx[i]; max = Math.max(max, sx[i]); } }
  return { n, mean: sum / Math.max(1, n), max };
}

test('carbon dissolves into molten iron, spreads through it, and stops at its limit', () => {
  box(62, 62, 179, 119);
  Sim.fill(62, 95, 179, 119, 'Fe'); Sim.fill(62, 90, 179, 94, 'C');
  for (let f = 0; f < 300; f++) { hold(1650); Sim.step(); }
  const s = stats('Fe');
  assert.ok(s.mean > 0.01, `carbon in the iron: ${(100 * s.mean).toFixed(1)}% of atoms on average`);
  assert.ok(s.max <= 0.2 + 1e-6, `richest cell ${(100 * s.max).toFixed(1)}% (limit 20%)`);
});

test('solid iron takes in nothing', () => {
  box(62, 62, 179, 119);
  Sim.fill(62, 95, 179, 119, 'Fe'); Sim.fill(62, 90, 179, 94, 'C');
  for (let f = 0; f < 300; f++) { hold(1000); Sim.step(); }
  assert.equal(stats('Fe').max, 0);
});

test('molten copper and tin mix into bronze, which melts lower than copper', () => {
  // (not brass: zinc boils at 907 °C, below the 1085 °C copper melts at, which is why brass is hard to make by melting)
  box(62, 62, 179, 119);
  for (let y = 100; y <= 119; y++) for (let x = 62; x <= 179; x++) Sim.paint(x, y, 'brush', 0, x < 121 ? ID.Cu : ID.Sn, true);
  for (let f = 0; f < 300; f++) { hold(1150); Sim.step(); }
  const cu = stats('Cu');
  assert.ok(cu.max > 0.1, `tin in the copper where they meet: ${(100 * cu.max).toFixed(0)}% of atoms (mixing spreads slowly without stirring)`);
  let i = -1, best = 0;
  for (let y = 100; y <= 119; y++) for (let x = 62; x <= 179; x++) { const k = y * W + x; if (Sim.type[k] === ID.Cu && Sim.solute(k) && sx[k] > best) { best = sx[k]; i = k; } }
  assert.ok(Sim.meltOf(i, ID.Cu) < 1085 - 100, `the richest bronze melts at ${Sim.meltOf(i, ID.Cu).toFixed(0)} °C (copper: 1085 °C)`);
});

test('iron with carbon stays molten below the melting point of pure iron', () => {
  box(62, 62, 179, 119);
  Sim.fill(62, 100, 179, 119, 'Fe');
  hold(1600); run(30);
  for (let y = 100; y <= 119; y++) for (let x = 62; x <= 120; x++) { const i = y * W + x; sol[i] = ID.C; sx[i] = 0.17; sh[i] = ID.Fe; }
  for (let f = 0; f < 240; f++) { hold(1350); Sim.step(); }
  let castLiquid = 0, pureLiquid = 0;
  for (let y = 100; y <= 119; y++) for (let x = 62; x <= 179; x++) { const i = y * W + x; if (Sim.st[i] !== Sim.LIQUID) continue; if (x <= 120) castLiquid++; else pureLiquid++; }
  assert.ok(castLiquid > 0.8 * pureLiquid + 300 && pureLiquid < 200, `at 1350 °C: ${castLiquid} carbon-rich cells still molten, ${pureLiquid} pure`);
});

test('compositions survive a rewind', () => {
  box(62, 62, 179, 119);
  Sim.fill(62, 95, 179, 119, 'Fe'); Sim.fill(62, 90, 179, 94, 'C');
  for (let f = 0; f < 120; f++) { hold(1650); Sim.step(); }
  const before = stats('Fe').mean, snap = Sim.snapshot();
  Sim.loadPreset('blank');
  Sim.restore(snap);
  assert.ok(Math.abs(stats('Fe').mean - before) < 1e-9 && before > 0, `mean ${before} before, ${stats('Fe').mean} after`);
});
