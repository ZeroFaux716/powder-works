// Circuits: contacts, wire, switches, sensors, inverters, plugs, injectors, valves, heaters, pumps, electrodes.
import { DRAFT, GAS, H, LIQUID, N, NONE, NOTHING, P0, PART, SOL, STATIC, W } from './constants.js';
import { MATS } from './materials.js';
import { ACID_X, CPDI, FIRE, HYD, WALL } from './tables.js';
import { CONTACT, DIR_STEP, ELECTRODE, G, HEATER, INJECTOR, INJ_UNITS, INVERTER, PLUG, PUMP, SENSE_C, SENSE_P, SENSE_T, SWITCH, VALVE, aux, clearCell, ddir, dset, eq, eseen, fan, gate, lat, life, lit, ox, st, stamp, swap, type, valveGate } from './grid.js';
import { NB, burn, swapTo } from './reactions.js';
import { P, temp } from './flow.js';
import { cur } from './world.js';

export let egen = 0;
// ---------- electrics ----------
// A contact is live while a part is passing over it. Everything wired to a live contact is live,
// and a live spark plug fires. Wires can run through walls and do not get in the way of anything.
export function spark(c) {
  const x = c % W, y = (c / W) | 0;
  if (st[c] === NONE) { type[c] = FIRE; st[c] = GAS; aux[c] = NOTHING; life[c] = 3; lat[c] = 0; temp[c] = 1600; stamp[c] = cur; }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const n = ny * W + nx, sn = st[n];
    if (sn === NONE || sn === PART || sn === DRAFT) continue;
    if ((sn === GAS || sn === LIQUID) && temp[n] < 1200) temp[n] = 1200;   // the spark heats the gas around it enough to set off most mixtures
    const b = MATS[type[n]].burn;
    if (b && b.fast) burn(n);
  }
}
// A live injector takes whatever liquid or gas touches its line in the tank and sprays it from its open end.
// Fuel that can turn to vapour sprays as a fine mist of vapour; anything else goes over a cell at a time.
export const injSrc = [], injSeed = [];
// A gas in a tank does not have to drift onto the pickup: the injector draws on the whole tankful near it.
export const rseen = new Uint32Array(N);
export let rgen = 0;
export function reachGas(ox, oy) {
  // start from the gas the line touches, and from open space next to it in case the gas has drifted off
  const seeds = [];
  for (const c of injSrc) if (st[c] === GAS) seeds.push(c);
  for (const c of injSeed) if (Math.abs(c % W - ox) > 6 || Math.abs(((c / W) | 0) - oy) > 6) seeds.push(c);
  if (!seeds.length) return;
  rgen++;
  const q = [];
  for (const c of seeds) if (rseen[c] !== rgen) { rseen[c] = rgen; q.push(c); }
  let t = -1;
  for (let h = 0; h < q.length && q.length < 500; h++) {
    const c = q[h], x = c % W, y = (c / W) | 0;
    if (st[c] === GAS && type[c] !== FIRE && (t < 0 || type[c] === t)) { t = type[c]; injSrc.unshift(c); }
    for (let d = 0; d < 4; d++) {
      if ((d === 0 && x === 0) || (d === 1 && x === W - 1) || (d === 2 && y === 0) || (d === 3 && y === H - 1)) continue;
      const n = c + NB[d];
      if (rseen[n] === rgen || !(st[n] === GAS || st[n] === NONE)) continue;
      if (Math.abs(n % W - ox) <= 6 && Math.abs(((n / W) | 0) - oy) <= 6) continue;   // never reach round to the nozzle's side
      rseen[n] = rgen; q.push(n);
    }
  }
}
export function inject(o, rate) {
  const ox = o % W, oy = (o / W) | 0;
  for (let k = 0; k < rate && injSrc.length; k++) {
    let src = -1;
    while (injSrc.length) { const c = injSrc[injSrc.length - 1]; if (st[c] === LIQUID || st[c] === GAS) { src = c; break; } injSrc.pop(); }
    if (src < 0) return;
    let n = -1;
    for (let tries = 0; tries < 4 && n < 0; tries++) {
      const dx = (Math.random() * 15 | 0) - 7, dy = (Math.random() * 15 | 0) - 7;
      const nx = ox + dx, ny = oy + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H || st[ny * W + nx] !== NONE) continue;
      let clear = true;
      for (let q = 1; q < 6 && clear; q++) if (SOL[st[Math.round(oy + dy * q / 6) * W + Math.round(ox + dx * q / 6)]]) clear = false;
      if (clear) n = ny * W + nx;
    }
    if (n < 0) continue;
    const t = type[src], m = MATS[t];
    if (st[src] === LIQUID && m.vapor) {
      type[n] = t; st[n] = GAS; life[n] = INJ_UNITS; aux[n] = 0; lat[n] = 0; temp[n] = temp[src]; stamp[n] = cur;
      life[src] += INJ_UNITS;
      if (life[src] >= m.burn.units) { clearCell(src); injSrc.pop(); }
    } else {
      type[n] = t; st[n] = st[src]; life[n] = life[src]; aux[n] = aux[src]; lat[n] = lat[src]; temp[n] = temp[src]; stamp[n] = cur;
      P[n] = P[src] > 0 ? P[src] : P0;
      clearCell(src); injSrc.pop();
    }
  }
}
// A sensor is live while what it measures is at or past its setting, and passes power on while it is.
export function sensed(c) {
  const f = fan[c];
  if (f === SENSE_T) return temp[c] >= dset[c] * 10;
  if (f === SENSE_P) return (st[c] === NONE || st[c] === GAS) && P[c] * 10 >= dset[c];
  return st[c] !== NONE;   // touch: anything at all on it but air
}
export const invSeed = [], pumpOn = [];
// Nothing flows backwards through a pump, running or not: liquid cannot move against the way it faces.
export const DIR_X = [0, 1, -1, 0, 0], DIR_Y = [0, 0, 0, -1, 1];
export function backflow(a, b) {
  const fa = fan[a] === PUMP, fb = fan[b] === PUMP;
  if (!fa && !fb) return false;
  const dx = b % W - a % W, dy = ((b / W) | 0) - ((a / W) | 0);
  if (fb && dx * DIR_X[ddir[b]] + dy * DIR_Y[ddir[b]] < 0) return true;
  if (fa && dx * DIR_X[ddir[a]] + dy * DIR_Y[ddir[a]] < 0) return true;
  return false;
}
// A live pump takes liquid from behind it, or from its own cell, and pushes it on ahead: through whatever
// liquid already fills the pipe in front, to the nearest open space beyond (up a pipe, too).
export const pseen = new Uint32Array(N);
export let pgen = 0;
export const pq = new Int32Array(N);
export function pump(c) {
  const d = DIR_STEP[ddir[c] || 1], back = c - d, front = c + d;
  if (back < 0 || front < 0 || back >= N || front >= N) return;
  for (let k = 0; k < dset[c]; k++) {
    const src = st[c] === LIQUID ? c : st[back] === LIQUID ? back : -1;
    if (src < 0 || SOL[st[front]]) return;
    let dst = -1;
    if (st[front] === NONE || st[front] === GAS) dst = front;
    else if (st[front] === LIQUID) {
      pgen++;
      let h = 0, t = 0;
      pq[t++] = front; pseen[front] = pgen; pseen[c] = pgen; pseen[back] = pgen;
      while (h < t && t < 600 && dst < 0) {
        const p = pq[h++], x = p % W, y = (p / W) | 0;
        for (let q = 0; q < 4; q++) {
          if ((q === 0 && x === 0) || (q === 1 && x === W - 1) || (q === 2 && y === 0) || (q === 3 && y === H - 1)) continue;
          const n = p + NB[q];
          if (pseen[n] === pgen || fan[n] === PUMP) continue;
          pseen[n] = pgen;
          if (st[n] === NONE || st[n] === GAS) { dst = n; break; }
          if (st[n] === LIQUID) pq[t++] = n;
        }
      }
    }
    if (dst < 0) return;                      // nowhere for it to go: the pipe ahead is full and closed
    swap(src, dst);
    stamp[src] = cur; stamp[dst] = cur;
  }
}
// A live electrode splits a liquid compound touching it back into its elements: water into hydrogen and
// oxygen, molten salt into sodium and chlorine, an acid into hydrogen and the halogen.
export function electrolyse(c) {
  const x = c % W, y = (c / W) | 0;
  for (let k = -1; k < 4; k++) {
    let n = c;
    if (k >= 0) {
      if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
      n = c + NB[k];
    }
    if (st[n] !== LIQUID || Math.random() > 0.01) continue;
    const t = type[n];
    let A = 0, B = 0;
    if (ACID_X[t]) { A = HYD; B = ACID_X[t]; }
    else if (CPDI[t]) { A = CPDI[t].A; B = CPDI[t].B; }
    else continue;
    // each split gives off one of the two elements, in the proportions of the formula (water: two hydrogens to one oxygen)
    const T = temp[n], info = CPDI[t];
    const r = ACID_X[t] ? 1 : info.ratio, pA = 1 / (1 + r);
    swapTo(n, Math.random() < pA ? A : B, T);
    if (st[n] === GAS) P[n] = P0;
    return;
  }
}
export function electric() {
  egen++;
  // An inverter powers what is in front of it whenever what is behind it was not powered a moment ago.
  // (It reads the moment before, so one fed from its own output flips every frame.)
  invSeed.length = 0;
  for (let i = 0; i < N; i++) {
    if (fan[i] === INVERTER) {
      const d = DIR_STEP[ddir[i] || 1], back = i - d, front = i + d;
      // (a cell before this one has already been counted down from 5 this frame)
      if (back >= 0 && front >= 0 && back < N && front < N && lit[back] < (back < i ? 4 : 5) && fan[front] >= CONTACT && fan[front] !== INVERTER) invSeed.push(front);
    }
    if (lit[i]) lit[i]--;
  }
  for (let q = 0; q < N + invSeed.length; q++) {
    const i = q < N ? q : invSeed[q - N];
    if (eseen[i] === egen) continue;
    const f = fan[i];
    if (q < N && !((f === CONTACT && st[i] === PART) || (f === SWITCH && dset[i] > 0) || (f >= SENSE_T && f <= SENSE_C && sensed(i)))) continue;
    let head = 0, tail = 0, out = -1;
    injSrc.length = 0; injSeed.length = 0;
    eq[tail++] = i; eseen[i] = egen;
    while (head < tail) {
      const c = eq[head++], x = c % W, y = (c / W) | 0;
      lit[c] = 5;
      if (fan[c] === PLUG) spark(c);
      else if (fan[c] === HEATER) { const target = dset[c] * 10; temp[c] += (target - temp[c]) * 0.5; }   // holds whatever it is in at its setting, heating or cooling
      else if (fan[c] === SWITCH && dset[c] === 0) continue;   // an open switch passes nothing on
      else if (fan[c] >= SENSE_T && fan[c] <= SENSE_C && !sensed(c)) continue;   // nor does a sensor that is not tripped
      else if (fan[c] === INVERTER) continue;                  // an inverter's two sides are separate circuits
      else if (fan[c] === PUMP) pumpOn.push(c);
      else if (fan[c] === ELECTRODE) electrolyse(c);
      else if (fan[c] === INJECTOR) {
        if (st[c] === NONE || st[c] === GAS) {
          // only the open end of the line sprays, not a stretch of it that happens to cross open air
          let links = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if ((dx || dy) && nx >= 0 && nx < W && ny >= 0 && ny < H && fan[ny * W + nx] === INJECTOR) links++;
          }
          if (links <= 1) out = c;
        }
        for (let k = 0; k < 4; k++) {
          if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
          const n = c + NB[k];
          if ((st[n] === LIQUID || st[n] === GAS) && type[n] !== FIRE && fan[n] !== INJECTOR) injSrc.push(n);
          else if (st[n] === NONE && fan[n] !== INJECTOR) injSeed.push(n);
        }
      }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const n = ny * W + nx;
        if (eseen[n] !== egen && fan[n] >= CONTACT && fan[n] !== INVERTER) { eseen[n] = egen; eq[tail++] = n; }
      }
    }
    if (out >= 0 && injSrc.length) {
      // nothing is drawn from right by the nozzle: that is where the spray goes, not the tank
      const ox = out % W, oy = (out / W) | 0;
      for (let k = injSrc.length - 1; k >= 0; k--) { const c = injSrc[k]; if (Math.abs(c % W - ox) <= 3 && Math.abs(((c / W) | 0) - oy) <= 3) injSrc.splice(k, 1); }
      reachGas(ox, oy);
      inject(out, dset[out]);
    }
  }
  for (const c of pumpOn) pump(c);
  pumpOn.length = 0;
  // Valves are solid wall while unpowered and open while powered.
  for (let i = W; i < N - W; i++) {
    if (fan[i] !== VALVE) continue;
    const on = eseen[i] === egen && dset[i] > 0;
    if (on) gate[i] = valveGate(dset[i]);
    if (on && st[i] === STATIC && type[i] === WALL) {
      let p = 0, t = 0, o = 0, n = 0;
      for (let k = 0; k < 4; k++) { const j = i + NB[k]; if (st[j] === NONE) { p += P[j]; t += temp[j]; o += ox[j]; n++; } }
      type[i] = 0; st[i] = NONE; life[i] = 0; aux[i] = 0; lat[i] = 0;
      if (n) { P[i] = p / n; temp[i] = t / n; ox[i] = o / n; } else { P[i] = P0; ox[i] = 1; }
      G.groundDirty = true;
    } else if (!on && (st[i] === NONE || st[i] === GAS)) {
      // shutting: whatever gas was in the opening is pushed into the neighbour with the least pressure
      let j = -1;
      for (let k = 0; k < 4; k++) { const n = i + NB[k]; if ((st[n] === NONE || st[n] === GAS) && fan[n] !== VALVE && (j < 0 || P[n] < P[j])) j = n; }
      if (j >= 0) P[j] += P[i];
      type[i] = WALL; st[i] = STATIC; P[i] = 0; life[i] = 0; aux[i] = 0; lat[i] = 0; gate[i] = 1;
      G.groundDirty = true;
    }
  }
}
