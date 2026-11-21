global.planck = require('planck');
const fs = require('fs');
const Sim = new Function(fs.readFileSync(__dirname + '/../src/sim.js', 'utf8') + '\nreturn Sim;')();
const { W, H, S, ID } = Sim;
const V = planck.Vec2;
const run = n => { for (let f = 0; f < n; f++) Sim.step(); };
const count = (key, state) => { let n = 0; for (let i = 0; i < W * H; i++) if (Sim.type[i] === ID[key] && (state === undefined || Sim.st[i] === state)) n++; return n; };
const mean = (arr, x0, y0, x1, y1) => { let s = 0, n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; if (Sim.st[i] === 0) { s += arr[i]; n++; } } return n ? s / n : NaN; };
// 1. squeeze sealed air to a fifth of its volume
Sim.loadPreset('blank');
Sim.fill(99, 99, 161, 101, 'wall'); Sim.fill(99, 112, 161, 114, 'wall'); Sim.fill(99, 102, 101, 111, 'wall');
const pis = Sim.addBody(Sim.cellsRect(152, 102, 159, 111), ID.Fe);
Sim.makeJoint('slider', pis, null, V(156 * S, 107 * S), V(1, 0));
run(10);
const g = Sim.grab(pis, 156, 107);
for (let f = 1; f <= 40; f++) { g.setTarget(V((156 - f) * S, 107 * S)); Sim.step(); }
const face = Math.round(pis.b.getPosition().x / S - 4);
const ratio = 50 / (face - 102);
console.log('compression: volume ratio', ratio.toFixed(2), 'P', mean(Sim.P, 102, 102, face - 1, 111).toFixed(2), '(adiabatic ideal', Math.pow(ratio, 1.4).toFixed(2) + ')', 'gas T', mean(Sim.temp, 102, 102, face - 1, 111).toFixed(0), '(ideal', (293 * Math.pow(ratio, 0.4) - 273).toFixed(0) + ')');
run(300);
console.log('  held 5s: P', mean(Sim.P, 102, 102, face - 1, 111).toFixed(2), 'gas T', mean(Sim.temp, 102, 102, face - 1, 111).toFixed(0));
for (let f = 1; f <= 40; f++) { g.setTarget(V((116 + f) * S, 107 * S)); Sim.step(); }
run(20);
const face2 = Math.round(pis.b.getPosition().x / S - 4);
console.log('  let back out: P', mean(Sim.P, 102, 102, face2 - 1, 111).toFixed(2), 'gas T', mean(Sim.temp, 102, 102, face2 - 1, 111).toFixed(0), '(colder than room: expansion after the heat leaked away)');
// 2. heat a sealed box of air
Sim.loadPreset('blank'); Sim.fill(99, 99, 121, 121, 'wall'); Sim.fill(101, 101, 119, 119, null);
for (let f = 0; f < 60; f++) { Sim.paint(110, 110, 'heat', 8); Sim.step(); }
const T2 = mean(Sim.temp, 101, 101, 119, 119), P2 = mean(Sim.P, 101, 101, 119, 119);
console.log('heated sealed air: T', T2.toFixed(0), 'P', P2.toFixed(2), '(gas law says', ((T2 + 273) / 293).toFixed(2) + ')');
// 3. vent a pressurised tank
Sim.loadPreset('blank'); Sim.fill(99, 99, 141, 131, 'wall'); Sim.fill(100, 100, 140, 130, null);
for (let f = 0; f < 80; f++) { for (let y = 100; y <= 130; y++) for (let x = 100; x <= 140; x++) { const i = y * W + x; Sim.P[i] *= 1.02; } Sim.step(); }
run(900);
console.log('tank pumped up and left to cool: P', mean(Sim.P, 100, 100, 140, 130).toFixed(2), 'T', mean(Sim.temp, 100, 100, 140, 130).toFixed(0));
Sim.fill(141, 114, 141, 116, null); run(40);
console.log('  after venting: P', mean(Sim.P, 100, 100, 140, 130).toFixed(2), 'T', mean(Sim.temp, 100, 100, 140, 130).toFixed(0));
// 4. heat capacity: same flame under lead, iron and water
Sim.loadPreset('blank');
['Pb', 'Fe', 'water'].forEach((k, n) => { const x = 80 + n * 30; Sim.fill(x - 1, 120, x + 10, 131, 'wall'); Sim.fill(x, 120, x + 9, 129, k); Sim.fill(x, 130, x + 9, 131, 'Cu'); });
for (let f = 0; f < 600; f++) { for (let n = 0; n < 3; n++) Sim.paint(85 + n * 30, 134, 'fire', 4); Sim.step(); }
const blockT = x => { let s = 0, n = 0; for (let y = 120; y <= 129; y++) for (let xx = x; xx <= x + 9; xx++) { s += Sim.temp[y * W + xx]; n++; } return (s / n).toFixed(0); };
console.log('10s over the same flame: lead', blockT(80), 'iron', blockT(110), 'water', blockT(140), '| molten lead', count('Pb', Sim.LIQUID), 'steam', count('water', Sim.GAS));
// 5. latent heat: ice in warm air holds at zero while it melts
Sim.loadPreset('blank'); Sim.fill(100, 136, 119, 145, 'water');
for (let i = 0; i < W * H; i++) if (Sim.type[i] === ID.water) { Sim.temp[i] = -20; Sim.st[i] = Sim.STATIC; }
const log = [];
for (let f = 1; f <= 1800; f++) { Sim.paint(110, 132, 'fire', 3); Sim.step(); if (f % 300 === 0) log.push('ice ' + count('water', Sim.STATIC) + ' water ' + count('water', Sim.LIQUID) + ' steam ' + count('water', Sim.GAS)); }
console.log('ice under a flame, every 5s:', log.join(' | '));
// 6. diesel hammer
Sim.loadPreset('diesel');
const ram = [...Sim.bodies.values()][0];
let lit = -1, lowest = 0, peakP = 0, peakT = 0, highestAfter = 999;
for (let f = 1; f <= 600; f++) {
  Sim.step();
  const y = ram.b.getPosition().y / S + 15;
  lowest = Math.max(lowest, y);
  const p = Sim.P[130 * W + 118] , t = Sim.temp[130 * W + 118];
  if (Sim.st[130 * W + 118] === 0) { peakP = Math.max(peakP, p); peakT = Math.max(peakT, t); }
  if (lit < 0 && count('fire') > 0) lit = f;
  if (lit > 0) highestAfter = Math.min(highestAfter, y);
}
console.log('diesel hammer: ram bottom reached row', lowest.toFixed(1), '(fuel at 136), peak P', peakP.toFixed(1), 'peak air T', peakT.toFixed(0), 'ignited at frame', lit, 'thrown back up to row', highestAfter.toFixed(1), 'fuel left', count('gasoline'));
