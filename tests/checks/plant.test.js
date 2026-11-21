// The refinery and the components scene: longer runs that check whole working plants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, W, S, run, secs, count, tally, parts } from './helpers.js';

test('the refinery separates crude oil into its jars', () => {
  Sim.loadPreset('refinery');
  secs(75);
  const jars = { top: tally(94, 58, 99, 66), mid: tally(108, 74, 113, 82), low: tally(122, 86, 127, 94) };
  const got = (jar, key) => (jars[jar][key] || 0);
  const msg = JSON.stringify(jars);
  assert.ok(got('top', 'gasoline') > 20, 'gasoline collects in the top jar: ' + msg);
  assert.ok(got('mid', 'kerosene') > 15, 'kerosene in the middle jar: ' + msg);
  assert.ok(got('top', 'crude') + got('mid', 'crude') + got('low', 'crude') === 0, 'no crude carried over into the jars: ' + msg);
});

test('the components scene: pump fills and stops, electrolysis, thermostat, relief valve', () => {
  Sim.loadPreset('components');
  const lid = parts()[0];
  const lid0 = lid.b.getPosition().y / S;
  let pmax = 0, lift = 0;
  for (let s = 1; s <= 30; s++) {
    for (let f = 0; f < 60; f++) { Sim.step(); pmax = Math.max(pmax, Sim.P[60 * W + 188]); lift = Math.max(lift, lid0 - lid.b.getPosition().y / S); }
    if (s === 3) for (const [x, y] of [[78, 95], [79, 95], [78, 96], [79, 96], [215, 79], [216, 79], [215, 80], [216, 80]]) Sim.dset[y * W + x] = 1;
  }
  const high = count('water', { box: [54, 40, 95, 70] });
  assert.ok(high > 200, `the high tank fills (${high} water)`);
  assert.ok(Sim.lit[126 * W + 47] < 4, 'the pump has stopped: the level sensor switched it off');
  const h = count('H'), o = count('O');
  assert.ok(h > 100 && h > 1.5 * o, `electrolysis makes about twice as much hydrogen as oxygen (H ${h}, O ${o})`);
  const pot = Sim.temp[118 * W + 130];
  assert.ok(pot > 40 && pot < 110, `the thermostat keeps the pot below boiling (${pot.toFixed(0)} °C)`);
  assert.ok(lift > 0.3, `the relief valve lid lifts (${lift.toFixed(2)} cells)`);
  assert.ok(pmax < 1.6, `and keeps the chamber pressure down (peak ${pmax.toFixed(2)} atm)`);
});
