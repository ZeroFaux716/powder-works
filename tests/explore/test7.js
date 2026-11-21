import * as planck from 'planck';
import { Sim } from '../../src/sim/index.js';
const { W, H, ID } = Sim;
const count = (key, state) => { let n = 0; for (let i = 0; i < W * H; i++) if (Sim.type[i] === ID[key] && (state === undefined || Sim.st[i] === state)) n++; return n; };
Sim.loadPreset('thermite');
for (let f = 0; f < 120; f++) Sim.step();
console.log('settled: parts', Sim.bodies.size, 'thermite', count('thermite'), 'Mg', count('Mg'));
// an ordinary flame must not light it
for (let f = 0; f < 120; f++) { Sim.paint(108, 102, 'fire', 2); Sim.step(); }
console.log('after gasoline-type flame on the pile: thermite', count('thermite'));
Sim.paint(120, 88, 'fire', 1);
for (let f = 1; f <= 900; f++) { Sim.step(); if (f % 150 === 0) console.log('f', f, 'Mg', count('Mg'), 'thermite', count('thermite'), 'molten iron', count('Fe', Sim.LIQUID), 'parts', [...Sim.bodies.values()].map(b => b.occ.reduce((a, v) => a + v, 0) + '@' + b.b.getAngle().toFixed(2)).join(' '), 'joints', Sim.jrecs.length); }
