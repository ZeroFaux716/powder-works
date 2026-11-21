import * as planck from 'planck';
import { Sim } from '../src/sim/index.js';
const { W, H, S, ID, MATS } = Sim;
const V = planck.Vec2;
const run = n => { for (let f = 0; f < n; f++) Sim.step(); };
const count = (key, state) => { let n = 0; for (let i = 0; i < W * H; i++) if (Sim.type[i] === ID[key] && (state === undefined || Sim.st[i] === state)) n++; return n; };
const maxT = key => { let m = 0; for (let i = 0; i < W * H; i++) if (Sim.type[i] === ID[key]) m = Math.max(m, Sim.temp[i]); return Math.round(m); };
// critical mass: bare uranium blocks of growing size, one burst of neutrons each
for (const size of [6, 12, 20, 30, 44]) {
  Sim.loadPreset('blank');
  Sim.fill(120 - size / 2, 100 - size / 2, 119 + size / 2, 99 + size / 2, 'U');
  for (let k = 0; k < 40; k++) Sim.emit(120, 100, true);
  const log = [];
  for (let f = 1; f <= 240; f++) { Sim.step(); if (f % 60 === 0) log.push(Sim.neutrons); }
  console.log('bare U block', size + 'x' + size, 'neutrons each second:', log.join(' '), 'peak T', maxT('U'));
}
for (const size of [6, 10, 14]) {
  Sim.loadPreset('blank');
  Sim.fill(120 - size / 2, 100 - size / 2, 119 + size / 2, 99 + size / 2, 'Pu');
  for (let k = 0; k < 40; k++) Sim.emit(120, 100, true);
  const log = [];
  for (let f = 1; f <= 180; f++) { Sim.step(); if (f % 60 === 0) log.push(Sim.neutrons); }
  console.log('bare Pu block', size + 'x' + size, 'neutrons each second:', log.join(' '));
}
// reactor: rods in, then pulled out, then dropped
Sim.loadPreset('reactor');
const rods = [...Sim.bodies.values()][0];
const ry = () => (rods.b.getPosition().y / S).toFixed(1);
const report = tag => console.log(tag, 'rods y', ry(), 'neutrons', Sim.neutrons, 'fuel T', maxT('U'), 'water T', maxT('water'), 'steam', count('water', Sim.GAS), 'water', count('water', Sim.LIQUID), 'waste', count('waste'), 'U', count('U'), 'molten U', count('U', Sim.LIQUID));
run(600); report('rods in 10s:');
const g = Sim.grab(rods, 120, 105);
g.setTarget(V(120 * S, 60 * S));
for (let k = 1; k <= 8; k++) { run(300); report('rods held up ' + k * 5 + 's:'); }
Sim.ungrab(g);
for (let k = 1; k <= 3; k++) { run(300); report('rods dropped ' + k * 5 + 's:'); }
// decay chain
Sim.loadPreset('blank'); Sim.fill(110, 130, 130, 145, 'Og'); run(1500);
const tally = {}; for (let i = 0; i < W * H; i++) if (Sim.st[i] && Sim.type[i] > 1 && (i / W | 0) < 146) { const k = MATS[Sim.type[i]].key; tally[k] = (tally[k] || 0) + 1; }
console.log('oganesson after 25s:', JSON.stringify(tally));
Sim.loadPreset('blank'); Sim.fill(110, 138, 130, 145, 'Po'); run(600); console.log('polonium lump after 10s: temp', maxT('Po'), 'lead', count('Pb'), 'helium', count('He'));
Sim.loadPreset('blank'); Sim.fill(110, 138, 130, 145, 'Pu'); run(1200); console.log('plutonium lump after 20s: temp', maxT('Pu'));
// thorium breeding
Sim.loadPreset('blank'); Sim.fill(100, 100, 140, 120, 'Th'); for (let f = 0; f < 300; f++) { for (let k = 0; k < 10; k++) Sim.emit(120, 110, false); Sim.step(); }
console.log('thorium under a neutron beam: uranium bred', count('U'), 'of', 41 * 21);
const t0 = Date.now(); Sim.loadPreset('reactor'); run(300); console.log('ms/step', ((Date.now() - t0) / 300).toFixed(2));
