// Reaction bench: pairs of elements meeting in a sealed box, optionally heated.
import * as planck from 'planck';
import { Sim } from '../src/sim/index.js';
const { W, H, ID, MATS } = Sim;
function box(a, b, heat, secs, split) {
  Sim.loadPreset('blank');
  Sim.fill(60, 60, 61, 121, 'wall'); Sim.fill(180, 60, 181, 121, 'wall'); Sim.fill(60, 60, 181, 61, 'wall'); Sim.fill(60, 120, 181, 121, 'wall');
  // a fills the bottom, b the space above it
  const sp = split || 100;
  Sim.fill(62, sp, 179, 119, a);
  Sim.fill(62, 62, 179, sp - 1, b);
  if (heat) for (let y = 62; y <= 119; y++) for (let x = 62; x <= 179; x++) Sim.temp[y * W + x] = heat;
  const count = () => { const c = {}; for (let y = 62; y <= 119; y++) for (let x = 62; x <= 179; x++) { const i = y * W + x; if (Sim.st[i] === 0) continue; const m = MATS[Sim.type[i]]; const k = m.sym || m.name; c[k] = (c[k] || 0) + 1; } return c; };
  const before = count();
  let maxT = 0;
  for (let f = 0; f < secs * 60; f++) { Sim.step(); if (f % 10 === 0) for (let i = 0; i < W * H; i++) if (Sim.temp[i] > maxT && Sim.st[i]) maxT = Sim.temp[i]; }
  const after = count();
  const fmt = c => Object.entries(c).sort((p, q) => q[1] - p[1]).slice(0, 6).map(([k, v]) => k + ' ' + v).join(', ');
  console.log((a + ' + ' + b + (heat ? ' at ' + heat + ' °C' : '')).padEnd(26), '| before:', fmt(before), '| after ' + secs + 's:', fmt(after), '| hottest', Math.round(maxT));
}
box('Na', 'Cl', 0, 4);
box('K', 'Br', 0, 4);
box('Mg', 'Cl', 0, 4);
box('Al', 'I', 0, 4);
box('Fe', 'S', 0, 3, 90);
box('Fe', 'S', 900, 4, 90);
box('Cu', 'O', 900, 4);
box('Zn', 'O', 800, 4);
box('H', 'Cl', 700, 3);
box('Mg', 'N', 900, 4);
box('Xe', 'F', 0, 3);
box('Al', 'O', 0, 3);
box('Ag', 'O', 900, 3);
