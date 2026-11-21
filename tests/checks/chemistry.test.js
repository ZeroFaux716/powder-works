// Elements forming compounds, acids, metals and the thermite scene.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, W, ID, run, secs, count, box, tally } from './helpers.js';

// a box with `a` in the bottom and `b` above it, optionally heated
function react(a, b, { heat = 0, seconds = 3, mix = false } = {}) {
  box(62, 62, 179, 119);
  Sim.fill(62, 100, 179, 119, a);
  if (mix) { for (let y = 100; y <= 119; y++) for (let x = 62; x <= 179; x++) if ((x + y) % 2) Sim.type[y * W + x] = ID[b]; }
  else Sim.fill(62, 80, 179, 99, b);
  if (heat) for (let y = 62; y <= 119; y++) for (let x = 62; x <= 179; x++) Sim.temp[y * W + x] = heat;
  secs(seconds);
  return tally(62, 62, 179, 119);
}

test('sodium and chlorine make salt', () => {
  const c = react('Na', 'Cl', { seconds: 4 });
  assert.ok((c.salt || 0) > 500, `salt made: ${c.salt || 0}`);
});

test('zinc dissolves in hydrochloric acid, giving zinc chloride and hydrogen', () => {
  const c = react('Zn', 'acid_Cl', { seconds: 4 });
  assert.ok((c.Zn || 0) < 2360 * 0.9, `zinc left: ${c.Zn}`);
  assert.ok((c.cpd_ZnCl2 || 0) > 50, `zinc chloride: ${c.cpd_ZnCl2 || 0}`);
  assert.ok((c.H || 0) > 20, `hydrogen: ${c.H || 0}`);
});

test('copper does not dissolve in hydrochloric acid', () => {
  const c = react('Cu', 'acid_Cl', { seconds: 4 });
  assert.equal(c.Cu, 2360, 'all the copper is still there');
});

test('carbon smelts rust into iron when hot', () => {
  const c = react('rust', 'C', { heat: 1200, seconds: 4, mix: true });
  assert.ok((c.Fe || 0) > 100, `iron made: ${c.Fe || 0}`);
});

test('zinc takes the chlorine from copper chloride', () => {
  const c = react('cpd_CuCl2', 'Zn', { heat: 450, seconds: 3, mix: true });
  assert.ok((c.Cu || 0) > 500 && (c.cpd_ZnCl2 || 0) > 500, `copper ${c.Cu || 0}, zinc chloride ${c.cpd_ZnCl2 || 0}`);
});

test('thermite ignores an ordinary flame but the magnesium fuse lights it', () => {
  Sim.loadPreset('thermite');
  run(120);
  const pile = count('thermite');
  assert.ok(pile > 100, `the scene has a thermite pile (${pile})`);
  for (let f = 0; f < 120; f++) { Sim.paint(108, 102, 'fire', 2); Sim.step(); }
  assert.ok(count('thermite') > pile * 0.95, 'a plain flame does not set it off');
  Sim.paint(120, 88, 'fire', 1);
  run(900);
  assert.ok(count('thermite') < pile * 0.2, `thermite burnt: ${count('thermite')} of ${pile} left`);
  assert.ok(count('Fe', { state: Sim.LIQUID }) + count('Fe') > 50, 'it made iron');
});
