// placeable components: thermostat loop, pump, electrolysis, pressure sensor
import * as planck from 'planck';
import { Sim } from '../../src/sim/index.js';
const { W, H, ID, MATS } = Sim;
const dev = (x, y, tool, setting, dir) => { if (dir) Sim.setPaintDir(dir); Sim.paint(x, y, tool, 0, setting); };
const run = n => { for (let f = 0; f < n; f++) Sim.step(); };
// 1. thermostat: a copper bar with a heater at one end, a 150 °C sensor at the other, through an inverter
Sim.loadPreset('blank');
Sim.fill(60, 60, 75, 63, 'Cu');
dev(60, 61, 'heater', 60);                      // 600 °C heater
dev(75, 61, 'sensor', 15);                      // trips at 150 °C
for (let x = 76; x <= 110; x++) dev(x, 61, 'wire');
for (let y = 62; y <= 70; y++) dev(110, y, 'wire');
dev(110, 71, 'inverter', undefined, 4);         // faces down: input above, output below
for (let y = 72; y <= 75; y++) dev(110, y, 'wire');
for (let x = 55; x <= 109; x++) dev(x, 75, 'wire');
for (let y = 62; y <= 74; y++) dev(55, y, 'wire');
for (let x = 56; x <= 59; x++) dev(x, 62, 'wire');
const T = [];
for (let s = 0; s < 20; s++) { run(60); T.push(Math.round(Sim.temp[61 * W + 75]) + (Sim.lit[61 * W + 60] >= 4 ? '*' : '')); }
console.log('thermostat: far end of the bar each second:', T.join(' '), '| heater live now:', Sim.lit[61 * W + 60] >= 4);
// 2. pump: water in a low tank, pumped up a pipe into a high tank
Sim.loadPreset('blank');
Sim.fill(40, 100, 41, 131, 'wall'); Sim.fill(80, 100, 81, 131, 'wall'); Sim.fill(40, 130, 81, 131, 'wall');   // low tank
Sim.fill(42, 110, 79, 129, 'water');
Sim.fill(84, 40, 85, 131, 'wall'); Sim.fill(88, 44, 89, 131, 'wall'); Sim.fill(82, 130, 89, 131, 'wall');      // pipe x86-87 from tank bottom up
Sim.fill(80, 126, 81, 129, null); Sim.fill(82, 126, 85, 129, null); Sim.fill(82, 125, 85, 125, 'wall');      // opening from the tank into the pipe
Sim.fill(88, 30, 130, 31, 'wall'); Sim.fill(128, 30, 129, 60, 'wall'); Sim.fill(90, 59, 129, 60, 'wall'); Sim.fill(84, 30, 85, 40, 'wall');
for (let y = 126; y <= 129; y++) dev(83, y, 'pump', 3, 1);   // in the passage from the tank, facing the pipe
for (let y = 115; y <= 125; y++) dev(83, y, 'wire');
dev(83, 114, 'switch');
const cnt = (x0, y0, x1, y1) => { let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (Sim.type[y * W + x] === ID.water) n++; return n; };
const p0 = cnt(42, 100, 79, 129);
run(600);
console.log('pump: low tank', p0, '->', cnt(42, 100, 79, 129), '| pipe', cnt(86, 32, 87, 129), '| high tank', cnt(90, 32, 127, 58));
// 3. electrolysis of water
Sim.loadPreset('blank');
Sim.fill(60, 100, 61, 131, 'wall'); Sim.fill(100, 100, 101, 131, 'wall'); Sim.fill(60, 130, 101, 131, 'wall');
Sim.fill(62, 110, 99, 129, 'water');
for (let y = 112; y <= 128; y++) { dev(70, y, 'electrode'); dev(90, y, 'electrode'); }
for (let y = 100; y <= 111; y++) { dev(70, y, 'wire'); dev(90, y, 'wire'); }
for (let x = 70; x <= 90; x++) dev(x, 99, 'wire');
dev(80, 98, 'switch');
run(300);
const all = () => { const c = {}; for (let i = 0; i < W * H; i++) if (Sim.st[i] && Sim.type[i] !== ID.wall) { const k = MATS[Sim.type[i]].sym || MATS[Sim.type[i]].name; c[k] = (c[k] || 0) + 1; } return JSON.stringify(c); };
console.log('electrolysis 5 s:', all());
// 4. pressure sensor in a sealed box that is being heated, lighting a plug outside
Sim.loadPreset('blank');
Sim.fill(60, 60, 61, 81, 'wall'); Sim.fill(100, 60, 101, 81, 'wall'); Sim.fill(60, 60, 101, 61, 'wall'); Sim.fill(60, 80, 101, 81, 'wall');
dev(80, 70, 'sensor', 12);                       // pressure, 1.2 atm (made a pressure sensor below)
Sim.fan[70 * W + 80] = 13;
for (let x = 81; x <= 110; x++) dev(x, 70, 'wire');
dev(111, 70, 'plug');
let trip = -1;
Sim.fill(62, 78, 99, 79, 'Cu'); for (let x = 62; x <= 99; x++) dev(x, 79, 'heater', 50); for (let y = 80; y <= 90; y++) dev(62, y, 'wire'); dev(62, 91, 'switch');
for (let f = 0; f < 1200; f++) { Sim.step(); if (trip < 0 && Sim.lit[70 * W + 111] >= 4) trip = f; }
console.log('pressure sensor: plug lit at frame', trip, '| pressure now', Sim.P[70 * W + 80].toFixed(2), 'air', Math.round(Sim.temp[70 * W + 80]), '°C');
