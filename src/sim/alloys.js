// Alloys and other mixtures: a cell can hold one dissolved material (sol, sx in grid.js).
//
// Mixing is physics, not recipes. Mixing two liquids always lowers the Gibbs energy (it is pure entropy,
// -T dS_mix), so molten metals that touch blend, and what is dissolved spreads between touching molten cells of
// the same metal. A few non-metals (carbon, silicon, phosphorus, sulfur, boron, nitrogen) dissolve in molten
// metal too, up to a limit; carbon in molten iron, for one, tops out at about a fifth of the atoms. Solids keep
// what they froze with: diffusion in a solid is far too slow to matter here.
//
// What is dissolved lowers the melting point by the ideal-solution law, dT = R Tm^2 x / dHfus, with the heat of
// melting from Richards' rule (dHfus = 9.2 Tm J/mol), so dT = 0.904 Tm x. For iron with a sixth of its atoms
// carbon (about 4% by mass) that gives about 1260 °C, near cast iron's real 1150 °C. It also cuts heat
// conduction, as impurities scatter the electrons that carry heat in a metal (steel conducts about two thirds as
// well as iron, brass a quarter as well as copper).
import { GAS, LIQUID, NONE, PART, POWDER, STATIC, W, H } from './constants.js';
import { MATS, ID } from './materials.js';
import { MELT, METAL } from './tables.js';
import { AMASS } from './chemdata.js';
import { clearCell, sh, sol, st, stamp, sx, taken, type } from './grid.js';
import { cur } from './world.js';

const NONMETAL_LIMIT = { C: 0.2, Si: 0.2, P: 0.1, S: 0.1, B: 0.1, N: 0.05 };
export const METAL_LIMIT = 0.5;             // beyond half, the other metal would be the host
const SPREAD = 0.5;                         // how far toward even two touching molten cells get each time
const DISSOLVE_CHANCE = 0.1, DISSOLVE_STEP = 0.1;
const NB = [-1, 1, -W, W];

// what is dissolved in cell i (0: nothing), and how much
export const solute = i => sx[i] > 0 && sh[i] === type[i] ? sol[i] : 0;
export function setSolute(i, s, x) {
  if (!s || x <= 1e-5) { sx[i] = 0; return; }
  sol[i] = s; sx[i] = x; sh[i] = type[i];
}
// how much of material s can dissolve in molten metal h, as a fraction of the atoms
export function limitOf(h, s) {
  if (!METAL[h] || s === h) return 0;
  const m = MATS[s];
  if (!m.z) return 0;
  if (METAL[s]) return METAL_LIMIT;
  return NONMETAL_LIMIT[m.sym] || 0;
}
export function meltOf(i, t) {
  const s = solute(i);
  if (!s) return MELT[t];
  const Tm = MELT[t] + 273.15;
  return MELT[t] - Math.min(0.6 * Tm, 0.904 * Tm * sx[i]);
}
export const conductionFactor = i => solute(i) ? 1 / (1 + 10 * sx[i]) : 1;
// by mass, for showing: the solute's share of the cell's weight
export function massShare(i) {
  const s = solute(i);
  if (!s) return 0;
  const ms = AMASS[MATS[s].sym] || 1, mh = AMASS[MATS[type[i]].sym] || 1, x = sx[i];
  return x * ms / (x * ms + (1 - x) * mh);
}

// A molten metal cell mixes with a neighbour: evens out what is dissolved with molten cells of the same metal,
// or takes in some of a touching element. Does not use up the cell's turn.
export function mix(i, x, y, t) {
  const k = (Math.random() * 4) | 0;
  if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) return;
  const n = i + NB[k], tn = type[n], sn = st[n];
  if (sn === NONE || sn === GAS || sn === PART) return;
  const a = solute(i);
  if (tn === t) {
    if (sn !== LIQUID) return;
    const b = solute(n);
    if (!a && !b) return;
    if (a && b && a !== b) return;                 // one dissolved material to a cell
    const s = a || b, xi = a ? sx[i] : 0, xn = b ? sx[n] : 0;
    const d = (xn - xi) * SPREAD * 0.5;
    if (d > -1e-5 && d < 1e-5) return;
    setSolute(i, s, xi + d); setSolute(n, s, xn - d);
    return;
  }
  // dissolving a touching element, a bit at a time, while there is room for it
  if (a && a !== tn) return;
  const lim = limitOf(t, tn);
  if (!lim || Math.random() > DISSOLVE_CHANCE) return;
  const xi = a ? sx[i] : 0, x2 = (xi + DISSOLVE_STEP) / (1 + DISSOLVE_STEP);
  if (x2 > lim) return;
  setSolute(i, tn, x2);
  taken[n] += DISSOLVE_STEP;
  if (taken[n] >= 0.999) { clearCell(n); stamp[n] = cur; }
}
