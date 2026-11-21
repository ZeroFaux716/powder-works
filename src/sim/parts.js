// Rigid parts made of cells: building them, stamping them into the grid, melting and breaking.
import * as planck from 'planck';
import { AMBIENT, DRAFT, DT, GAMMA, GAS, GRAVITY, H, LIQUID, N, NONE, P0, PART, PFORCE, S, SKIN, SOL, STATIC, W, WIND } from './constants.js';
import { MATS } from './materials.js';
import { DENS, MELT } from './tables.js';
import { G, LP, aux, bid, bodies, lat, life, ox, st, stamp, type, world } from './grid.js';
import { NB, fk, phase } from './reactions.js';
import { FX, FY, P, temp } from './flow.js';
import { buildJoint, dropJoint, jrecs, removeJoint, springEnds } from './joints.js';
import { cur, tick } from './world.js';

// ---------- rigid parts made of cells ----------
// Each part keeps its own grid of cells. Every frame it is lifted out of the world grid,
// moved by the physics engine, and stamped back in at its new position and angle.

export function rectsOf(occ, w, h) {
  const used = new Uint8Array(w * h), out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (!occ[k] || used[k]) continue;
    let x1 = x;
    while (x1 + 1 < w && occ[y * w + x1 + 1] && !used[y * w + x1 + 1]) x1++;
    let y1 = y;
    grow: while (y1 + 1 < h) {
      for (let xx = x; xx <= x1; xx++) { const kk = (y1 + 1) * w + xx; if (!occ[kk] || used[kk]) break grow; }
      y1++;
    }
    for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) used[yy * w + xx] = 1;
    out.push([x, y, x1, y1]);
  }
  return out;
}

export function addFixtures(b, occ, w, h, ox, oy, matId) {
  // iron is the reference weight; lighter and heavier metals scale from it
  const density = Math.max(0.05, Math.min(2.5, MATS[matId].dens / 7.87));
  for (const [x0, y0, x1, y1] of rectsOf(occ, w, h)) {
    const hx = (x1 - x0 + 1) / 2, hy = (y1 - y0 + 1) / 2;
    const lx = ox + x0 + hx, ly = oy + y0 + hy;
    // shrunk by the engine's contact skin, so a part that exactly fills a bore slides instead of snagging
    b.createFixture(planck.Box(hx * S - SKIN, hy * S - SKIN, planck.Vec2(lx * S, ly * S), 0), { density, friction: 0.15, restitution: 0.1 });
  }
}

export function spawn(occ, temps, w, h, ox, oy, R, x, y, angle, matId, id, lats) {
  const b = world.createBody({ type: 'dynamic', position: planck.Vec2(x, y), angle, angularDamping: 0.01 });
  addFixtures(b, occ, w, h, ox, oy, matId);
  if (!id) { id = G.nextId++; if (G.nextId > 65000) G.nextId = 1; }
  const rb = { id, b, occ, temps, lats: lats || new Float32Array(w * h), w, h, ox, oy, R, mat: matId, foot: [], footK: [], old: [], lastPos: planck.Vec2(x, y), lastAngle: angle };
  bodies.set(id, rb);
  return rb;
}

export function makeBody(cells, matId) {
  const list = cells.filter(i => st[i] !== STATIC && st[i] !== PART);
  if (!list.length) return null;
  let minX = W, minY = H, maxX = 0, maxY = 0, sx = 0, sy = 0;
  for (const i of list) {
    const x = i % W, y = (i / W) | 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    sx += x + 0.5; sy += y + 0.5;
  }
  const cx = sx / list.length, cy = sy / list.length;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const occ = new Uint8Array(w * h), temps = new Float32Array(w * h).fill(AMBIENT);
  for (const i of list) {
    const k = ((i / W | 0) - minY) * w + (i % W - minX);
    occ[k] = 1;
    if (st[i] === DRAFT || st[i] === NONE) temps[k] = temp[i];
  }
  const ox = minX - cx, oy = minY - cy;
  let R = 0;
  for (const [ax, ay] of [[ox, oy], [ox + w, oy], [ox, oy + h], [ox + w, oy + h]]) R = Math.max(R, Math.hypot(ax, ay));
  return spawn(occ, temps, w, h, ox, oy, R + 1, cx * S, cy * S, 0, matId);
}

export function liftBody(rb) {
  const foot = rb.foot, footK = rb.footK;
  for (let k = 0; k < foot.length; k++) {
    const i = foot[k];
    if (st[i] === PART && bid[i] === rb.id) {
      rb.temps[footK[k]] = temp[i]; rb.lats[footK[k]] = lat[i];
      type[i] = 0; st[i] = NONE; bid[i] = 0; life[i] = 0; lat[i] = 0;
    }
  }
  foot.length = 0; footK.length = 0;
}

// Placing a part: first claim its new footprint, then find room nearby for whatever was
// there. Gas can always be squeezed out; powder and liquid need a free cell, and if there is
// none the move is refused, so packed sand and trapped water hold a part up.
export const mark = new Uint32Array(N);
export let gen = 0;
export const fpI = [], fpK = [], moves = [];
export function freeNear(x, y, ax, ay, claim) {
  let best = -1, bestScore = -1e9;
  for (let r = 1; r <= 3 && best < 0; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const j = ny * W + nx;
      if (st[j] !== NONE || mark[j] === gen) continue;
      const sc = dx * ax + dy * ay;
      if (sc > bestScore) { bestScore = sc; best = j; }
    }
  }
  if (best >= 0 && claim) mark[best] = gen;
  return best;
}

export function placeBody(rb) {
  const pos = rb.b.getPosition(), a = rb.b.getAngle();
  const c = Math.cos(a), s = Math.sin(a);
  const px = pos.x / S, py = pos.y / S;
  const x0 = Math.max(0, Math.floor(px - rb.R)), x1 = Math.min(W - 1, Math.ceil(px + rb.R));
  const y0 = Math.max(0, Math.floor(py - rb.R)), y1 = Math.min(H - 1, Math.ceil(py + rb.R));
  const { occ, w, h, ox: offX, oy: offY } = rb;   // (offX/offY: where the part's grid sits; ox is the fresh-air field)
  gen++;
  fpI.length = 0; fpK.length = 0; moves.length = 0;
  for (let Y = y0; Y <= y1; Y++) {
    const dy = Y + 0.5 - py;
    for (let X = x0; X <= x1; X++) {
      const dx = X + 0.5 - px;
      const ix = Math.floor(c * dx + s * dy - offX), iy = Math.floor(-s * dx + c * dy - offY);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
      const k = iy * w + ix;
      if (!occ[k]) continue;
      const i = Y * W + X;
      if (SOL[st[i]]) continue;
      fpI.push(i); fpK.push(k); mark[i] = gen;
    }
  }
  for (let n = 0; n < fpI.length; n++) {
    const i = fpI[n], si = st[i];
    if (si === NONE) continue;
    const x = i % W, y = (i / W) | 0;
    let dst = freeNear(x, y, x + 0.5 - px, y + 0.5 - py, true);
    if (dst < 0 && si === LIQUID) {
      // no room nearby: squeeze it into a neighbouring cell of the same liquid (see liquidPressure)
      const t = type[i];
      for (let k = 0; k < 4 && dst < 0; k++) {
        if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
        const n = i + NB[k];
        if (st[n] === LIQUID && type[n] === t && mark[n] !== gen && aux[n] < 60000) dst = -2 - n;
      }
      if (dst === -1) {
        // the liquid beside it is also being pushed: look two cells out
        for (let r = 2; r <= 6 && dst === -1; r++) for (let dy = -r; dy <= r && dst === -1; dy++) for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const n = ny * W + nx;
          if (st[n] === LIQUID && type[n] === t && mark[n] !== gen && aux[n] < 60000) { dst = -2 - n; break; }
        }
      }
    }
    if (dst === -1 && si !== GAS) return false;
    moves.push(i, dst);
  }
  for (let n = 0; n < moves.length; n += 2) {
    const i = moves[n], j = moves[n + 1];
    if (j <= -2) { aux[-2 - j] += 1 + aux[i]; aux[i] = 0; P[i] = 0; continue; }
    if (j >= 0) {
      type[j] = type[i]; st[j] = st[i]; temp[j] = temp[i]; life[j] = life[i]; aux[j] = aux[i]; lat[j] = lat[i];
      P[j] += P[i]; stamp[j] = cur; P[i] = 0;
    }
  }
  for (let n = 0; n < fpI.length; n++) {
    const i = fpI[n];
    if (P[i] > 0) {
      // the gas this cell held is squeezed into a neighbour, and the work of squeezing it goes in as extra energy
      const x = i % W, y = (i / W) | 0;
      const j = freeNear(x, y, x + 0.5 - px, y + 0.5 - py, false);
      if (j >= 0) {
        if (st[i] === NONE && st[j] === NONE) ox[j] = (ox[j] * P[j] + ox[i] * P[i]) / (P[j] + P[i]);   // its share of fresh air goes with it
        P[j] += P[i] * GAMMA;
      }
    }
    fk[i] = fpK[n];
    type[i] = rb.mat; st[i] = PART; bid[i] = rb.id; temp[i] = rb.temps[fpK[n]]; lat[i] = rb.lats[fpK[n]]; life[i] = 0; aux[i] = 0; P[i] = 0;
    rb.foot.push(i); rb.footK.push(fpK[n]);
  }
  return true;
}

export function stampBody(rb) {
  if (placeBody(rb)) return;
  // refused at the new pose: go back to where it was and stop
  rb.b.setTransform(rb.lastPos, rb.lastAngle);
  rb.b.setLinearVelocity(planck.Vec2(0, 0));
  rb.b.setAngularVelocity(0);
  placeBody(rb);
}

// Gas pressure on every exposed face pushes the part, off-centre pushes make it turn.
export function pressOn(rb) {
  const wc = rb.b.getWorldCenter();
  const cx = wc.x / S, cy = wc.y / S;
  // the part's own motion, in cells per frame, so wind only pushes a surface it is catching up with
  const lv = rb.b.getLinearVelocity(), om = rb.b.getAngularVelocity() * DT;
  const bvx = lv.x * DT / S, bvy = lv.y * DT / S;
  let fx = 0, fy = 0, tq = 0;
  for (const i of rb.foot) {
    const x = i % W, y = (i / W) | 0;
    const rx = x + 0.5 - cx, ry = y + 0.5 - cy;
    let g;
    // wind: air arriving at a face pushes it, by the square of how fast it closes on the face
    if (x > 1 && !SOL[st[i - 1]] && (g = FX[i - 2]) > 0.05) {
      const u = g / (P[i - 1] > 0.3 ? P[i - 1] : 0.3) - (bvx - om * ry);
      if (u > 0) { const q = WIND * u * u; fx += q; tq -= ry * q; }
    }
    if (x < W - 2 && !SOL[st[i + 1]] && (g = -FX[i + 1]) > 0.05) {
      const u = g / (P[i + 1] > 0.3 ? P[i + 1] : 0.3) + (bvx - om * ry);
      if (u > 0) { const q = WIND * u * u; fx -= q; tq += ry * q; }
    }
    if (y > 1 && !SOL[st[i - W]] && (g = FY[i - 2 * W]) > 0.05) {
      const u = g / (P[i - W] > 0.3 ? P[i - W] : 0.3) - (bvy + om * rx);
      if (u > 0) { const q = WIND * u * u; fy += q; tq += rx * q; }
    }
    if (y < H - 2 && !SOL[st[i + W]] && (g = -FY[i + W]) > 0.05) {
      const u = g / (P[i + W] > 0.3 ? P[i + W] : 0.3) + (bvy + om * rx);
      if (u > 0) { const q = WIND * u * u; fy -= q; tq -= rx * q; }
    }
    if (x > 0 && !SOL[st[i - 1]] && (g = P[i - 1] - P0 + LP[i - 1])) { fx += g; tq -= ry * g; }
    if (x < W - 1 && !SOL[st[i + 1]] && (g = P[i + 1] - P0 + LP[i + 1])) { fx -= g; tq += ry * g; }
    if (y > 0 && !SOL[st[i - W]] && (g = P[i - W] - P0 + LP[i - W])) { fy += g; tq += rx * g; }
    if (y < H - 1 && !SOL[st[i + W]] && (g = P[i + W] - P0 + LP[i + W])) { fy -= g; tq -= rx * g; }
  }
  if (Math.abs(fx) + Math.abs(fy) + Math.abs(tq) < 0.02) return;
  rb.b.applyForceToCenter(planck.Vec2(fx * PFORCE, fy * PFORCE), true);
  rb.b.applyTorque(tq * PFORCE * S, true);
}

// A part sitting in liquid is pushed up by the weight of the liquid it displaces, row by row,
// and slowed by the liquid as it moves.
export function floatOn(rb) {
  const foot = rb.foot, n = foot.length;
  if (!n) return;
  const v = rb.b.getLinearVelocity();
  let k = 0, wet = 0;
  while (k < n) {
    const y = (foot[k] / W) | 0;
    let minX = W, maxX = -1, cnt = 0, sum = 0;
    while (k < n && ((foot[k] / W) | 0) === y) {
      const x = foot[k] % W;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      sum += x; cnt++; k++;
    }
    let d = 0, sides = 0;
    if (minX > 0 && st[y * W + minX - 1] === LIQUID) { d += DENS[type[y * W + minX - 1]]; sides++; }
    if (maxX < W - 1 && st[y * W + maxX + 1] === LIQUID) { d += DENS[type[y * W + maxX + 1]]; sides++; }
    if (!sides) continue;
    wet += cnt;
    const lift = d / sides / 7.87 * S * S * GRAVITY * cnt;
    const drag = 0.6 * S * S * cnt;
    rb.b.applyForce(planck.Vec2(-v.x * drag, -lift - v.y * drag), planck.Vec2((sum / cnt + 0.5) * S, (y + 0.5) * S), true);
  }
  if (wet) rb.b.applyTorque(-rb.b.getAngularVelocity() * 0.02 * S * S * wet, true);
}

// Cells of a part that reach the melting point drip off as liquid. What is left is re-shaped,
// and if the part is cut in two, each piece carries on as its own part.
export function meltPart(rb) {
  const melt = MELT[rb.mat], t = rb.mat;
  let changed = false;
  for (let k = 0; k < rb.foot.length; k++) {
    const i = rb.foot[k];
    if (st[i] !== PART || bid[i] !== rb.id || (temp[i] <= melt && lat[i] <= 0)) continue;
    if (phase(i, t, PART) === LIQUID) {
      st[i] = LIQUID; bid[i] = 0; stamp[i] = cur;
      rb.occ[rb.footK[k]] = 0;
      changed = true;
    }
  }
  if (changed) refit(rb);
}

export function refit(rb) {
  const { occ, w, h } = rb;
  const lab = new Int32Array(w * h), sizes = [0];
  let n = 0;
  for (let k0 = 0; k0 < w * h; k0++) {
    if (!occ[k0] || lab[k0]) continue;
    n++;
    let size = 0;
    const stack = [k0];
    lab[k0] = n;
    while (stack.length) {
      const k = stack.pop(), x = k % w, y = (k / w) | 0;
      size++;
      if (x > 0 && occ[k - 1] && !lab[k - 1]) { lab[k - 1] = n; stack.push(k - 1); }
      if (x < w - 1 && occ[k + 1] && !lab[k + 1]) { lab[k + 1] = n; stack.push(k + 1); }
      if (y > 0 && occ[k - w] && !lab[k - w]) { lab[k - w] = n; stack.push(k - w); }
      if (y < h - 1 && occ[k + w] && !lab[k + w]) { lab[k + w] = n; stack.push(k + w); }
    }
    sizes.push(size);
  }
  if (n === 0) { removeBody(rb.id); return; }
  let keep = 1;
  for (let L = 2; L <= n; L++) if (sizes[L] > sizes[keep]) keep = L;
  const pieces = new Map();
  if (n > 1) {
    const p = rb.b.getPosition(), v = rb.b.getLinearVelocity();
    for (let L = 1; L <= n; L++) {
      if (L === keep) continue;
      const o = new Uint8Array(w * h);
      for (let k = 0; k < w * h; k++) if (lab[k] === L) { o[k] = 1; occ[k] = 0; }
      const nb = spawn(o, rb.temps.slice(), w, h, rb.ox, rb.oy, rb.R, p.x, p.y, rb.b.getAngle(), rb.mat, 0, rb.lats.slice());
      nb.b.setLinearVelocity(planck.Vec2(v.x, v.y));
      nb.b.setAngularVelocity(rb.b.getAngularVelocity());
      pieces.set(L, nb);
    }
  }
  for (let f = rb.b.getFixtureList(); f;) { const nx = f.getNext(); rb.b.destroyFixture(f); f = nx; }
  addFixtures(rb.b, occ, w, h, rb.ox, rb.oy, rb.mat);
  // joints follow the piece their pin sits on; a pin whose metal melted away lets go
  const labelNear = (lx, ly) => {
    const ix = Math.floor(lx / S - rb.ox), iy = Math.floor(ly / S - rb.oy);
    for (let r = 0; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = ix + dx, y = iy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (lab[y * w + x]) return lab[y * w + x];
    }
    return 0;
  };
  for (const rec of jrecs.slice()) {
    for (const side of ['A', 'B']) {
      if (rec[side] !== rb || !jrecs.includes(rec)) continue;
      const local = side === 'A' ? rec.localA : rec.localB;
      const L = labelNear(local.x, local.y);
      if (L === 0) removeJoint(rec);
      else if (L !== keep) {
        const anchor = rb.b.getWorldPoint(local);
        const ends = rec.kind === 'spring' ? springEnds(rec) : null;
        dropJoint(rec);
        rec[side] = pieces.get(L);
        if (ends) buildJoint(rec, ends[0], ends[1]); else buildJoint(rec, anchor);
      }
    }
  }
}

export function rebuildGround() {
  G.groundDirty = false;
  for (let f = G.ground.getFixtureList(); f;) { const n = f.getNext(); G.ground.destroyFixture(f); f = n; }
  const occ = new Uint8Array(N);
  for (let i = 0; i < N; i++) occ[i] = st[i] === STATIC ? 1 : 0;
  for (const [x0, y0, x1, y1] of rectsOf(occ, W, H)) {
    const hx = (x1 - x0 + 1) / 2, hy = (y1 - y0 + 1) / 2;
    G.ground.createFixture(planck.Box(hx * S, hy * S, planck.Vec2((x0 + hx) * S, (y0 + hy) * S), 0), { friction: 0.4 });
  }
  // the edges of the bench keep parts in view
  G.ground.createFixture(planck.Edge(planck.Vec2(0, 0), planck.Vec2(0, H * S)));
  G.ground.createFixture(planck.Edge(planck.Vec2(W * S, 0), planck.Vec2(W * S, H * S)));
  G.ground.createFixture(planck.Edge(planck.Vec2(0, H * S), planck.Vec2(W * S, H * S)));
}

export function removeBody(id) {
  const rb = bodies.get(id);
  if (!rb) return;
  for (const rec of jrecs.filter(r => r.A === rb || r.B === rb)) removeJoint(rec);
  liftBody(rb);
  world.destroyBody(rb.b);
  bodies.delete(id);
}

export function physicsStep() {
  if (G.groundDirty && (tick & 3) === 0) rebuildGround();
  for (const rb of Array.from(bodies.values())) {
    if (rb.dirty) { rb.dirty = false; refit(rb); }
    if (bodies.has(rb.id)) meltPart(rb);
  }
  for (const rb of bodies.values()) { pressOn(rb); floatOn(rb); }
  for (const rb of bodies.values()) {
    rb.old = rb.foot.slice();
    liftBody(rb);
    const p = rb.b.getPosition();
    rb.lastPos = planck.Vec2(p.x, p.y); rb.lastAngle = rb.b.getAngle();
  }
  world.step(DT, 8, 3);
  const order = Array.from(bodies.values()).reverse();   // newest on top
  for (const rb of order) {
    const p = rb.b.getPosition();
    if (p.y > (H + 40) * S || p.y < -200 * S) { removeBody(rb.id); continue; }
    stampBody(rb);
  }
  // Gas that expands into the space a part just left has done work pushing it, and pays for that in energy.
  for (const rb of order) {
    for (const i of rb.old) {
      if (st[i] !== NONE || P[i] !== 0) continue;
      const x = i % W, y = (i / W) | 0;
      let j = -1, best = 0;
      if (x > 0 && !SOL[st[i - 1]] && P[i - 1] > best) { best = P[i - 1]; j = i - 1; }
      if (x < W - 1 && !SOL[st[i + 1]] && P[i + 1] > best) { best = P[i + 1]; j = i + 1; }
      if (y > 0 && !SOL[st[i - W]] && P[i - W] > best) { best = P[i - W]; j = i - W; }
      if (y < H - 1 && !SOL[st[i + W]] && P[i + W] > best) { best = P[i + W]; j = i + W; }
      if (j >= 0) { P[j] -= (GAMMA - 1) * best; ox[i] = ox[j]; }
    }
  }
}

// Which parts cover (or nearly cover) a cell, nearest first.
export function bodiesAt(x, y, reach) {
  const found = [];
  for (const rb of bodies.values()) {
    const pos = rb.b.getPosition(), a = rb.b.getAngle();
    const c = Math.cos(a), s = Math.sin(a), px = pos.x / S, py = pos.y / S;
    let best = Infinity;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > reach || d >= best) continue;
      const qx = x + dx + 0.5 - px, qy = y + dy + 0.5 - py;
      const ix = Math.floor(c * qx + s * qy - rb.ox), iy = Math.floor(-s * qx + c * qy - rb.oy);
      if (ix < 0 || iy < 0 || ix >= rb.w || iy >= rb.h || !rb.occ[iy * rb.w + ix]) continue;
      best = d;
    }
    if (best < Infinity) found.push([best, rb]);
  }
  found.sort((p, q) => p[0] - q[0]);
  return found.map(f => f[1]);
}
