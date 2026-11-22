// One step of the whole simulation, snapshots for Play, Rewind and Undo, and clearing the bench.
import * as planck from 'planck';
import { AMBIENT, DRAFT, GAS, H, LIQUID, NONE, P0, PART, POWDER, STATIC, W } from './constants.js';
import { MATS } from './materials.js';
import { CHEMV, CPDI, IGN, MELT, PARTRX, RAD, RX } from './tables.js';
import { G, LP, Pref, aux, passPairs, sol, sx, sh, taken, bid, bodies, clearCell, ddir, dset, fan, gate, lat, life, lit, ox, st, stamp, type, world } from './grid.js';
import { burn, chemCompound, chemReact, cpdReact, detach, need, phase, react, smolder, wetReact } from './reactions.js';
import { electric } from './electrics.js';
import { nDX, nDY, nFast, nLife, nX, nY, radiate, stepNeutrons } from './neutrons.js';
import { updateCell } from './cells.js';
import { FX, FY, P, advectAir, diffuseHeat, diffusePressure, liquidPressure, temp } from './flow.js';
import { physicsStep, rebuildGround, spawn } from './parts.js';
import { scanChunks, wakeAll } from './sleep.js';
import { meltOf } from './alloys.js';
import { checkJoints } from './strength.js';
import { buildJoint, jrecs } from './joints.js';

export let tick = 0, cur = 1;
// ---------- snapshots for Play and Rewind ----------
export function snapshot() {
  return {
    fan: fan.slice(), dset: dset.slice(), gate: gate.slice(), ddir: ddir.slice(), fx: FX.slice(), fy: FY.slice(), type: type.slice(), st: st.slice(), temp: temp.slice(), life: life.slice(), aux: aux.slice(), lat: lat.slice(), need: need.slice(), sol: sol.slice(), sx: sx.slice(), sh: sh.slice(), taken: taken.slice(), ox: ox.slice(), P: P.slice(), bid: bid.slice(), nextId: G.nextId,
    neutrons: { n: G.nCount, x: nX.slice(0, G.nCount), y: nY.slice(0, G.nCount), dx: nDX.slice(0, G.nCount), dy: nDY.slice(0, G.nCount), fast: nFast.slice(0, G.nCount), life: nLife.slice(0, G.nCount) },
    bodies: Array.from(bodies.values(), rb => {
      const p = rb.b.getPosition(), v = rb.b.getLinearVelocity();
      return {
        id: rb.id, occ: rb.occ.slice(), temps: rb.temps.slice(), lats: rb.lats.slice(), w: rb.w, h: rb.h, ox: rb.ox, oy: rb.oy, R: rb.R, mat: rb.mat, sol: rb.sol, sx: rb.sx,
        foot: rb.foot.slice(), footK: rb.footK.slice(), x: p.x, y: p.y, a: rb.b.getAngle(), vx: v.x, vy: v.y, av: rb.b.getAngularVelocity()
      };
    }),
    joints: jrecs.map(r => ({
      kind: r.kind, A: r.A.id, B: r.B ? r.B.id : 0, lx: r.localA.x, ly: r.localA.y,
      axis: r.axis ? [r.axis.x, r.axis.y] : null, spin: r.spin, strength: r.strength,
      hz: r.hz, damp: r.damp, len: r.len, lb: r.localB ? [r.localB.x, r.localB.y] : null, wb: r.worldB ? [r.worldB.x, r.worldB.y] : null
    })),
    pass: [...passPairs]
  };
}

export function restore(snap) {
  clearAll();
  type.set(snap.type); st.set(snap.st); temp.set(snap.temp); life.set(snap.life); aux.set(snap.aux); lat.set(snap.lat); need.set(snap.need);
  // (saves from before 0.9 have no compositions)
  if (snap.sx) { sol.set(snap.sol); sx.set(snap.sx); sh.set(snap.sh); taken.set(snap.taken); } else { sx.fill(0); taken.fill(0); } ox.set(snap.ox); P.set(snap.P); Pref.set(snap.P); bid.set(snap.bid);
  fan.set(snap.fan); dset.set(snap.dset); gate.set(snap.gate); ddir.set(snap.ddir); FX.set(snap.fx); FY.set(snap.fy);
  G.nextId = snap.nextId;
  const sn = snap.neutrons;
  G.nCount = sn.n; nX.set(sn.x); nY.set(sn.y); nDX.set(sn.dx); nDY.set(sn.dy); nFast.set(sn.fast); nLife.set(sn.life);
  for (const d of snap.bodies) {
    const rb = spawn(d.occ.slice(), d.temps.slice(), d.w, d.h, d.ox, d.oy, d.R, d.x, d.y, d.a, d.mat, d.id, d.lats.slice());
    rb.b.setLinearVelocity(planck.Vec2(d.vx, d.vy));
    rb.b.setAngularVelocity(d.av);
    rb.foot = d.foot.slice(); rb.footK = d.footK.slice();
    rb.sol = d.sol || 0; rb.sx = d.sx || 0;
  }
  for (const jd of snap.joints) {
    const A = bodies.get(jd.A), B = jd.B ? bodies.get(jd.B) : null;
    if (!A) continue;
    const rec = { id: G.nextJointId++, kind: jd.kind, A, B, axis: jd.axis ? planck.Vec2(jd.axis[0], jd.axis[1]) : null, spin: jd.spin, strength: jd.strength, j: null, anchorBody: null,
      hz: jd.hz, damp: jd.damp, len: jd.len };
    if (jd.kind === 'spring') {
      if (jd.B && !B) continue;
      buildJoint(rec, A.b.getWorldPoint(planck.Vec2(jd.lx, jd.ly)), B ? B.b.getWorldPoint(planck.Vec2(jd.lb[0], jd.lb[1])) : planck.Vec2(jd.wb[0], jd.wb[1]));
    } else buildJoint(rec, A.b.getWorldPoint(planck.Vec2(jd.lx, jd.ly)));
    jrecs.push(rec);
  }
  for (const k of snap.pass || []) passPairs.add(k);   // (saves from before 0.3 have none)
  wakeAll();
  G.groundDirty = true;
  rebuildGround();
}

// Open edges: anything loose that reaches the edge of the bench leaves it, like gas drifting off into the sky.
export function clearEdges() {
  const out = i => { const s = st[i]; if (s === GAS || s === LIQUID || s === POWDER) { clearCell(i); P[i] = P0; ox[i] = 1; } };
  for (let x = 0; x < W; x++) { out(x); out((H - 1) * W + x); }
  for (let y = 1; y < H - 1; y++) { out(y * W); out(y * W + W - 1); }
}
export function step() {
  if (G.openEdges) clearEdges();
  tick++;
  cur = (tick % 255) + 1;
  const ltr = tick & 1;
  for (let y = H - 1; y >= 0; y--) {
    const row = y * W;
    for (let k = 0; k < W; k++) {
      const x = ltr ? k : W - 1 - k, i = row + x, s = st[i];
      if (s === NONE || s === DRAFT) continue;
      if (s === PART) {
        const t = type[i];
        if (RAD[t]) radiate(i, x, y, t, PART);
        if (PARTRX[t]) {
          // parts burn, fizz in water and are cut by hot oxygen like loose material; the cell that goes is lost from the part
          const m = MATS[t];
          if (m.burn && temp[i] > IGN[t]) { if (smolder(i, x, y, m)) detach(i); }
          else if (m.wet && wetReact(i, x, y, m)) detach(i);
        }
        if (CHEMV[t]) chemReact(i, x, y, t);
        continue;
      }
      if (s === STATIC) {
        // solid material sits still, but it can still melt, catch fire or decay
        const t = type[i];
        if (RAD[t] && radiate(i, x, y, t, STATIC)) continue;
        const T = temp[i];
        if (T > IGN[t]) { const m = MATS[t]; if (m.burn.fast) burn(i); else smolder(i, x, y, m); }
        else if (T > meltOf(i, t) || lat[i] > 0) { if (phase(i, t, STATIC) !== STATIC) { st[i] = LIQUID; G.groundDirty = true; } }
        else if (RX[t] && react(i, x, y, t, STATIC)) continue;
        else if (CHEMV[t]) chemReact(i, x, y, t);
        else if (CPDI[t]) { if (!cpdReact(i, x, y, t)) chemCompound(i, x, y, t, CPDI[t]); }
        continue;
      }
      if (stamp[i] === cur) continue;
      updateCell(i, x, y);
    }
  }
  electric();
  stepNeutrons();
  scanChunks();
  diffusePressure();
  liquidPressure();
  advectAir();
  diffuseHeat();
  physicsStep();
  checkJoints();
}

export function clearAll() {
  for (let b = world.getBodyList(); b;) { const n = b.getNext(); world.destroyBody(b); b = n; }
  G.ground = world.createBody();
  G.grabBase = null;
  bodies.clear();
  jrecs.length = 0;
  passPairs.clear();
  sx.fill(0); taken.fill(0);
  wakeAll();
  G.nCount = 0;
  LP.fill(0); G.lpCells = []; lit.fill(0);
  fan.fill(0); dset.fill(0); gate.fill(1); ddir.fill(0); FX.fill(0); FY.fill(0);
  type.fill(0); st.fill(0); temp.fill(AMBIENT); life.fill(0); aux.fill(0); lat.fill(0); need.fill(0); ox.fill(1); P.fill(P0); Pref.fill(P0); bid.fill(0); stamp.fill(0);
  G.groundDirty = true;
}
