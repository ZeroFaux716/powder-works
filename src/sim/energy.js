// Chemistry driven by energy. For every compound, from its enthalpy H(T) and Gibbs energy G(T) (thermo.gen.js,
// built from NASA's tables), this works out, at each temperature:
//   - whether it can form from its elements: only where that lowers the Gibbs energy (dG < 0), and whether it
//     falls back apart: where it raises it (dG > 0, as for mercury oxide above about 470 °C);
//   - how much heat forming it gives off: -dH, shared between the new cell and the cells around it;
//   - how fast it forms: Arrhenius' law, exp(-Ea / RT). The barrier Ea is the one calibrated part: it grows
//     with how tightly the electron-giver holds its electrons (its electronegativity: sodium gives them up to
//     chlorine cold, hydrogen needs a flame), plus one constant per electron-taker, fitted to the temperatures
//     at which known reactions get going (copper and iron oxidise from about 400 °C, iron and sulfur from
//     about 500 °C, fluorine attacks almost anything cold). How downhill a reaction is does not set its speed:
//     metals that give off more heat on oxidising do not start any sooner (their oxide skin slows them).
// Everything is tabulated in 50 °C steps when the game starts, so a reaction costs one lookup.
import { MATS } from './materials.js';
import { CPD_INFO, ENEG, KNOWN_CPD } from './chemdata.js';
import { THERMO, THERMO_T } from './thermo.gen.js';

const R = 8.314e-3;                     // kJ/mol K
export const TSTEP = 50, NT = 72;       // 0 to 3550 °C
export const tbin = T => { const b = (T / TSTEP) | 0; return b < 0 ? 0 : b >= NT ? NT - 1 : b; };

// the barrier, kJ/mol: EA_GIVER x electronegativity of the electron-giver + a constant for the electron-taker
const EA_GIVER = 45.7;
const EA_TAKER = { O: 15, Cl: -8, Br: 0, I: 20, At: 20, S: 35, Se: 35, Te: 35, F: -60, H: 46, N: 110, P: 40, As: 40, C: 190, Si: 190, B: 190 };
const PREFACTOR = 1e5;        // a barrier of 100 kJ/mol gets going (0.1% a frame) around 380 °C
const MAX_RATE = 0.5;
// The game's cells are not moles: the heat of a reaction is shared with the cells around it. This many °C per
// kJ/mol of each atom-sized cell taking part keeps flames in the range the rest of the game is tuned for
// (sodium chloride about 2000 °C, iron oxide about 1600 °C, iron sulfide about 500 °C; capped at 3200 °C).
export const HEAT_SCALE = 10;
const MAX_RISE = 3200;

function curve(key) {
  const row = THERMO[key];
  if (!row) return null;
  const n = THERMO_T.length;
  return { H: row.slice(1, 1 + n), G: row.slice(1 + n, 1 + 2 * n) };
}
function at(arr, T) {     // interpolate a table column at T (kelvin), flat beyond the ends
  const t = THERMO_T;
  if (T <= t[0]) return arr[0];
  for (let k = 0; k < t.length - 1; k++) if (T <= t[k + 1]) return arr[k] + (arr[k + 1] - arr[k]) * (T - t[k]) / (t[k + 1] - t[k]);
  return arr[t.length - 1];
}
const parse = f => { const c = {}; for (const [, el, n] of f.matchAll(/([A-Z][a-z]?)(\d*)/g)) c[el] = (c[el] || 0) + (+n || 1); return c; };

// per compound id: chance per attempt to form, temperature rise per atom-cell taken in, chance per frame to
// fall apart, and the temperature drop when it does; each NT entries long
export const FORM = {}, RISE = {}, BREAK = {}, DROP = {};
export const ENERGY = {};             // per compound id: { dH298, dG298, Ea, x, y, unstableAbove, neverForms }
for (const id in CPD_INFO) {
  const info = CPD_INFO[id], m = MATS[id], a = MATS[info.A], b = MATS[info.B];
  const c = curve(m.key), ca = curve(a.key), cb = curve(b.key);
  if (!c || !ca || !cb) continue;
  // the formula: in the key for generated compounds, from the known list for water, salt, rust and sand
  const known = Object.keys(KNOWN_CPD).find(f => KNOWN_CPD[f] === m.key);
  const comp = m.key.startsWith('cpd_') ? parse(m.key.slice(4)) : known ? parse(known) : null;
  const x = comp && comp[a.sym], y = comp && comp[b.sym];
  if (!x || !y) continue;
  const atoms = x + y;
  const dH = TK => at(c.H, TK) - x * at(ca.H, TK) - y * at(cb.H, TK);
  const dG = TK => at(c.G, TK) - x * at(ca.G, TK) - y * at(cb.G, TK);
  const Ea = Math.max(5, EA_GIVER * (ENEG[a.sym] ?? 1.5) + (EA_TAKER[b.sym] ?? 40));
  const form = new Float32Array(NT), rise = new Float32Array(NT), brk = new Float32Array(NT), drop = new Float32Array(NT);
  let unstableAbove = null;
  for (let k = 0; k < NT; k++) {
    const TK = k * TSTEP + TSTEP / 2 + 273.15, g = dG(TK), h = dH(TK);
    const perAtom = -h / atoms;                                           // kJ/mol per atom-cell
    if (g < 0) {
      form[k] = Math.min(MAX_RATE, PREFACTOR * Math.exp(-Ea / (R * TK)));
      rise[k] = Math.max(0, Math.min(MAX_RISE, perAtom * HEAT_SCALE));
    } else {
      if (unstableAbove === null && k > 0) unstableAbove = k * TSTEP;
      // falling apart: faster the further past the tipping point; takes back the heat forming it gave
      brk[k] = Math.min(0.05, 0.005 * g / atoms);
      drop[k] = Math.max(0, Math.min(MAX_RISE, perAtom * HEAT_SCALE));
    }
  }
  FORM[id] = form; RISE[id] = rise; BREAK[id] = brk; DROP[id] = drop;
  ENERGY[id] = { dH298: dH(298.15), dG298: dG(298.15), Ea, x, y, unstableAbove, neverForms: form.every(v => v === 0) };
}
