// Shared bits for the self-checking tests. Importing this first replaces Math.random with a seeded
// generator, so every run of a check sees the same dice rolls and gives the same numbers.
import './seed.js';   // must come first: it seeds Math.random before the simulation loads
export { reseed } from './seed.js';

import * as planck from 'planck';
import { Sim } from '../../src/sim/index.js';
export { Sim, planck };
export const { W, H, S, ID, MATS } = Sim;
export const V = planck.Vec2;

export const run = frames => { for (let f = 0; f < frames; f++) Sim.step(); };
export const secs = s => run(Math.round(s * 60));

// how many cells of a material (by key) there are, optionally only in one state or inside a rectangle
export function count(key, { state, box } = {}) {
  const id = ID[key]; let n = 0;
  const [x0, y0, x1, y1] = box || [0, 0, W - 1, H - 1];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    if (Sim.type[i] === id && Sim.st[i] && (state === undefined || Sim.st[i] === state)) n++;
  }
  return n;
}
// counts of everything inside a rectangle, by material key (walls left out)
export function tally(x0, y0, x1, y1) {
  const c = {};
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    if (!Sim.st[i] || Sim.type[i] === ID.wall) continue;
    const k = MATS[Sim.type[i]].key; c[k] = (c[k] || 0) + 1;
  }
  return c;
}
export const parts = () => [...Sim.bodies.values()];
export const cells = body => body.occ.reduce((a, v) => a + v, 0);
// a walled box on a blank bench, inside x0..x1, y0..y1
export function box(x0, y0, x1, y1) {
  Sim.loadPreset('blank');
  Sim.fill(x0 - 2, y0 - 2, x0 - 1, y1 + 2, 'wall'); Sim.fill(x1 + 1, y0 - 2, x1 + 2, y1 + 2, 'wall');
  Sim.fill(x0 - 2, y0 - 2, x1 + 2, y0 - 1, 'wall'); Sim.fill(x0 - 2, y1 + 1, x1 + 2, y1 + 2, 'wall');
}
// a device painted at one cell, as the toolbar does
export const dev = (x, y, tool, setting, dir) => { if (dir) Sim.setPaintDir(dir); Sim.paint(x, y, tool, 0, setting); };
export const press = (x, y, on = 1) => { for (let q = y; q <= y + 1; q++) for (let p = x; p <= x + 1; p++) Sim.dset[q * W + p] = on; };
