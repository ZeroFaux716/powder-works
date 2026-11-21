// Each cell's own update: movement of powders, liquids and gases, and everything that happens to it.
import { FIRE_P, GAS, H, LIQUID, NONE, NOTHING, POWDER, SOL, STATIC, W } from './constants.js';
import { MATS } from './materials.js';
import { CRUDE } from './chemdata.js';
import { ACID_X, CHEMV, CPDI, DENS, FIRE, IGN, LIFT, RAD, RX, SMOKE, stateAt } from './tables.js';
import { G, aux, clearCell, lat, life, ox, st, stamp, swap, type } from './grid.js';
import { NB, burn, chemCompound, chemReact, condense, cpdReact, distill, fireTouch, fireTouchLit, phase, pool, react, smolder, wetReact } from './reactions.js';
import { backflow } from './electrics.js';
import { radiate } from './neutrons.js';
import { FX, FY, P, temp } from './flow.js';
import { cur } from './world.js';

export function updateCell(i, x, y) {
  const t = type[i], m = MATS[t];
  let s = st[i];

  if (t === FIRE) {
    if (--life[i] <= 0) {
      const a = aux[i];
      aux[i] = 0; life[i] = 0;
      if (a === NOTHING) { type[i] = 0; st[i] = NONE; }
      else if (a) { type[i] = a; st[i] = stateAt(MATS[a], temp[i]); if (st[i] === STATIC) G.groundDirty = true; }
      else if (Math.random() < 0.35) { type[i] = SMOKE; life[i] = 60 + (Math.random() * 90 | 0); }
      else { type[i] = 0; st[i] = NONE; }
      return;
    }
    // An open flame (a torch, burning coal) is fed from outside and holds its temperature. The flame left by
    // fuel burning its air is just hot gas: it cools as it gives up heat, and its pressure falls with it.
    if (aux[i] !== NOTHING) { if (temp[i] < 1100) temp[i] = 1100; P[i] += FIRE_P; }
    let fed = false;
    const flameT = temp[i];
    // only an open flame feeds on oxygen; the flash of a reaction or of burnt fuel has nothing left to burn
    if (aux[i] === NOTHING) {
      if (x > 0) fireTouchLit(i - 1, flameT);
      if (x < W - 1) fireTouchLit(i + 1, flameT);
      if (y > 0) fireTouchLit(i - W, flameT);
      if (y < H - 1) fireTouchLit(i + W, flameT);
    } else {
      if (x > 0 && fireTouch(i - 1, flameT)) fed = true;
      if (x < W - 1 && fireTouch(i + 1, flameT)) fed = true;
      if (y > 0 && fireTouch(i - W, flameT)) fed = true;
      if (y < H - 1 && fireTouch(i + W, flameT)) fed = true;
    }
    if (fed) {
      // a flame fed with oxygen burns hotter and longer
      temp[i] = Math.min(2800, temp[i] + 500);
      if (life[i] < 40) life[i] += 5;
    }
  } else if (t === SMOKE) {
    if (--life[i] <= 0) { clearCell(i); return; }
  } else {
    if (RAD[t] && radiate(i, x, y, t, s)) return;
    const T = temp[i];
    if (m.fades && s === GAS && Math.random() < m.fades) {
      // a wisp out in the open air thins away to nothing
      let airy = 0;
      // (only real air thins it: in a sealed still or tank there is nothing to thin it into)
      if (x > 0 && st[i - 1] === NONE && ox[i - 1] > 0.3) airy++;
      if (x < W - 1 && st[i + 1] === NONE && ox[i + 1] > 0.3) airy++;
      if (y > 0 && st[i - W] === NONE && ox[i - W] > 0.3) airy++;
      if (y < H - 1 && st[i + W] === NONE && ox[i + W] > 0.3) airy++;
      if (airy >= 3) { clearCell(i); return; }
    }
    if (t === CRUDE && s === LIQUID && distill(i, x, y)) return;
    if (m.vapor && s === GAS && condense(i, x, y, t, m)) return;
    if (m.vapor && s === LIQUID && Math.random() < 0.15 && pool(i, x, y, t, m)) return;
    if (s === LIQUID && m.vapor && y > 0 && Math.random() < 0.004 * (1 + (T > 20 ? (T - 20) / 25 : 0))) {
      // the surface gives off vapour, faster when warm, until the air right above it is full of it
      // (into open air: in a sealed tank or still the space above soon holds all the vapour it can)
      const a = st[i - W] === NONE ? i - W : x > 0 && st[i - 1] === NONE ? i - 1 : x < W - 1 && st[i + 1] === NONE ? i + 1 : -1;
      if (a >= 0 && ox[a] > 0.3) {
        type[a] = t; st[a] = GAS; life[a] = 1; aux[a] = 0; lat[a] = 0; temp[a] = T; stamp[a] = cur;
        if (++life[i] >= m.burn.units) { clearCell(i); return; }
      }
    }
    if (T > IGN[t]) {
      if (m.burn.fast) { if (burn(i)) return; }
      else if (smolder(i, x, y, m)) return;
    } else if (m.burn && m.burn.fast && s !== GAS && y > 1 && !SOL[st[i - W]] && st[i - W] !== LIQUID && !SOL[st[i - 2 * W]] && (temp[i - W] > IGN[t] || temp[i - 2 * W] > IGN[t]) && Math.random() < 0.5) {
      // air hot enough to light it, as in a diesel: the fuel does not have to boil first
      if (burn(i)) return;
    }
    if (m.wet && s !== GAS && wetReact(i, x, y, m)) return;
    if (RX[t] && react(i, x, y, t, s)) return;
    if (CHEMV[t] && chemReact(i, x, y, t)) return;
    if ((CPDI[t] || ACID_X[t]) && cpdReact(i, x, y, t)) return;
    if (CPDI[t] && chemCompound(i, x, y, t, CPDI[t])) return;
    const ns = phase(i, t, s);
    if (ns !== s) {
      if (m.vapor && s === LIQUID && ns === GAS) life[i] = m.burn.units - life[i];   // the vapour carries what fuel was left
      st[i] = ns; stamp[i] = cur; aux[i] = 0;
      if (ns === STATIC) { G.groundDirty = true; return; }
    }
  }

  s = st[i];
  const gas = s === GAS;

  // The flow that evened out the pressure last frame carries loose material with it.
  // Gas goes all the way along; liquid and powder are dragged a fraction as far.
  {
    const p = P[i] > 0.3 ? P[i] : 0.3;
    const k = (gas ? 0.5 : s === POWDER ? 0.08 : 0.4) / p;
    const vx = ((x > 0 ? FX[i - 1] : 0) + FX[i]) * k;
    const vy = ((y > 0 ? FY[i - W] : 0) + FY[i]) * k;
    const ax = vx < 0 ? -vx : vx, ay = vy < 0 ? -vy : vy, sp = ax + ay;
    if (sp > 0.02) {
      let n = sp | 0;
      if (Math.random() < sp - n) n++;
      if (n > 8) n = 8;
      const px = ax / sp, sx = vx > 0 ? 1 : -1, sy = vy > 0 ? 1 : -1;
      let j = i, cx = x, cy = y, moved = false;
      for (; n > 0; n--) {
        const alongX = Math.random() < px;
        const dx = alongX ? sx : 0, dy = alongX ? 0 : sy;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) break;
        const d = dx + dy * W;
        // find room ahead: gas in the way is shoved along in front, up to a few cells
        let e = j + d, ex = nx, ey = ny, room = false;
        for (let c = 0, reach = gas ? 12 : 4; c < reach; c++) {
          const se = st[e];
          if (se === NONE) { room = true; break; }
          if (se !== GAS) break;
          ex += dx; ey += dy;
          if (ex < 0 || ex >= W || ey < 0 || ey >= H) break;
          e += d;
        }
        if (!room || (s === LIQUID && backflow(j, j + d))) continue;
        for (let q = e; q !== j; q -= d) swap(q, q - d);
        j += d; cx = nx; cy = ny; moved = true;
      }
      if (moved) return;
    }
  }

  // ordinary movement
  if (s === POWDER) {
    if (y >= H - 1) return;
    const d = i + W, sd = st[d];
    if (sd === NONE || sd === GAS || (sd === LIQUID && DENS[t] > DENS[type[d]] && Math.random() < 0.6)) { swap(i, d); return; }
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (let k = 0; k < 2; k++) {
      const q = k ? -dir : dir, nx = x + q;
      if (nx < 0 || nx >= W || SOL[st[i + q]]) continue;
      const sj = st[d + q];
      if (sj === NONE || sj === GAS || (sj === LIQUID && DENS[t] > DENS[type[d + q]] && Math.random() < 0.4)) { swap(i, d + q); return; }
    }
  } else if (s === LIQUID) {
    if (y < H - 1) {
      const d = i + W, sd = st[d];
      if ((sd === NONE || sd === GAS || (sd === LIQUID && DENS[t] > DENS[type[d]] + 0.01 && Math.random() < 0.5)) && !backflow(i, d)) { swap(i, d); return; }
      const dir = Math.random() < 0.5 ? -1 : 1;
      for (let k = 0; k < 2; k++) {
        const q = k ? -dir : dir, nx = x + q;
        if (nx < 0 || nx >= W || SOL[st[i + q]]) continue;
        const sj = st[d + q];
        if ((sj === NONE || sj === GAS) && !backflow(i, d + q)) { swap(i, d + q); return; }
      }
    }
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (let k = 0; k < 2; k++) {
      const q = k ? -dir : dir;
      let j = i, cx = x, moved = false;
      for (let n = 0; n < 3; n++) {
        const nx = cx + q;
        if (nx < 0 || nx >= W) break;
        const sj = st[j + q];
        if ((sj !== NONE && sj !== GAS) || backflow(j, j + q)) break;
        swap(j, j + q); j += q; cx = nx; moved = true;
      }
      if (moved) return;
    }
  } else {
    // gases: light or hot ones rise, heavy ones sink, the rest wander
    // different gases also mix into each other where they meet, so a light one does not just sit on a heavy one
    if (t !== FIRE && Math.random() < 0.2) {
      const k = (Math.random() * 4) | 0;
      if (!((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1))) {
        const n = i + NB[k];
        if (st[n] === GAS && type[n] !== t && type[n] !== FIRE && stamp[n] !== cur) { swap(i, n); return; }
      }
    }
    const r = Math.random();
    const side = Math.random() < 0.5 ? -1 : 1;
    const lift = temp[i] > 120 ? 1 : LIFT[t];      // hot gas rises whatever it is
    const up = t === FIRE ? 0.6 : lift > 0 ? 0.45 : lift < 0 ? 0.1 : 0.25;
    const dn = lift > 0 ? 0 : lift < 0 ? 0.45 : 0.25;
    if (r < up) {
      if (y > 0) {
        const sj = st[i - W];
        if (sj === NONE || sj === LIQUID) swap(i, i - W);
        // hot gas rises through cooler gas packed above it
        else if (sj === GAS && lift > 0 && temp[i] > temp[i - W] + 5 && type[i - W] !== FIRE && stamp[i - W] !== cur) swap(i, i - W);
      }
    } else if (r < up + dn) {
      if (y < H - 1 && st[i + W] === NONE) swap(i, i + W);
    } else if (lift > 0 && r < up + dn + 0.3) {
      const nx = x + side;
      if (y > 0 && nx >= 0 && nx < W && !SOL[st[i + side]] && st[i - W + side] === NONE) swap(i, i - W + side);
    } else {
      const nx = x + side;
      if (nx >= 0 && nx < W && st[i + side] === NONE) swap(i, i + side);
    }
  }
}
