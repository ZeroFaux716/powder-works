import * as planck from 'planck';
import { Sim } from '../../src/sim/index.js';
const { W, H, S, ID } = Sim;
const secs = +(process.argv[3] || 30);
Sim.loadPreset('engine');
const [piston, wheel] = [...Sim.bodies.values()];
const fuel = () => { let u = 0; for (let i = 0; i < W * H; i++) if (Sim.type[i] === ID.gasoline) u += Sim.st[i] === Sim.GAS ? Math.max(1, Sim.life[i]) : 64 - Sim.life[i]; return u; };
const chamber = () => { let air = 0, exh = 0, vap = 0, fresh = 0; const face = Math.round(piston.b.getPosition().x / S - 4); for (let y = 96; y <= 111; y++) for (let x = 30; x < face; x++) { const i = y * W + x; if (Sim.st[i] === 0) air++; else if (Sim.type[i] === ID.fire) exh++; if (Sim.st[i] === 0) fresh += Sim.ox[i]; else if (Sim.type[i] === ID.gasoline) vap++; } return air + ' air cells, ' + (100 * fresh / Math.max(1, air)).toFixed(0) + '% fresh, ' + vap + ' fuel'; };
let fires = 0, wasFire = false, sparks = 0, last = wheel.b.getAngle(), a0 = last;
const f0 = fuel();
for (let f = 1; f <= secs * 60; f++) {
  const litNow = Sim.lit[110 * W + 34] > 0;
  Sim.step();
  let burning = 0; for (let y = 96; y <= 118; y++) for (let x = 30; x <= 60; x++) if (Sim.type[y * W + x] === ID.fire && Sim.temp[y * W + x] > 1400) burning++;
  if (burning > 8 && !wasFire) fires++;
  wasFire = burning > 8;
  if (Sim.lit[110 * W + 34] > 0 && !litNow) sparks++;
  if (f % 120 === 0) {
    const a = wheel.b.getAngle();
    console.log('t=' + f / 60 + 's', 'revs', ((a - a0) / 6.2832).toFixed(1), 'rpm', ((a - last) / 6.2832 * 30).toFixed(0), 'sparks', sparks, 'firings', fires, 'fuel units', fuel().toFixed(0) + '/' + f0, '| chamber now:', chamber(), '| tank', (() => { let m = 0, n = 0; for (let i = 0; i < W * H; i++) if (Sim.type[i] === ID.gasoline && Sim.st[i] === Sim.LIQUID) { n++; m = Math.max(m, Sim.temp[i]); } return n + ' cells ' + m.toFixed(0) + 'C'; })(), '| piston', 'T', Math.round(Math.max(...piston.foot.map(i => Sim.temp[i]))));
    last = a;
  }
}
