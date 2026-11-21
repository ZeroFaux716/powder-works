import * as planck from 'planck';
import { Sim } from '../../src/sim/index.js';
const { W, H, S, ID } = Sim;
const run = n => { for (let f = 0; f < n; f++) Sim.step(); };
Sim.loadPreset('wind');
const wheel = [...Sim.bodies.values()][0];
const log = [];
for (let f = 1; f <= 900; f++) { Sim.step(); if (f % 150 === 0) log.push((wheel.b.getAngle() / (2 * Math.PI)).toFixed(2) + ' rev @' + (wheel.b.getAngularVelocity() * 60 / (2 * Math.PI)).toFixed(0) + 'rpm'); }
console.log('paddle wheel in the fan stream:', log.join(' | '), 'cells', wheel.occ.reduce((a, v) => a + v, 0));
for (let i = 0; i < W * H; i++) Sim.fan[i] = 0;
run(300); console.log('  5s after the fan is switched off:', (wheel.b.getAngularVelocity() * 60 / (2 * Math.PI)).toFixed(0), 'rpm');
// hot air blown down a duct
Sim.loadPreset('blank'); Sim.fill(40, 78, 200, 80, 'wall'); Sim.fill(40, 97, 200, 99, 'wall');
for (let y = 81; y <= 96; y++) for (let x = 44; x <= 51; x++) Sim.fan[y * W + x] = 1;
const T = x => { let s = 0; for (let y = 84; y <= 93; y++) s += Sim.temp[y * W + x]; return (s / 10).toFixed(0); };
for (let f = 0; f < 300; f++) { Sim.paint(70, 88, 'heat', 4); Sim.step(); }
console.log('heater at x=70 in a fan duct: air temp at x=60 (upwind)', T(60), 'x=90', T(90), 'x=130', T(130), 'x=180', T(180));
for (let i = 0; i < W * H; i++) Sim.fan[i] = 0;
Sim.loadPreset('blank'); Sim.fill(40, 78, 200, 80, 'wall'); Sim.fill(40, 97, 200, 99, 'wall');
for (let f = 0; f < 300; f++) { Sim.paint(70, 88, 'heat', 4); Sim.step(); }
console.log('same heater, no fan: x=60', T(60), 'x=90', T(90), 'x=130', T(130));
