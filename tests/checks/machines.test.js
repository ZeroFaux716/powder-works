// Hydraulics, fans, the diesel hammer and the reactor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, W, S, ID, run, count, parts } from './helpers.js';

test('the hydraulic press lifts its platform', () => {
  Sim.loadPreset('hydraulic');
  const plat = parts()[1];
  const y0 = plat.b.getPosition().y / S;
  let top = 0;
  for (let f = 0; f < 1200; f++) { Sim.step(); top = Math.max(top, y0 - plat.b.getPosition().y / S); }
  assert.ok(top > 3, `platform rose ${top.toFixed(1)} cells`);
});

test('a fan stream turns the paddle wheel', () => {
  Sim.loadPreset('wind');
  const wheel = parts()[0];
  run(900);
  const spin = Math.abs(wheel.b.getAngularVelocity());
  assert.ok(spin > 0.5, `wheel spins in the stream (${(spin * 9.55).toFixed(0)} rpm)`);
});

test('the diesel hammer ignites fuel by compression alone', () => {
  Sim.loadPreset('diesel');
  const ram = parts()[0];
  let fire = 0, low = -Infinity;
  for (let f = 0; f < 600; f++) { Sim.step(); fire = Math.max(fire, count('fire')); low = Math.max(low, ram.b.getPosition().y / S); }
  assert.ok(fire > 5, `fuel ignited (${fire} fire cells at most)`);
});

test('a small lump of uranium fizzles; a big one runs away', () => {
  const burst = size => {
    Sim.loadPreset('blank');
    Sim.fill(120 - size / 2, 100 - size / 2, 119 + size / 2, 99 + size / 2, 'U');
    for (let k = 0; k < 40; k++) Sim.emit(120, 100, true);
    run(180);
    return Sim.neutrons;
  };
  const small = burst(6), big = burst(44);
  assert.ok(small < 20, `6x6 lump: ${small} neutrons after 3 s`);
  assert.ok(big > 200, `44x44 lump: ${big} neutrons after 3 s`);
});
