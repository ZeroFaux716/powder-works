// Chunk sleeping: settled parts of the bench are skipped, and anything that happens there wakes them,
// with the same outcome as when nothing sleeps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, W, ID, run, count } from './helpers.js';

function bench() {
  Sim.loadPreset('blank');
  Sim.fill(20, 120, 220, 145, 'sand');
  Sim.fill(60, 90, 61, 119, 'Cu'); Sim.fill(180, 90, 181, 119, 'Cu'); Sim.fill(60, 88, 181, 89, 'Cu');   // a sealed copper room
  run(300);
}
function both(fn) {
  const out = [];
  for (const on of [false, true]) { Sim.setSleeping(on); out.push(fn()); }
  Sim.setSleeping(true);
  return out;
}

test('a settled bench mostly sleeps', () => {
  bench();
  run(10);
  assert.ok(Sim.asleepCount() > 100, `${Sim.asleepCount()} of 150 chunks asleep`);
});

test('heat painted into a sleeping area wakes it and spreads as it would anyway', () => {
  const [off, on] = both(() => {
    bench();
    for (let f = 0; f < 60; f++) { Sim.paint(120, 100, 'heat', 3); Sim.step(); }
    run(300);
    return [Sim.temp[100 * W + 120], Sim.temp[100 * W + 140], Sim.temp[89 * W + 120], Sim.P[100 * W + 120]];
  });
  for (let k = 0; k < off.length; k++) assert.ok(Math.abs(off[k] - on[k]) < Math.max(1, Math.abs(off[k]) * 0.03), `reading ${k}: ${off[k].toFixed(2)} without sleeping, ${on[k].toFixed(2)} with`);
});

test('a burst of pressure in a sleeping area spreads out and settles as it would anyway', () => {
  // (without sleeping, the solver spreads a burst along a whole row of open air in one frame; with it, the
  // burst travels about one chunk, 16 cells, a frame, which is closer to a real pressure wave)
  const [off, on] = both(() => {
    bench();
    for (let y = 30; y < 40; y++) for (let x = 115; x < 125; x++) Sim.P[y * W + x] = 4;   // set straight into the arrays: nothing woke it
    let reached = 0;
    for (let f = 0; f < 5; f++) { Sim.step(); reached = Math.max(reached, Math.abs(Sim.P[35 * W + 160] - 1)); }
    run(60);
    return [reached, Sim.P[35 * W + 120], Sim.P[35 * W + 200]];
  });
  assert.ok(on[0] > 5e-4, `the burst reaches 40 cells away within 5 frames (${on[0].toExponential(1)} atm)`);
  for (const k of [1, 2]) assert.ok(Math.abs(off[k] - on[k]) < 0.005, `after 1 s: ${off[k].toFixed(4)} atm without sleeping, ${on[k].toFixed(4)} with`);
});

test('a switch turned on in a sleeping area powers its heater', () => {
  bench();
  Sim.fill(100, 60, 110, 61, 'Cu');
  for (let x = 100; x <= 110; x++) Sim.paint(x, 61, 'heater', 0, 30);
  Sim.paint(111, 61, 'wire', 0); Sim.paint(112, 61, 'switch', 0, 0);   // a switch that starts off
  run(300);
  const t0 = Sim.temp[60 * W + 105];
  for (let q = 61; q <= 62; q++) for (let p = 112; p <= 113; p++) Sim.dset[q * W + p] = 1;
  run(120);
  assert.ok(Sim.temp[60 * W + 105] > t0 + 50, `the bar heats up (${t0.toFixed(0)} -> ${Sim.temp[60 * W + 105].toFixed(0)} °C)`);
});
