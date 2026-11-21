// The ready-made scenes.
import * as planck from 'planck';
import { AMBIENT, GAS, H, N, POWDER, S, STATIC, W } from './constants.js';
import { ID, MATS } from './materials.js';
import { SOLIDST, stateAt } from './tables.js';
import { CONTACT, DEV_DEFAULT, ELECTRODE, HEATER, INJECTOR, INJ_UNITS, INVERTER, PLUG, PUMP, SENSE_C, SENSE_T, SWITCH, VALVE, WIRE, clearCell, ddir, dset, fan, life, ox, st, type } from './grid.js';
import { temp } from './flow.js';
import { rebuildGround } from './parts.js';
import { makeJoint, setSpring } from './joints.js';
import { clearAll } from './world.js';
import { TRAYS, addBody, cellsDisc, cellsLine, cellsRect, fill, offCells } from './editing.js';

export function loadPreset(name) {
  clearAll();
  const V = planck.Vec2;
  fill(0, H - 4, W - 1, H - 1, 'wall');                 // ground
  if (name === 'crank') {
    fill(27, 93, 90, 95, 'wall');                       // barrel top
    fill(27, 112, 90, 114, 'wall');                     // barrel bottom
    fill(27, 96, 29, 111, 'wall');                      // closed end
    fill(48, 115, 51, H - 5, 'wall');                   // legs
    fill(80, 115, 83, H - 5, 'wall');
    fill(50, 93, 52, 95, null);                         // exhaust port, uncovered near the end of the stroke
    fill(30, 104, 39, 111, 'gasoline');
    const piston = addBody(cellsRect(40, 96, 47, 111));
    const wheel = addBody(cellsDisc(134, 104, 15));
    const pinX = 134 - 10 * Math.cos(0.44), pinY = 104 - 10 * Math.sin(0.44);
    const rod = addBody(cellsLine(48, 104, pinX, pinY, 1));
    makeJoint('hinge', wheel, null, V(134 * S, 104 * S));            // axle on the background
    makeJoint('hinge', rod, wheel, V(pinX * S, pinY * S));
    makeJoint('hinge', rod, piston, V(48 * S, 104 * S));
    makeJoint('slider', piston, null, V(44 * S, 104 * S), V(1, 0));
  } else if (name === 'engine') {
    // A uniflow two-stroke: a blower feeds air in through ports the piston uncovers at the bottom of its
    // stroke, and the burnt gas leaves through a valve in the head that a second contact holds open.
    const cx = 134, cy = 104;
    fill(24, 93, 90, 95, 'wall');                       // barrel roof
    fill(24, 112, 90, 114, 'wall');                     // barrel floor
    fill(24, 96, 29, 111, 'wall');                      // closed end (the head)
    for (let y = 93; y <= 95; y++) for (let x = 31; x <= 36; x++) fan[y * W + x] = VALVE;   // exhaust valve
    fill(29, 86, 30, 92, 'wall'); fill(37, 86, 38, 92, 'wall');                             // exhaust stack
    fill(52, 112, 57, 114, null);                       // air ports in the floor, uncovered near the bottom of the stroke
    fill(49, 115, 51, 128, 'wall'); fill(58, 115, 60, 128, 'wall');          // air duct up to the ports
    for (let y = 119; y <= 125; y++) for (let x = 52; x <= 57; x++) fan[y * W + x] = 3;   // blower
    // throttle: a valve across the mouth of the air duct, held open by a switch; its setting is how far it opens
    for (let x = 52; x <= 57; x++) fan[128 * W + x] = VALVE;
    for (let x = 52; x <= 66; x++) fan[129 * W + x] = WIRE;
    for (let y = 129; y <= 130; y++) for (let x = 67; x <= 68; x++) fan[y * W + x] = SWITCH;
    fill(80, 115, 83, H - 5, 'wall');                   // a leg at the crank end only, so the blower can draw fresh air from underneath
    fill(3, 93, 5, 109, 'wall'); fill(3, 107, 19, 109, 'wall'); fill(17, 93, 19, 109, 'wall');   // fuel tank, set apart from the hot cylinder
    fill(6, 99, 16, 106, 'gasoline');
    const piston = addBody(cellsRect(40, 96, 59, 111), ID.Al);   // long enough to keep the ports shut from behind
    // flywheel with a timing lobe on its rim
    const lob = [4.86, -16.28];
    const wheel = addBody([...new Set(cellsDisc(cx, cy, 15).concat(cellsDisc(cx + lob[0], cy + lob[1], 2.6)))]);
    const pinX = cx - 10 * Math.cos(0.44), pinY = cy - 10 * Math.sin(0.44);
    const rod = addBody(cellsLine(60, 104, pinX, pinY, 1));
    makeJoint('hinge', wheel, null, V(cx * S, cy * S));
    makeJoint('hinge', rod, wheel, V(pinX * S, pinY * S));
    makeJoint('hinge', rod, piston, V(60 * S, 104 * S));
    makeJoint('slider', piston, null, V(50 * S, 104 * S), V(1, 0));   // carries the piston's weight, so it does not drag along the bore
    // Ignition: a contact the lobe passes over at the top of the stroke, wired to the injector and the spark plug.
    for (let y = 84; y <= 86; y++) for (let x = 134; x <= 140; x++) fan[y * W + x] = CONTACT;   // out of reach of the rim, only the lobe touches it
    fan[83 * W + 140] = WIRE;
    for (let x = 1; x <= 140; x++) fan[82 * W + x] = WIRE;
    for (let y = 82; y <= 131; y++) fan[y * W + 1] = WIRE;
    for (let x = 1; x <= 15; x++) fan[102 * W + x] = WIRE;
    for (let x = 16; x <= 30; x++) fan[103 * W + x] = INJECTOR;      // from the tank, through the wall, into the cylinder
    for (let y = 104; y <= 107; y++) fan[y * W + 16] = INJECTOR;     // picking up from the bottom of the tank
    for (let x = 1; x <= 34; x++) fan[131 * W + x] = WIRE;
    for (let y = 112; y <= 131; y++) fan[y * W + 34] = WIRE;
    for (let y = 110; y <= 111; y++) for (let x = 33; x <= 35; x++) fan[y * W + x] = PLUG;
    // Exhaust timing: an arc under the wheel that the lobe sweeps from late in the power stroke until the air ports shut.
    let ex = 0, ey = 0;
    for (let a = 1.05; a <= 3.65; a += 0.01) {
      const c = Math.cos(a), sn = Math.sin(a), dx = c * lob[0] - sn * lob[1], dy = sn * lob[0] + c * lob[1], L = Math.hypot(dx, dy);
      for (const r of [18, 18.7, 19.4]) {
        const x = Math.round(cx + dx / L * r), y = Math.round(cy + dy / L * r);
        fan[y * W + x] = CONTACT;
        if (x > ex) { ex = x; ey = y; }
      }
    }
    for (let x = ex + 1; x <= 158; x++) fan[ey * W + x] = WIRE;
    for (let y = 88; y <= ey; y++) fan[y * W + 158] = WIRE;
    for (let x = 34; x <= 158; x++) fan[88 * W + x] = WIRE;
    for (let y = 88; y <= 92; y++) fan[y * W + 34] = WIRE;
    wheel.b.setAngularVelocity(9);                      // already turning, as if someone has just pulled the starter cord
    // a first charge of vapour so it fires on the first spark
    for (let y = 96; y <= 111; y++) for (let x = 30; x <= 39; x++) if ((x * 7 + y * 3) % 9 < 2) { const i = y * W + x; type[i] = ID.gasoline; st[i] = GAS; life[i] = INJ_UNITS; }
  } else if (name === 'cylinder') {
    fill(27, 93, 150, 95, 'wall');                      // barrel top
    fill(27, 112, 150, 114, 'wall');                    // barrel bottom
    fill(27, 96, 29, 111, 'wall');                      // closed end
    fill(50, 115, 53, H - 5, 'wall');                   // legs
    fill(120, 115, 123, H - 5, 'wall');
    fill(30, 109, 64, 111, 'gasoline');
    addBody(cellsRect(65, 96, 72, 111));
    fill(188, 118, 226, H - 5, 'sand');
  } else if (name === 'steam') {
    fill(109, 50, 111, 128, 'wall');
    fill(128, 50, 130, 128, 'wall');
    fill(112, 127, 127, 128, 'Cu');                     // copper boiler plate
    fill(112, 113, 127, 126, 'water');
    addBody(cellsRect(112, 104, 127, 109));
    fill(96, 129, 98, H - 5, 'wall');                   // firebox sides
    fill(141, 129, 143, H - 5, 'wall');
  } else if (name === 'thermite') {
    fill(76, 112, 79, H - 5, 'wall');                   // two posts
    fill(160, 112, 163, H - 5, 'wall');
    const beam = addBody(cellsRect(74, 106, 165, 108));
    makeJoint('hinge', beam, null, V(78 * S, 107.5 * S));
    makeJoint('hinge', beam, null, V(162 * S, 107.5 * S));
    fill(110, 97, 130, 105, 'thermite');
    fill(120, 89, 120, 98, 'Mg');                       // magnesium fuse, its tip just in the pile (deeper in, it would have no air to burn with)
  } else if (name === 'reactor') {
    fill(87, 96, 89, H - 5, 'wall');                    // vessel
    fill(151, 96, 153, H - 5, 'wall');
    fill(90, 108, 150, H - 5, 'water');
    for (let x = 98; x <= 138; x += 8) fill(x, 112, x + 1, 141, 'U');           // fuel rods
    fill(119, 143, 120, 144, 'Cf');                     // neutron source
    // boron control rods hang from one bar that can only slide up and down
    let cells = cellsRect(96, 104, 144, 106);
    for (let x = 102; x <= 134; x += 8) cells = cells.concat(cellsRect(x, 107, x + 1, 141));
    for (const i of cells) clearCell(i);
    const rods = addBody(cells, ID.B);
    makeJoint('slider', rods, null, V(120 * S, 105.5 * S), V(0, 1));
  } else if (name === 'diesel') {
    fill(108, 6, 110, 140, 'wall');                     // tall cylinder, closed at the bottom
    fill(127, 6, 129, 140, 'wall');
    fill(111, 138, 126, 140, 'wall');
    fill(111, 136, 126, 137, 'gasoline');
    addBody(cellsRect(111, 10, 126, 49), ID.W);          // heavy tungsten ram
  } else if (name === 'hydraulic') {
    // two cylinders joined underneath: a narrow one on the left, a wide one on the right
    fill(70, 60, 72, 132, 'wall'); fill(79, 60, 81, 120, 'wall');
    fill(119, 60, 121, 120, 'wall'); fill(152, 60, 154, 132, 'wall');
    fill(70, 133, 154, 135, 'wall'); fill(79, 121, 121, 123, 'wall');
    fill(73, 100, 78, 132, 'water'); fill(79, 124, 121, 132, 'water'); fill(122, 110, 151, 132, 'water');
    addBody(cellsRect(73, 76, 78, 99), ID.Fe);           // narrow iron ram, lighter than what it lifts
    addBody(cellsRect(122, 104, 151, 109), ID.Fe);       // wide platform
    addBody(cellsRect(130, 94, 143, 103), ID.Pb);        // the load
  } else if (name === 'wind') {
    fill(30, 78, 150, 80, 'wall');                       // duct roof
    fill(30, 97, 150, 99, 'wall');                       // duct floor
    for (let y = 81; y <= 96; y++) for (let x = 34; x <= 41; x++) fan[y * W + x] = 1;
    // a paddle wheel with only its top half in the stream
    let cells = cellsDisc(176, 100, 3);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 4;
      cells = cells.concat(cellsLine(176 - 13 * Math.cos(a), 100 - 13 * Math.sin(a), 176 + 13 * Math.cos(a), 100 + 13 * Math.sin(a), 1));
    }
    const wheel = addBody([...new Set(cells)], ID.Al);
    makeJoint('hinge', wheel, null, V(176 * S, 100 * S));
    fill(151, 100, 196, 102, 'wall'); fill(160, 100, 192, 102, null);   // shield under the stream, cut away for the wheel
  } else if (name === 'chem') {
    const box = (x0, y0, x1, y1) => { fill(x0, y0, x1, y0 + 1, 'wall'); fill(x0, y1 - 1, x1, y1, 'wall'); fill(x0, y0, x0 + 1, y1, 'wall'); fill(x1 - 1, y0, x1, y1, 'wall'); };
    // 1. sodium under chlorine: they react as soon as they meet, and leave salt
    box(8, 40, 59, 81);
    fill(10, 72, 57, 79, 'Na');
    fill(10, 42, 57, 71, 'Cl');
    // 2. iron and sulfur mixed in a dish: nothing happens until part of it is heated
    fill(68, 96, 122, 97, 'wall'); fill(68, 86, 69, 97, 'wall'); fill(121, 86, 122, 97, 'wall');
    for (let y = 88; y <= 95; y++) for (let x = 70; x <= 120; x++) {
      const i = y * W + x, m = MATS[(x + y) % 2 ? ID.Fe : ID.S];
      type[i] = m.id; st[i] = SOLIDST[m.id] === STATIC ? POWDER : SOLIDST[m.id]; temp[i] = AMBIENT;
    }
    // 4. a beaker of hydrochloric acid with a strip of zinc dipped in it: hydrogen bubbles off as the zinc dissolves
    fill(8, 100, 9, 136, 'wall'); fill(48, 100, 49, 136, 'wall'); fill(8, 135, 49, 136, 'wall');
    fill(10, 112, 47, 134, 'acid_Cl');
    fill(27, 96, 30, 126, 'Zn');
    // 5. a crucible of rust and charcoal with heaters in its walls: switch them on and iron is smelted out of it
    const cru = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { fan[y * W + x] = HEATER; dset[y * W + x] = 140; } };
    fill(76, 112, 77, 132, 'wall'); fill(112, 112, 113, 132, 'wall'); fill(76, 131, 113, 132, 'wall');
    cru(76, 112, 77, 132); cru(112, 112, 113, 132); cru(76, 131, 113, 132);
    for (let y = 116; y <= 130; y++) for (let x = 78; x <= 111; x++) { const i = y * W + x, m = MATS[(x + y) % 2 ? ID.rust : ID.C]; type[i] = m.id; st[i] = stateAt(m, AMBIENT); temp[i] = AMBIENT; }
    for (let x = 114; x <= 125; x++) fan[132 * W + x] = WIRE;
    for (let y = 131; y <= 132; y++) for (let x = 126; x <= 127; x++) { fan[y * W + x] = SWITCH; offCells.push(y * W + x); }
    // 3. a small plant: hydrogen and chlorine tanks with injectors into a chamber, a spark plug, a drain valve
    box(150, 30, 176, 52); fill(152, 32, 174, 50, 'H');
    box(185, 30, 211, 52); fill(187, 32, 209, 50, 'Cl');
    box(170, 62, 195, 84);
    for (let y = 64; y <= 82; y++) for (let x = 172; x <= 193; x++) ox[y * W + x] = 0;   // purged: no air in the chamber, so the hydrogen cannot just burn
    fill(180, 83, 185, 84, null);
    for (let y = 83; y <= 84; y++) for (let x = 180; x <= 185; x++) fan[y * W + x] = VALVE;   // drain
    fill(172, 90, 173, 112, 'wall'); fill(192, 90, 193, 112, 'wall'); fill(172, 111, 193, 112, 'wall');   // collecting jar
    for (const [x, sx] of [[173, 140], [188, 222]]) {
      for (let y = 51; y <= 66; y++) { fan[y * W + x] = INJECTOR; dset[y * W + x] = 3; }
      const a = Math.min(x + 1, sx + 2), b = Math.max(x - 1, sx - 1);
      for (let q = a; q <= b; q++) fan[57 * W + q] = WIRE;
      for (let y = 56; y <= 57; y++) for (let q = sx; q <= sx + 1; q++) { fan[y * W + q] = SWITCH; offCells.push(y * W + q); }
    }
    for (let y = 66; y <= 67; y++) for (let x = 180; x <= 181; x++) fan[y * W + x] = PLUG;   // up under the roof, where the two sprays meet
    for (let x = 182; x <= 221; x++) fan[68 * W + x] = WIRE;
    for (let y = 67; y <= 68; y++) for (let x = 222; x <= 223; x++) { fan[y * W + x] = SWITCH; offCells.push(y * W + x); }
    for (let x = 142; x <= 149; x++) fan[105 * W + x] = WIRE;
    for (let y = 85; y <= 105; y++) fan[y * W + 149] = WIRE;
    for (let x = 149; x <= 179; x++) fan[85 * W + x] = WIRE;
    for (let y = 104; y <= 105; y++) for (let x = 140; x <= 141; x++) { fan[y * W + x] = SWITCH; offCells.push(y * W + x); }
  } else if (name === 'refinery') {
    // A still: a pot of crude on an electric heater, with a column above it. Heaters in the column walls keep
    // each stretch of it at its own temperature, hottest at the bottom. Each fraction boils off the crude,
    // rises until it reaches a stretch cooler than its boiling point, turns back to liquid there and runs down
    // to that stretch's tray, which pipes it out to a jar. Fuel gas never cools enough: it goes on up into a gas holder.
    const heat = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { fan[y * W + x] = HEATER; dset[y * W + x] = c / 10; } };
    const L = 54, R = 65;                                                        // column walls: x L..L+1 and R..R+1
    fill(36, 126, 84, 127, 'Cu');                                                // copper bottom
    fill(36, 96, 37, 125, 'wall'); fill(83, 96, 84, 125, 'wall');
    // lid: a funnel narrowing up into the column, so the vapour is led to it rather than trapped under a flat lid
    for (let y = 96; y <= 101; y++) { const w = 4 * (y - 96); fill(38, y, 82, y, 'wall'); fill(Math.max(38, L + 2 - w), y, Math.min(82, R - 1 + w), y, null); }
    heat(36, 126, 84, 127, 450);                                                 // the burner
    heat(36, 96, 37, 125, 380); heat(83, 96, 84, 125, 380);
    for (let y = 96; y <= 101; y++) for (let x = 38; x <= 82; x++) if (st[y * W + x] === STATIC) { fan[y * W + x] = HEATER; dset[y * W + x] = 38; }   // a warm jacket, so nothing condenses in the pot
    for (let x = 30; x <= 35; x++) fan[127 * W + x] = WIRE;
    for (let y = 126; y <= 127; y++) for (let x = 28; x <= 29; x++) fan[y * W + x] = SWITCH;
    fill(38, 115, 82, 125, 'crude');
    fill(L, 20, L + 1, 95, 'wall'); fill(R, 20, R + 1, 95, 'wall');              // column
    for (const [y0, y1, c] of [[88, 95, 330], [76, 87, 240], [60, 75, 180], [40, 59, 100], [20, 39, 30]]) { heat(L, y0, L + 1, y1, c); heat(R, y0, R + 1, y1, c); }   // the bottom stretch is kept hot, so nothing condenses straight back into the pot
    // gas holder on top
    fill(L, 18, L + 1, 19, 'wall'); fill(R, 18, R + 1, 19, 'wall');
    fill(40, 2, 80, 3, 'wall'); fill(40, 2, 41, 19, 'wall'); fill(79, 2, 80, 19, 'wall'); fill(40, 18, L + 1, 19, 'wall'); fill(R, 18, 80, 19, 'wall');
    // its vent: what the holder cannot take spills out of a short pipe and thins away in the open air, which
    // also keeps the pressure in the still from building up and stalling it
    fill(79, 4, 80, 5, null); fill(81, 3, 86, 3, 'wall'); fill(81, 6, 86, 6, 'wall');   // high up, so the heavy gas settles in the holder and only the overflow leaves
    // Each tray's pipe and jar are kept at the temperature of its stretch of column, so a lighter vapour that
    // strays out along the pipe cannot condense there either; the jars are closed, with no air in them.
    for (const [ty, jx, c] of TRAYS) {
      fill(L + 3, ty, R - 1, ty, 'wall');                                        // tray, catching what runs down the column (vapour rises past it on the left)
      heat(L, ty - 1, L + 1, ty + 1, c + 90);                                    // the wall by the gap is kept warmer, so vapour heading up through the gap is not caught there
      fill(R, ty - 1, R + 1, ty - 1, null);                                      // draw-off through the wall
      fan[(ty - 1) * W + R] = 0; fan[(ty - 1) * W + R + 1] = 0;
      fill(R + 2, ty - 2, jx + 5, ty - 2, 'wall'); fill(R + 2, ty, jx - 2, ty, 'wall');   // pipe out to the jar
      fill(jx - 4, ty, jx - 3, ty + 8, 'wall'); fill(jx + 4, ty - 1, jx + 5, ty + 8, 'wall'); fill(jx - 4, ty + 8, jx + 5, ty + 9, 'wall');   // jar
      heat(R + 2, ty - 2, jx + 5, ty - 2, c); heat(R + 2, ty, jx - 2, ty, c); heat(jx - 4, ty, jx - 3, ty + 8, c); heat(jx + 4, ty - 1, jx + 5, ty + 8, c); heat(jx - 4, ty + 8, jx + 5, ty + 9, c);
    }
    // no air anywhere inside: hot vapour must not catch fire in there
    for (let y = 4; y <= 125; y++) for (let x = 38; x <= 130; x++) {
      const i = y * W + x;
      if ((y <= 17 && x >= 42 && x <= 78) || (y >= 18 && y <= 95 && x >= L + 2 && x <= R - 1) || (y >= 96 && x <= 82)) ox[i] = 0;
    }
    for (const [ty, jx] of TRAYS) for (let y = ty - 1; y <= ty + 7; y++) for (let x = R; x <= jx + 3; x++) ox[y * W + x] = 0;
  } else if (name === 'components') {
    const wire = (x0, y0, x1, y1) => { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) fan[y * W + x] = WIRE; };
    const put = (x0, y0, x1, y1, f, set, dir) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; fan[i] = f; if (set !== undefined) dset[i] = set; if (dir) ddir[i] = dir; } };
    // 1. A tank that fills itself: a pump lifts water from the low tank, and a touch sensor near the top of the
    // high tank, through an inverter, stops the pump once the water reaches it.
    fill(6, 100, 7, 131, 'wall'); fill(46, 100, 47, 131, 'wall'); fill(6, 130, 53, 131, 'wall');
    fill(8, 112, 45, 129, 'water');
    fill(46, 126, 49, 129, null); fill(46, 125, 49, 125, 'wall');            // outlet from the low tank
    fill(48, 40, 49, 124, 'wall'); fill(52, 44, 53, 131, 'wall');            // the pipe up
    fill(48, 38, 97, 39, 'wall'); fill(96, 38, 97, 72, 'wall'); fill(52, 71, 97, 72, 'wall');   // the high tank
    put(47, 126, 47, 129, PUMP, 3, 1);
    put(60, 62, 61, 62, SENSE_C);
    wire(60, 36, 60, 61); wire(30, 36, 60, 36); wire(30, 36, 30, 105);
    put(30, 106, 30, 106, INVERTER, 1, 4);
    wire(30, 107, 30, 107); wire(30, 107, 45, 107); wire(45, 107, 45, 125); wire(46, 125, 46, 125);
    // 2. Electrolysis: water with two electrodes on a switch, in a closed cell. Hydrogen and oxygen bubble up and collect
    // above the water (a spark in there would set them off).
    fill(62, 100, 63, 131, 'wall'); fill(94, 100, 95, 131, 'wall'); fill(62, 130, 95, 131, 'wall'); fill(62, 100, 95, 101, 'wall');   // closed, so the gases collect at the top
    fill(64, 110, 93, 129, 'water');
    put(72, 112, 72, 128, ELECTRODE); put(85, 112, 85, 128, ELECTRODE);
    wire(72, 98, 72, 111); wire(85, 98, 85, 111); wire(72, 98, 85, 98);
    put(78, 95, 79, 96, SWITCH); wire(78, 97, 78, 97); offCells.push(95 * W + 78, 95 * W + 79, 96 * W + 78, 96 * W + 79);
    // 3. A pot of water kept at 90 °C: a heat sensor in the water, through an inverter, switches the heater under it.
    fill(112, 104, 113, 129, 'wall'); fill(146, 104, 147, 129, 'wall'); fill(112, 128, 147, 129, 'Cu');
    fill(114, 118, 145, 127, 'water');
    put(112, 129, 147, 129, HEATER, 15);
    put(130, 123, 130, 123, SENSE_T, 9);
    wire(130, 100, 130, 122);
    put(130, 99, 130, 99, INVERTER, 1, 3);
    wire(130, 96, 130, 98); wire(130, 96, 150, 96); wire(150, 96, 150, 129); wire(148, 129, 150, 129);
    // 4. A spring-loaded relief valve: as the air in the heated chamber expands, the pressure lifts the block
    // off the vent, lets some out, and the spring pulls the block back down.
    fill(170, 50, 171, 80, 'wall'); fill(205, 50, 206, 80, 'wall'); fill(170, 79, 206, 80, 'Cu'); fill(170, 50, 206, 51, 'wall');
    fill(183, 50, 192, 51, null);
    put(170, 80, 206, 80, HEATER, 80);
    wire(207, 80, 214, 80); put(215, 79, 216, 80, SWITCH); offCells.push(79 * W + 215, 79 * W + 216, 80 * W + 215, 80 * W + 216);
    const lid = addBody(cellsRect(181, 48, 194, 49), ID.Al);
    makeJoint('slider', lid, null, V(187.5 * S, 49 * S), V(0, 1));
    const sp = makeJoint('spring', lid, null, V(187.5 * S, 48 * S), V(187.5 * S, 30 * S));
    setSpring(sp, 1, 0.5, sp.len);
  } else if (name === 'forge') {
    fill(40, 130, 43, H - 5, 'wall');                   // firebox sides, open above for air
    fill(196, 130, 199, H - 5, 'wall');
    fill(44, 136, 195, H - 5, 'C');                     // coal bed
    fill(40, 120, 199, 121, 'Cu');                      // copper shelf over the fire
    const bars = ['Ga', 'Sn', 'Pb', 'Zn', 'Al', 'Cu', 'Fe', 'W'];
    bars.forEach((key, n) => addBody(cellsRect(50 + n * 18, 110, 59 + n * 18, 119), ID[key]));
  }
  for (let i = 0; i < N; i++) if (DEV_DEFAULT[fan[i]] !== undefined && !dset[i]) dset[i] = DEV_DEFAULT[fan[i]];
  for (const i of offCells) dset[i] = 0;
  offCells.length = 0;
  rebuildGround();
}
