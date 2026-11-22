// Gas pressure and flow, liquids under pressure, heat flow, and moving air carrying heat.
import { AIR_COOL, AMBIENT, BULK, CAPG, DIFF, FAN_HEAD, FAN_TOP, FLOW_ROUNDS, GAS, H, KAPPA, KEEP_GAS, KEEP_LIQUID, KEEP_POWDER, KFLOW, KLIQ, LIQCAP, LIQUID, N, NONE, NOTHING, P0, POWDER, P_ITERS, SOL, W } from './constants.js';
import { CAPS, CONDG, CONDS, FIRE } from './tables.js';
import { sx, G, HDX, HDY, LP, Pref, aux, cnd, cpBuf, cpc, dpBuf, fan, gate, headFaces, kfBuf, lat, life, open, ox, pcap, smooth, st, stamp, stocked, type } from './grid.js';
import { NB } from './reactions.js';
import { cur, tick } from './world.js';
import { CSHIFT, CW, awake } from './sleep.js';
import { conductionFactor } from './alloys.js';

export let temp = new Float32Array(N).fill(AMBIENT);
export let temp2 = new Float32Array(N);
export let P = new Float32Array(N).fill(P0);
export let P2 = new Float32Array(N);
export let FX = new Float32Array(N);       // flow across each cell's right face, atm x cells per frame
export let FY = new Float32Array(N);       // same for the bottom face
export let GX = new Float32Array(N), GY = new Float32Array(N);
// ---------- pressure ----------
// Implicit diffusion along one run of open cells. Stable for any KFLOW, so pressure
// can cross a whole chamber in one frame while still only passing through real openings.
export const poBuf = new Float64Array(Math.max(W, H)), oxBuf = new Float64Array(Math.max(W, H));
// hasL / hasR: the cell before the run's first cell / after its last is open but asleep, so it is held at its
// pressure: flow still crosses that face, but the sleeping cell's pressure does not change this frame.
const kfAt = (i, j) => (st[i] === LIQUID || st[j] === LIQUID ? KLIQ : KFLOW) * (gate[i] < gate[j] ? gate[i] : gate[j]);
const onBorder = (cx, cy) => cx === 0 || cx === W - 1 || cy === 0 || cy === H - 1;
export function solveRun(start, stride, n, x, y, sx, sy, F, HD, hasL, hasR) {
  const last = start + (n - 1) * stride;
  const kfL = hasL && !onBorder(x, y) ? kfAt(start - stride, start) : 0;
  const kfR = hasR && !onBorder(x + sx * (n - 1), y + sy * (n - 1)) ? kfAt(last, last + stride) : 0;
  for (let k = 0; k < n; k++) { const idx = start + k * stride; oxBuf[k] = ox[idx]; poBuf[k] = P[idx] * pcap[idx]; }
  // kf[k] is how easily flow passes between cell k and cell k + 1 of the run
  for (let k = 0; k < n - 1; k++) {
    const idx = start + k * stride;
    const g = gate[idx] < gate[idx + stride] ? gate[idx] : gate[idx + stride];
    kfBuf[k] = (st[idx] === LIQUID || st[idx + stride] === LIQUID ? KLIQ : KFLOW) * g;
  }
  for (let k = 0; k < n; k++) {
    const cx = x + sx * k, cy = y + sy * k;
    let a, b, c, d;
    if (cx === 0 || cx === W - 1 || cy === 0 || cy === H - 1) { a = 0; b = 1; c = 0; d = P0; }
    else {
      const idx = start + k * stride, q = pcap[idx];
      a = k > 0 ? -kfBuf[k - 1] : 0; c = k < n - 1 ? -kfBuf[k] : 0; b = q - a - c;
      // what the flow already under way carries out of this cell, less what it carries in
      d = q * P[idx] - (F[idx] - (k > 0 ? F[idx - stride] : 0));
      // a fan across a face acts like an extra pressure difference there
      if (k < n - 1) d -= kfBuf[k] * HD[idx];
      if (k > 0) d += kfBuf[k - 1] * HD[idx - stride];
      if (k === 0 && kfL) { b += kfL; d += F[idx - stride] + kfL * (P[idx - stride] + HD[idx - stride]); }
      if (k === n - 1 && kfR) { b += kfR; d += kfR * (P[idx + stride] - HD[idx]); }
    }
    if (k === 0) { cpBuf[0] = c / b; dpBuf[0] = d / b; }
    else { const m = b - a * cpBuf[k - 1]; cpBuf[k] = c / m; dpBuf[k] = (d - a * dpBuf[k - 1]) / m; }
  }
  let v = dpBuf[n - 1];
  P[start + (n - 1) * stride] = v;
  for (let k = n - 2; k >= 0; k--) {
    const nv = dpBuf[k] - cpBuf[k] * v;
    F[start + k * stride] += kfBuf[k] * (nv - v + HD[start + k * stride]);  // the pressure difference (and any fan) speeds the flow up or slows it down
    v = nv;
    P[start + k * stride] = v;
  }
  if (kfL) F[start - stride] += kfL * (P[start - stride] - P[start] + HD[start - stride]);
  if (kfR) F[last] += kfR * (P[last] - P[last + stride] + HD[last]);
  // Fresh and burnt gas travel with the flow. Each cell ends up as a mix of what it held and what flowed in
  // (worked out implicitly, so fast flow through small cells cannot overshoot): one pass along the run
  // settles everything carried rightwards, a second pass back settles everything carried leftwards.
  let moving = false, mix = false;
  for (let k = 0; k < n - 1; k++) {
    const f = F[start + k * stride];
    if (f > 1e-3 || f < -1e-3) { moving = true; if (oxBuf[k] !== oxBuf[k + 1]) { mix = true; break; } }
  }
  if (!moving || !mix) return;          // nothing flowing, or all the same air: nothing changes
  for (let pass = 0; pass < 2; pass++) {
    for (let q = 0; q < n; q++) {
      const k = pass ? n - 1 - q : q, idx = start + k * stride;
      const fl = k > 0 ? F[idx - stride] : 0, fr = k < n - 1 ? F[idx] : 0;
      let m = poBuf[k], acc = m * oxBuf[k];
      if (fl > 0) { m += fl; acc += fl * ox[idx - stride]; }
      if (fr < 0) { m -= fr; acc -= fr * ox[idx + stride]; }
      if (m > 1e-6) ox[idx] = acc / m;
    }
  }
}
export function flowRows() {
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let x = 0;
    while (x < W) {
      if (!open[row + x]) { x++; continue; }
      let e = x; while (e + 1 < W && open[row + e + 1]) e++;
      // the awake stretches of this run, each held at the pressure of the sleeping cell beyond its ends
      const crow = (y >> CSHIFT) * CW;
      for (let s = x; s <= e;) {
        if (!awake[crow + (s >> CSHIFT)]) { s = ((s >> CSHIFT) + 1) << CSHIFT; continue; }
        let t = s; while (t + 1 <= e && awake[crow + ((t + 1) >> CSHIFT)]) t++;
        solveRun(row + s, 1, t - s + 1, s, y, 1, 0, FX, HDX, s > x, t < e);
        s = t + 1;
      }
      x = e + 1;
    }
  }
}
export function flowCols() {
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!open[y * W + x]) { y++; continue; }
      let e = y; while (e + 1 < H && open[(e + 1) * W + x]) e++;
      const ccol = x >> CSHIFT;
      for (let s = y; s <= e;) {
        if (!awake[(s >> CSHIFT) * CW + ccol]) { s = ((s >> CSHIFT) + 1) << CSHIFT; continue; }
        let t = s; while (t + 1 <= e && awake[((t + 1) >> CSHIFT) * CW + ccol]) t++;
        solveRun(s * W + x, W, t - s + 1, x, s, 0, 1, FY, HDY, s > y, t < e);
        s = t + 1;
      }
      y = e + 1;
    }
  }
}

// Flow has momentum. Each frame the moving gas carries its own motion along with it (so a jet keeps
// going and fast flow through a narrowing drops in pressure), loses a little to drag, and is zeroed
// wherever a wall or part is in the way. Fans add to it.
export function carryFlow() {
  for (let y = 0; y < H; y++) {
    const edgeY = y === 0 || y === H - 1;
    let i = y * W;
    const crow = (y >> CSHIFT) * CW;
    for (let x = 0; x < W; x++, i++) {
      if (!awake[crow + (x >> CSHIFT)]) { GX[i] = FX[i]; GY[i] = FY[i]; continue; }
      const oi = open[i];
      // right face, between i and i + 1
      if (!oi || x === W - 1 || !open[i + 1]) GX[i] = 0;
      else {
        let g = FX[i];
        const si = st[i], sj = st[i + 1];
        const keep = si === LIQUID || sj === LIQUID ? KEEP_LIQUID : si === POWDER || sj === POWDER ? KEEP_POWDER : KEEP_GAS;
        if (!edgeY && x > 0 && x < W - 2) {
          const pf = 0.5 * (P[i] + P[i + 1]), inv = 1 / (pf > 0.3 ? pf : 0.3);
          let ux = g * inv, uy = 0.25 * (FY[i] + FY[i + 1] + FY[i - W] + FY[i + 1 - W]) * inv;
          if (ux > 0.02 || ux < -0.02 || uy > 0.02 || uy < -0.02) {
            ux = ux > 12 ? 12 : ux < -12 ? -12 : ux; uy = uy > 12 ? 12 : uy < -12 ? -12 : uy;
            let sx = x - ux, sy = y - uy;
            sx = sx < 0 ? 0 : sx > W - 2.001 ? W - 2.001 : sx; sy = sy < 0 ? 0 : sy > H - 1.001 ? H - 1.001 : sy;
            const x0 = sx | 0, y0 = sy | 0, tx = sx - x0, ty = sy - y0, j = y0 * W + x0;
            g = (FX[j] * (1 - tx) + FX[j + 1] * tx) * (1 - ty) + (FX[j + W] * (1 - tx) + FX[j + W + 1] * tx) * ty;
          }
        }
        GX[i] = g * keep * (gate[i] < gate[i + 1] ? gate[i] : gate[i + 1]);
      }
      // bottom face, between i and i + W
      if (!oi || y === H - 1 || !open[i + W]) GY[i] = 0;
      else {
        let g = FY[i];
        const si = st[i], sj = st[i + W];
        const keep = si === LIQUID || sj === LIQUID ? KEEP_LIQUID : si === POWDER || sj === POWDER ? KEEP_POWDER : KEEP_GAS;
        if (y > 0 && y < H - 2 && x > 0 && x < W - 1) {
          const pf = 0.5 * (P[i] + P[i + W]), inv = 1 / (pf > 0.3 ? pf : 0.3);
          let uy = g * inv, ux = 0.25 * (FX[i] + FX[i - 1] + FX[i + W] + FX[i + W - 1]) * inv;
          if (ux > 0.02 || ux < -0.02 || uy > 0.02 || uy < -0.02) {
            ux = ux > 12 ? 12 : ux < -12 ? -12 : ux; uy = uy > 12 ? 12 : uy < -12 ? -12 : uy;
            let sx = x - ux, sy = y - uy;
            sx = sx < 0 ? 0 : sx > W - 1.001 ? W - 1.001 : sx; sy = sy < 0 ? 0 : sy > H - 2.001 ? H - 2.001 : sy;
            const x0 = sx | 0, y0 = sy | 0, tx = sx - x0, ty = sy - y0, j = y0 * W + x0;
            g = (FY[j] * (1 - tx) + FY[j + 1] * tx) * (1 - ty) + (FY[j + W] * (1 - tx) + FY[j + W + 1] * tx) * ty;
          }
        }
        GY[i] = g * keep * (gate[i] < gate[i + W] ? gate[i] : gate[i + W]);
      }
    }
  }
  let t = FX; FX = GX; GX = t;
  t = FY; FY = GY; GY = t;
  // Fans: a pressure jump across the face in front of each fan cell, fading out as the flow through it
  // nears the fan's top speed.
  for (const k of headFaces) { HDX[k] = 0; HDY[k] = 0; }
  headFaces.length = 0;
  for (let i = 0; i < N; i++) {
    const f = fan[i];
    if (!f || f > 4 || !open[i]) continue;
    const x = i % W, top = FAN_TOP * (P[i] > 0.3 ? P[i] : 0.3);
    let k = -1, sgn = 1, F = FX;
    if (f === 1) { if (x < W - 1 && open[i + 1]) k = i; }
    else if (f === 2) { if (x > 0 && open[i - 1]) { k = i - 1; sgn = -1; } }
    else if (f === 3) { if (i >= W && open[i - W]) { k = i - W; sgn = -1; F = FY; } }
    else if (i < N - W && open[i + W]) { k = i; F = FY; }
    if (k < 0) continue;
    const r = 1 - sgn * F[k] / top, h = FAN_HEAD * (r < 0 ? 0 : r > 1 ? 1 : r);
    if (F === FX) HDX[k] += sgn * h; else HDY[k] += sgn * h;
    headFaces.push(k);
  }
}
export function diffusePressure() {
  stocked.length = 0;
  for (let i = 0; i < N; i++) {
    const s = st[i];
    open[i] = SOL[s] ? 0 : 1;
    pcap[i] = s === LIQUID ? LIQCAP : 1;
    smooth[i] = open[i] && s !== LIQUID ? 1 : 0;
    if (s === LIQUID && aux[i]) stocked.push(i);
  }
  carryFlow();
  // Several rounds a frame. Each round can only pass a corner's worth of gas round a bend,
  // so one round alone throttles ports and passages far too much.
  for (let r = 0; r < FLOW_ROUNDS; r++) { if ((tick + r) & 1) { flowRows(); flowCols(); } else { flowCols(); flowRows(); } }
  for (let it = 0; it < P_ITERS; it++) {
    for (let y = 1; y < H - 1; y++) {
      let i = y * W + 1;
      const crow = (y >> CSHIFT) * CW;
      for (let x = 1; x < W - 1; x++, i++) {
        const p = P[i];
        if (!smooth[i] || !awake[crow + (x >> CSHIFT)]) { P2[i] = p; continue; }
        let acc = 0;
        if (smooth[i - 1]) acc += P[i - 1] - p;
        if (smooth[i + 1]) acc += P[i + 1] - p;
        if (smooth[i - W]) acc += P[i - W] - p;
        if (smooth[i + W]) acc += P[i + W] - p;
        P2[i] = p + DIFF * acc;
      }
    }
    // the border of the world is open air
    for (let x = 0; x < W; x++) { P2[x] = P0; P2[(H - 1) * W + x] = P0; }
    for (let y = 0; y < H; y++) { P2[y * W] = P0; P2[y * W + W - 1] = P0; }
    const t = P; P = P2; P2 = t;
  }
  // Gas that was squeezed this frame gets hotter, gas that expanded gets colder (adiabatic change).
  for (let i = 0; i < N; i++) {
    if (!open[i] || !awake[((i / W | 0) >> CSHIFT) * CW + ((i % W) >> CSHIFT)]) continue;
    let p = P[i];
    p = p > 200 ? 200 : p < 0 ? 0 : p;
    P[i] = p;
    const s = st[i], was = Pref[i];
    if ((s === NONE || s === GAS) && (type[i] !== FIRE || aux[i] === NOTHING) && was > 0.05 && p > 0.05) {
      let r = p / was;
      if (r > 1.0002 || r < 0.9998) {
        if (r > 2) r = 2; else if (r < 0.5) r = 0.5;
        const d = r - 1;
        const f = d < 0.03 && d > -0.03 ? 1 + KAPPA * d : Math.pow(r, KAPPA);
        const tk = (temp[i] + 273.15) * f - 273.15;
        temp[i] = tk > 6000 ? 6000 : tk;
      }
    }
    Pref[i] = p;
  }
}

// Liquid that a part pushes into with nowhere to go is squeezed into the liquid next to it.
// Each frame that squeezed-in liquid comes back out wherever the same body of liquid has room:
// the far end of a pipe, the other arm of a U-tube, the surface of a pool, the gap under a piston
// that has moved. What cannot get out raises the pressure of the whole trapped body evenly
// (Pascal's law), and that pressure pushes on every part the liquid touches.
export const bq = new Int32Array(N), bseen = new Uint32Array(N), spots = new Int32Array(256);
export let bgen = 0;
export function liquidPressure() {
  for (const i of G.lpCells) LP[i] = 0;
  G.lpCells = [];
  bgen++;
  for (const i0 of stocked) {
    if (bseen[i0] === bgen || st[i0] !== LIQUID) continue;
    let head = 0, tail = 0, nSpots = 0, stock = 0;
    bq[tail++] = i0; bseen[i0] = bgen;
    while (head < tail) {
      const i = bq[head++], x = i % W, y = (i / W) | 0;
      stock += aux[i];
      for (let k = 0; k < 4; k++) {
        if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
        const j = i + NB[k];
        if (bseen[j] === bgen) continue;
        bseen[j] = bgen;
        const s = st[j];
        if (s === LIQUID) bq[tail++] = j;
        else if (s === NONE && nSpots < 256) spots[nSpots++] = j;
      }
    }
    // let it back out into free space, nearest first
    let q = 0;
    for (let h = 0; h < tail && q < nSpots && stock > 0; h++) {
      const i = bq[h];
      while (aux[i] > 0 && q < nSpots) {
        const j = spots[q++];
        type[j] = type[i]; st[j] = LIQUID; temp[j] = temp[i]; life[j] = 0; aux[j] = 0; lat[j] = lat[i]; stamp[j] = cur;
        aux[i]--; stock--;
      }
    }
    if (stock > 0) {
      const extra = Math.min(150, BULK * stock / tail);
      for (let h = 0; h < tail; h++) { LP[bq[h]] = extra; G.lpCells.push(bq[h]); }
    }
  }
}

// Moving air takes its temperature with it: each cell of air becomes whatever air the flow
// brought there this frame.
export function advectAir() {
  let any = false;
  for (let y = 1; y < H - 1; y++) {
    let i = y * W + 1;
    const crow = (y >> CSHIFT) * CW;
    for (let x = 1; x < W - 1; x++, i++) {
      if (st[i] !== NONE || !awake[crow + (x >> CSHIFT)]) continue;
      const inv = 0.5 / (P[i] > 0.3 ? P[i] : 0.3);
      let ux = (FX[i - 1] + FX[i]) * inv, uy = (FY[i - W] + FY[i]) * inv;
      if (ux < 0.05 && ux > -0.05 && uy < 0.05 && uy > -0.05) continue;
      if (!any) { temp2.set(temp); any = true; }
      ux = ux > 8 ? 8 : ux < -8 ? -8 : ux; uy = uy > 8 ? 8 : uy < -8 ? -8 : uy;
      // where this air was a frame ago; the random part makes slow drifts add up correctly over time
      const sx = Math.floor(x + 0.5 - ux + Math.random() - 0.5), sy = Math.floor(y + 0.5 - uy + Math.random() - 0.5);
      if (sx < 0 || sx >= W || sy < 0 || sy >= H) { temp[i] = AMBIENT; continue; }
      const j = sy * W + sx;
      // only air swaps with air: smoke and steam carry their own heat as they move
      if (j !== i && st[j] === NONE) temp[i] = temp2[j];
    }
  }
  // burnt gas and fresh air mix where they meet, and the edge of the bench is always fresh
  for (let y = 1; y < H - 1; y++) {
    let i = y * W + 1;
    const crow = (y >> CSHIFT) * CW;
    for (let x = 1; x < W - 1; x++, i++) {
      if (st[i] !== NONE || !awake[crow + (x >> CSHIFT)]) continue;
      let sum = 0, n = 0;
      if (st[i - 1] === NONE) { sum += ox[i - 1]; n++; }
      if (st[i + 1] === NONE) { sum += ox[i + 1]; n++; }
      if (st[i - W] === NONE) { sum += ox[i - W]; n++; }
      if (st[i + W] === NONE) { sum += ox[i + W]; n++; }
      if (n) ox[i] += 0.03 * (sum / n - ox[i]);
    }
  }
  for (let x = 0; x < W; x++) { ox[x] = 1; ox[(H - 1) * W + x] = 1; }
  for (let y = 0; y < H; y++) { ox[y * W] = 1; ox[y * W + W - 1] = 1; }
}

// Which squares of gas or liquid connect to the edge of the world: the outside air, which can carry heat away.
// Air sealed inside a box, a cylinder or a boiler is not outdoors, so it only loses heat through its walls.
// Worked out by a flood fill from the edges every few frames (walls rarely change faster than that).
export const outdoors = new Uint32Array(N), outQ = new Int32Array(N);
export let outGen = 0;
export function findOutdoors() {
  outGen++;
  let head = 0, tail = 0;
  const seed = i => { if (outdoors[i] !== outGen && !SOL[st[i]]) { outdoors[i] = outGen; outQ[tail++] = i; } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 1; y < H - 1; y++) { seed(y * W); seed(y * W + W - 1); }
  while (head < tail) {
    const i = outQ[head++], x = i % W;
    if (x > 0) seed(i - 1);
    if (x < W - 1) seed(i + 1);
    if (i >= W) seed(i - W);
    if (i < N - W) seed(i + W);
  }
}

export function diffuseHeat() {
  if ((tick & 7) === 0 || outGen === 0) findOutdoors();
  // Heat flows between neighbours at the rate the worse conductor allows, and each cell warms by
  // the energy it received divided by its own heat capacity.
  for (let i = 0; i < N; i++) {
    const s = st[i], t = type[i];
    const c = s === NONE || s === GAS ? CAPG : CAPS[t];
    const k = s === GAS ? (t === FIRE && aux[i] === NOTHING ? 0.01 : CONDG[t]) : CONDS[t];
    cpc[i] = c;
    const ka = sx[i] > 0 ? k * conductionFactor(i) : k;   // (alloys conduct heat less well)
    cnd[i] = ka < c / 4.5 ? ka : c / 4.5;        // keeps the exchange stable for low-capacity cells
  }
  for (let y = 1; y < H - 1; y++) {
    let i = y * W + 1;
    const crow = (y >> CSHIFT) * CW;
    for (let x = 1; x < W - 1; x++, i++) {
      if (!awake[crow + (x >> CSHIFT)]) { temp2[i] = temp[i]; continue; }
      const c = cnd[i], t0 = temp[i];
      let acc = 0, k;
      k = cnd[i - 1]; acc += (k < c ? k : c) * (temp[i - 1] - t0);
      k = cnd[i + 1]; acc += (k < c ? k : c) * (temp[i + 1] - t0);
      k = cnd[i - W]; acc += (k < c ? k : c) * (temp[i - W] - t0);
      k = cnd[i + W]; acc += (k < c ? k : c) * (temp[i + W] - t0);
      let t = t0 + acc / cpc[i];
      const s = st[i];
      if (s === NONE && ox[i] > 0.3 && outdoors[i] === outGen) t += (AMBIENT - t) * AIR_COOL;   // (air sealed inside anything only loses heat through its walls)
      temp2[i] = t;
      // gas law: heating gas in place raises its pressure, cooling lowers it
      if ((s === NONE || s === GAS) && (type[i] !== FIRE || aux[i] === NOTHING) && t !== t0) {
        const f = (t + 273.15) / (t0 + 273.15);
        P[i] *= f; Pref[i] *= f;
      }
    }
  }
  for (let x = 0; x < W; x++) {
    let i = x; temp2[i] = temp[i] + (AMBIENT - temp[i]) * 0.1;
    i = (H - 1) * W + x; temp2[i] = temp[i] + (AMBIENT - temp[i]) * 0.1;
  }
  for (let y = 0; y < H; y++) {
    let i = y * W; temp2[i] = temp[i] + (AMBIENT - temp[i]) * 0.1;
    i = y * W + W - 1; temp2[i] = temp[i] + (AMBIENT - temp[i]) * 0.1;
  }
  const t = temp; temp = temp2; temp2 = t;
}
