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
import { NE0, PAIR_A, PAIR_PRODUCT } from './chemdata.js';
import { ENERGY, GA, GB, RISE, SPEED, tbin } from './energy.js';
import { becomeCompound, need } from './reactions.js';
import { temp } from './flow.js';
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
export const meltOf = (i, t) => solute(i) ? meltWith(t, sx[i]) : MELT[t];
export const conductionFactor = i => solute(i) ? 1 / (1 + 10 * sx[i]) : 1;
// by mass, for showing: the solute's share of the cell's weight
export function massShare(i) {
  const s = solute(i);
  return s ? massOf(type[i], s, sx[i]) : 0;
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

// An element meeting an alloy cell (oxygen blown through molten cast iron) goes to whichever it can bond to more
// strongly, per atom of it: the dissolved element or the metal itself. That is the same energy comparison as
// swapping partners, and it is what makes steel: oxygen burns the carbon out of molten iron as carbon dioxide
// long before it starts on the iron. Returns true if it handled the meeting (even if nothing happened yet).
export function alloyReact(i, n) {
  let a, e;
  if (sx[n] > 0 && solute(n)) { a = n; e = i; } else if (sx[i] > 0 && solute(i)) { a = i; e = n; } else return false;
  const s = solute(a), E = type[e], h = type[a];
  if (E === s || E === h || !MATS[E].z || st[e] === NONE || st[e] === PART) return false;
  const kS = s * NE0 + E, pS = PAIR_PRODUCT[kS];
  if (!pS || !GB[pS]) return false;
  const T = temp[a] > temp[e] ? temp[a] : temp[e], k = tbin(T);
  const perE = (pid, giver) => PAIR_A[giver * NE0 + E] === giver ? GB[pid][k] : GA[pid][k];
  const gS = perE(pS, s);
  if (gS >= 0) return false;
  const pH = PAIR_PRODUCT[h * NE0 + E];
  if (pH && GB[pH] && perE(pH, h) <= gS) return false;          // the metal itself wins: the usual chemistry
  // the dissolved element wins: the meeting is its, at its bond's speed, slower the less of it there is
  if (Math.random() >= SPEED[pS][k] * Math.min(1, 5 * sx[a])) return true;
  const en = ENERGY[pS], sIsA = PAIR_A[kS] === s, use = sIsA ? en.x / en.y : en.y / en.x;
  setSolute(a, s, sx[a] - Math.min(sx[a], use));
  becomeCompound(e, pS, T, RISE[pS][k]);
  need[e] = 0;
  return true;
}

// Names for well-known alloys: labels only, the physics is the same for any mix. [metal, what is dissolved,
// share by mass from, to, name]. Anything else is named by its make-up ("Nickel with 12% copper").
const NAMED = [
  ['Fe', 'C', 0.0005, 0.021, 'Steel'], ['Fe', 'C', 0.021, 0.067, 'Cast iron'],
  ['Fe', 'Cr', 0.105, 0.3, 'Stainless steel'], ['Fe', 'Si', 0.01, 0.065, 'Silicon steel'],
  ['Cu', 'Zn', 0.05, 0.45, 'Brass'], ['Cu', 'Sn', 0.03, 0.35, 'Bronze'], ['Cu', 'Ni', 0.1, 0.45, 'Cupronickel'],
  ['Ag', 'Cu', 0.05, 0.1, 'Sterling silver'], ['Au', 'Ag', 0.2, 0.45, 'Electrum'], ['Ag', 'Au', 0.2, 0.5, 'Electrum'],
  ['Sn', 'Pb', 0.3, 0.5, 'Solder'], ['Pb', 'Sn', 0.3, 0.5, 'Solder'], ['Sn', 'Pb', 0.0, 0.15, 'Pewter'],
  ['Al', 'Cu', 0.02, 0.06, 'Duralumin'], ['Ni', 'Cr', 0.1, 0.3, 'Nichrome'],
];
export function alloyName(h, s, wt) {
  const hs = MATS[h].sym, ss = MATS[s].sym;
  if (hs === 'Hg') return 'Amalgam';
  for (const [a, b, lo, hi, name] of NAMED) if (a === hs && b === ss && wt >= lo && wt <= hi) return name;
  return MATS[h].name + ' with ' + pct(wt) + ' ' + MATS[s].name.toLowerCase();
}
export const pct = wt => (100 * wt < 0.95 ? (100 * wt).toFixed(1) : String(Math.round(100 * wt))) + '%';
// share by mass of s in host h at atom fraction x
export function massOf(h, s, x) {
  const ms = AMASS[MATS[s].sym] || 1, mh = AMASS[MATS[h].sym] || 1;
  return x * ms / (x * ms + (1 - x) * mh);
}
// the melting point of host h with atom fraction x of something dissolved
export function meltWith(h, x) {
  if (!x) return MELT[h];
  const Tm = MELT[h] + 273.15;
  return MELT[h] - Math.min(0.6 * Tm, 0.904 * Tm * x);
}
