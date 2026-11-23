// Copy, cut and paste: a rectangle of the bench taken as a "clip" (loose cells, devices, whole parts, the joints
// between those parts) that can be turned, mirrored, pasted anywhere and kept as a stamp.
//
// A clip is plain data (arrays and numbers only), so a stamp is just the clip written out as JSON.
// Everything in it is measured in cells from the clip's top-left corner; w and h are the clip's size.
// Parts keep their own grid of cells (occ) and their pose (X, Y, angle a), as the physics engine has them.
import * as planck from 'planck';
import { AMBIENT, GAS, H, LIQUID, NONE, P0, PART, POWDER, S, SOL, W } from './constants.js';
import { G, aux, bid, bodies, clearCell, ddir, dset, fan, gate, lat, life, ox, passPairs, sh, sol, st, sx, type } from './grid.js';
import { P, temp } from './flow.js';
import { letPass, partCovers, placeBody, removeBody, spawn } from './parts.js';
import { buildJoint, jrecs, springEnds } from './joints.js';
import { solute } from './alloys.js';
import { wakeAll } from './sleep.js';

export const CLIP_VERSION = 1;
const r4 = v => Math.round(v * 1e4) / 1e4;

// ---------- copying ----------
// Every part with any cell inside the box comes along whole; so do the joints whose parts all came along.
// ids: if given, the ids of the parts taken are added to it
export function copyRegion(x0, y0, x1, y1, ids) {
  if (x0 > x1) [x0, x1] = [x1, x0];
  if (y0 > y1) [y0, y1] = [y1, y0];
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
  const clip = { v: CLIP_VERSION, w: x1 - x0 + 1, h: y1 - y0 + 1, cells: [], devs: [], parts: [], joints: [], pass: [] };
  const picked = new Set();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x, s = st[i];
    if (s === PART) picked.add(bid[i]);
    else if (s !== NONE) {
      const so = solute(i);
      clip.cells.push([x - x0, y - y0, type[i], s, r4(temp[i]), life[i], aux[i], r4(lat[i]), so ? sol[i] : 0, so ? r4(sx[i]) : 0, s === GAS ? r4(P[i]) : P0, s === GAS ? r4(ox[i]) : 1]);
    }
    if (fan[i]) clip.devs.push([x - x0, y - y0, fan[i], dset[i], ddir[i], r4(gate[i])]);
  }
  // parts hidden under other parts have no cells of their own on the grid there: find them by shape
  for (const rb of bodies.values()) {
    if (picked.has(rb.id)) continue;
    search: for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (partCovers(rb, x, y)) { picked.add(rb.id); break search; }
  }
  if (ids) for (const id of picked) ids.push(id);
  const index = new Map();
  for (const id of picked) {
    const rb = bodies.get(id);
    if (!rb) continue;
    // the part's cells keep their temperature on the grid while it sits there
    const temps = Array.from(rb.temps, r4), lats = Array.from(rb.lats, r4);
    for (let k = 0; k < rb.foot.length; k++) { const i = rb.foot[k]; if (bid[i] === rb.id) { temps[rb.footK[k]] = r4(temp[i]); lats[rb.footK[k]] = r4(lat[i]); } }
    const p = rb.b.getPosition();
    index.set(id, clip.parts.length);
    clip.parts.push({ X: r4(p.x / S - x0), Y: r4(p.y / S - y0), a: r4(rb.b.getAngle()), w: rb.w, h: rb.h, ox: rb.ox, oy: rb.oy, R: rb.R, mat: rb.mat, sol: rb.sol || 0, sx: rb.sx || 0,
      occ: Array.from(rb.occ), temps, lats });
  }
  for (const rec of jrecs) {
    if (!index.has(rec.A.id) || (rec.B && !index.has(rec.B.id))) continue;
    const A = index.get(rec.A.id), B = rec.B ? index.get(rec.B.id) : -1;
    const jd = { kind: rec.kind, A, B, la: [r4(rec.localA.x / S), r4(rec.localA.y / S)], lb: null, wb: null, axis: rec.axis ? [r4(rec.axis.x), r4(rec.axis.y)] : null,
      spin: rec.spin, strength: rec.strength, hz: rec.hz, damp: rec.damp, len: rec.len };
    if (rec.kind === 'spring') {
      const [, e] = springEnds(rec);
      if (rec.B) jd.lb = [r4(rec.localB.x / S), r4(rec.localB.y / S)]; else jd.wb = [r4(e.x / S - x0), r4(e.y / S - y0)];
    }
    clip.joints.push(jd);
  }
  for (const k of passPairs) {
    const a = Math.floor(k / 65536), b = k % 65536;
    if (index.has(a) && index.has(b)) clip.pass.push([index.get(a), index.get(b)]);
  }
  return clip.cells.length || clip.devs.length || clip.parts.length ? clip : null;
}

// Cutting: copy, then clear the box and take away the parts that went into the clip.
export function cutRegion(x0, y0, x1, y1) {
  const ids = [], clip = copyRegion(x0, y0, x1, y1, ids);
  if (!clip) return null;
  if (x0 > x1) [x0, x1] = [x1, x0];
  if (y0 > y1) [y0, y1] = [y1, y0];
  x0 = Math.max(0, x0); y0 = Math.max(0, y0);
  for (const id of ids) removeBody(id);
  for (let y = y0; y < y0 + clip.h; y++) for (let x = x0; x < x0 + clip.w; x++) {
    const i = y * W + x;
    fan[i] = 0; dset[i] = 0; gate[i] = 1; ddir[i] = 0;
    const s = st[i];
    if (s === NONE || s === PART) continue;
    if (SOL[s]) { P[i] = P0; temp[i] = AMBIENT; G.groundDirty = true; }
    clearCell(i);
  }
  wakeAll();
  return clip;
}

// ---------- turning and mirroring ----------
// Directions as fans and pumps store them: 1 right, 2 left, 3 up, 4 down.
const TURN = [0, 4, 3, 1, 2], MIRROR = [0, 2, 1, 3, 4];
function redirect(clip, map) {
  for (const d of clip.devs) {
    if (d[2] >= 1 && d[2] <= 4) d[2] = map[d[2]];
    else if (d[4]) d[4] = map[d[4]];
  }
}
// A quarter turn clockwise (as seen on screen).
export function turnClip(clip) {
  const { w, h } = clip;
  for (const c of clip.cells) [c[0], c[1]] = [h - 1 - c[1], c[0]];
  for (const d of clip.devs) [d[0], d[1]] = [h - 1 - d[1], d[0]];
  redirect(clip, TURN);
  for (const p of clip.parts) { [p.X, p.Y] = [r4(h - p.Y), p.X]; p.a = r4(p.a + Math.PI / 2); }
  for (const j of clip.joints) {
    if (j.axis) j.axis = [r4(-j.axis[1]), j.axis[0]];
    if (j.wb) j.wb = [r4(h - j.wb[1]), j.wb[0]];
  }
  clip.w = h; clip.h = w;
  return clip;
}
// Mirrored left to right. A part is mirrored in its own grid, so it can still be a rigid body;
// a mirrored motor turns the other way, so a mirrored machine runs as the mirror image of the original.
export function mirrorClip(clip) {
  const { w } = clip;
  for (const c of clip.cells) c[0] = w - 1 - c[0];
  for (const d of clip.devs) d[0] = w - 1 - d[0];
  redirect(clip, MIRROR);
  for (const p of clip.parts) {
    p.X = r4(w - p.X); p.a = r4(-p.a);
    const flip = arr => { const out = arr.slice(); for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) out[y * p.w + (p.w - 1 - x)] = arr[y * p.w + x]; return out; };
    p.occ = flip(p.occ); p.temps = flip(p.temps); p.lats = flip(p.lats);
    p.ox = -(p.ox + p.w);
  }
  for (const j of clip.joints) {
    j.la[0] = -j.la[0];
    if (j.lb) j.lb[0] = -j.lb[0];
    if (j.wb) j.wb[0] = r4(w - j.wb[0]);
    if (j.axis) j.axis[0] = -j.axis[0];
    j.spin = -j.spin;
  }
  return clip;
}
// Mirrored top to bottom: mirrored left to right, then half a turn.
export function mirrorClipV(clip) { return turnClip(turnClip(mirrorClip(clip))); }

// ---------- pasting ----------
// The clip goes in with its top-left corner at x0, y0. What it brings replaces what is there, except parts
// already on the bench: pasted parts lie over them and pass through them, as if drawn there.
export function pasteClip(clip, x0, y0) {
  for (const c of clip.cells) {
    const x = x0 + c[0], y = y0 + c[1];
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = y * W + x;
    if (st[i] === PART) continue;
    if (SOL[st[i]] || SOL[c[3]]) G.groundDirty = true;
    type[i] = c[2]; st[i] = c[3]; temp[i] = c[4]; life[i] = c[5]; aux[i] = c[6]; lat[i] = c[7];
    if (c[9]) { sol[i] = c[8]; sx[i] = c[9]; sh[i] = c[2]; } else sx[i] = 0;
    P[i] = c[10]; ox[i] = c[11];
  }
  for (const d of clip.devs) {
    const x = x0 + d[0], y = y0 + d[1];
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = y * W + x;
    if (d[2] <= 4 && SOL[st[i]]) continue;   // fans only blow through open cells
    fan[i] = d[2]; dset[i] = d[3]; ddir[i] = d[4]; gate[i] = d[5];
  }
  const made = [];
  for (const p of clip.parts) {
    const under = [...bodies.values()];
    const rb = spawn(Uint8Array.from(p.occ), Float32Array.from(p.temps), p.w, p.h, p.ox, p.oy, p.R, (x0 + p.X) * S, (y0 + p.Y) * S, p.a, p.mat, 0, Float32Array.from(p.lats));
    rb.sol = p.sol; rb.sx = p.sx;
    const cover = coveredCells(rb);
    for (const o of under) if (cover.some(i => partCovers(o, i % W, (i / W) | 0))) letPass(rb.id, o.id);
    if (!placeBody(rb)) {
      // packed sand or trapped water under it, with nowhere to go: the paste replaces it
      for (const i of cover) if (st[i] === POWDER || st[i] === LIQUID) clearCell(i);
      placeBody(rb);
    }
    made.push(rb);
  }
  for (const jd of clip.joints) {
    const A = made[jd.A], B = jd.B >= 0 ? made[jd.B] : null;
    if (!A || (jd.B >= 0 && !B)) continue;
    const rec = { id: G.nextJointId++, kind: jd.kind, A, B, axis: jd.axis ? planck.Vec2(jd.axis[0], jd.axis[1]) : null, spin: jd.spin, strength: jd.strength, j: null, anchorBody: null,
      hz: jd.hz, damp: jd.damp, len: jd.len };
    const a = A.b.getWorldPoint(planck.Vec2(jd.la[0] * S, jd.la[1] * S));
    if (jd.kind === 'spring') buildJoint(rec, a, B ? B.b.getWorldPoint(planck.Vec2(jd.lb[0] * S, jd.lb[1] * S)) : planck.Vec2((x0 + jd.wb[0]) * S, (y0 + jd.wb[1]) * S));
    else buildJoint(rec, a);
    jrecs.push(rec);
  }
  for (const [a, b] of clip.pass) if (made[a] && made[b]) letPass(made[a].id, made[b].id);
  wakeAll();
  return made;
}

// The bench cells a part covers at its pose
function coveredCells(rb) {
  const p = rb.b.getPosition(), out = [];
  const px = p.x / S, py = p.y / S;
  for (let y = Math.max(0, Math.floor(py - rb.R)); y <= Math.min(H - 1, Math.ceil(py + rb.R)); y++)
    for (let x = Math.max(0, Math.floor(px - rb.R)); x <= Math.min(W - 1, Math.ceil(px + rb.R)); x++)
      if (partCovers(rb, x, y)) out.push(y * W + x);
  return out;
}

// ---------- seeing a clip ----------
// What a clip looks like, cell by cell: [x, y, material] for cells and parts, [x, y, -device] for devices,
// so the page can draw the paste preview and a stamp's thumbnail. Parts are drawn at their pose.
export function clipPicture(clip) {
  const out = [];
  for (const c of clip.cells) out.push([c[0], c[1], c[2]]);
  for (const p of clip.parts) {
    const cs = Math.cos(p.a), sn = Math.sin(p.a), R = Math.ceil(p.R);
    for (let y = Math.floor(p.Y - R); y <= Math.ceil(p.Y + R); y++) for (let x = Math.floor(p.X - R); x <= Math.ceil(p.X + R); x++) {
      const qx = x + 0.5 - p.X, qy = y + 0.5 - p.Y;
      const ix = Math.floor(cs * qx + sn * qy - p.ox), iy = Math.floor(-sn * qx + cs * qy - p.oy);
      if (ix >= 0 && iy >= 0 && ix < p.w && iy < p.h && p.occ[iy * p.w + ix]) out.push([x, y, p.mat]);
    }
  }
  for (const d of clip.devs) out.push([d[0], d[1], -d[2]]);
  return out;
}
// Where the clip's joints sit, in its own cells: [x, y, kind]
export function clipJoints(clip) {
  return clip.joints.map(j => {
    const p = clip.parts[j.A], c = Math.cos(p.a), s = Math.sin(p.a);
    return [p.X + c * j.la[0] - s * j.la[1], p.Y + s * j.la[0] + c * j.la[1], j.kind];
  });
}
// A deep copy, so a stamp can be turned without turning the one it came from
export const cloneClip = clip => JSON.parse(JSON.stringify(clip));
