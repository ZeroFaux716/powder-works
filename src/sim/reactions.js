// Changes of state, burning, chemistry, distilling and condensing, water and metals.
import { CAPG, DRAFT, FLAME_GAIN, GAS, H, LIQUID, N, NONE, NOTHING, P0, PART, SOL, STATIC, W } from './constants.js';
import { ID, MATS } from './materials.js';
import { CRUDE_CUTS, NE0, PAIR_A, PAIR_PRODUCT, PAIR_RATIO, TAR } from './chemdata.js';
import { BREAK, DROP, FORM, RISE, swapChance, swapHeat, tbin } from './energy.js';
import { alloyReact, meltOf } from './alloys.js';
import { ACID_OF, ACID_X, BASE_METAL, BOIL, CAPS, CARBON, CPDI, ENV, FIRE, GASP, HYD, HYDROXIDE, LF, LV, MELT, METAL, NOCOND, OX, OXIDE_OF, RUST, SOLIDST, TROUT, WATER, stateAt } from './tables.js';
import { sx, G, LP, Pref, aux, bid, bodies, clearCell, lat, life, lit, open, ox, st, stamp, type } from './grid.js';
import { P, temp } from './flow.js';
import { cur } from './world.js';

// The boiling point at pressure p: higher under pressure (water boils at about 120 °C at 2 atm and 180 °C at
// 10 atm, which is what lets a boiler hold a steady pressure), lower in a vacuum.
export function boilAt(t, p) {
  const b = BOIL[t], k = TROUT[t];
  if (k === 0 || (p > 0.98 && p < 1.02)) return b;
  const r = p < 0.02 ? 0.02 : p > 200 ? 200 : p;
  return (b + 273.15) / (1 - k * Math.log(r / P0)) - 273.15;
}

export function phase(i, t, s) {
  const T = temp[i];
  if (s === GAS) {
    const b = boilAt(t, P[i]);
    if (T < b) {
      if (NOCOND[t]) return GAS;                   // vapour thinned out in air stays vapour
      lat[i] += (b - T) * CAPG; temp[i] = b;
      if (lat[i] >= LV[t]) { lat[i] = 0; P[i] = Math.max(0, P[i] - GASP[t]); Pref[i] = P[i]; return LIQUID; }
    } else if (lat[i] > 0) {
      const d = Math.min(lat[i], (T - b) * CAPG);
      lat[i] -= d; temp[i] = T - d / CAPG;
    }
    return GAS;
  }
  const c = CAPS[t];
  if (s === LIQUID) {
    const b = boilAt(t, P[i] + LP[i]), m = meltOf(i, t);
    if (T > b) {
      if (lat[i] < 0) lat[i] = 0;
      lat[i] += (T - b) * c; temp[i] = b;
      if (lat[i] >= LV[t]) { lat[i] = 0; P[i] += GASP[t]; Pref[i] = P[i]; return GAS; }
    } else if (T < m) {
      if (lat[i] > 0) lat[i] = 0;
      lat[i] -= (m - T) * c; temp[i] = m;
      if (lat[i] <= -LF[t]) { lat[i] = 0; return SOLIDST[t]; }
    } else if (lat[i] > 0) {
      const d = Math.min(lat[i], (b - T) * c);
      lat[i] -= d; temp[i] = T + d / c;
    } else if (lat[i] < 0) {
      const d = Math.min(-lat[i], (T - m) * c);
      lat[i] += d; temp[i] = T - d / c;
    }
    return LIQUID;
  }
  const m = meltOf(i, t);
  if (T > m) {
    lat[i] += (T - m) * c; temp[i] = m;
    if (lat[i] >= LF[t]) { lat[i] = 0; return LIQUID; }
  } else if (lat[i] > 0) {
    const d = Math.min(lat[i], (m - T) * c);
    lat[i] -= d; temp[i] = T + d / c;
  }
  return s;
}

// Fast fuels (gasoline, hydrogen) burn only with oxygen. Empty space is air, and each cell of air
// holds oxygen in proportion to its density, so squeezed air burns more fuel. The air a fuel cell
// burns with is used up: it flashes to flame, its pressure jumps, and it is left as burnt gas, which
// nothing can burn in until fresh air replaces it. A cell of liquid gasoline holds 8 units of fuel and each unit needs one cell
// of ordinary air. Liquid burns from its surface a couple of units at a time; vapour goes at once.
// Returns false if there was no air to burn with.
export function burn(i) {
  const t = type[i], b = MATS[t].burn, s = st[i];
  const full = b.units || 1;
  const content = s === GAS ? (life[i] > 0 ? life[i] : 1) : full - life[i];
  if (content <= 0) { clearCell(i); return false; }
  const want = s === GAS ? content : Math.min(content, 2);
  const per = b.o2 || 1;
  let need = want * per;
  const x = i % W, y = (i / W) | 0;
  for (let r = 1; r <= 2 && need > 0.01; r++) {
    for (let dy = -r; dy <= r && need > 0.01; dy++) for (let dx = -r; dx <= r; dx++) {
      if ((dx < 0 ? -dx : dx) !== r && (dy < 0 ? -dy : dy) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const c = ny * W + nx, sc = st[c];
      let rich;
      if (sc === NONE) rich = ox[c]; else if (sc === GAS && type[c] === OX) rich = 3; else continue;
      if (r === 2 && SOL[st[i + Math.sign(dx) + Math.sign(dy) * W]]) continue;    // not through a wall
      // how much oxygen is in the cell: its density, which is pressure over temperature (hot air is thin)
      const o = P[c] * 293 / (temp[c] + 273) * rich;
      if (o < 0.05) continue;
      const used = o < need ? o : need;
      need -= used;
      P[c] += FLAME_GAIN * used;
      if (sc === NONE) ox[c] *= 1 - used / o;        // that share of the cell's air is now burnt gas
      type[c] = FIRE; st[c] = GAS; aux[c] = NOTHING; lat[c] = 0;
      life[c] = 4 + (Math.random() * 8 | 0);
      const h = b.heat + (rich > 1 ? 800 : 0);
      if (temp[c] < h) temp[c] = h;
      stamp[c] = cur;
      if (need <= 0.01) break;
    }
  }
  const burned = want - (need > 0 ? need : 0) / per;
  if (burned < 0.05) return false;
  const left = content - burned;
  if (left < 0.3) {
    if (s === STATIC) G.groundDirty = true;
    aux[i] = b.product ? ID[b.product] : NOTHING;
    lat[i] = 0;
    type[i] = FIRE; st[i] = GAS;
    life[i] = (b.life || 6) + (Math.random() * 6 | 0);
    if (temp[i] < b.heat) temp[i] = b.heat;
    stamp[i] = cur;
  } else if (s === GAS) life[i] = Math.max(1, Math.round(left));
  else life[i] = Math.min(full - 1, Math.round(full - left));
  return true;
}

// A part cell that has burned, dissolved or corroded is no longer part of its part.
export const fk = new Int32Array(N);       // for a part cell: which of its part's own cells it is
export function detach(i) {
  const rb = bodies.get(bid[i]);
  if (rb) { rb.occ[fk[i]] = 0; rb.dirty = true; }
  bid[i] = 0;
}

// What a flame does to the cell next to it. Returns true if it found oxygen to feed on.
export function fireTouch(n, flameT) {
  const s = st[n];
  if (s === NONE) return false;
  if (s === PART) {
    // a part made of something that burns can be lit by a flame hot enough
    const pb = MATS[type[n]].burn;
    if (pb && !pb.fast && !pb.self && flameT >= pb.at && temp[n] < pb.at + 60 && Math.random() < 0.08) temp[n] = pb.at + 60;
    return false;
  }
  if (type[n] === OX && s === GAS) {
    if (Math.random() < 0.5) clearCell(n);
    return true;
  }
  const b = MATS[type[n]].burn;
  if (!b) return false;
  if (b.fast) { if (Math.random() < 0.5) burn(n); }
  else if (flameT >= b.at && temp[n] < b.at + 60 && Math.random() < 0.08) temp[n] = b.self ? b.heat : b.at + 60;   // the flame has to be hot enough
  return false;
}

// A spent flame can still light what it touches, but has no fuel to feed on oxygen with.
export function fireTouchLit(n, flameT) {
  const s = st[n];
  if (s === NONE || (type[n] === OX && s === GAS)) return;
  fireTouch(n, flameT);
}
// Reactions between neighbours, by chemical family:
//   halogens attack metals and leave salt, faster for fluorine and for the more reactive metals
//   iron rusts slowly in water and burns to rust in hot oxygen
export const NB = [-1, 1, -W, W];
export function react(i, x, y, t, s) {
  // iron rusts slowly in water (with oxygen, iron burns to the same oxide through the general chemistry)
  for (let k = 0; k < 4; k++) {
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = i + NB[k];
    if (type[n] === WATER && st[n] === LIQUID && Math.random() < 0.0004) {
      if (s === STATIC) G.groundDirty = true;
      type[i] = RUST; st[i] = stateAt(MATS[RUST], temp[i]); stamp[i] = cur;
      return true;
    }
  }
  return false;
}

// ---------- chemistry at work ----------
// need: how much more of one of its two elements a freshly made compound cell still takes in to match its
// formula (positive: more of the electron-taker, B; negative: more of the giver, A). One cell of each element
// meets one cell of the other, and the compound keeps drawing in neighbours until the proportions are right.
export const need = new Float32Array(N);
export const made = new Set();                  // compounds that have formed since the page opened
export function chemSkip(ia, ib) {
  // burning in air and oxygen already has its own, more detailed rules
  return ib === OX && MATS[ia].burn;
}
export function becomeCompound(c, pid, T, heat) {
  if (st[c] === PART) detach(c);
  if (st[c] === STATIC) G.groundDirty = true;
  type[c] = pid; life[c] = 0; aux[c] = 0; lat[c] = 0;
  temp[c] = T + heat;
  st[c] = stateAt(MATS[pid], temp[c]);
  if (st[c] === GAS && P[c] < P0) P[c] = P0;
  stamp[c] = cur;
  if (!made.has(pid)) { made.add(pid); G.madeNews = pid; }
  const x = c % W, y = (c / W) | 0, warm = temp[c] * 0.6, R = st[c] === GAS ? 2 : 1;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const nx = x + dx, ny = y + dy;
    if ((dx || dy) && nx >= 0 && nx < W && ny >= 0 && ny < H) { const n = ny * W + nx; if ((st[n] !== NONE || R === 2) && !MATS[type[n]].fixed && !SOL[st[n]] && temp[n] < warm) temp[n] = warm; else if (st[n] !== NONE && SOL[st[n]] && !MATS[type[n]].fixed && temp[n] < warm) temp[n] = warm; }
  }
}
export function useUp(c) {
  if (st[c] === PART) detach(c);
  if (st[c] === STATIC) G.groundDirty = true;
  // a gas taken up into a solid leaves next to nothing behind: the pressure there drops and no fresh air appears
  if (st[c] === GAS) { P[c] *= 0.15; ox[c] = 0; }
  clearCell(c);
  stamp[c] = cur;
}
// a flash of flame where a strong reaction happens next to open space
export function flash(c, x, y, heat) {
  if (heat < 700) return;
  for (let k = 0; k < 4; k++) {
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = c + NB[k];
    if (st[n] === NONE) { type[n] = FIRE; st[n] = GAS; aux[n] = NOTHING; life[n] = 3 + (heat / 600 | 0); temp[n] = Math.min(2500, 400 + heat); lat[n] = 0; stamp[n] = cur; return; }
  }
}
export function chemReact(i, x, y, t) {
  const k0 = (Math.random() * 4) | 0;
  for (let q = 0; q < 4; q++) {
    const k = (k0 + q) & 3;
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = i + NB[k], tn = type[n], sn = st[n];
    if (sn === NONE || sn === DRAFT || tn >= NE0 || stamp[n] === cur) continue;
    if ((sx[n] > 0 || sx[i] > 0) && alloyReact(i, n)) return true;
    const pk = t * NE0 + tn, pid = PAIR_PRODUCT[pk];
    if (!pid) continue;
    const ia = PAIR_A[pk], ib = ia === t ? tn : t;
    if (chemSkip(ia, ib)) continue;
    const T = temp[i] > temp[n] ? temp[i] : temp[n];
    if (!(Math.random() < formChance(pk, pid, T))) continue;
    return combine(i, n, t, tn, pk, pid, ia);
  }
  // gases are thin: a gas reacts with a partner a couple of cells away as well
  if (st[i] === GAS) {
    const dx = ((Math.random() * 5) | 0) - 2, dy = ((Math.random() * 5) | 0) - 2;
    const nx = x + dx, ny = y + dy;
    if ((dx < -1 || dx > 1 || dy < -1 || dy > 1) && nx >= 0 && nx < W && ny >= 0 && ny < H) {
      const n = ny * W + nx, tn = type[n];
      const mid = (y + ny >> 1) * W + (x + nx >> 1);
      if (st[n] === GAS && tn < NE0 && stamp[n] !== cur && !SOL[st[mid]]) {
        const pk = t * NE0 + tn, pid = PAIR_PRODUCT[pk];
        if (pid) {
          const ia = PAIR_A[pk], ib = ia === t ? tn : t;
          const T = Math.max(temp[i], temp[n], temp[mid]);   // the air between them counts: a flame front heats it
          if (!chemSkip(ia, ib) && Math.random() < formChance(pk, pid, T)) return combine(i, n, t, tn, pk, pid, ia);
        }
      }
    }
  }
  return false;
}
// How likely two elements meeting at temperature T are to combine this frame (energy.js: only if it lowers the
// Gibbs energy, at the Arrhenius rate; a compound without energy data does not form)
export function formChance(pk, pid, T) {
  const f = FORM[pid];
  return f ? f[tbin(T)] : 0;
}
// the temperature rise of forming it, per atom-sized cell taking part
const riseAt = (pk, pid, T) => RISE[pid] ? RISE[pid][tbin(T)] : 0;
export function combine(i, n, t, tn, pk, pid, ia) {
  // the compound forms in the place of the element it has more atoms of; the other cell is used up
  const r = PAIR_RATIO[pk];
  const cA = ia === t ? i : n, cB = ia === t ? n : i;
  const keep = r >= 1 ? cA : cB, gone = keep === cA ? cB : cA;
  const T0 = Math.max(temp[cA], temp[cB]), heat = riseAt(pk, pid, T0);
  useUp(gone);
  becomeCompound(keep, pid, T0, heat);
  need[keep] = r >= 1 ? r - 1 : -(1 / r - 1);
  flash(keep, keep % W, (keep / W) | 0, heat);
  return true;
}
export function swapTo(c, id, T) {
  if (st[c] === PART) detach(c);
  if (st[c] === STATIC) G.groundDirty = true;
  type[c] = id; life[c] = 0; aux[c] = 0; lat[c] = 0; need[c] = 0;
  temp[c] = T; st[c] = stateAt(MATS[id], T);
  if (st[c] === GAS && P[c] < P0) P[c] = P0;
  stamp[c] = cur;
  if (MATS[id].gen && !made.has(id)) { made.add(id); G.madeNews = id; }
}
export function cpdReact(i, x, y, t) {
  const X = ACID_X[t], info = CPDI[t];
  const k0 = (Math.random() * 4) | 0;
  for (let q = 0; q < 4; q++) {
    const k = (k0 + q) & 3;
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = i + NB[k], sn = st[n];
    if (sn === NONE || sn === DRAFT || stamp[n] === cur) continue;
    const tn = type[n], T = temp[i] > temp[n] ? temp[i] : temp[n];
    if (X) {
      // an acid eats away a metal more reactive than hydrogen: hydrogen bubbles off where the metal was,
      // and the metal's salt comes out of the acid (so the next bit of metal is bare to the acid again)
      if (METAL[tn] && ENV[tn] < 1.85) {
        const salt = PAIR_PRODUCT[tn * NE0 + X];
        if (salt && Math.random() < Math.min(0.2, Math.max(0.003, (1.9 - ENV[tn]) * 0.15))) {
          swapTo(n, HYD, temp[n] + 60); P[n] += 1;
          if (Math.random() < 0.4) swapTo(i, salt, temp[i] + 60); else swapTo(i, WATER, temp[i] + 60);   // spent acid is mostly water
          return true;
        }
      }
      // and turns a base or a metal oxide into the salt and water
      const ci = CPDI[tn];
      const bm = BASE_METAL[tn] || (ci && ci.B === OX && METAL[ci.A] ? ci.A : 0);
      if (bm) {
        const salt = PAIR_PRODUCT[bm * NE0 + X];
        if (salt && Math.random() < 0.1) { swapTo(n, salt, temp[n] + 150); swapTo(i, WATER, temp[i] + 150); return true; }
      }
      continue;
    }
    if (!info) return false;
    // a hydrogen halide dissolves in water to make the acid
    if (ACID_OF[t] && tn === WATER && sn === LIQUID) { swapTo(n, ACID_OF[t], temp[n] + 40); useUp(i); return true; }
    if (tn >= NE0 || isNaN(ENV[tn])) continue;
    if (t === WATER && MATS[tn].wet) continue;      // (sodium and the like fizzing in water have their own rule)
    const A = info.A, B = info.B;
    // other compounds of hydrogen (the hydrogen halides) are left to the acid rules; water takes part, so hot
    // iron, zinc or carbon take the oxygen out of steam and set the hydrogen free, and fluorine frees oxygen
    if ((A === HYD && t !== WATER) || tn === A || tn === B) continue;
    // Swapping partners, by energy: the element takes over this compound's electron-taker (carbon smelting
    // iron oxide, aluminium in thermite, zinc taking chlorine from copper chloride, hydrogen stripping copper
    // oxide, iron in hot steam), or its electron-giver (chlorine driving bromine out of a bromide, oxygen roasting a sulfide),
    // when the compound it would make holds that element more tightly, per atom, than this one does.
    let to = 0, side = '', freed = 0;
    const kB = tn * NE0 + B, kA = A * NE0 + tn;
    if (PAIR_PRODUCT[kB] && PAIR_A[kB] === tn) { to = PAIR_PRODUCT[kB]; side = 'B'; freed = A; }
    else if (PAIR_PRODUCT[kA] && PAIR_A[kA] === A) { to = PAIR_PRODUCT[kA]; side = 'A'; freed = B; }
    if (!to || !(Math.random() < swapChance(t, to, side, T))) continue;
    const d = swapHeat(t, to, side, T);
    swapTo(n, to, T + d); swapTo(i, freed, T + d);
    return true;
  }
  return false;
}
// A compound short of one of its elements takes it in from a neighbour, and an unstable one falls apart when hot.
export function chemCompound(i, x, y, t, info) {
  const brk = BREAK[t];
  if (brk && Math.random() < brk[tbin(temp[i])]) {
    // back to its elements: this cell becomes the giver, and a free neighbour takes the other one if there is
    // room; falling apart takes back the heat that forming it gave off
    const T = Math.max(-200, temp[i] - DROP[t][tbin(temp[i])]);
    type[i] = info.A; life[i] = 0; aux[i] = 0; lat[i] = 0; need[i] = 0;
    st[i] = stateAt(MATS[info.A], T); stamp[i] = cur;
    for (let k = 0; k < 4; k++) {
      if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
      const n = i + NB[k];
      if (st[n] === NONE) { type[n] = info.B; st[n] = stateAt(MATS[info.B], T); temp[n] = T; life[n] = 0; aux[n] = 0; lat[n] = 0; stamp[n] = cur; break; }
    }
    return true;
  }
  const nd = need[i];
  if (nd === 0) return false;
  const want = nd > 0 ? info.B : info.A;
  for (let k = 0; k < 4; k++) {
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = i + NB[k];
    if (type[n] !== want || st[n] === NONE || st[n] === DRAFT || stamp[n] === cur) continue;
    useUp(n);
    if (RISE[t]) temp[i] += RISE[t][tbin(temp[i])];
    const left = nd > 0 ? nd - 1 : nd + 1;
    need[i] = (nd > 0 ? left > 0.01 : left < -0.01) ? left : 0;
    if (st[i] !== PART) st[i] = stateAt(MATS[t], temp[i]);
    return true;
  }
  return false;
}

// Crude oil gives off each of its fractions once it is hot enough for that one to boil, lightest first,
// and what is left once they have all gone is tar.
export function distill(i, x, y) {
  let k = 0, sum = 0;
  for (; k < CRUDE_CUTS.length; k++) { sum += CRUDE_CUTS[k][2]; if (life[i] < sum) break; }
  if (k === CRUDE_CUTS.length) {
    type[i] = TAR; st[i] = stateAt(MATS[TAR], temp[i]); life[i] = 0; stamp[i] = cur;
    if (st[i] === STATIC) G.groundDirty = true;
    return true;
  }
  const [key, at, size] = CRUDE_CUTS[k];
  // the hotter it is past the boiling point, the faster it boils, and boiling takes the heat away again:
  // so the crude sits at each fraction's boiling point until that fraction has gone
  if (temp[i] < at || Math.random() > 0.03 + (temp[i] - at) / 30) return false;
  // it boils into open space above it, bubbling up through the crude on top if it is not at the surface
  let a = -1;
  for (let q = i - W, n = 0; q >= 0 && n < 30; q -= W, n++) {
    if (st[q] === NONE) { a = q; break; }
    if (st[q] !== LIQUID) break;
  }
  if (a < 0) a = x > 0 && st[i - 1] === NONE ? i - 1 : x < W - 1 && st[i + 1] === NONE ? i + 1 : -1;
  if (a < 0) return false;
  // the whole of that fraction leaves as one cell of vapour: what is in a cell of crude is a lot of vapour
  const f = ID[key], units = sum - life[i];
  type[a] = f; st[a] = GAS; life[a] = key === 'lpg' ? 1 : units; aux[a] = 0; lat[a] = 0; temp[a] = temp[i]; stamp[a] = cur;
  P[a] += 0.6;                                    // boiling pushes the vapour out and up
  life[i] += units;
  temp[i] -= 20;                                  // boiling takes heat
  return true;
}
// Vapour only turns back to liquid where it is crowded against something cool, as in a condenser or up a
// column: a wisp of it out in the open air stays vapour. The liquid joins any drop of the same next to it.
export function condense(i, x, y, t, m) {
  // it condenses on a surface colder than its boiling point
  let open = 0, touch = 0, drop = -1;
  const b = BOIL[t];
  for (let k = 0; k < 4; k++) {
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = i + NB[k], sn = st[n];
    if (sn === NONE) open++;
    else if ((sn === LIQUID || SOL[sn]) && temp[n] < b) { touch++; if (sn === LIQUID && type[n] === t && life[n] > 0) drop = n; }
  }
  // out in the air it needs to be crowded; inside sealed equipment with no air in it, touching is enough
  if (!touch || Math.random() > 0.2) return false;
  if (open > 1) {
    for (let k = 0; k < 4; k++) { const n = i + NB[k]; if (n >= 0 && n < N && st[n] === NONE && ox[n] > 0.3) return false; }
  }
  const units = life[i] > 0 ? life[i] : 1, full = m.burn.units;
  if (temp[i] > b) temp[i] = b;                   // it comes off the surface at its boiling point
  if (drop >= 0) {
    const room = life[drop];
    if (units <= room) { life[drop] -= units; temp[drop] = (temp[drop] + temp[i]) / 2; clearCell(i); return true; }
    life[drop] = 0; life[i] = units - room;
  }
  st[i] = LIQUID; life[i] = full - (life[i] > 0 ? life[i] : 1); lat[i] = 0; stamp[i] = cur;
  P[i] = Math.max(0, P[i] - 0.2);
  return true;
}
// Drops of the same liquid fuel run together, so condensate collects into a proper pool.
export function pool(i, x, y, t, m) {
  const full = m.burn.units, mine = full - life[i];
  if (mine >= full) return false;
  const k = (Math.random() * 4) | 0;
  if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) return false;
  const n = i + NB[k];
  if (type[n] !== t || st[n] !== LIQUID || stamp[n] === cur) return false;
  const room = life[n];
  if (room <= 0) return false;
  if (mine <= room) { life[n] -= mine; clearCell(i); stamp[n] = cur; return true; }
  life[n] = 0; life[i] += room; stamp[n] = cur;
  return true;
}

// Slow fuels (coal, sulfur, magnesium) burn from the surface: they stay hot, throw off flame, and are eaten away.
export function smolder(i, x, y, m) {
  const b = m.burn;
  if (b.self) {
    // carries its own oxygen: burns buried, with no flame, straight to its product
    temp[i] = b.heat;
    for (let k = 0; k < 4; k++) {
      if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
      const n = i + NB[k];
      if (type[n] === type[i] && temp[n] < b.heat && Math.random() < 0.3) temp[n] = b.heat;   // the reaction front spreads by contact
    }
    if (Math.random() < b.rate) {
      type[i] = ID[b.product]; st[i] = stateAt(MATS[type[i]], b.heat); stamp[i] = cur;
      return true;
    }
    return false;
  }
  // it needs a neighbour it can draw oxygen from: fresh air (not burnt gas) or oxygen itself
  const breathes = n => (st[n] === NONE && ox[n] > 0.15) || (st[n] === GAS && type[n] === OX);
  let air = -1;
  if (y > 0 && breathes(i - W)) air = i - W;
  else {
    const side = Math.random() < 0.5 ? -1 : 1;
    if (x + side >= 0 && x + side < W && breathes(i + side)) air = i + side;
    else if (x - side >= 0 && x - side < W && breathes(i - side)) air = i - side;
    else if (y < H - 1 && breathes(i + W)) air = i + W;
  }
  if (air < 0) {
    // flame or smoke against the surface still counts as burning; buried fuel is smothered
    const lit = (y > 0 && type[i - W] === FIRE) || (x > 0 && type[i - 1] === FIRE) || (x < W - 1 && type[i + 1] === FIRE);
    if (!lit) return false;
  }
  let heat = b.heat;
  // pure oxygen against the surface makes it burn much hotter
  for (let k = 0; k < 4; k++) {
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = i + NB[k];
    if (type[n] === OX && st[n] === GAS) { heat += 800; if (Math.random() < 0.3) clearCell(n); break; }
  }
  if (temp[i] < heat) temp[i] = heat;              // a burning surface holds its flame temperature
  // it lights any slow fuel it is touching, provided it burns hot enough to
  for (let k = 0; k < 4; k++) {
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = i + NB[k], sn = st[n];
    if (sn === NONE) continue;
    const nb = MATS[type[n]].burn;
    if (nb && !nb.fast && b.heat >= nb.at && temp[n] < nb.at + 60 && Math.random() < 0.2) temp[n] = nb.self ? nb.heat : nb.at + 60;
  }
  if (air >= 0 && st[air] === NONE && Math.random() < 0.25) {
    type[air] = FIRE; st[air] = GAS; aux[air] = 0;
    life[air] = 8 + (Math.random() * 10 | 0);
    temp[air] = b.heat; stamp[air] = cur;
  }
  if (Math.random() < b.rate) {
    if (st[i] === STATIC) G.groundDirty = true;
    // a burning metal leaves its oxide behind as ash (magnesium burns to white magnesium oxide)
    const ash = OXIDE_OF[type[i]];
    type[i] = FIRE; st[i] = GAS; aux[i] = ash; life[i] = 10; stamp[i] = cur;
    if (ash && !made.has(ash)) { made.add(ash); G.madeNews = ash; }
    return true;
  }
  return false;
}

// Alkali metals in water: hydrogen and heat. Potassium runs hot enough to light the hydrogen.
export function wetReact(i, x, y, m) {
  let w = -1;
  if (y < H - 1 && type[i + W] === WATER && st[i + W] === LIQUID) w = i + W;
  else if (x > 0 && type[i - 1] === WATER && st[i - 1] === LIQUID) w = i - 1;
  else if (x < W - 1 && type[i + 1] === WATER && st[i + 1] === LIQUID) w = i + 1;
  else if (y > 0 && type[i - W] === WATER && st[i - W] === LIQUID) w = i - W;
  if (w < 0 || Math.random() > m.wet.p) return false;
  type[i] = ID.H; st[i] = GAS; life[i] = 0; aux[i] = 0;
  temp[i] = m.wet.gasTemp;
  P[i] += 2;
  temp[w] += 40;
  // the water it took the hydrogen from is left as the metal's hydroxide (lye)
  const oh = HYDROXIDE[m.id];
  if (oh && Math.random() < 0.5) swapTo(w, oh, temp[w]);
  else if (Math.random() < 0.3) clearCell(w);
  stamp[i] = cur;
  return true;
}
