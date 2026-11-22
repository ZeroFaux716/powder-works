// Chemistry driven by energy: what forms, when, and what falls apart, from the NASA data, not hand-set rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim, W, ID, run, box, tally } from './helpers.js';

// a sealed box: `a` in the bottom 20 rows, `b` above it, everything held at T (°C) for `seconds`
function cook(a, b, T, seconds = 4) {
  box(62, 62, 179, 119);
  Sim.fill(62, 100, 179, 119, a);
  if (b) Sim.fill(62, 70, 179, 99, b);
  const hold = () => { for (let y = 62; y <= 119; y++) for (let x = 62; x <= 179; x++) Sim.temp[y * W + x] = T; };
  for (let f = 0; f < seconds * 60; f++) { hold(); Sim.step(); }
  return tally(62, 62, 179, 119);
}

test('mercury takes up oxygen at 400 °C, and mercury oxide gives it back above about 470 °C', () => {
  const made = cook('Hg', 'O', 400);
  assert.ok((made.cpd_HgO || 0) > 50, `mercury oxide made at 400 °C: ${made.cpd_HgO || 0}`);
  const back = cook('cpd_HgO', null, 600, 3);
  assert.ok((back.Hg || 0) > 500, `at 600 °C mercury oxide falls apart: ${back.Hg || 0} mercury, ${back.cpd_HgO || 0} oxide left`);
});

test('gold does not burn, and silver does not tarnish in oxygen', () => {
  const au = cook('Au', 'O', 1000, 3), ag = cook('Ag', 'O', 300, 3);
  assert.equal(au.cpd_Au2O3 || 0, 0, 'gold oxide made at 1000 °C');
  assert.equal(ag.cpd_Ag2O || 0, 0, 'silver oxide made at 300 °C');
});

test('iron and sulfur need about 500 °C', () => {
  const cold = cook('Fe', 'S', 300, 3), hot = cook('Fe', 'S', 650, 3);
  assert.ok((cold.cpd_FeS || 0) < 20, `iron sulfide at 300 °C: ${cold.cpd_FeS || 0}`);
  assert.ok((hot.cpd_FeS || 0) > 50, `iron sulfide at 650 °C: ${hot.cpd_FeS || 0}`);
});

test('nitrogen and hydrogen never make ammonia on their own', () => {
  const c = cook(null, null, 20, 0);
  box(62, 62, 179, 119);
  for (let y = 62; y <= 119; y++) for (let x = 62; x <= 179; x++) Sim.paint(x, y, 'brush', 0, (x + y) % 2 ? ID.N : ID.H, true);
  for (let f = 0; f < 180; f++) { for (let y = 62; y <= 119; y++) for (let x = 62; x <= 179; x++) Sim.temp[y * W + x] = 450; Sim.step(); }
  assert.equal(tally(62, 62, 179, 119).cpd_NH3 || 0, 0, 'ammonia made');
});

test('heat comes from the energy released: sodium and chlorine burn far hotter than iron and sulfur', () => {
  const peak = (a, b, T0) => {
    box(62, 62, 179, 119);
    Sim.fill(62, 100, 179, 119, a); Sim.fill(62, 80, 179, 99, b);
    for (let y = 62; y <= 119; y++) for (let x = 62; x <= 179; x++) Sim.temp[y * W + x] = T0;
    let hot = 0;
    for (let f = 0; f < 120; f++) { Sim.step(); for (let y = 62; y <= 119; y++) for (let x = 62; x <= 179; x++) hot = Math.max(hot, Sim.temp[y * W + x]); }
    return hot;
  };
  const nacl = peak('Na', 'Cl', 20), fes = peak('Fe', 'S', 550);
  assert.ok(nacl - 20 > 2 * (fes - 550), `Na + Cl rose to ${nacl.toFixed(0)} °C from 20; Fe + S to ${fes.toFixed(0)} °C from 550`);
});

// two materials mixed checkerboard-wise in a sealed box, held at T
function mix(a, b, T, seconds = 3) {
  box(62, 62, 179, 119);
  for (let y = 90; y <= 119; y++) for (let x = 62; x <= 179; x++) Sim.paint(x, y, 'brush', 0, (x + y) % 2 ? ID[a] : ID[b], true);
  for (let f = 0; f < seconds * 60; f++) { for (let y = 62; y <= 119; y++) for (let x = 62; x <= 179; x++) Sim.temp[y * W + x] = T; Sim.step(); }
  return tally(62, 62, 179, 119);
}

test('swapping partners follows the energy: carbon smelts iron oxide but not alumina', () => {
  const fe = mix('rust', 'C', 900), al = mix('cpd_Al2O3', 'C', 1500);
  assert.ok((fe.Fe || 0) > 100, `iron from rust and carbon at 900 °C: ${fe.Fe || 0}`);
  assert.equal(al.Al || 0, 0, 'aluminium from alumina and carbon at 1500 °C');
});

test('hydrogen strips copper oxide but not zinc oxide at 700 °C', () => {
  const cu = mix('cpd_CuO', 'H', 700), zn = mix('cpd_ZnO', 'H', 700);
  assert.ok((cu.Cu || 0) > 50, `copper freed: ${cu.Cu || 0}`);
  assert.equal(zn.Zn || 0, 0, 'zinc freed');
});

test('displacement only runs downhill', () => {
  const fwd = mix('cpd_CuCl2', 'Zn', 300), back = mix('cpd_ZnCl2', 'Cu', 300);
  assert.ok((fwd.Cu || 0) > 100, `zinc frees copper from copper chloride: ${fwd.Cu || 0}`);
  assert.equal(back.Zn || 0, 0, 'copper never frees zinc from zinc chloride');
  const br = mix('cpd_NaBr', 'Cl', 20), cl = mix('salt', 'Br', 20);
  assert.ok((br.Br || 0) > 50, `chlorine drives bromine out of sodium bromide: ${br.Br || 0}`);
  assert.equal(cl.Cl || 0, 0, 'bromine never drives chlorine out of salt');
});

test('aluminium and iron oxide give off a great deal of heat (thermite)', () => {
  box(62, 62, 179, 119);
  for (let y = 100; y <= 119; y++) for (let x = 62; x <= 179; x++) Sim.paint(x, y, 'brush', 0, (x + y) % 2 ? ID.Al : ID.rust, true);
  for (let y = 62; y <= 119; y++) for (let x = 62; x <= 179; x++) Sim.temp[y * W + x] = 500;
  let hot = 0;
  for (let f = 0; f < 120; f++) { Sim.step(); for (let y = 62; y <= 119; y++) for (let x = 62; x <= 179; x++) hot = Math.max(hot, Sim.temp[y * W + x]); }
  const c = tally(62, 62, 179, 119);
  assert.ok((c.cpd_Al2O3 || 0) > 100 && hot > 1500, `alumina ${c.cpd_Al2O3 || 0}, hottest ${hot.toFixed(0)} °C`);
});

test('hot iron takes the oxygen out of steam and sets hydrogen free; copper does not', () => {
  // (iron, steam and hydrogen are nearly balanced: below about 550 °C steam rusts iron, above it hydrogen turns
  // rust back into iron, as in the real steam-iron process)
  const fe = cook('Fe', 'water', 450, 3), cu = cook('Cu', 'water', 450, 3);
  assert.ok((fe.rust || 0) > 20 && (fe.H || 0) > 20, `iron in steam at 450 °C: rust ${fe.rust || 0}, hydrogen ${fe.H || 0}`);
  assert.equal(cu.cpd_CuO || 0, 0, 'copper oxide made from steam');
  const cold = cook('Fe', 'water', 60, 3);
  assert.ok((cold.H || 0) < 5, `iron in warm water makes next to no hydrogen: ${cold.H || 0}`);
});
