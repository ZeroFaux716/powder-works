// Second-step chemistry bench: compounds meeting a third substance.
import * as planck from 'planck';
import { Sim } from '../../src/sim/index.js';
const { W, H, ID, MATS } = Sim;
function box(a, b, heat, secs, mix) {
  Sim.loadPreset('blank');
  Sim.fill(60, 60, 61, 121, 'wall'); Sim.fill(180, 60, 181, 121, 'wall'); Sim.fill(60, 60, 181, 61, 'wall'); Sim.fill(60, 120, 181, 121, 'wall');
  if (mix) {
    Sim.fill(62, 100, 179, 119, a);
    for (let y = 100; y <= 119; y++) for (let x = 62; x <= 179; x++) if ((x + y) % 2) { const i = y * W + x; Sim.type[i] = ID[b]; Sim.st[i] = Sim.st[i]; }
  } else { Sim.fill(62, 100, 179, 119, a); Sim.fill(62, 80, 179, 99, b); }
  if (heat) for (let y = 62; y <= 119; y++) for (let x = 62; x <= 179; x++) Sim.temp[y * W + x] = heat;
  const count = () => { const c = {}; for (let y = 62; y <= 119; y++) for (let x = 62; x <= 179; x++) { const i = y * W + x; if (Sim.st[i] === 0) continue; const m = MATS[Sim.type[i]]; const k = m.sym || m.name; c[k] = (c[k] || 0) + 1; } return c; };
  const fmt = c => Object.entries(c).sort((p, q) => q[1] - p[1]).slice(0, 6).map(([k, v]) => k + ' ' + v).join(', ');
  const before = fmt(count());
  for (let f = 0; f < secs * 60; f++) Sim.step();
  console.log((a + ' + ' + b + (heat ? ' at ' + heat + ' °C' : '') + (mix ? ' (mixed)' : '')).padEnd(34), '|', before, '->', fmt(count()));
}
box('Na', 'water', 0, 3);
box('Zn', 'acid_Cl', 0, 4);
box('Mg', 'acid_Cl', 0, 3);
box('Fe', 'acid_Cl', 0, 4);
box('Cu', 'acid_Cl', 0, 4);
box('oh_Na', 'acid_Cl', 0, 3);
box('rust', 'acid_Cl', 0, 4);
box('water', 'cpd_HCl', 0, 3);
box('rust', 'Al', 900, 3, true);
box('cpd_CuO', 'Mg', 600, 3, true);
box('rust', 'C', 1200, 4, true);
box('cpd_CuO', 'H', 450, 3);
box('cpd_CuCl2', 'Zn', 450, 3, true);
