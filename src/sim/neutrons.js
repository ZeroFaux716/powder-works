// Free neutrons, fission and radioactive decay.
import { GAS, H, NONE, PART, STATIC, W } from './constants.js';
import { MATS } from './materials.js';
import { ABSF, ABST, BREED, FISF, FIST, HE, MODV, NUV, SCAT, SFV, WASTE, stateAt } from './tables.js';
import { G, aux, life, ox, st, stamp, type } from './grid.js';
import { temp } from './flow.js';
import { cur } from './world.js';

// ---------- neutrons ----------
// Neutrons are not cells: they fly straight through the grid and only sometimes hit what they cross.
export const MAXN = 6000, FIS_HEAT = 80;
export const nX = new Float32Array(MAXN), nY = new Float32Array(MAXN), nDX = new Float32Array(MAXN), nDY = new Float32Array(MAXN);
export const nFast = new Uint8Array(MAXN), nLife = new Uint16Array(MAXN);

export function emit(x, y, fast) {
  if (G.nCount >= MAXN) return;
  const a = Math.random() * 6.2832, n = G.nCount++;
  nX[n] = x + 0.5; nY[n] = y + 0.5; nDX[n] = Math.cos(a); nDY[n] = Math.sin(a);
  nFast[n] = fast ? 1 : 0; nLife[n] = 900;
}

export function fission(i, x, y, t, s) {
  temp[i] += FIS_HEAT;
  let k = NUV[t] | 0;
  if (Math.random() < NUV[t] - k) k++;
  for (; k > 0; k--) emit(x, y, true);
  if (s !== PART && Math.random() < 0.003) {
    // the split atom is now fission waste
    type[i] = WASTE; life[i] = 0;
    const ns = s === GAS ? GAS : stateAt(MATS[WASTE], temp[i]);
    if (ns !== s && (ns === STATIC || s === STATIC)) G.groundDirty = true;
    st[i] = ns;
  }
}

export function stepNeutrons() {
  for (let n = G.nCount - 1; n >= 0; n--) {
    let alive = --nLife[n] > 0;
    for (let q = nFast[n] ? 2 : 1; q > 0 && alive; q--) {
      const ox = nX[n] | 0, oy = nY[n] | 0;
      nX[n] += nDX[n]; nY[n] += nDY[n];
      const x = Math.floor(nX[n]), y = Math.floor(nY[n]);
      if (x < 0 || x >= W || y < 0 || y >= H) { alive = false; break; }
      if (x === ox && y === oy) continue;
      const i = y * W + x, s = st[i];
      if (s === NONE) continue;
      const t = type[i], thin = s === GAS ? 0.02 : 1, fast = nFast[n];
      // hot fuel is a little less willing to fission
      const pf = (fast ? FISF[t] : FIST[t]) * thin / (1 + temp[i] / 800);
      if (pf > 0 && Math.random() < pf) { fission(i, x, y, t, s); alive = false; break; }
      const pa = (fast ? ABSF[t] : ABST[t]) * thin;
      if (pa > 0 && Math.random() < pa) {
        if (BREED[t] && s !== PART) {
          type[i] = BREED[t];
          const ns = stateAt(MATS[BREED[t]], temp[i]);
          if (ns !== s && (ns === STATIC || s === STATIC)) G.groundDirty = true;
          st[i] = ns;
        }
        alive = false; break;
      }
      if (Math.random() < SCAT[t] * thin) {
        const a = Math.random() * 6.2832;
        nDX[n] = Math.cos(a); nDY[n] = Math.sin(a);
        if (fast && Math.random() < MODV[t]) nFast[n] = 0;
      }
    }
    if (!alive) {
      const l = --G.nCount;
      nX[n] = nX[l]; nY[n] = nY[l]; nDX[n] = nDX[l]; nDY[n] = nDY[l]; nFast[n] = nFast[l]; nLife[n] = nLife[l];
    }
  }
}

// Decay heat, spontaneous fission and decay into the next element down the chain.
// Returns true if the cell changed into something else.
export function radiate(i, x, y, t, s) {
  const m = MATS[t];
  if (m.warm) temp[i] += m.warm;
  if (SFV[t] && Math.random() < SFV[t]) { temp[i] += FIS_HEAT; emit(x, y, true); emit(x, y, true); }
  const d = m.decay;
  if (!d || s === PART || Math.random() > d.p) return false;
  const to = d.into[d.into.length === 1 ? 0 : (Math.random() * d.into.length) | 0];
  type[i] = to; life[i] = 0; aux[i] = 0;
  temp[i] += d.q;
  const ns = stateAt(MATS[to], temp[i]);
  if (ns === STATIC || s === STATIC) G.groundDirty = true;
  st[i] = ns; stamp[i] = cur;
  if (d.alpha && Math.random() < 0.25) {
    // the alpha particle it threw off is a helium nucleus
    const j = y > 0 && st[i - W] === NONE ? i - W : x > 0 && st[i - 1] === NONE ? i - 1 : x < W - 1 && st[i + 1] === NONE ? i + 1 : -1;
    if (j >= 0) { type[j] = HE; st[j] = GAS; temp[j] = temp[i]; life[j] = 0; aux[j] = 0; stamp[j] = cur; }
  }
  return true;
}
