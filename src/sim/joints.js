// Hinges, motors, sliders and springs, and moving parts by hand.
import * as planck from 'planck';
import { S } from './constants.js';
import { G, bodies, world } from './grid.js';
import { liftBody, placeBody } from './parts.js';

// ---------- joints ----------
// Every joint has a primary part A. B is a second part, or null for the background.
// Hinges and motors pin A to B at a point; sliders let A move only along a straight track.
export const jrecs = [];

export function dropJoint(rec) {
  if (rec.anchorBody) { world.destroyBody(rec.anchorBody); rec.anchorBody = null; }
  else if (rec.j) world.destroyJoint(rec.j);
  rec.j = null;
}

// Where each end of a spring is now, in the world.
export function springEnds(rec) {
  return [rec.A.b.getWorldPoint(rec.localA), rec.B ? rec.B.b.getWorldPoint(rec.localB) : rec.worldB];
}
export function buildJoint(rec, anchor, anchorB) {
  if (rec.kind === 'spring') {
    // a spring joins a point on A to a point on B (or on the background), pulling them back to its length
    const [a0, b0] = anchorB ? [anchor, anchorB] : springEnds(rec);
    const other = rec.B ? rec.B.b : (rec.anchorBody = world.createBody({ type: 'static', position: b0 }));
    rec.j = world.createJoint(planck.DistanceJoint({ collideConnected: true, frequencyHz: rec.hz, dampingRatio: rec.damp, length: rec.len * S }, rec.A.b, other, a0, b0));
    rec.localA = rec.A.b.getLocalPoint(a0);
    rec.localB = rec.B ? rec.B.b.getLocalPoint(b0) : null;
    rec.worldB = rec.B ? null : b0;
    rec.A.b.setAwake(true);
    return;
  }
  const other = rec.B ? rec.B.b : (rec.anchorBody = world.createBody({ type: 'static', position: anchor }));
  if (rec.kind === 'slider') {
    rec.j = world.createJoint(planck.PrismaticJoint({ collideConnected: false }, other, rec.A.b, anchor, rec.axis));
  } else {
    rec.j = world.createJoint(planck.RevoluteJoint({
      collideConnected: false, enableMotor: rec.kind === 'motor',
      motorSpeed: -rec.spin, maxMotorTorque: Math.min(rec.strength, 1e12)
    }, rec.A.b, other, anchor));
  }
  rec.localA = rec.A.b.getLocalPoint(anchor);
  rec.localB = rec.B ? rec.B.b.getLocalPoint(anchor) : null;
  rec.A.b.setAwake(true);
}

export function makeJoint(kind, A, B, anchor, axis) {
  const rec = { id: G.nextJointId++, kind, A, B: kind === 'slider' ? null : B, axis: kind === 'spring' ? null : axis || null, spin: Math.PI, strength: 60, j: null, anchorBody: null,
    hz: 3, damp: 0.3, len: kind === 'spring' ? Math.hypot(anchor.x - axis.x, anchor.y - axis.y) / S : 0 };
  if (kind === 'spring') buildJoint(rec, anchor, axis);   // for a spring the fifth argument is its other end
  else buildJoint(rec, anchor);
  jrecs.push(rec);
  return rec;
}

export function removeJoint(rec) {
  const k = jrecs.indexOf(rec);
  if (k < 0) return;
  dropJoint(rec);
  jrecs.splice(k, 1);
}

export function setJointKind(rec, kind) {
  if (rec.kind === 'slider' || kind === 'slider' || rec.kind === 'spring' || kind === 'spring') return;
  rec.kind = kind;
  rec.j.enableMotor(kind === 'motor');
  rec.j.setMotorSpeed(-rec.spin);
  rec.j.setMaxMotorTorque(Math.min(rec.strength, 1e12));
  rec.A.b.setAwake(true);
}

// A spring's stiffness (how many times a second it would bounce), damping (0 none, 1 no bounce) and length in cells.
export function setSpring(rec, hz, damp, len) {
  rec.hz = hz; rec.damp = damp; rec.len = len;
  rec.j.setFrequency(hz); rec.j.setDampingRatio(damp); rec.j.setLength(len * S);
  rec.A.b.setAwake(true);
  if (rec.B) rec.B.b.setAwake(true);
}

// spin: radians per second the part turns, positive is clockwise on screen
export function setMotor(rec, spin, strength) {
  rec.spin = spin; rec.strength = strength;
  if (rec.kind !== 'motor') return;
  rec.j.setMotorSpeed(-spin);
  rec.j.setMaxMotorTorque(Math.min(strength, 1e12));     // "inf" is stored as given, the engine gets a huge finite number
  rec.A.b.setAwake(true);
}

// Where the joint sits on its primary part, in cells.
export function jointPoint(rec) {
  const p = rec.A.b.getWorldPoint(rec.localA);
  return [p.x / S, p.y / S];
}

export function jointNear(fx, fy, reach, noSprings) {
  let best = null, bd = reach;
  for (const rec of jrecs) {
    if (rec.kind === 'spring' && noSprings) continue;
    let [x, y] = jointPoint(rec);
    if (rec.kind === 'spring') { const [a, b] = springEnds(rec); x = (a.x + b.x) / 2 / S; y = (a.y + b.y) / 2 / S; }   // a spring is picked by its middle
    const d = Math.hypot(x - fx, y - fy);
    if (d <= bd) { bd = d; best = rec; }
  }
  return best;
}

// Snap a point (in cells) to an existing joint, then to a part's centre, then to the cell centre.
export function snapPoint(fx, fy) {
  const j = jointNear(fx, fy, 2.2, true);
  if (j) { const [x, y] = jointPoint(j); return { x, y, joint: j }; }
  let best = null, bd = 2.5;
  for (const rb of bodies.values()) {
    const c = rb.b.getWorldCenter();
    const d = Math.hypot(c.x / S - fx, c.y / S - fy);
    if (d <= bd) { bd = d; best = [c.x / S, c.y / S]; }
  }
  if (best) return { x: best[0], y: best[1], center: true };
  return { x: Math.floor(fx) + 0.5, y: Math.floor(fy) + 0.5 };
}

export function longAxis(rb) {
  const a = rb.b.getAngle();
  return rb.w >= rb.h ? planck.Vec2(Math.cos(a), Math.sin(a)) : planck.Vec2(-Math.sin(a), Math.cos(a));
}

// Move or turn a part by hand. Joints on it come along: a pin stays where it was on the moved part.
export function movePart(rb, x, y, angle) {
  const op = rb.b.getPosition(), oldX = op.x, oldY = op.y, oldA = rb.b.getAngle();
  liftBody(rb);
  rb.b.setTransform(planck.Vec2(x, y), angle);
  if (!placeBody(rb)) {
    rb.b.setTransform(planck.Vec2(oldX, oldY), oldA);
    placeBody(rb);
    return false;
  }
  rb.lastPos = planck.Vec2(x, y); rb.lastAngle = angle;
  rb.b.setLinearVelocity(planck.Vec2(0, 0));
  rb.b.setAngularVelocity(0);
  const dA = angle - oldA, c = Math.cos(dA), s = Math.sin(dA);
  for (const rec of jrecs) {
    if (rec.A !== rb && rec.B !== rb) continue;
    if (rec.kind === 'spring') { const ends = springEnds(rec); dropJoint(rec); buildJoint(rec, ends[0], ends[1]); continue; }
    const anchor = rb.b.getWorldPoint(rec.A === rb ? rec.localA : rec.localB);
    if (rec.axis && dA) rec.axis = planck.Vec2(c * rec.axis.x - s * rec.axis.y, s * rec.axis.x + c * rec.axis.y);
    dropJoint(rec);
    buildJoint(rec, anchor);
  }
  rb.b.setAwake(true);
  return true;
}

// Dragging a part while the simulation runs pulls it with a spring.
export function grab(rb, fx, fy) {
  if (!G.grabBase) G.grabBase = world.createBody();
  return world.createJoint(planck.MouseJoint({ maxForce: 250 * rb.b.getMass(), frequencyHz: 5, dampingRatio: 0.7 }, G.grabBase, rb.b, planck.Vec2(fx * S, fy * S)));
}
export function ungrab(j) {
  for (let k = world.getJointList(); k; k = k.getNext()) if (k === j) { world.destroyJoint(j); return; }
}
