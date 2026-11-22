// Steam and sealed gas: pressure must not vanish, boilers must build it, and boiling must depend on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, W, S, ID, run, secs, count, parts } from './helpers.js';

const copperBox = () => {   // sealed, inside x 100-139, y 100-129
  Sim.loadPreset('blank');
  Sim.fill(98, 98, 141, 99, 'Cu'); Sim.fill(98, 130, 141, 131, 'Cu'); Sim.fill(98, 98, 99, 131, 'Cu'); Sim.fill(140, 98, 141, 131, 'Cu');
};
const gasP = () => { let p = 0, n = 0; for (let y = 100; y <= 129; y++) for (let x = 100; x <= 139; x++) { const i = y * W + x; if (Sim.st[i] !== Sim.LIQUID) { p += Sim.P[i]; n++; } } return p / n; };
const holdFloor = T => { for (let x = 98; x <= 141; x++) { Sim.temp[130 * W + x] = T; Sim.temp[131 * W + x] = T; } };

test('sealed air only loses heat through its walls', () => {
  // walls and air both held at 150 °C: there is nowhere for the heat to go, so neither temperature nor pressure may drop
  copperBox();
  const walls = []; for (let y = 98; y <= 131; y++) for (let x = 98; x <= 141; x++) if (x < 100 || x > 139 || y < 100 || y > 129) walls.push(y * W + x);
  const air = () => { let t = 0; for (let y = 100; y <= 129; y++) for (let x = 100; x <= 139; x++) t += Sim.temp[y * W + x]; return t / 1200; };
  for (let y = 100; y <= 129; y++) for (let x = 100; x <= 139; x++) Sim.temp[y * W + x] = 150;
  for (let f = 0; f < 10; f++) { for (const i of walls) Sim.temp[i] = 150; Sim.step(); }
  const p0 = gasP();
  for (let f = 0; f < 600; f++) { for (const i of walls) Sim.temp[i] = 150; Sim.step(); }
  assert.ok(air() > 147, `air in the box cooled to ${air().toFixed(0)} °C with its walls at 150`);
  assert.ok(gasP() > p0 - 0.03, `pressure fell from ${p0.toFixed(2)} to ${gasP().toFixed(2)} atm`);
});

test('a sealed boiler builds pressure and settles with water left', () => {
  copperBox();
  Sim.fill(100, 120, 139, 129, 'water');
  for (let f = 0; f < 40 * 60; f++) { holdFloor(150); Sim.step(); }
  const p = gasP(), water = count('water', { state: Sim.LIQUID, box: [100, 100, 139, 129] });
  assert.ok(p > 3, `pressure ${p.toFixed(2)} atm (a 150 °C floor should push it towards 4-5 atm)`);
  assert.ok(water > 30, `water left: ${water} (raised pressure raises the boiling point, so it stops boiling dry)`);
});

test('water under pressure boils above 100 °C', () => {
  copperBox();
  Sim.fill(100, 120, 139, 129, 'water');
  for (let y = 100; y <= 129; y++) for (let x = 100; x <= 139; x++) { const i = y * W + x; Sim.P[i] = 4; Sim.temp[i] = 115; }
  run(5);
  for (let f = 0; f < 300; f++) { holdFloor(115); for (let y = 100; y <= 129; y++) for (let x = 100; x <= 139; x++) if (Sim.st[y * W + x] === Sim.LIQUID) Sim.temp[y * W + x] = 115; Sim.step(); }
  assert.ok(count('water', { state: Sim.GAS }) < 20, `at 4 atm water should not boil at 115 °C; steam made: ${count('water', { state: Sim.GAS })}`);
});

test('the steam scene lifts its piston', () => {
  Sim.loadPreset('steam');
  const piston = parts()[0];
  run(60);
  const y0 = piston.b.getPosition().y / S;
  for (let f = 0; f < 540; f++) { Sim.paint(120, 133, 'fire', 4); Sim.step(); }
  const lift = y0 - piston.b.getPosition().y / S;
  assert.ok(lift > 25, `9 s into the fire the piston should be held well up by steam; it is ${lift.toFixed(1)} cells above where it started`);
});
