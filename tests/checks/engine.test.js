// The two-stroke engine scene and the crank: the machines that started all this.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, parts, run, secs, count } from './helpers.js';

const TURN = 2 * Math.PI;

test('the two-stroke engine starts and keeps running', () => {
  Sim.loadPreset('engine');
  const wheel = parts()[1];
  secs(10);
  const a = wheel.b.getAngle();
  secs(10);
  const rpm = (wheel.b.getAngle() - a) / TURN * 6;
  assert.ok(rpm > 40 && rpm < 120, `engine should run at a steady 40-120 rpm between 10 and 20 s, got ${rpm.toFixed(0)}`);
});

test('the crank turns when its fuel is lit, and Rewind replays the same run', () => {
  Sim.loadPreset('crank');
  const wheel = () => parts()[1];
  run(60);
  const snap = Sim.snapshot();
  const a0 = wheel().b.getAngle();
  Sim.paint(34, 108, 'fire', 2);
  run(400);
  const revs = (wheel().b.getAngle() - a0) / TURN;
  assert.ok(Math.abs(revs) > 1, `crank should turn at least once, turned ${revs.toFixed(2)}`);
  Sim.restore(snap);
  Sim.paint(34, 108, 'fire', 2);
  run(400);
  const again = (wheel().b.getAngle() - a0) / TURN;
  assert.ok(Math.abs(again) > 1, `after rewinding, it turns again (${again.toFixed(2)} revs)`);
});
