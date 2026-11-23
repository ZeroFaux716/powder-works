// Live information about parts and joints, in real units, for the inspector.
//
// The physics engine works in metres and seconds (a cell is 10 cm) but treats parts as flat sheets: an iron
// cell weighs 10 g to it. Taking parts as 10 cm thick instead makes an iron cell 7.87 kg, as it would be, so
// masses, forces, torques, energies and powers are all shown that many times larger (MASS_SCALE), which keeps
// them consistent with each other and with the motion. Two things differ from the real world: gravity here is
// 14 m/s^2, and the engine squeezes very light and very dense materials into a narrower range for stable
// physics, so those parts move as if lighter or heavier than they are (the part's info says so).
import { DT, GRAVITY, S } from './constants.js';
import { MATS } from './materials.js';
import { DENS_LO, DENS_HI } from './parts.js';
import { partStrength, isBrittle } from './strength.js';
import { meltWith, massOf, alloyName } from './alloys.js';

export const MASS_SCALE = 787;                 // real kg per physics-engine kg, for a part 10 cm thick
const RPM = 60 / (2 * Math.PI);

// One reading: key (for graphing), label, value (a number, or null), unit, and how many decimals to show.
const q = (key, label, value, unit, dp = 1, note) => ({ key, label, value, unit, dp, note });

// The mass a part moves with, in kg: the physics engine's, at MASS_SCALE. It is less than its cells of solid
// metal would weigh, because the engine trims a thin skin off each part so it can slide in a bore (a part one cell
// thick keeps about half its area); the cells' weight is given alongside. All forces, torques and energies use
// the engine's mass, so they agree with each other and with the motion.
export function movingMass(rb) {
  let n = 0;
  for (let k = 0; k < rb.occ.length; k++) if (rb.occ[k]) n++;
  return { n, m: rb.b.getMass() * MASS_SCALE, k: MASS_SCALE };
}
// clockwise is positive, as for motors
const CW = w => w * RPM;

export function partInfo(rb, joints, nameOf) {
  const b = rb.b, { n, m, k: kM } = movingMass(rb), I = b.getInertia() * kM;
  const v = b.getLinearVelocity(), w = b.getAngularVelocity(), speed = Math.hypot(v.x, v.y);
  let tsum = 0, tmax = -Infinity;
  for (let k = 0; k < rb.occ.length; k++) if (rb.occ[k]) { tsum += rb.temps[k]; if (rb.temps[k] > tmax) tmax = rb.temps[k]; }
  const c = b.getWorldCenter(), mat = MATS[rb.mat];
  const cellsMass = n * mat.dens;                    // its cells as 10 cm cubes of the material, kg
  const evened = mat.dens / 7.87 < DENS_LO || mat.dens / 7.87 > DENS_HI;
  const out = [
    q('mass', 'Mass', m, 'kg', m < 100 ? 1 : 0, 'as the physics moves it; its cells of solid ' + mat.name.toLowerCase() + ' would be ' + fmt(cellsMass, 0) +
      ' kg (parts get a thin skin so they slide in bores' + (evened ? ', and very light and very dense materials are evened out' : '') + ')'),
    q('area', 'Size', n, 'cells', 0, (n * 0.01).toFixed(2) + ' m²'),
    q('speed', 'Speed', speed, 'm/s', 2),
    q('spin', 'Spin', CW(w), 'rpm', 1, 'clockwise is positive'),
    q('ke', 'Moving energy', 0.5 * m * speed * speed, 'J', 0),
    q('re', 'Spinning energy', 0.5 * I * w * w, 'J', 0),
    q('mom', 'Momentum', m * speed, 'kg·m/s', 0),
    q('amom', 'Angular momentum', I * w, 'kg·m²/s', 0),
    q('height', 'Height', (150 - c.y / S) * S, 'm', 2, 'of its centre above the bottom of the bench'),
    q('temp', 'Temperature', n ? tsum / n : 20, '°C', 0, 'hottest ' + Math.round(tmax) + ' °C'),
    q('strength', 'Strength', partStrength(rb), 'MPa', 0, isBrittle(rb.mat, rb.sol, rb.sx) ? 'brittle' : 'tough'),
    q('melt', 'Melts at', meltWith(rb.mat, rb.sx), '°C', 0),
  ];
  for (const rec of joints) if (rec.cap) {
    const other = rec.B ? (rec.A === rb ? rec.B : rec.A) : null;
    out.push(q('load' + rec.id, jointName(rec) + (other ? ' to ' + (nameOf ? nameOf(other) : MATS[other.mat].name).toLowerCase() : ' to background'), 100 * rec.load / rec.cap, '% of limit', 0));
  }
  return out;
}

const jointName = rec => rec.kind[0].toUpperCase() + rec.kind.slice(1);

export function jointInfo(rec) {
  const j = rec.j, out = [];
  const loadN = (rec.load || 0) * MASS_SCALE;
  if (rec.kind === 'hinge' || rec.kind === 'motor') {
    const ang = -j.getJointAngle() * 180 / Math.PI, spd = j.getJointSpeed();
    out.push(q('angle', 'Angle', ((ang % 360) + 360) % 360, '°', 0, rec.B ? 'between the two parts, from how they were joined' : 'turned from where it was pinned'));
    out.push(q('turns', 'Turns', ang / 360, '', 1));
    out.push(q('rpm', 'Speed', -spd * RPM, 'rpm', 1, 'clockwise is positive'));
    if (rec.kind === 'motor') {
      const torque = Math.abs(j.getMotorTorque(1 / DT)) * MASS_SCALE, max = rec.strength * MASS_SCALE;
      out.push(q('set', 'Set to', rec.spin * RPM, 'rpm', 1));
      out.push(q('torque', 'Torque', torque, 'N·m', 0, isFinite(max) ? 'of ' + fmt(max, 0) + ' N·m it has' : 'of unlimited'));
      out.push(q('power', 'Power', torque * Math.abs(spd), 'W', 0));
    }
  } else if (rec.kind === 'slider') {
    out.push(q('pos', 'Position', j.getJointTranslation(), 'm', 2, 'along its track from where it was set'));
    out.push(q('vel', 'Speed', j.getJointSpeed(), 'm/s', 2));
  } else if (rec.kind === 'spring') {
    const a = j.getAnchorA(), bb = j.getAnchorB(), len = Math.hypot(a.x - bb.x, a.y - bb.y) / S;
    const stretch = len - rec.len, F = loadN;
    out.push(q('len', 'Length', len, 'cells', 1, 'rests at ' + fmt(rec.len, 1)));
    out.push(q('stretch', 'Stretch', stretch, 'cells', 1));
    out.push(q('force', 'Force', F, 'N', 0));
    out.push(q('energy', 'Stored energy', 0.5 * F * Math.abs(stretch) * S, 'J', 0));
  }
  out.push(q('load', 'Load', loadN, 'N', 0));
  if (rec.cap) out.push(q('loadpct', 'Of its limit', 100 * rec.load / rec.cap, '%', 0));
  return out;
}

export function fmt(v, dp) {
  if (v === null || v === undefined || !isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(2) + ' M';
  if (a >= 1e4) return (v / 1e3).toFixed(1) + ' k';
  return v.toFixed(dp);
}
