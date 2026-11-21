import * as planck from 'planck';
import { Sim } from '../src/sim/index.js';
const { W, H, S, ID } = Sim;
const V = planck.Vec2;
const run = n => { for (let f = 0; f < n; f++) Sim.step(); };
const count = (key, test) => { let n = 0; for (let i = 0; i < W * H; i++) if (Sim.type[i] === ID[key] && (!test || test(i % W, (i / W) | 0))) n++; return n; };
// 1. push water along a full pipe and out of the far end
Sim.loadPreset('blank');
Sim.fill(60, 97, 160, 99, 'wall'); Sim.fill(60, 108, 160, 110, 'wall');
Sim.fill(72, 100, 160, 107, 'water');
const pis = Sim.addBody(Sim.cellsRect(64, 100, 71, 107), ID.Fe);
Sim.makeJoint('slider', pis, null, V(68 * S, 104 * S), V(1, 0));
const w0 = count('water');
const g = Sim.grab(pis, 68, 104);
for (let f = 1; f <= 120; f++) { g.setTarget(V((68 + f * 0.4) * S, 104 * S)); Sim.step(); }
console.log('pipe: piston moved', (pis.b.getPosition().x / S - 68).toFixed(1), 'cells, water inside pipe', count('water', (x, y) => x <= 160 && y >= 100 && y <= 107), 'of', w0, ', spilled out', count('water', (x, y) => x > 160 || y > 110), ', total', count('water'));
Sim.ungrab(g);
// 2. sealed pipe: piston stops, pressure rises
Sim.loadPreset('blank');
Sim.fill(60, 97, 163, 99, 'wall'); Sim.fill(60, 108, 163, 110, 'wall'); Sim.fill(161, 100, 163, 107, 'wall');
Sim.fill(72, 100, 160, 107, 'water');
const p2 = Sim.addBody(Sim.cellsRect(64, 100, 71, 107), ID.Fe);
Sim.makeJoint('slider', p2, null, V(68 * S, 104 * S), V(1, 0));
const g2 = Sim.grab(p2, 68, 104);
g2.setTarget(V(90 * S, 104 * S));
let pk = 0; for (let f = 0; f < 120; f++) { Sim.step(); pk = Math.max(pk, (Sim.P[104 * W + 150] + Sim.LP[104 * W + 150])); }
console.log('sealed pipe: piston moved', (p2.b.getPosition().x / S - 68).toFixed(1), 'cells, water pressure at the far end peaked at', pk.toFixed(1), 'atm, now', (Sim.P[104 * W + 150] + Sim.LP[104 * W + 150]).toFixed(1));
// 3. hydraulic press scene
Sim.loadPreset('hydraulic');
const [ram, plat, load] = [...Sim.bodies.values()];
const y = b => b.b.getPosition().y / S;
const r0 = y(ram), q0 = y(plat);
const region = (x0, y0, x1, y1) => count('water', (x, yy) => x >= x0 && x <= x1 && yy >= y0 && yy <= y1);
let top = 0; for (let f = 1; f <= 1200; f++) { Sim.step(); top = Math.max(top, q0 - y(plat)); if (f === 1200) console.log('highest the platform ever got', top.toFixed(1)); if (f % 150 === 0) console.log('press f', f, 'ram down', (y(ram) - r0).toFixed(1), 'platform up', (q0 - y(plat)).toFixed(1), 'tilt', plat.b.getAngle().toFixed(2), '| water: left bore', region(73, 60, 78, 132), 'channel', region(79, 124, 121, 132), 'right bore', region(122, 60, 151, 132), 'elsewhere', count('water') - region(73, 60, 151, 132), '| P under platform', (Sim.P[125 * W + 136] + Sim.LP[125 * W + 136]).toFixed(2)); }
// 4. floating
const pool = liquid => { Sim.loadPreset('blank'); Sim.fill(88, 100, 90, 145, 'wall'); Sim.fill(151, 100, 153, 145, 'wall'); Sim.fill(91, 120, 150, 145, liquid); };
for (const [liquid, metal] of [['water', 'Fe'], ['water', 'Na'], ['Hg', 'Fe'], ['Hg', 'W'], ['water', 'Li']]) {
  pool(liquid);
  const b = Sim.addBody(Sim.cellsRect(112, 100, 127, 107), ID[metal]);
  run(600);
  console.log(metal, 'block dropped in', liquid + ': centre at row', y(b).toFixed(1), '(surface near 119, floor 146), tilt', b.b.getAngle().toFixed(2), 'speed', b.b.getLinearVelocity().y.toFixed(2), 'liquid', count(liquid));
}
const t0 = Date.now(); Sim.loadPreset('hydraulic'); run(300); console.log('ms/step', ((Date.now() - t0) / 300).toFixed(2));
