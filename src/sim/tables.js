// Per-material lookup tables built from the finished material list, and the nuclear data.
import { GAS, LIQUID, POWDER, STATIC } from './constants.js';
import { ID, MATS } from './materials.js';
import { ACID_KEY, CPD_INFO, ENEG, HYDROXIDE_KEY, NE0, PAIR_PRODUCT, isMetal } from './chemdata.js';

export const WALL = ID.wall, FIRE = ID.fire, SMOKE = ID.smoke, WATER = ID.water, FE = ID.Fe, AL = ID.Al, OX = ID.O, RUST = ID.rust, SALT = ID.salt;
export const NM = MATS.length;
export const MELT = new Float32Array(NM), BOIL = new Float32Array(NM), IGN = new Float32Array(NM);
export const CAPS = new Float32Array(NM), LF = new Float32Array(NM), LV = new Float32Array(NM), GASP = new Float32Array(NM), SOLIDST = new Uint8Array(NM);
export const PARTRX = new Uint8Array(NM), NOCOND = new Uint8Array(NM);
// How strongly the boiling point moves with pressure (Clausius-Clapeyron with Trouton's rule): 1 / Trouton's
// constant in units of R. About 1/10.5 for most liquids; water, held together by hydrogen bonds, is 1/13.1.
// Fuels are left at a fixed boiling point: their vapour is tuned for engines and the refinery as it is.
export const TROUT = new Float32Array(NM);
export const HALV = new Float32Array(NM), REACTV = new Float32Array(NM), RX = new Uint8Array(NM);
export const CONDS = new Float32Array(NM), CONDG = new Float32Array(NM), DENS = new Float32Array(NM), LIFT = new Int8Array(NM);
for (const m of MATS) {
  const locked = m.fixed || m.special;
  MELT[m.id] = locked ? 1e9 : m.melt;
  BOIL[m.id] = locked ? 1e9 : Math.max(m.boil, m.melt + 1);
  CAPS[m.id] = m.cap;
  // Latent heat: the energy soaked up by melting and by boiling, as "degrees of heating this material" times its
  // heat capacity. Where no figure is given it follows the usual rules of thumb: about a third of the melting
  // point (in kelvin) for metals, and about three times the boiling point for a metal to vaporise.
  m.lfDeg = m.lf !== undefined ? m.lf : Math.round((m.soft ? 0.25 : 0.36) * (m.melt + 273));
  m.lvDeg = m.lv !== undefined ? m.lv : Math.round((m.soft ? 1.2 : 3) * (m.boil + 273));
  LF[m.id] = locked ? 1e9 : m.lfDeg * m.cap;
  LV[m.id] = locked ? 1e9 : m.lvDeg * m.cap;
  GASP[m.id] = m.gasP;
  TROUT[m.id] = locked || m.vapor ? 0 : 1 / (m.trouton || 10.5);
  SOLIDST[m.id] = m.powder ? POWDER : STATIC;
  IGN[m.id] = m.burn ? m.burn.at : 1e9;
  CONDS[m.id] = m.cond !== undefined ? m.cond : 0.04 + 0.18 * Math.min(1, Math.log10(1 + m.k) / 2.604);
  CONDG[m.id] = m.special === 'fire' ? 0.1 : 0.01;      // gases pass heat on slowly; an open flame is the exception
  DENS[m.id] = m.dens;
  LIFT[m.id] = m.lift;
  HALV[m.id] = m.hal || 0;
  NOCOND[m.id] = m.vapor ? 1 : 0;
  PARTRX[m.id] = (m.burn && !m.burn.fast && !m.burn.self) || m.wet || m.key === 'Fe' ? 1 : 0;
  REACTV[m.id] = m.react || 0;
  RX[m.id] = m.id === FE ? 1 : 0;
}
export const CHEMV = new Uint8Array(NM), CPDI = new Array(NM).fill(null);
for (let k = 0; k < NE0 * NE0; k++) if (PAIR_PRODUCT[k]) CHEMV[(k / NE0) | 0] = 1;
for (const id in CPD_INFO) CPDI[id] = CPD_INFO[id];
export const OXIDE_OF = new Uint16Array(NM);
for (const m of MATS) if (m.z && m.burn && !m.burn.fast && isMetal(m) && PAIR_PRODUCT[m.id * NE0 + OX]) OXIDE_OF[m.id] = PAIR_PRODUCT[m.id * NE0 + OX];
// ---------- chemistry, second step: compounds reacting with a third substance ----------
// Water and the reactive metals give a hydroxide (lye) and hydrogen. Hydrogen halides dissolve in water as
// acids. Acids eat metals that are more reactive than hydrogen, giving the metal's salt and hydrogen, and turn
// bases and metal oxides into the salt and water. A metal that holds the other element harder takes it from a
// compound and frees the first metal (aluminium with rust is thermite). Carbon at furnace heat and hot hydrogen
// strip the oxygen from the less reactive metals' oxides, which is how ores are smelted.
export const ENV = new Float32Array(NM).fill(NaN), METAL = new Uint8Array(NM);
for (const m of MATS) if (m.z) { if (ENEG[m.key] !== undefined) ENV[m.id] = ENEG[m.key]; METAL[m.id] = isMetal(m) ? 1 : 0; }
export const HYDROXIDE = new Uint16Array(NM), BASE_METAL = new Uint16Array(NM), ACID_OF = new Uint16Array(NM), ACID_X = new Uint16Array(NM);
for (const k in HYDROXIDE_KEY) { HYDROXIDE[ID[k]] = ID[HYDROXIDE_KEY[k]]; BASE_METAL[ID[HYDROXIDE_KEY[k]]] = ID[k]; }
for (const X in ACID_KEY) { const hx = PAIR_PRODUCT[ID.H * NE0 + ID[X]]; if (hx) ACID_OF[hx] = ID[ACID_KEY[X]]; ACID_X[ID[ACID_KEY[X]]] = ID[X]; }
export const CARBON = ID.C, HYD = ID.H;

// ---------- nuclear behaviour ----------
// Chances are per cell a neutron passes through. fisF/fisT: fission by a fast/slow neutron, nu: neutrons
// released, sf: spontaneous fission per frame, absF/absT: swallows the neutron, scat: bounces it,
// mod: a bounce also slows it down, breed: capturing a neutron turns it into this, warm: deg C per frame of decay heat.
export const NUC = {
  U: { fisF: 0.03, fisT: 0.3, nu: 2.5, sf: 0.00002 },
  Pu: { fisF: 0.1, fisT: 0.3, nu: 3, sf: 0.0002, warm: 0.25 },
  Np: { fisF: 0.02, fisT: 0.02, nu: 2.5 },
  Am: { fisF: 0.02, fisT: 0.05, nu: 3, warm: 0.1 },
  Cm: { fisF: 0.04, fisT: 0.1, nu: 3, sf: 0.0005 },
  Cf: { fisF: 0.05, fisT: 0.2, nu: 3.7, sf: 0.01 },
  Th: { absF: 0.02, absT: 0.08, breed: 'U' },
  B: { absF: 0.08, absT: 0.5 }, Cd: { absF: 0.03, absT: 0.6 }, Gd: { absF: 0.03, absT: 0.8 }, Hf: { absF: 0.05, absT: 0.3 },
  Xe: { absT: 0.4 }, In: { absT: 0.2 }, Ag: { absT: 0.15 }, Li: { absT: 0.15 },
  water: { scat: 0.35, mod: 0.5, absT: 0.004 }, gasoline: { scat: 0.3, mod: 0.4, absT: 0.004 },
  C: { scat: 0.3, mod: 0.25 }, Be: { scat: 0.4, mod: 0.2 }, H: { scat: 0.3, mod: 0.6 }
};
// Decay: [half-life in game seconds, what it becomes, heat released in deg C]. Real half-lives run from
// microseconds to millennia, so these are squeezed onto a scale you can watch. Uranium and thorium last
// billions of years and do not decay here.
export const DECAY = {
  Pm: [120, 'Nd', 150], Po: [45, 'Pb', 600], At: [8, 'Bi', 400], Rn: [20, 'Po', 300], Fr: [6, 'Ra', 300], Ra: [180, 'Rn', 300],
  Ac: [90, 'Ra', 300], Pa: [240, 'Ac', 300], Am: [300, 'Np', 300], Cm: [60, 'Pu', 400], Bk: [40, 'Cf', 200], Cf: [50, 'Cm', 400],
  Es: [15, 'Bk', 300], Fm: [10, 'Cf', 300], Md: [8, 'Es', 300], No: [5, 'Fm', 300], Lr: [5, 'Md', 300],
  waste: [120, ['Zr', 'Mo', 'Ba', 'Ce', 'Nd', 'Xe', 'Cs', 'Sr'], 200]
};
export const FISF = new Float32Array(NM), FIST = new Float32Array(NM), NUV = new Float32Array(NM), SFV = new Float32Array(NM);
export const ABSF = new Float32Array(NM), ABST = new Float32Array(NM), SCAT = new Float32Array(NM), MODV = new Float32Array(NM);
export const BREED = new Uint16Array(NM), RAD = new Uint8Array(NM);
export const BYZ = [];
for (const m of MATS) if (m.z) BYZ[m.z] = m;
for (const m of MATS) {
  const n = NUC[m.key] || {};
  m.nuc = NUC[m.key] || null;
  FISF[m.id] = n.fisF || 0; FIST[m.id] = n.fisT || 0; NUV[m.id] = n.nu || 0; SFV[m.id] = n.sf || 0;
  ABSF[m.id] = n.absF || 0; ABST[m.id] = n.absT || 0;
  SCAT[m.id] = n.scat !== undefined ? n.scat : m.id === 0 || m.special ? 0 : 0.08;
  MODV[m.id] = n.mod || 0;
  BREED[m.id] = n.breed ? ID[n.breed] : 0;
  if (n.warm) m.warm = n.warm;
  let d = DECAY[m.key];
  // the superheavy elements shed an alpha particle within seconds and step two places down the table
  if (!d && m.z >= 104) d = [2 + m.z % 3, BYZ[m.z - 2].key, 300];
  if (d) {
    const into = (Array.isArray(d[1]) ? d[1] : [d[1]]).map(k => ID[k]);
    m.decay = { half: d[0], p: Math.LN2 / (d[0] * 60), into, q: d[2], alpha: m.z > 82 && MATS[into[0]].z === m.z - 2 };
  }
  RAD[m.id] = m.warm || SFV[m.id] || m.decay ? 1 : 0;
}
export const WASTE = ID.waste, HE = ID.He;

export function stateAt(m, T) {
  if (m.fixed) return STATIC;
  if (m.special) return GAS;
  return T < m.melt ? (m.powder ? POWDER : STATIC) : T < m.boil ? LIQUID : GAS;
}
