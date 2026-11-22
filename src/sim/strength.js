// How strong parts are, and joints that break when overloaded.
//
// A part's metal takes a certain stress before it gives: its flow stress (strength.gen.js: hardness / 3 by
// Tabor's relation, from pymatgen's element data). An alloy is stronger: atoms dissolved in a metal get in the
// way of the slip that lets it bend, and the strength rises with the square root of how much is dissolved.
// Small atoms that sit in the gaps between the metal's own (carbon, nitrogen, boron, hydrogen) do this far
// more than metal atoms that take a metal atom's place. Too much of them and the metal turns brittle: iron
// past about 2% carbon by mass is cast iron. Metals also soften as they near their melting point.
//
// A joint's pin bears on the cells of each part around it. It can take the part's strength times those cells
// (times one calibration factor from the game's forces to stresses); the physics engine reports the force on
// every joint each step. Overloaded, a ductile part tears out around the pin, and a brittle one cracks from the
// pin to its edge; either way the joint lets go.
import * as planck from 'planck';
import { DT, S } from './constants.js';
import { MATS } from './materials.js';
import { MELT, METAL } from './tables.js';
import { STRENGTH } from './strength.gen.js';
import { G, bodies, world } from './grid.js';
import { jrecs, removeJoint } from './joints.js';
import { refit } from './parts.js';

const GAP_ATOMS = { C: 1, N: 1, B: 1, H: 1 };     // dissolve in the gaps between metal atoms
const GAP_HARDENING = 15, SWAP_HARDENING = 1.5, OTHER_HARDENING = 3;
const GAP_BRITTLE = 0.09, OTHER_BRITTLE = 0.02;   // atom fractions past which the alloy is brittle
const GAP_PEAK = 0.036;                           // (0.8% carbon by mass in iron)
const COMPOUND_STRENGTH = 50;                     // MPa: compounds and ceramics, all brittle

// strength in MPa of material mat with atom fraction sx of sol dissolved in it, at room temperature
export function flowStress(mat, sol, sx) {
  const m = MATS[mat], row = STRENGTH[m.key];
  const s0 = row ? row[0] : COMPOUND_STRENGTH;
  if (!sol || !sx) return s0;
  const ss = MATS[sol].sym, gap = GAP_ATOMS[ss];
  // Hardening from atoms in the gaps tops out where the metal can hold no more of them in solution (in iron,
  // about 0.8% carbon by mass: high-carbon steel); once brittle (cast iron, full of graphite flakes) it is no
  // stronger than the metal alone when pulled.
  if (gap && sx > GAP_BRITTLE) return s0;
  const k = gap ? GAP_HARDENING : METAL[sol] ? SWAP_HARDENING : OTHER_HARDENING;
  return s0 * (1 + k * Math.sqrt(gap ? Math.min(sx, GAP_PEAK) : sx));
}
export function isBrittle(mat, sol, sx) {
  const row = STRENGTH[MATS[mat].key];
  if (!row || row[1]) return true;
  if (sol && sx) {
    if (GAP_ATOMS[MATS[sol].sym]) return sx > GAP_BRITTLE;
    if (!METAL[sol]) return sx > OTHER_BRITTLE;
  }
  return false;
}
// metals keep their strength up to about a third of their melting point (in kelvin), then lose it
export function heatFactor(mat, T) {
  const Tm = MELT[mat] + 273.15, r = (T + 273.15) / Tm;
  return r < 0.3 ? 1 : r >= 1 ? 0.02 : 1 - 0.98 * (r - 0.3) / 0.7;
}
export const partStrength = rb => flowStress(rb.mat, rb.sol, rb.sx);

// Game force per (MPa x cell of bearing metal), the one calibration number: set so the engine scene's busiest
// pin (the aluminium connecting rod on the iron crank) runs at about 30% of what it can take. With the same
// machine a lead rod tears out, tin is borderline, and copper, iron and steel hold easily.
export let LOAD_SCALE = 2.5;
export const setLoadScale = k => { LOAD_SCALE = k; };
const PIN_R = 2;

// the cells of part rb within reach of a pin at local point p, and their mean temperature
function pinCells(rb, p) {
  const cx = p.x / S - rb.ox, cy = p.y / S - rb.oy;
  let n = 0, t = 0;
  for (let y = Math.floor(cy - PIN_R); y <= Math.ceil(cy + PIN_R); y++) for (let x = Math.floor(cx - PIN_R); x <= Math.ceil(cx + PIN_R); x++) {
    if (x < 0 || y < 0 || x >= rb.w || y >= rb.h) continue;
    const k = y * rb.w + x;
    if (!rb.occ[k] || (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > PIN_R * PIN_R) continue;
    n++; t += rb.temps[k];
  }
  return { n, T: n ? t / n : 20 };
}
// how much force the pin at local point p of part rb can take
export function pinCapacity(rb, p) {
  const { n, T } = pinCells(rb, p);
  return partStrength(rb) * heatFactor(rb.mat, T) * Math.max(n, 1) * LOAD_SCALE;   // (a pin always has something to bear on)
}

// The part gives way around the pin: ductile metal tears out around it, brittle stuff also cracks from the
// pin to the edge along the pull.
function tearAt(rb, p, pull) {
  const cx = p.x / S - rb.ox, cy = p.y / S - rb.oy, R = PIN_R + 0.6;
  const brittle = isBrittle(rb.mat, rb.sol, rb.sx);
  const d = rb.b.getLocalVector(pull), len = Math.hypot(d.x, d.y) || 1, ux = d.x / len, uy = d.y / len;
  for (let y = 0; y < rb.h; y++) for (let x = 0; x < rb.w; x++) {
    const k = y * rb.w + x;
    if (!rb.occ[k]) continue;
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    if (dx * dx + dy * dy <= R * R) { rb.occ[k] = 0; continue; }
    if (brittle) {
      const along = dx * ux + dy * uy, across = Math.abs(dx * uy - dy * ux);
      if (along > 0 && across < 0.75) rb.occ[k] = 0;
    }
  }
  return brittle;
}

// Impacts on brittle parts, noted during the physics step (parts cannot be changed in the middle of it) and
// dealt with after it: if the blow is more than the metal around the point of impact can take, it cracks there.
const knocks = [];
let listening = false;
const listen = () => world.on('post-solve', (contact, impulse) => {
  const n = impulse.normalImpulses[0] || 0;
  if (n <= 0) return;
  for (const f of [contact.getFixtureA(), contact.getFixtureB()]) {
    const id = f.getBody().getUserData(), rb = id && bodies.get(id);
    if (!rb || !isBrittle(rb.mat, rb.sol, rb.sx)) continue;
    const wm = contact.getWorldManifold(null);
    if (!wm || !wm.points[0]) continue;
    knocks.push({ rb, p: planck.Vec2(wm.points[0].x, wm.points[0].y), n: planck.Vec2(wm.normal.x, wm.normal.y), F: n / DT });
  }
});
function crackOnImpact() {
  const done = new Set();
  for (const k of knocks) {
    const rb = k.rb;
    if (done.has(rb.id) || !bodies.has(rb.id)) continue;
    const local = rb.b.getLocalPoint(k.p);
    if (!(k.F > IMPACT_FACTOR * pinCapacity(rb, local))) continue;
    done.add(rb.id);
    // the crack runs from the point of impact into the part, through its middle
    const c = rb.b.getWorldCenter();
    tearAt(rb, local, planck.Vec2(c.x - k.p.x, c.y - k.p.y));
    G.broke = { x: k.p.x / S, y: k.p.y / S, mat: rb.mat, sol: rb.sol, sx: rb.sx, kind: 'impact', brittle: true, load: k.F, cap: pinCapacity(rb, local) };
    refit(rb);
  }
  knocks.length = 0;
}
// a blow lasts a moment: brittle material takes a few times its steady load before it cracks
const IMPACT_FACTOR = 3;

// After each physics step: impacts on brittle parts, then every joint's load against what its pins can take.
export function checkJoints() {
  if (!listening) { listening = true; listen(); }   // (the physics world does not exist yet when this module loads)
  crackOnImpact();
  for (const rec of jrecs.slice()) {
    if (!rec.j) continue;
    const f = rec.j.getReactionForce(1 / DT), F = Math.hypot(f.x, f.y);
    rec.load = rec.load === undefined ? F : rec.load * 0.7 + F * 0.3;      // (smoothed: one jolt is not a pull)
    const capA = pinCapacity(rec.A, rec.localA), capB = rec.B ? pinCapacity(rec.B, rec.localB) : Infinity;
    rec.cap = Math.min(capA, capB);
    if (!(rec.load > rec.cap)) continue;
    const rb = capA <= capB ? rec.A : rec.B, local = rb === rec.A ? rec.localA : rec.localB;
    const where = rb.b.getWorldPoint(local), pull = rb === rec.A ? planck.Vec2(-f.x, -f.y) : f;
    removeJoint(rec);
    const brittle = tearAt(rb, local, pull);
    G.broke = { x: where.x / S, y: where.y / S, mat: rb.mat, sol: rb.sol, sx: rb.sx, kind: rec.kind, brittle, load: rec.load, cap: rec.cap };
    refit(rb);
  }
}
