// chemistry scene: the three demos
import * as planck from 'planck';
import { Sim } from '../../src/sim/index.js';
const { W, H, ID, MATS } = Sim;
Sim.loadPreset('chem');
const count = (x0, y0, x1, y1) => { const c = {}; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; if (Sim.st[i] === 0 || Sim.type[i] === ID.wall) continue; const m = MATS[Sim.type[i]]; const k = m.sym || m.name; c[k] = (c[k] || 0) + 1; } return Object.entries(c).sort((p, q) => q[1] - p[1]).slice(0, 6).map(([k, v]) => k + ' ' + v).join(', '); };
const run = s => { for (let f = 0; f < s * 60; f++) Sim.step(); };
run(5);
console.log('sodium box after 5 s:', count(10, 42, 57, 79));
console.log('dish, untouched after 5 s:', count(70, 86, 120, 95));
for (let y = 88; y <= 95; y++) for (let x = 70; x <= 76; x++) Sim.temp[y * W + x] = 520;   // heat one end, like the Heat tool
run(8);
console.log('dish, 8 s after heating one end:', count(70, 86, 120, 95));
const sw = (x, y, on) => { for (let q = y; q <= y + 1; q++) for (let p = x; p <= x + 1; p++) Sim.dset[q * W + p] = on; };
sw(140, 56, 1); sw(222, 56, 1);
run(2);
console.log('chamber after 2 s of feeding:', count(172, 64, 193, 82), '| tanks:', count(152, 32, 174, 50), '/', count(187, 32, 209, 50));
sw(222, 67, 1);
run(3);
console.log('chamber 3 s after the spark switch, still feeding:', count(172, 64, 193, 82));
sw(140, 56, 0); sw(222, 56, 0); sw(222, 67, 0);
run(4);
console.log('chamber 4 s after everything is off:', count(172, 64, 193, 82));
sw(140, 104, 1);
run(6);
console.log('jar after draining 6 s:', count(174, 86, 191, 110), '| chamber:', count(172, 64, 193, 82));
