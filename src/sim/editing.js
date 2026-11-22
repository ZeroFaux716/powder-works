// Painting and filling: what the tools do to the grid.
import { AMBIENT, DRAFT, GAS, H, N, NONE, P0, PART, SOL, STATIC, W } from './constants.js';
import { ID, MATS } from './materials.js';
import { FIRE, stateAt } from './tables.js';
import { sx, taken, CONTACT, DEV_DEFAULT, ELECTRODE, G, HEATER, INJECTOR, INVERTER, PLUG, PUMP, Pref, SENSE_T, SWITCH, VALVE, WIRE, aux, bid, bodies, clearCell, ddir, dset, fan, gate, lat, life, st, type, world } from './grid.js';
import { burn, made } from './reactions.js';
import { emit } from './neutrons.js';
import { P, temp } from './flow.js';
import { setSolute } from './alloys.js';
import { letPass, makeBody, partCovers, placeBody, removeBody } from './parts.js';

// Fill a rectangle with a material in the state it has at room temperature. key null clears it.
export const TRAYS = [[59, 96, 100], [75, 110, 180], [87, 124, 240]];   // refinery draw-offs: tray row, jar centre, temperature   // refinery draw-offs: tray row and jar centre, top to bottom
export const offCells = [];     // switches a scene wants to start switched off
export function fill(x0, y0, x1, y1, key) {
  const m = key ? MATS[ID[key]] : null;
  const s = m ? stateAt(m, AMBIENT) : NONE;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    type[i] = m ? m.id : 0; st[i] = s; temp[i] = AMBIENT; life[i] = 0; aux[i] = 0; lat[i] = 0; sx[i] = 0; taken[i] = 0;
  }
  G.groundDirty = true;
}

export function cellsRect(x0, y0, x1, y1) {
  if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
  if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
  const out = [];
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      const i = y * W + x;
      if (st[i] !== STATIC && st[i] !== PART) out.push(i);
    }
  return out;
}
export function cellsDisc(cx, cy, r) {
  const out = [];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r && x >= 0 && y >= 0 && x < W && y < H) out.push(y * W + x);
  return out;
}
export function cellsLine(x0, y0, x1, y1, half) {
  const set = new Set();
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  for (let k = 0; k <= n; k++) {
    const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n;
    for (let dy = -half; dy < half; dy++) for (let dx = -half; dx < half; dx++) {
      const gx = Math.floor(x + dx + 0.5), gy = Math.floor(y + dy + 0.5);
      if (gx >= 0 && gy >= 0 && gx < W && gy < H) set.add(gy * W + gx);
    }
  }
  return [...set];
}
// over: the part may lie over other parts (it passes through them; see passPairs)
export function addBody(cells, matId, over) {
  if (matId === undefined) matId = ID.Fe;
  const rb = makeBody(cells, matId, over);
  if (rb && !placeBody(rb)) {
    // nowhere to push what is underneath: keep only the open cells (and, if allowed, the ones over parts)
    world.destroyBody(rb.b); bodies.delete(rb.id);
    return addBody(cells.filter(i => st[i] === NONE || st[i] === GAS || (over && st[i] === PART)), matId, over);
  }
  return rb;
}

// Cells drawn with the Part tool become one part per connected piece when the stroke ends. The stroke is
// kept on its own layer (draft) rather than in the grid, so it can be drawn over other parts and over loose
// material without disturbing them. A new part passes through every part it was drawn over.
export const draft = new Uint16Array(N);
export let strokeCells = [];
export let passedLast = 0;   // how many parts the last part made was drawn over (for the hint)
// A part from the Part or Block tool: it may lie over other parts, and passes through the ones it covers.
// alloy: { s, x }: the part is that alloy of matId, all through
export function makePart(cells, matId, alloy) {
  const under = [];   // found by shape, so parts hidden under other parts count too
  for (const rb of bodies.values()) if (cells.some(i => partCovers(rb, i % W, (i / W) | 0))) under.push(rb.id);
  const rb = addBody(cells, matId, true);
  if (rb) {
    for (const id of under) letPass(rb.id, id); passedLast = under.length;
    if (alloy) { rb.sol = alloy.s; rb.sx = alloy.x; for (const i of rb.foot) if (bid[i] === rb.id) setSolute(i, alloy.s, alloy.x); }
  }
  return rb;
}
export function finishPart(alloy) {
  const seen = new Set();
  let made = 0, passed = 0;
  for (const start of strokeCells) {
    if (seen.has(start) || !draft[start]) continue;
    const matId = draft[start];
    const comp = [start], stack = [start];
    seen.add(start);
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (draft[j] !== matId || seen.has(j)) continue;
        seen.add(j); comp.push(j); stack.push(j);
      }
    }
    for (const i of comp) draft[i] = 0;
    if (makePart(comp, matId, alloy && alloy.h === matId ? alloy : null)) { made++; passed += passedLast; }
  }
  passedLast = passed;
  for (const i of strokeCells) draft[i] = 0;
  strokeCells = [];
  return made;
}

// The squares of a straight line, as Powder Toy draws them (Simulation::CreateLine): one step along the
// longer axis at a time, plus an extra square wherever it steps sideways, so even a thin diagonal line has
// no gaps for gas or liquid to slip through.
export function lineCells(x1, y1, x2, y2) {
  const out = [];
  const steep = Math.abs(y2 - y1) > Math.abs(x2 - x1);
  if (steep) { [x1, y1] = [y1, x1]; [x2, y2] = [y2, x2]; }
  if (x1 > x2) { [x1, x2] = [x2, x1]; [y1, y2] = [y2, y1]; }
  const dx = x2 - x1, dy = Math.abs(y2 - y1), sy = y1 < y2 ? 1 : -1, de = dx ? dy / dx : 0;
  const put = (a, b) => out.push(steep ? [b, a] : [a, b]);
  let e = 0, y = y1;
  for (let x = x1; x <= x2; x++) {
    put(x, y);
    e += de;
    if (e >= 0.5) {
      y += sy;
      if (sy > 0 ? y <= y2 : y >= y2) put(x, y);
      e -= 1;
    }
  }
  return out;
}

// The connected area that a fill starting at (x, y) covers: every square joined to it (side by side, not
// corner to corner) holding the same thing, such as one stretch of empty space or one pool of water.
// Parts and anything different bound it.
export function floodRegion(x, y, limit = N) {
  const i0 = y * W + x, s0 = st[i0], t0 = s0 === NONE ? 0 : type[i0];
  if (s0 === PART) return [];
  const seen = new Uint8Array(N), out = [i0];
  seen[i0] = 1;
  for (let h = 0; h < out.length && out.length < limit; h++) {
    const i = out[h], cx = i % W;
    for (const j of [cx > 0 ? i - 1 : -1, cx < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j < 0 || j >= N || seen[j]) continue;
      seen[j] = 1;
      if (st[j] === s0 && (s0 === NONE || type[j] === t0)) out.push(j);
    }
  }
  return out;
}

// tool: 'brush' paints matId, 'part' drafts a part of matId, plus 'fire', 'heat', 'cool', 'erase'.
// solid: fill every square (lines, rectangles and fills) instead of the brush's loose scatter of liquid and gas.
export const DEV_TOOLS = { contact: CONTACT, wire: WIRE, plug: PLUG, injector: INJECTOR, valve: VALVE, switch: SWITCH, heater: HEATER, sensor: SENSE_T, inverter: INVERTER, pump: PUMP, electrode: ELECTRODE };
// for the device tools matId carries the new device's setting (left out: the usual default)
// alloy: { s, x }: paint the metal with that dissolved in it (an alloy picked from Made so far)
export function paint(cx, cy, tool, r, matId, solid, alloy) {
  const m = matId !== undefined && tool !== 'fan' && !DEV_TOOLS[tool] ? MATS[matId] : null;
  const ms = m ? stateAt(m, AMBIENT) : NONE;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r + 0.5) continue;
    const x = cx + dx, y = cy + dy;
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const i = y * W + x, s = st[i];
    if (tool === 'erase') {
      fan[i] = 0; dset[i] = 0; gate[i] = 1; ddir[i] = 0;
      if (s === PART) removeBody(bid[i]);
      else if (s !== NONE) {
        if (SOL[s]) { P[i] = P0; temp[i] = AMBIENT; G.groundDirty = true; }
        clearCell(i);
      }
    } else if (DEV_TOOLS[tool]) {
      const d = DEV_TOOLS[tool];
      if (fan[i] !== d) { fan[i] = d; dset[i] = matId !== undefined && DEV_DEFAULT[d] !== undefined ? matId : DEV_DEFAULT[d] || 0; gate[i] = 1; }
      if (d === INVERTER || d === PUMP) ddir[i] = G.paintDir;
    } else if (tool === 'fan') {
      if (!SOL[s]) fan[i] = matId;                  // here matId carries the direction, 1 to 4
    } else if (tool === 'heat' || tool === 'cool') {
      const t0 = temp[i];
      temp[i] = tool === 'heat' ? Math.min(4500, t0 + 100) : Math.max(-270, t0 - 60);
      if ((s === NONE || s === GAS) && type[i] !== FIRE) {
        // gas law: heated gas pushes harder, chilled gas pulls back
        const f = (temp[i] + 273.15) / (t0 + 273.15);
        P[i] *= f; Pref[i] *= f;
      }
    } else if (tool === 'fire') {
      if (s === NONE) { type[i] = FIRE; st[i] = GAS; aux[i] = 0; life[i] = 15 + (Math.random() * 20 | 0); temp[i] = 1100; }
      else if (s !== PART && MATS[type[i]].burn) {
        if (MATS[type[i]].burn.fast) {
          if (!burn(i)) {
            // buried fuel has no air: light the surface above it instead
            let j = i;
            while (j >= W && st[j] !== NONE && !SOL[st[j]]) j -= W;
            if (st[j] === NONE) { type[j] = FIRE; st[j] = GAS; aux[j] = 0; life[j] = 15; temp[j] = 1100; }
          }
        }
        else if (MATS[type[i]].burn.at < 1100) temp[i] = Math.max(temp[i], MATS[type[i]].burn.at + 80);   // a match cannot light thermite
      }
    } else if (m && m.special === 'neutron') {
      if (Math.random() < 0.3) emit(x, y, true);
    } else if (tool === 'part') {
      if (s !== STATIC && !draft[i]) { draft[i] = m.id; strokeCells.push(i); }
    } else if (ms === STATIC) {
      if (!SOL[s]) { type[i] = m.id; st[i] = STATIC; life[i] = 0; aux[i] = 0; lat[i] = 0; sx[i] = 0; taken[i] = 0; temp[i] = AMBIENT; P[i] = P0; G.groundDirty = true; if (alloy) setSolute(i, alloy.s, alloy.x); }
    } else if (s === NONE && (solid || Math.random() < (ms === GAS ? 0.6 : 0.8))) {
      type[i] = m.id; st[i] = ms; temp[i] = AMBIENT; life[i] = 0; aux[i] = 0; lat[i] = 0; sx[i] = 0; taken[i] = 0;
      if (alloy) setSolute(i, alloy.s, alloy.x);
    }
  }
}
