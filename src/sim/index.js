// The simulation's public face: everything re-exported, and the Sim object the tests use.
import { GAS, H, LIQUID, NONE, P0, PART, POWDER, S, STATIC, W } from './constants.js';
import { ID, MATS } from './materials.js';
import { NE0, PAIR_ACT, PAIR_PRODUCT } from './chemdata.js';
import { CAPS, CPDI, stateAt } from './tables.js';
import { G, LP, aux, pairKey, passPairs, bid, bodies, ddir, dset, fan, gate, lat, life, lit, ox, st, type, world } from './grid.js';
import { burn, made, need } from './reactions.js';
import { spark } from './electrics.js';
import { emit, nFast, nX, nY } from './neutrons.js';
import { FX, FY, P, temp } from './flow.js';
import { bodiesAt, letPass, partCovers, removeBody } from './parts.js';
import { grab, jointNear, jointPoint, jrecs, longAxis, makeJoint, movePart, removeJoint, setJointKind, setMotor, setSpring, snapPoint, springEnds, ungrab } from './joints.js';
import { clearAll, restore, snapshot, step } from './world.js';
import { addBody, cellsDisc, cellsRect, draft, fill, finishPart, makePart, paint } from './editing.js';
import { loadPreset } from './scenes.js';

export * from './constants.js';
export * from './materials.js';
export * from './chemdata.js';
export * from './tables.js';
export * from './grid.js';
export * from './reactions.js';
export * from './electrics.js';
export * from './neutrons.js';
export * from './cells.js';
export * from './flow.js';
export * from './parts.js';
export * from './joints.js';
export * from './world.js';
export * from './editing.js';
export * from './scenes.js';

export const Sim = {
  W, H, P0, S, MATS, ID, NONE, STATIC, POWDER, LIQUID, GAS, PART, type, st, life, bid, bodies,
  setOpenEdges(v) { G.openEdges = v; }, fan, lit, dset, gate, ddir, setPaintDir(d) { G.paintDir = d; }, need, made, CPDI, NE0, PAIR_PRODUCT, PAIR_ACT, takeNews() { const m = G.madeNews; G.madeNews = null; return m; }, burn, spark, get FX() { return FX; }, get FY() { return FY; }, nX, nY, nFast, emit, get neutrons() { return G.nCount; }, get temp() { return temp; }, get P() { return P; }, get world() { return world; },
  lat, aux, ox, LP, CAPS, jrecs, springEnds, setSpring, step, paint, finishPart, addBody, cellsRect, cellsDisc, removeBody, loadPreset, clearAll, fill, stateAt,
  bodiesAt, makeJoint, removeJoint, setJointKind, setMotor, jointPoint, jointNear, snapPoint, longAxis,
  movePart, grab, ungrab, snapshot, restore, makePart, passPairs, pairKey, letPass, partCovers, draft
};
