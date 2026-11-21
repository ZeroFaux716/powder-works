global.planck = require('planck');
const fs = require('fs');
const Sim = new Function(fs.readFileSync(__dirname + '/../src/sim.js', 'utf8') + '\nreturn Sim;')();
const { W, H, ID, MATS } = Sim;
const run = n => { for (let f = 0; f < n; f++) Sim.step(); };
const count = (key, state) => { let n = 0; for (let i = 0; i < W * H; i++) if (Sim.type[i] === ID[key] && (state === undefined || Sim.st[i] === state)) n++; return n; };
const maxT = () => { let m = 0; for (let i = 0; i < W * H; i++) m = Math.max(m, Sim.temp[i]); return Math.round(m); };
console.log('materials', MATS.length, 'elements', MATS.filter(m => m.z).length);
// every material can be painted and stepped
let bad = [];
for (const m of MATS) { if (m.id === 0 || m.special) continue; try { Sim.loadPreset('blank'); for (let y = 60; y < 70; y++) Sim.paint(120, y, 'brush', 3, m.id); run(20); for (let i = 0; i < W * H; i++) if (Number.isNaN(Sim.temp[i]) || Number.isNaN(Sim.P[i])) throw new Error('NaN'); } catch (e) { bad.push(m.key + ': ' + e.message); } }
console.log('paint+step all:', bad.length ? bad : 'ok');
const box = () => { Sim.loadPreset('blank'); Sim.fill(99, 110, 100, 145, 'wall'); Sim.fill(141, 110, 142, 145, 'wall'); };
// sodium + chlorine
box(); Sim.fill(101, 140, 140, 145, 'Na'); Sim.fill(101, 132, 140, 139, 'Cl'); run(300);
console.log('Na + Cl: salt', count('salt'), 'sodium left', count('Na'), 'chlorine left', count('Cl'));
// iron + fluorine vs gold + fluorine
box(); Sim.fill(101, 140, 120, 145, 'Fe'); Sim.fill(121, 140, 140, 145, 'Au'); Sim.fill(101, 132, 140, 139, 'F'); run(600);
console.log('F on iron/gold: salt', count('salt'), 'iron left', count('Fe'), 'of 120, gold left', count('Au'), 'of 120');
// caesium in water
box(); Sim.fill(101, 135, 140, 145, 'water'); Sim.fill(118, 115, 122, 119, 'Cs');
let pk = 0; for (let f = 0; f < 200; f++) { Sim.step(); pk = Math.max(pk, maxT()); }
console.log('Cs in water: caesium left', count('Cs'), 'peak temp', pk);
// rust
box(); Sim.fill(101, 144, 140, 145, 'Fe'); Sim.fill(101, 138, 140, 143, 'water'); run(3000);
console.log('iron under water 50s: rust', count('rust'), 'iron', count('Fe'));
// thermite on an iron part
box(); const plate = Sim.addBody(Sim.cellsRect(101, 140, 140, 142), ID.Fe); run(30);
Sim.fill(112, 130, 128, 139, 'thermite'); run(30);
console.log('thermite pile', count('thermite'));
for (let f = 0; f < 60; f++) { Sim.paint(120, 136, 'heat', 3); Sim.step(); }
let pkT = 0; for (let f = 0; f < 400; f++) { Sim.step(); if (f === 60) console.log('  1s in: thermite', count('thermite'), 'molten iron', count('Fe', Sim.LIQUID), 'plate cells', [...Sim.bodies.values()].map(b => b.occ.reduce((a, v) => a + v, 0)).join('+')); }
console.log('after lighting: thermite left', count('thermite'), 'molten iron', count('Fe', Sim.LIQUID), 'iron parts', Sim.bodies.size, 'cells', [...Sim.bodies.values()].map(b => b.occ.reduce((a, v) => a + v, 0)).join('+'), 'peak', maxT());
// oxygen-fed coal
for (const ox of [false, true]) { box(); Sim.fill(101, 140, 140, 145, 'C'); if (ox) Sim.fill(101, 120, 140, 139, 'O'); for (let x = 102; x < 140; x += 4) Sim.paint(x, 139, 'fire', 1); let p = 0; for (let f = 0; f < 200; f++) { Sim.step(); p = Math.max(p, maxT()); } console.log('coal', ox ? 'in oxygen' : 'in air', 'peak temp', p); }
// noble gases layer by weight
Sim.loadPreset('blank'); Sim.fill(99, 40, 100, 145, 'wall'); Sim.fill(141, 40, 142, 145, 'wall'); Sim.fill(99, 38, 142, 39, 'wall');
for (let y = 80; y < 110; y++) for (let x = 101; x < 141; x++) Sim.paint(x, y, 'brush', 0, (x + y) % 2 ? ID.He : ID.Xe);
run(900);
const yOf = key => { let s = 0, n = 0; for (let i = 0; i < W * H; i++) if (Sim.type[i] === ID[key]) { s += (i / W) | 0; n++; } return (s / n).toFixed(0); };
console.log('mean row: helium', yOf('He'), 'xenon', yOf('Xe'));
const t0 = Date.now(); Sim.loadPreset('forge'); run(300); console.log('ms/step', ((Date.now() - t0) / 300).toFixed(2));
