// springs: a block hung from the background bounces and settles; a spring between two parts; rewind keeps it
import * as planck from 'planck';
import { Sim } from '../../src/sim/index.js';
const { W, H, S } = Sim;
Sim.loadPreset('blank');
const blk = Sim.addBody(Sim.cellsRect(100, 60, 109, 67), Sim.ID.Fe);
const rec = Sim.makeJoint('spring', blk, null, planck.Vec2(104.5 * S, 60 * S), planck.Vec2(104.5 * S, 30 * S));
const ys = [];
for (let f = 1; f <= 360; f++) { Sim.step(); if (f % 20 === 0) ys.push((blk.b.getPosition().y / S).toFixed(1)); }
console.log('hanging block centre y every 1/3 s:', ys.join(' '), '| spring length', rec.len.toFixed(1));
const snap = Sim.snapshot();
Sim.setSpring(rec, 1, 0.1, 10);
for (let f = 0; f < 120; f++) Sim.step();
console.log('softer, shorter spring: block y', (blk.b.getPosition().y / S).toFixed(1));
Sim.restore(snap);
const r2 = Sim.jrecs[0];
console.log('after rewind: joints', Sim.jrecs.length, r2.kind, 'len', r2.len.toFixed(1), 'hz', r2.hz, 'block y', ([...Sim.bodies.values()][0].b.getPosition().y / S).toFixed(1));
for (let f = 0; f < 60; f++) Sim.step();
console.log('keeps running: block y', ([...Sim.bodies.values()][0].b.getPosition().y / S).toFixed(1));
