import * as planck from 'planck';
import { Sim } from '../../src/sim/index.js';
const { W, H, S, ID, MATS } = Sim;
const V = planck.Vec2;
const count = (key, state) => { let n = 0; for (let i = 0; i < W * H; i++) if (Sim.type[i] === ID[key] && (state === undefined || Sim.st[i] === state)) n++; return n; };
const bl = () => [...Sim.bodies.values()];
const run = n => { for (let f = 0; f < n; f++) Sim.step(); };

// crank
Sim.loadPreset('crank');
let [piston, wheel] = bl();
run(60);
const snap = Sim.snapshot();
const a0 = wheel.b.getAngle();
Sim.paint(34, 108, 'fire', 2);
run(400);
console.log('crank revs', ((wheel.b.getAngle() - a0) / (2 * Math.PI)).toFixed(2), 'fuel left', count('gasoline'));
Sim.restore(snap);
[piston, wheel] = bl();
Sim.paint(34, 108, 'fire', 2);
run(400);
console.log('after rewind revs', ((wheel.b.getAngle() - a0) / (2 * Math.PI)).toFixed(2));

// cylinder
Sim.loadPreset('cylinder');
let pb = bl()[0];
run(60);
Sim.paint(35, 109, 'fire', 2);
run(160);
console.log('cylinder piston x', (pb.b.getPosition().x / S).toFixed(1), '(started 69)');

// steam
Sim.loadPreset('steam');
pb = bl()[0];
run(60);
const y0 = pb.b.getPosition().y / S;
let lifted = -1;
for (let f = 1; f <= 1200; f++) { Sim.paint(120, 133, 'fire', 4); Sim.step(); if (lifted < 0 && pb.b.getPosition().y / S < y0 - 3) lifted = f; }
console.log('steam rest', y0.toFixed(1), 'lifted at', lifted, 'plate T', Sim.temp[127 * W + 120].toFixed(0), 'copper static', count('Cu', Sim.STATIC));

// forge
Sim.loadPreset('forge');
run(30);
const bars = bl();
console.log('forge bars', bars.map(b => MATS[b.mat].sym).join(' '));
for (let x = 50; x < 190; x += 6) Sim.paint(x, 135, 'fire', 2);
for (let f = 1; f <= 3600; f++) {
  Sim.step();
  if (f % 600 === 0) {
    const alive = bl().map(b => MATS[b.mat].sym + ':' + b.occ.reduce((a, v) => a + v, 0) + '@' + Math.round(Math.max(...b.foot.map(i => Sim.temp[i])))).join(' ');
    console.log('f', f, 'coal', count('C'), 'fire', count('fire'), 'shelf T', Sim.temp[120 * W + 100].toFixed(0), 'Cu static', count('Cu', Sim.STATIC), '|', alive);
  }
}
console.log('liquid metal cells:', ['Ga', 'Sn', 'Pb', 'Zn', 'Al'].map(k => k + ' ' + count(k, Sim.LIQUID) + '/' + count(k, Sim.STATIC)).join(', '));

// melting a hinged bar in two with the heat tool
Sim.loadPreset('blank');
const bar = Sim.addBody(Sim.cellsRect(100, 60, 139, 62), ID.Sn);
Sim.makeJoint('hinge', bar, null, V(101 * S, 61.5 * S));
Sim.makeJoint('hinge', bar, null, V(138 * S, 61.5 * S));
for (let f = 0; f < 200; f++) { Sim.paint(120, 61, 'heat', 2); Sim.step(); }
console.log('tin bar split into', Sim.bodies.size, 'parts, joints', Sim.jrecs.length, 'liquid tin', count('Sn', Sim.LIQUID), 'frozen tin', count('Sn', Sim.STATIC));
run(200);
console.log('after swing: parts', bl().map(b => (b.b.getAngle()).toFixed(2)).join(' '));

// chemistry
Sim.loadPreset('blank');
Sim.fill(100, 130, 140, 145, 'water');
Sim.fill(118, 100, 122, 104, 'K');
let maxP = 0;
for (let f = 0; f < 300; f++) { Sim.step(); for (let i = 0; i < W * H; i++) maxP = Math.max(maxP, Sim.P[i]); }
console.log('potassium left', count('K'), 'hydrogen', count('H'), 'steam', count('water', Sim.GAS), 'peak P', maxP.toFixed(1));
Sim.loadPreset('blank');
Sim.fill(100, 140, 140, 145, 'water');
for (let f = 0; f < 400; f++) { Sim.paint(120, 142, 'cool', 6); Sim.step(); }
console.log('ice', count('water', Sim.STATIC), 'water', count('water', Sim.LIQUID));
Sim.loadPreset('blank');
Sim.fill(98, 60, 99, 145, 'wall'); Sim.fill(141, 60, 142, 145, 'wall'); Sim.fill(100, 130, 140, 145, 'Hg'); Sim.fill(110, 100, 130, 110, 'sand'); Sim.fill(105, 80, 135, 90, 'water');
run(400);
const yOf = key => { let s = 0, n = 0; for (let i = 0; i < W * H; i++) if (Sim.type[i] === ID[key]) { s += (i / W) | 0; n++; } return (s / n).toFixed(1); };
console.log('layers by mean row: water', yOf('water'), 'sand', yOf('sand'), 'mercury', yOf('Hg'));

Sim.loadPreset('forge');
const t0 = Date.now(); run(300);
console.log('ms/step', ((Date.now() - t0) / 300).toFixed(2));
