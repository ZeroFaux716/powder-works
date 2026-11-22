// Lists the game's chemical materials (elements, generated compounds, and the hand-made materials that are
// real substances) with what they are made of, for tools/gen_thermo.py.
//   node tools/dump_chem.mjs > tools/chem_materials.json
import { MATS, ID } from '../src/sim/materials.js';
import { CPD_INFO, ENEG, NEG_STATE, KNOWN_CPD, HYDROXIDE_KEY } from '../src/sim/chemdata.js';
import { METAL } from '../src/sim/tables.js';

const out = [];
const add = (m, comp, extra = {}) => out.push({ key: m.key, name: m.name, comp, melt: m.melt, boil: m.boil, ...extra });
const parse = f => { const c = {}; for (const [, el, n] of f.matchAll(/([A-Z][a-z]?)(\d*)/g)) c[el] = (c[el] || 0) + (+n || 1); return c; };

for (const m of MATS) if (m.z) add(m, { [m.sym]: 1 }, { element: true, en: ENEG[m.sym] ?? null, metal: !!METAL[m.id], dens: m.dens });
for (const [id, info] of Object.entries(CPD_INFO)) {
  const m = MATS[id], A = MATS[info.A].sym, B = MATS[info.B].sym;
  if (!m.key.startsWith('cpd_')) continue;                    // water, salt, rust and sand come below
  const comp = parse(m.key.slice(4));
  add(m, comp, { A, B, bonds: comp[B] * (NEG_STATE[B] || 1), dX: Math.abs((ENEG[B] ?? 0) - (ENEG[A] ?? 0)) });
}
for (const [f, key] of Object.entries(KNOWN_CPD)) add(MATS[ID[key]], parse(f), { known: f });
// hydroxides: one OH for each charge on the metal (group 1 metals one, group 2 two)
for (const [sym, key] of Object.entries(HYDROXIDE_KEY)) {
  const m = MATS[ID[key]], n = ['Ca', 'Sr', 'Ba', 'Mg', 'Ra'].includes(sym) ? 2 : 1;
  add(m, { [sym]: 1, O: n, H: n }, { hydroxide: true });
}
console.log(JSON.stringify(out));
