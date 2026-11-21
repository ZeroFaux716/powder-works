// refinery: temperatures up the column and where each fraction ends up
import * as planck from 'planck';
import { Sim } from '../src/sim/index.js';
const { W, H, ID, MATS } = Sim;
const secs = +(process.argv[3] || 60);
Sim.loadPreset('refinery');
const F = ['crude', 'lpg', 'gasoline', 'kerosene', 'diesel', 'tar'];
const region = (x0, y0, x1, y1) => { const c = {}; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; if (!Sim.st[i]) continue; const k = MATS[Sim.type[i]].key; if (F.includes(k)) { const kk = k + (Sim.st[i] === 4 ? '~' : ''); c[kk] = (c[kk] || 0) + 1; } } return Object.entries(c).map(([k, v]) => k + ' ' + v).join(', ') || '-'; };
const colT = () => { const o = []; for (let y = 24; y <= 94; y += 10) { let t = 0; for (let x = 56; x <= 64; x++) t += Sim.temp[y * W + x]; o.push('y' + y + ':' + Math.round(t / 9)); } return o.join(' '); };
for (let s = 1; s <= secs; s++) {
  for (let f = 0; f < 60; f++) Sim.step();
  if (s % 10 === 0) {
    let pt = 0, n = 0; for (let y = 98; y <= 125; y++) for (let x = 38; x <= 82; x++) { const i = y * W + x; if (Sim.type[i] === ID.crude) { pt += Sim.temp[i]; n++; } }
    console.log('t=' + s + 's pot crude ' + n + ' at ' + Math.round(pt / Math.max(1, n)) + ' °C | column ' + colT());
    console.log('   column: ' + region(56, 22, 64, 95) + ' | holder ' + region(42, 4, 78, 17) + ' | jars: top ' + region(94, 58, 99, 66) + ' | mid ' + region(108, 74, 113, 82) + ' | low ' + region(122, 86, 127, 94) + ' | pot ' + region(38, 98, 82, 125) + ' | outside ' + region(0, 0, 239, 19));
  }
}
