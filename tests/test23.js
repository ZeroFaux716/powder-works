import * as planck from 'planck';
import { Sim } from '../src/sim/index.js';
const { W, H, ID, MATS, S } = Sim;
Sim.loadPreset('components');
const cnt = (key, x0, y0, x1, y1) => { let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (Sim.type[y * W + x] === ID[key] && Sim.st[y * W + x]) n++; return n; };
const lid = [...Sim.bodies.values()][0];
let maxLift = 0, pmax = 0;
for (let s = 1; s <= 30; s++) {
  for (let f = 0; f < 60; f++) {
    Sim.step();
    maxLift = Math.max(maxLift, 49.05 - lid.b.getPosition().y / S);
    pmax = Math.max(pmax, Sim.P[60 * W + 188]);
  }
  if (s === 3) {   // switch on the electrolysis and the relief valve's heater
    for (const [x, y] of [[78, 95], [79, 95], [78, 96], [79, 96], [215, 79], [216, 79], [215, 80], [216, 80]]) Sim.dset[y * W + x] = 1;
  }
  if (s % 5 === 0) console.log('t' + s, '| low tank', cnt('water', 8, 100, 45, 129), 'high tank', cnt('water', 54, 40, 95, 70), 'pump live', Sim.lit[126 * W + 47] >= 4,
    '| electrolysis H', cnt('H', 0, 0, 239, 149), 'O', cnt('O', 0, 0, 239, 149),
    '| pot', Math.round(Sim.temp[118 * W + 130]) + '°C heater', Sim.lit[129 * W + 120] >= 4 ? 'on' : 'off',
    '| chamber P', Sim.P[60 * W + 188].toFixed(2), 'max', pmax.toFixed(2), 'lid lifted max', maxLift.toFixed(2));
}
