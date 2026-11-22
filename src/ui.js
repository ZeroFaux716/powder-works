// The page: drawing the bench, the toolbar and palette, mouse and keys, undo, save and open.
import * as planck from 'planck';
import { AMBIENT, DRAFT, GAS, H, LIQUID, N, NONE, NOTHING, P0, PART, POWDER, S, SOL, STATIC, W } from './sim/constants.js';
import { ID, MATS } from './sim/materials.js';
import { FIRE, SMOKE, stateAt } from './sim/tables.js';
import { passPairs, sx, CONTACT, DEV_DEFAULT, ELECTRODE, G, HEATER, INJECTOR, INVERTER, LP, PLUG, PUMP, SENSE_C, SENSE_P, SENSE_T, SWITCH, VALVE, WIRE, bid, bodies, ddir, dset, fan, gate, life, lit, open, ox, st, type } from './sim/grid.js';
import { made } from './sim/reactions.js';
import { nFast, nX, nY } from './sim/neutrons.js';
import { FX, FY, P, temp } from './sim/flow.js';
import { bodiesAt, removeBody } from './sim/parts.js';
import { grab, jointNear, jointPoint, jrecs, longAxis, makeJoint, movePart, removeJoint, setJointKind, setMotor, setSpring, snapPoint, springEnds, ungrab } from './sim/joints.js';
import { restore, snapshot, step } from './sim/world.js';
import { massShare, solute } from './sim/alloys.js';
import { addBody, cellsRect, draft, finishPart, floodRegion, lineCells, makePart, paint, passedLast } from './sim/editing.js';
import { loadPreset } from './sim/scenes.js';

// ---------- rendering and input ----------
const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const over = document.getElementById('overlay');
const octx = over.getContext('2d');
const OS = over.width / W;
const img = ctx.createImageData(W, H);
const px = img.data;
const shade = new Int8Array(N);
for (let i = 0; i < N; i++) shade[i] = (Math.random() * 16 | 0) - 8;
const BG = MATS[0].color;
const JCOL = { hinge: '#f5d76e', motor: '#6ee0f5', slider: '#f29bd0', spring: '#9be37a' };
const SEL = '#f2a33a';
const HINTS = {
  components: 'Press Play. A pump fills the high tank until the water touches a sensor; electrodes split water (switch on); a heat sensor keeps a pot at 90 °C; a spring relief valve vents a heated chamber (switch on).',
  refinery: 'Press Play and wait. The crude boils off fraction by fraction: gasoline, kerosene and diesel collect in the three jars, fuel gas in the holder on top, tar stays in the pot. Click a heater with Move to change it.',
  chem: 'Press Play. Sodium meets chlorine (top left); zinc dissolves in acid (bottom left); heat one end of the iron and sulfur mix; switch on the crucible heaters to smelt iron from rust and charcoal; the plant on the right: both feeds, then the spark.',
  engine: 'Press Play. To throttle, pick Move and click the green valve under the air duct (or the injector line) and turn it down. The flywheel lobe times the spark, fuel and exhaust.',
  crank: 'Building. Press Play, then touch the gasoline in the cylinder with Fire.',
  cylinder: 'Building. Press Play, then touch the gasoline inside the cylinder with Fire.',
  steam: 'Building. Press Play, then hold Fire under the copper boiler plate until the water boils.',
  forge: 'Building. Press Play, then touch the coal with Fire and watch which metal bars survive.',
  thermite: 'Building. Press Play, then touch the top of the magnesium fuse with Fire.',
  diesel: 'Press Play. The falling ram squeezes the air until it is hot enough to light the fuel.',
  hydraulic: 'Press Play. The light ram sinks and lifts the heavier load through the water.',
  wind: 'Press Play. The fan blows down the duct and turns the paddle wheel. Flow view shows the stream.',
  reactor: 'Press Play, then drag the control rods up with Move. Let go and they drop back in.',
  blank: 'Pick a material, draw with Brush or build parts with Part and Block, then press Play.'
};
const TOOL_HINTS = {
  contact: 'Paint contacts where a part will pass over them. While a part covers a contact, everything wired to it is live.',
  wire: 'Paint wire from a contact to plugs, injectors and valves. Wires join where they touch, even diagonally. Brush size 1 draws thin wire.',
  plug: 'Paint a spark plug into open space. It sparks every frame its circuit is live and lights fuel vapor next to it.',
  injector: 'Paint an injector line from inside a tank to where it should spray. While live, its open end sprays whatever liquid or gas the line touches in the tank. Click it with Move to set how much.',
  valve: 'Paint a valve over a gap or a wall. It is solid wall while unpowered and opens while its circuit is live. Click it with Move to set how far it opens.',
  heater: 'Paint a heater onto a wall, a pipe or a pot and wire it up. While live it holds that spot at its set temperature (400 °C to start). Click it with Move to change it.',
  switch: 'Paint a switch and wire it up. While it is on, everything wired to it is live. Click it with Move to turn it on or off.',
  fan: 'Paint a patch of fan in open space. Arrow buttons or arrow keys set which way it blows.',
  heat: 'Hold on anything to heat it. Metals melt at their real melting points.',
  cool: 'Hold on anything to chill it. Water freezes, and gases turn liquid if you go cold enough.',
  move: 'Drag a part to move it. Q and E or the mouse wheel turn it. Click a joint to edit it.',
  hinge: 'Click where two parts meet to pin them, or on one part to pin it to the background. Snaps to centres and joints.',
  motor: 'Click a part to drive it around that point. Click an existing joint to edit it.',
  slider: 'Press on a part and drag along the direction it should travel. A short click uses its long side.',
  spring: 'Press on a part and drag to where the other end goes: another part, or empty background. Click its middle with Move to set stiffness and length.',
  sensor: 'Paint a sensor and wire it up. It powers its circuit while it is past its setting: heat (150 °C to start), pressure or touch. Click it with Move to change it.',
  inverter: 'Paint an inverter between two wires. It powers the wire in front whenever the wire behind is not powered. The arrows by Fan set which way it faces.',
  pump: 'Paint a pump into a pipe and wire it up. While live it pushes liquid the way it faces, up hill too; nothing flows back through it. The arrows by Fan set the way.',
  electrode: 'Paint electrodes into a liquid compound and wire them up. While live they split it: water into hydrogen and oxygen, molten salt into sodium and chlorine.'
};

let tool = 'fire', view = 0, playing = false, brush = 3, preset = 'engine', curMat = ID.sand;
let down = false, lastX = -1, lastY = -1, hoverX = -1, hoverY = -1, hoverFX = -1, hoverFY = -1, dragX = 0, dragY = 0;
// Powder Toy's drawing keys: Shift-drag a line, Ctrl-drag (Cmd on a Mac) a filled rectangle, with Alt held
// the line snaps to 45° steps and the rectangle to a square; Ctrl+Shift-click fills an area.
let shape = null, altHeld = false, altUsed = false;

// ---------- grid ----------
// Grid lines run through cell centres every gridN cells. With Snap on, line and box ends, Block corners,
// joints and moved parts lock to it. Kept by the browser between visits, not in saved benches.
let gridOn = false, gridN = 10, snapOn = false;
try { const g = JSON.parse(localStorage.getItem('powder-works-grid') || 'null'); if (g) { gridOn = !!g.on; gridN = +g.n || 10; snapOn = !!g.snap; } } catch (e) {}
const keepGrid = () => { try { localStorage.setItem('powder-works-grid', JSON.stringify({ on: gridOn, n: gridN, snap: snapOn })); } catch (e) {} };
const snapCell = v => snapOn ? Math.round(v / gridN) * gridN : v;
// joints: an existing joint or a part's centre still wins when the pointer is right on it
function snapAt(fx, fy) {
  const s = snapPoint(fx, fy);
  if (!snapOn || s.joint || s.center) return s;
  return { x: snapCell(Math.floor(fx)) + 0.5, y: snapCell(Math.floor(fy)) + 0.5 };
}
let drag = null, sel = null, snap = null, fanDir = 1;

function label(t, s) {
  const m = MATS[t];
  if (s === NONE) return 'Air';
  if (m.special || m.fixed) return m.name;
  const low = m.name.toLowerCase();
  if (s === GAS) return m.names ? m.names[2] : m.boil > AMBIENT ? m.name + ' vapor' : m.name;
  if (s === LIQUID) return m.names ? m.names[1] : m.melt > AMBIENT ? 'Molten ' + low : m.boil > AMBIENT ? m.name : 'Liquid ' + low;
  if (s === POWDER) return m.name;
  if (s === PART || s === DRAFT) return m.name + ' part';
  return m.names ? m.names[0] : m.melt > AMBIENT ? m.name : 'Frozen ' + low;
}

function render() {
  const selId = sel && sel.rb ? sel.rb.id : -1;
  for (let i = 0, o = 0; i < N; i++, o += 4) {
    const t = type[i], s = st[i], T = temp[i];
    let r, g, b;
    if (view === 2) {
      if (T < AMBIENT) {
        const k = Math.min(1, (AMBIENT - T) / 220);
        r = 20 - 10 * k; g = 110 * k; b = 40 + 215 * k;
      } else {
        const k = Math.min(1, (T - AMBIENT) / 1500);
        r = Math.min(255, 20 + k * 3 * 235);
        g = Math.min(255, Math.max(0, (k - 0.33) * 3 * 255));
        b = k < 0.66 ? 40 * (1 - k) : (k - 0.66) * 3 * 255;
      }
      if (SOL[s]) { r = r * 0.8 + 30; g = g * 0.8 + 30; b = b * 0.8 + 34; }
    } else {
      if (s === NONE) {
        r = BG[0]; g = BG[1]; b = BG[2];
        if (T > 120) { const k = Math.min(1, (T - 120) / 1400); r += 70 * k; g += 18 * k; }
      } else {
        const m = MATS[t];
        if (t === FIRE) {
          const f = Math.min(1, life[i] / 30);
          r = 255; g = 80 + 160 * f; b = 20 + 110 * f * f;
          if (T > 2000) { g = 236; b = 222; }
        } else if (t === SMOKE) {
          const f = Math.min(1, life[i] / 90), c = m.color;
          r = BG[0] + (c[0] - BG[0]) * f; g = BG[1] + (c[1] - BG[1]) * f; b = BG[2] + (c[2] - BG[2]) * f;
        } else if (s === GAS) {
          const c = m.gasColor || m.color;
          r = c[0] * 0.5 + BG[0] * 0.5; g = c[1] * 0.5 + BG[1] * 0.5; b = c[2] * 0.5 + BG[2] * 0.5;
          if (T > 600) { const k = Math.min(1, (T - 600) / 1500); r += (255 - r) * k * 0.6; g += (140 - g) * k * 0.4; }
        } else {
          const c = (s === STATIC && m.solidColor) || m.color;
          r = c[0]; g = c[1]; b = c[2];
          if (sx[i] > 0) {
            // an alloy takes on some of the colour of what is dissolved in it (carbon darkens iron, zinc yellows copper)
            const so = solute(i);
            if (so) { const cs = MATS[so].color, k = Math.min(0.6, sx[i] * 2.5); r += (cs[0] - r) * k; g += (cs[1] - g) * k; b += (cs[2] - b) * k; }
          }
          if (s === LIQUID) { r += 10; g += 10; b += 10; }
          else { const n = shade[i]; r += n; g += n; b += n; }
          if (s === PART) {
            // darken the outline so separate parts read as separate; the selected part gets an orange one
            const id = bid[i], x = i % W, y = (i / W) | 0;
            const edge = (x > 0 && bid[i - 1] !== id) || (x < W - 1 && bid[i + 1] !== id) ||
                         (y > 0 && bid[i - W] !== id) || (y < H - 1 && bid[i + W] !== id);
            if (id === selId) {
              if (edge) { r = 242; g = 163; b = 58; } else { r += 18; g += 14; b += 6; }
            } else if (edge) { r *= 0.78; g *= 0.78; b *= 0.78; }
          }
          // hot things glow: red, then orange, then towards white
          if (T > 350) {
            const k = Math.min(1, (T - 350) / 900);
            r += (255 - r) * k; g += (120 - g) * k * 0.7; b *= 1 - k * 0.75;
            if (T > 1250) { const k2 = Math.min(1, (T - 1250) / 1600); g += (245 - g) * k2; b += (215 - b) * k2 * 0.8; }
          }
        }
      }
      const dm = draft[i];
      if (dm) {
        // a part being drawn shows on top of whatever is there, lightened
        const c = MATS[dm].color;
        r = c[0] + (255 - c[0]) * 0.3; g = c[1] + (255 - c[1]) * 0.3; b = c[2] + (255 - c[2]) * 0.3;
      }
      const fd = fan[i];
      if (fd >= CONTACT) {
        // electrics: dull when idle, bright while their circuit is live
        const hot = lit[i] >= 4;
        let er, eg, eb, k = 0.6;
        if (fd === CONTACT) { er = 214; eg = 176; eb = 64; if (s === PART) k = 0.35; }
        else if (fd === WIRE) { er = 176; eg = 102; eb = 58; k = 0.55; }
        else if (fd === PLUG) { er = 225; eg = 232; eb = 240; }
        else if (fd === INJECTOR) { er = 168; eg = 116; eb = 222; k = s === LIQUID ? 0.3 : 0.55; }
        else if (fd === HEATER) { er = 214; eg = 92; eb = 56; k = 0.2; }
        else if (fd >= SENSE_T && fd <= SENSE_C) { er = 79; eg = 209; eb = 197; k = 0.6; }
        else if (fd === INVERTER) { er = 199; eg = 125; eb = 255; k = 0.7; }
        else if (fd === PUMP) { er = 58; eg = 123; eb = 213; k = s === LIQUID ? 0.35 : 0.6; }
        else if (fd === ELECTRODE) { er = 201; eg = 209; eb = 217; k = 0.6; }
        else if (fd === SWITCH) { if (dset[i]) { er = 120; eg = 230; eb = 90; k = 0.85; } else { er = 150; eg = 60; eb = 52; k = 0.85; } }
        else { er = 92; eg = 200; eb = 120; k = s === STATIC ? 0.5 : 0.25; }
        if (devMask[i]) { er = 242; eg = 163; eb = 58; k = 0.85; }
        else if (hot) { er += (255 - er) * 0.6; eg += (240 - eg) * 0.6; eb += (150 - eb) * 0.4; k = Math.min(0.9, k + 0.3); }
        r += (er - r) * k; g += (eg - g) * k; b += (eb - b) * k;
      } else if (fd && !SOL[s]) {
        // fan cells: teal, with bands that march the way it blows
        const x = i % W, y = (i / W) | 0, tt = frameNo >> 2;
        const ph = fd === 1 ? x - tt : fd === 2 ? x + tt : fd === 3 ? y + tt : y - tt;
        const on = (ph & 3) === 0;
        r += on ? 40 : 12; g += on ? 100 : 44; b += on ? 104 : 46;
      }
      if (view === 3) {
        // how far gas travelled through this cell last frame
        if (SOL[s]) { r = 58; g = 64; b = 72; }
        else {
          const x = i % W;
          const q = (Math.abs(FX[i]) + Math.abs(FY[i]) + (x > 0 ? Math.abs(FX[i - 1]) : 0) + (i >= W ? Math.abs(FY[i - W]) : 0)) * 0.5 / Math.max(0.3, P[i]);
          const k = Math.min(1, q * 0.8), mix = s === NONE ? 0 : 0.35;
          r = r * mix + (BG[0] + (90 - BG[0]) * k) * (1 - mix);
          g = g * mix + (BG[1] + (235 - BG[1]) * k) * (1 - mix);
          b = b * mix + (BG[2] + (210 - BG[2]) * k) * (1 - mix);
        }
      } else if (view === 4) {
        // fresh air blue, burnt gas (air with no oxygen left) amber, fuel that has not burned yet green
        if (SOL[s]) { r = 58; g = 64; b = 72; }
        else if (s === NONE) {
          const k = 1 - ox[i];
          r = 34 + (206 - 34) * k; g = 70 + (118 - 70) * k; b = 118 + (40 - 118) * k;
        } else if (t === FIRE) { /* flames keep their colour */ }
        else if (MATS[t].burn && s !== POWDER) { r = 118; g = 236; b = 92; }
        else { r = r * 0.45 + 20; g = g * 0.45 + 20; b = b * 0.45 + 24; }
      } else if (view === 1) {
        if (SOL[s]) { r = 58; g = 64; b = 72; }
        else {
          const d = P[i] - P0;
          let pr, pg, pb, k;
          if (d >= 0) { k = Math.min(1, d / 3); pr = 255; pg = 96; pb = 56; }
          else { k = Math.min(1, -d); pr = 64; pg = 128; pb = 255; }
          const mix = s === NONE ? 0 : 0.35;
          r = r * mix + (BG[0] + (pr - BG[0]) * k) * (1 - mix);
          g = g * mix + (BG[1] + (pg - BG[1]) * k) * (1 - mix);
          b = b * mix + (BG[2] + (pb - BG[2]) * k) * (1 - mix);
        }
      }
    }
    px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
  }
  if (view === 0 && passPairs.size) showHiddenParts(selId);
  // neutrons in flight: fast ones white, slowed ones green
  for (let n = 0; n < G.nCount; n++) {
    const o = ((nY[n] | 0) * W + (nX[n] | 0)) * 4;
    if (nFast[n]) { px[o] = 235; px[o + 1] = 255; px[o + 2] = 250; }
    else { px[o] = 90; px[o + 1] = 240; px[o + 2] = 150; }
  }
  ctx.putImageData(img, 0, 0);
  drawOverlay();
}

// Where parts that pass through each other overlap, only one owns each grid square. Show the other one
// through it, faintly, so a rod crossing a flywheel stays visible all the way along.
function showHiddenParts(selId) {
  const ids = new Set();
  for (const k of passPairs) { ids.add(Math.floor(k / 65536)); ids.add(k % 65536); }
  for (const id of ids) {
    const rb = bodies.get(id);
    if (!rb) continue;
    const pos = rb.b.getPosition(), a = rb.b.getAngle(), c = Math.cos(a), s = Math.sin(a);
    const px0 = pos.x / S, py0 = pos.y / S, col = MATS[rb.mat].color;
    // lightened, so a part over another of the same material still shows
    const [cr, cg, cb] = id === selId ? [242, 163, 58] : col.map(v => v + (255 - v) * 0.45), k = id === selId ? 0.6 : 0.5;
    for (let iy = 0; iy < rb.h; iy++) for (let ix = 0; ix < rb.w; ix++) {
      if (!rb.occ[iy * rb.w + ix]) continue;
      const lx = ix + rb.ox + 0.5, ly = iy + rb.oy + 0.5;
      const X = Math.floor(px0 + c * lx - s * ly), Y = Math.floor(py0 + s * lx + c * ly);
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const i = Y * W + X;
      if (st[i] !== PART || bid[i] === id) continue;
      const o = i * 4;
      px[o] += (cr - px[o]) * k; px[o + 1] += (cg - px[o + 1]) * k; px[o + 2] += (cb - px[o + 2]) * k;
    }
  }
}

function drawGrid() {
  // faint lines through cell centres; every 5th a little stronger, for counting
  for (const strong of [false, true]) {
    octx.beginPath();
    for (let k = 0, x = 0; x < W; k++, x += gridN) if ((k % 5 === 0) === strong) { octx.moveTo((x + 0.5) * OS, 0); octx.lineTo((x + 0.5) * OS, H * OS); }
    for (let k = 0, y = 0; y < H; k++, y += gridN) if ((k % 5 === 0) === strong) { octx.moveTo(0, (y + 0.5) * OS); octx.lineTo(W * OS, (y + 0.5) * OS); }
    octx.lineWidth = 1;
    octx.strokeStyle = strong ? 'rgba(183,198,214,0.28)' : 'rgba(183,198,214,0.12)';
    octx.stroke();
  }
}

function ring(x, y, rad, color, width, dash) {
  octx.beginPath();
  octx.arc(x * OS, y * OS, rad, 0, Math.PI * 2);
  if (dash) octx.setLineDash([3, 3]);
  octx.lineWidth = width;
  octx.strokeStyle = color;
  octx.stroke();
  octx.setLineDash([]);
}

function zigzag(ax, ay, bx, by, color, width) {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  const turns = Math.max(4, Math.min(16, Math.round(L / 2.5)));
  octx.beginPath();
  octx.moveTo(ax * OS, ay * OS);
  for (let k = 1; k < turns * 2; k++) {
    const f = k / (turns * 2), side = k % 2 ? 1 : -1;
    octx.lineTo((ax + dx * f + nx * side * 1.2) * OS, (ay + dy * f + ny * side * 1.2) * OS);
  }
  octx.lineTo(bx * OS, by * OS);
  octx.lineWidth = width; octx.strokeStyle = color; octx.stroke();
}
function drawOverlay() {
  octx.clearRect(0, 0, over.width, over.height);
  if (gridOn && view === 0) drawGrid();
  for (const rec of jrecs) {
    const [x, y] = jointPoint(rec);
    const chosen = sel && sel.rec === rec;
    if (rec.kind === 'spring') {
      const [a, b] = springEnds(rec);
      zigzag(a.x / S, a.y / S, b.x / S, b.y / S, chosen ? SEL : JCOL.spring, chosen ? 2.5 : 1.8);
      for (const p of [a, b]) { octx.beginPath(); octx.arc(p.x / S * OS, p.y / S * OS, 3, 0, Math.PI * 2); octx.fillStyle = chosen ? SEL : JCOL.spring; octx.fill(); }
      continue;
    }
    if (rec.kind === 'slider') {
      const a = rec.j.getAnchorA(), ax = rec.j.getBodyA().getWorldVector(rec.j.getLocalAxisA());
      const tx = a.x / S, ty = a.y / S, L = 14;
      octx.beginPath();
      octx.moveTo((tx - ax.x * L) * OS, (ty - ax.y * L) * OS);
      octx.lineTo((tx + ax.x * L) * OS, (ty + ax.y * L) * OS);
      octx.setLineDash([6, 4]);
      octx.lineWidth = 2;
      octx.strokeStyle = chosen ? SEL : JCOL.slider;
      octx.stroke();
      octx.setLineDash([]);
      octx.fillStyle = '#0b0f14';
      octx.fillRect(x * OS - 5, y * OS - 5, 10, 10);
      octx.lineWidth = 2.5;
      octx.strokeStyle = chosen ? SEL : JCOL.slider;
      octx.strokeRect(x * OS - 5, y * OS - 5, 10, 10);
      continue;
    }
    octx.beginPath();
    octx.arc(x * OS, y * OS, 5, 0, Math.PI * 2);
    octx.fillStyle = '#0b0f14';
    octx.fill();
    ring(x, y, 5, chosen ? SEL : JCOL[rec.kind], 2.5);
    if (chosen) ring(x, y, 9, SEL, 1.5);
    if (rec.kind === 'motor') {
      const ang = rec.A.b.getAngle();
      octx.beginPath();
      octx.moveTo(x * OS, y * OS);
      octx.lineTo(x * OS + Math.cos(ang) * 5, y * OS + Math.sin(ang) * 5);
      octx.strokeStyle = chosen ? SEL : JCOL.motor;
      octx.lineWidth = 2;
      octx.stroke();
    }
  }
  if (down && shape) {
    // the line or rectangle about to be drawn
    const [x1, y1] = shapeEnd();
    octx.fillStyle = 'rgba(232,238,245,0.35)';
    octx.strokeStyle = '#e8eef5';
    if (shape.kind === 'rect') {
      const x0 = Math.min(shape.x0, x1), y0 = Math.min(shape.y0, y1);
      const w = (Math.abs(x1 - shape.x0) + 1) * OS, h = (Math.abs(y1 - shape.y0) + 1) * OS;
      octx.lineWidth = 1.5;
      octx.fillRect(x0 * OS, y0 * OS, w, h);
      octx.strokeRect(x0 * OS, y0 * OS, w, h);
    } else {
      octx.beginPath();
      octx.moveTo((shape.x0 + 0.5) * OS, (shape.y0 + 0.5) * OS);
      octx.lineTo((x1 + 0.5) * OS, (y1 + 0.5) * OS);
      octx.lineCap = 'round';
      octx.lineWidth = Math.max(1, 2 * brush - 1) * OS;
      octx.strokeStyle = 'rgba(232,238,245,0.45)';
      octx.stroke();
      octx.lineCap = 'butt';
    }
  }
  if (down && tool === 'block') {
    const x0 = Math.min(dragX, lastX), y0 = Math.min(dragY, lastY);
    const w = (Math.abs(dragX - lastX) + 1) * OS, h = (Math.abs(dragY - lastY) + 1) * OS;
    octx.fillStyle = 'rgba(183,198,214,0.35)';
    octx.strokeStyle = '#b7c6d6';
    octx.lineWidth = 1.5;
    octx.fillRect(x0 * OS, y0 * OS, w, h);
    octx.strokeRect(x0 * OS, y0 * OS, w, h);
  }
  if (drag && drag.mode === 'spring') zigzag(drag.x, drag.y, drag.cx, drag.cy, JCOL.spring, 1.5);
  if (drag && drag.mode === 'slider') {
    const ax = sliderAxis(drag);
    const L = 14;
    octx.beginPath();
    octx.moveTo((drag.x - ax.x * L) * OS, (drag.y - ax.y * L) * OS);
    octx.lineTo((drag.x + ax.x * L) * OS, (drag.y + ax.y * L) * OS);
    octx.setLineDash([6, 4]);
    octx.lineWidth = 2;
    octx.strokeStyle = JCOL.slider;
    octx.stroke();
    octx.setLineDash([]);
  }
  if (!down && snap && (tool === 'hinge' || tool === 'motor' || tool === 'slider' || tool === 'spring')) {
    if (snap.joint) ring(snap.x, snap.y, 10, SEL, 1.5, true);
    else ring(snap.x, snap.y, 5, JCOL[tool], 1.5, true);
  }
}

function pointAt(ev) {
  const r = canvas.getBoundingClientRect();
  const s = Math.min(r.width / W, r.height / H);
  const ox = (r.width - W * s) / 2, oy = (r.height - H * s) / 2;
  const fx = (ev.clientX - r.left - ox) / s, fy = (ev.clientY - r.top - oy) / s;
  return [Math.max(0, Math.min(W - 0.01, fx)), Math.max(0, Math.min(H - 0.01, fy))];
}

// Parts need a material that is a solid block at room temperature; anything else falls back to iron.
function partMat() {
  const m = MATS[curMat], s = stateAt(m, AMBIENT);
  return !m.fixed && !m.special && (s === STATIC || s === POWDER) ? curMat : ID.Fe;
}

const BRUSHED = { brush: 1, part: 1, fire: 1, heat: 1, cool: 1, fan: 1, erase: 1, contact: 1, wire: 1, plug: 1, injector: 1, valve: 1, switch: 1, heater: 1, sensor: 1, inverter: 1, pump: 1, electrode: 1 };
function dab(x, y) { paint(x, y, tool, brush - 1, tool === 'part' ? partMat() : tool === 'fan' ? fanDir : curMat); }
function stroke(x0, y0, x1, y1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let k = 0; k <= n; k++) dab(Math.round(x0 + (x1 - x0) * k / n), Math.round(y0 + (y1 - y0) * k / n));
}

const hintEl = document.getElementById('hint');
const readoutEl = document.getElementById('readout');
function setHint(text) { hintEl.textContent = text; }

function sliderAxis(d) {
  const dx = d.cx - d.x, dy = d.cy - d.y;
  if (Math.hypot(dx, dy) < 2) return longAxis(d.A);
  const step = Math.PI / 12;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return planck.Vec2(Math.cos(a), Math.sin(a));
}

// ---------- selection and the inspector ----------
const ins = document.getElementById('inspector');
const insTitle = document.getElementById('insTitle');
const insSub = document.getElementById('insSub');
const insKind = document.getElementById('insKind');
const insMotor = document.getElementById('insMotor');
const insRotate = document.getElementById('insRotate');
const insSpeed = document.getElementById('insSpeed');
const insStrength = document.getElementById('insStrength');
const RPM = 60 / (2 * Math.PI);

const devMask = new Uint8Array(N);
function select(next) {
  if (sel && sel.dev) for (const c of sel.cells) devMask[c] = 0;
  sel = next;
  if (sel && sel.dev) for (const c of sel.cells) devMask[c] = 1;
  showInspector();
}
// A device is every touching cell of the same kind: a valve, an injector line, a switch.
function devName(i) {
  const d = fan[i];
  if (d === VALVE) return 'Valve ' + dset[i] + '%';
  if (d === INJECTOR) return 'Injector ' + dset[i] + '/frame';
  if (d === SWITCH) return 'Switch ' + (dset[i] ? 'on' : 'off');
  if (d === HEATER) return 'Heater ' + dset[i] * 10 + ' °C';
  const face = ['', 'right', 'left', 'up', 'down'][ddir[i] || 1];
  if (d === SENSE_T) return 'Heat sensor ' + dset[i] * 10 + ' °C';
  if (d === SENSE_P) return 'Pressure sensor ' + (dset[i] / 10).toFixed(1) + ' atm';
  if (d === SENSE_C) return 'Touch sensor';
  if (d === INVERTER) return 'Inverter facing ' + face;
  if (d === PUMP) return 'Pump facing ' + face + ', ' + dset[i] + '/frame';
  if (d === ELECTRODE) return 'Electrode';
  return ['Contact', 'Wire', 'Spark plug'][d - CONTACT];
}
function deviceAt(x, y) {
  for (let r = 0; r <= 1; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const i = ny * W + nx, d = fan[i];
    if (d < VALVE || d === WIRE) continue;
    const cells = [i], seen = new Set(cells);
    for (let h = 0; h < cells.length; h++) {
      const c = cells[h], cx = c % W, cy = (c / W) | 0;
      for (let ey = -1; ey <= 1; ey++) for (let ex = -1; ex <= 1; ex++) {
        const qx = cx + ex, qy = cy + ey;
        if (qx < 0 || qx >= W || qy < 0 || qy >= H) continue;
        const q = qy * W + qx;
        if (fan[q] === d && dset[q] === dset[i] && ddir[q] === ddir[i] && !seen.has(q)) { seen.add(q); cells.push(q); }   // same kind, same setting
      }
    }
    return { dev: d, cells };
  }
  return null;
}

function speedText(rpm) {
  if (rpm === 0) return 'holds still';
  return Math.abs(rpm) + ' rpm ' + (rpm > 0 ? 'clockwise' : 'anticlockwise');
}

const insDev = document.getElementById('insDev');
const insDevLabel = document.getElementById('insDevLabel');
const insDevRange = document.getElementById('insDevRange');
const insDevNum = document.getElementById('insDevNum');
const insSwitch = document.getElementById('insSwitch');
const insSense = document.getElementById('insSense'), insDir = document.getElementById('insDir'), insSpring = document.getElementById('insSpring');
const DEV_MAX = { [VALVE]: 100, [INJECTOR]: 40, [HEATER]: 2550, [SENSE_T]: 2550, [SENSE_P]: 25.5, [PUMP]: 20 };
// what is stored is the shown value divided by this: heaters and heat sensors in tens of degrees, pressure in tenths of an atmosphere
const DEV_SCALE = { [HEATER]: 10, [SENSE_T]: 10, [SENSE_P]: 0.1 };
const DEV_NAME = { [VALVE]: 'Valve', [INJECTOR]: 'Injector', [HEATER]: 'Heater', [SWITCH]: 'Switch', [SENSE_T]: 'Heat sensor', [SENSE_P]: 'Pressure sensor', [SENSE_C]: 'Touch sensor', [INVERTER]: 'Inverter', [PUMP]: 'Pump', [ELECTRODE]: 'Electrode' };
const DEV_LABEL = { [VALVE]: 'Opens to, %', [HEATER]: 'Holds at, °C', [INJECTOR]: 'Puffs per frame', [SENSE_T]: 'Trips at, °C', [SENSE_P]: 'Trips at, atm', [PUMP]: 'Cells per frame' };
function showInspector() {
  if (!sel) { ins.hidden = true; return; }
  ins.hidden = false;
  insDev.hidden = true; insSwitch.hidden = true; insSense.hidden = true; insDir.hidden = true; insSpring.hidden = true;
  if (sel.dev) {
    const d = sel.dev, v = dset[sel.cells[0]];
    insKind.hidden = true; insMotor.hidden = true; insRotate.hidden = true;
    insTitle.textContent = DEV_NAME[d];
    insSense.hidden = !(d >= SENSE_T && d <= SENSE_C); insDir.hidden = !(d === INVERTER || d === PUMP);
    insSense.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.sense === d ? 'true' : 'false'));
    insDir.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.face === (ddir[sel.cells[0]] || 1) ? 'true' : 'false'));
    insSub.textContent = (d === VALVE ? 'Solid while unpowered. Opens this far while its circuit is live.'
      : d === HEATER ? 'Holds whatever it is in at this temperature while its circuit is live, heating or cooling it.'
      : d === SENSE_T ? 'Powers its circuit while it is at least this hot.'
      : d === SENSE_P ? 'Powers its circuit while the gas on it is at least at this pressure.'
      : d === SENSE_C ? 'Powers its circuit while anything but air is on it: a part, a powder, a liquid or a gas.'
      : d === INVERTER ? 'Powers the wire in front of it whenever the wire behind it is not powered.'
      : d === PUMP ? 'Pushes liquid the way it faces while its circuit is live. Nothing flows back through it.'
      : d === ELECTRODE ? 'Splits a liquid compound touching it into its elements while its circuit is live.'
      : d === INJECTOR ? 'Sprays this many puffs a frame while its circuit is live, from whatever its line touches in the tank.'
      : 'While on, everything wired to it is live.') + ' ' + sel.cells.length + (sel.cells.length === 1 ? ' cell' : ' cells') + '.';
    if (d === SENSE_C || d === INVERTER || d === ELECTRODE) {
      // nothing to set but the kind and the way it faces
    } else if (d === SWITCH) {
      insSwitch.hidden = false;
      insSwitch.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', (+b.dataset.on === (v ? 1 : 0)) ? 'true' : 'false'));
    } else {
      insDev.hidden = false;
      insDevLabel.textContent = DEV_LABEL[d];
      const sc = DEV_SCALE[d] || 1;
      insDevRange.max = DEV_MAX[d];
      insDevRange.step = sc;
      insDevRange.value = v * sc;
      insDevNum.value = sc < 1 ? (v * sc).toFixed(1) : v * sc;
    }
    document.getElementById('insDelete').textContent = 'Remove ' + insTitle.textContent.toLowerCase();
    return;
  }
  if (sel.rb) {
    const m = MATS[sel.rb.mat];
    const n = sel.rb.occ.reduce((a, v) => a + v, 0);
    const joints = jrecs.filter(r => r.A === sel.rb || r.B === sel.rb).length;
    insTitle.textContent = m.name + ' part';
    insSub.textContent = 'Melts at ' + m.melt + ' °C · ' + n + ' cells' + (joints ? ' · ' + joints + (joints === 1 ? ' joint' : ' joints') : '');
    insKind.hidden = true; insMotor.hidden = true; insRotate.hidden = false;
    document.getElementById('insDelete').textContent = 'Delete part';
    return;
  }
  const rec = sel.rec;
  if (rec.kind === 'spring') {
    insTitle.textContent = 'Spring';
    insSub.textContent = rec.B ? 'Joins two parts' : 'Hangs a part from the background';
    insRotate.hidden = true; insKind.hidden = true; insMotor.hidden = true; insSpring.hidden = false;
    document.getElementById('insHz').value = +rec.hz.toFixed(2);
    document.getElementById('insDamp').value = +rec.damp.toFixed(2);
    document.getElementById('insLen').value = +rec.len.toFixed(1);
    document.getElementById('insDelete').textContent = 'Delete spring';
    return;
  }
  insTitle.textContent = rec.kind === 'slider' ? 'Slider' : rec.kind === 'motor' ? 'Motor' : 'Hinge';
  insSub.textContent = rec.kind === 'slider' ? 'Part slides along a fixed track' : rec.B ? 'Joins two parts' : 'Pins a part to the background';
  insRotate.hidden = true;
  insKind.hidden = rec.kind === 'slider';
  insKind.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.kind === rec.kind ? 'true' : 'false'));
  insMotor.hidden = rec.kind !== 'motor';
  showMotorValues(rec);
  document.getElementById('insDelete').textContent = 'Delete joint';
}

insKind.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  if (!sel || !sel.rec) return;
  setJointKind(sel.rec, b.dataset.kind);
  showInspector();
}));
// Motor speed and strength: the sliders cover the everyday range, the boxes take any value.
const insSpeedNum = document.getElementById('insSpeedNum');
const insStrengthNum = document.getElementById('insStrengthNum');
const STRENGTH_DECADES = 4.3;      // the slider tops out near 20,000 N m
function strengthFromSlider(v) {
  if (v <= 0) return 0;
  const s = Math.pow(10, v / 100 * STRENGTH_DECADES);
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(s)) - 1));
  return Math.round(s / mag) * mag;
}
function sliderFromStrength(s) { return s <= 1 ? 0 : Math.min(100, Math.log10(s) / STRENGTH_DECADES * 100); }
function tidy(v) { return v === Infinity ? 'inf' : String(Number(v.toPrecision(6))); }
function parseStrength(text) {
  const t = text.trim().toLowerCase();
  if (t === 'inf' || t === 'infinity' || t === 'infinite' || t === '\u221e') return Infinity;
  const v = Number(t);
  return t !== '' && Number.isFinite(v) && v >= 0 ? v : null;
}
function showMotorValues(rec) {
  const rpm = rec.spin * RPM;
  insSpeed.value = Math.max(-120, Math.min(120, rpm));
  insSpeedNum.value = tidy(rpm);
  insStrength.value = sliderFromStrength(rec.strength);
  insStrengthNum.value = tidy(rec.strength);
  document.getElementById('insSpeedVal').textContent = rpm === 0 ? '(holds still)' : rpm > 0 ? '(clockwise)' : '(anticlockwise)';
}
function applyMotor(rpm, strength) {
  if (!sel || !sel.rec) return;
  setMotor(sel.rec, rpm / RPM, strength);
  showMotorValues(sel.rec);
}
insSpeed.addEventListener('input', () => { if (sel && sel.rec) applyMotor(+insSpeed.value, sel.rec.strength); });
insStrength.addEventListener('input', () => { if (sel && sel.rec) applyMotor(sel.rec.spin * RPM, strengthFromSlider(+insStrength.value)); });
function typedSpeed() {
  if (!sel || !sel.rec) return;
  const v = Number(insSpeedNum.value.trim());
  if (insSpeedNum.value.trim() !== '' && Number.isFinite(v)) applyMotor(v, sel.rec.strength);
  else { showMotorValues(sel.rec); setHint('Speed needs a number of turns per minute. Negative turns it anticlockwise.'); }
}
function typedStrength() {
  if (!sel || !sel.rec) return;
  const v = parseStrength(insStrengthNum.value);
  if (v !== null) applyMotor(sel.rec.spin * RPM, v);
  else { showMotorValues(sel.rec); setHint('Strength needs a number that is zero or more, or "inf".'); }
}
insSpeedNum.addEventListener('change', typedSpeed);
insStrengthNum.addEventListener('change', typedStrength);
for (const box of [insSpeedNum, insStrengthNum]) {
  box.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === 'Escape') box.blur(); });
  box.addEventListener('focus', () => box.select());
}
document.getElementById('insClose').addEventListener('click', () => select(null));
function setDevice(v) {
  if (!sel || !sel.dev) return;
  const max = sel.dev === SWITCH ? 1 : DEV_MAX[sel.dev], sc = DEV_SCALE[sel.dev] || 1;
  v = Math.round(Math.max(0, Math.min(max, v)) / sc);
  for (const c of sel.cells) dset[c] = v;
  showInspector();
}
insDevRange.addEventListener('input', () => setDevice(+insDevRange.value));
insDevNum.addEventListener('change', () => {
  const v = Number(insDevNum.value.trim());
  if (insDevNum.value.trim() !== '' && Number.isFinite(v)) setDevice(v);
  else { showInspector(); setHint('Type a number from 0 to ' + DEV_MAX[sel.dev] + '.'); }
});
insDevNum.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === 'Escape') insDevNum.blur(); });
insDevNum.addEventListener('focus', () => insDevNum.select());
for (const [id, lo, hi] of [['insHz', 0.05, 60], ['insDamp', 0, 1], ['insLen', 0.5, 400]]) {
  const box = document.getElementById(id);
  box.addEventListener('change', () => {
    if (!sel || !sel.rec || sel.rec.kind !== 'spring') return;
    const v = Number(box.value.trim()), r = sel.rec;
    if (box.value.trim() === '' || !Number.isFinite(v)) { showInspector(); setHint('Type a number from ' + lo + ' to ' + hi + '.'); return; }
    const c = Math.max(lo, Math.min(hi, v));
    setSpring(r, id === 'insHz' ? c : r.hz, id === 'insDamp' ? c : r.damp, id === 'insLen' ? c : r.len);
    showInspector();
  });
  box.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === 'Escape') box.blur(); });
  box.addEventListener('focus', () => box.select());
}
insSwitch.querySelectorAll('button').forEach(b => b.addEventListener('click', () => setDevice(+b.dataset.on)));
// a sensor changes kind in place; its setting starts over at that kind's usual value
insSense.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  if (!sel || !sel.dev) return;
  const k = +b.dataset.sense;
  for (const c of sel.cells) { fan[c] = k; dset[c] = DEV_DEFAULT[k]; }
  sel.dev = k;
  showInspector();
}));
insDir.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  if (!sel || !sel.dev) return;
  for (const c of sel.cells) ddir[c] = +b.dataset.face;
  showInspector();
}));
function deleteSelection() {
  if (!sel) return;
  if (sel.dev) { for (const c of sel.cells) { fan[c] = 0; dset[c] = 0; gate[c] = 1; } setHint('Removed.'); select(null); return; }
  if (sel.rb) removeBody(sel.rb.id); else removeJoint(sel.rec);
  setHint(sel.rb ? 'Part deleted.' : 'Joint deleted.');
  select(null);
}
document.getElementById('insDelete').addEventListener('click', deleteSelection);
function turnSelected(dir) {
  if (!sel || !sel.rb) return;
  const p = sel.rb.b.getPosition();
  if (!movePart(sel.rb, p.x, p.y, sel.rb.b.getAngle() + dir * Math.PI / 12)) setHint('No room to turn it there.');
}
document.getElementById('rotL').addEventListener('click', () => turnSelected(-1));
document.getElementById('rotR').addEventListener('click', () => turnSelected(1));

// ---------- the material picker ----------
const SYMS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
  'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu ' +
  'Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr ' +
  'Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' ');
function tablePos(z) {
  if (z === 1) return [1, 1];
  if (z === 2) return [1, 18];
  if (z <= 10) return [2, z - 2 <= 2 ? z - 2 : z + 8];
  if (z <= 18) return [3, z - 10 <= 2 ? z - 10 : z];
  if (z <= 36) return [4, z - 18];
  if (z <= 54) return [5, z - 36];
  if (z <= 86) return z >= 57 && z <= 71 ? [9, z - 54] : [6, z <= 56 ? z - 54 : z - 68];
  return z >= 89 && z <= 103 ? [10, z - 86] : [7, z <= 88 ? z - 86 : z - 100];
}
const palette = document.getElementById('palette');
const palInfo = document.getElementById('palInfo');
const matBtn = document.getElementById('matBtn');
const css = c => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
const degC = v => (Math.abs(v) >= 1e8 ? 'never' : v + ' °C');

function describe(m) {
  if (m.fixed) return m.name + ' · never melts, burns or moves';
  if (m.special === 'neutron') return 'Neutrons · paint them onto uranium or plutonium to start a chain reaction · water and carbon slow them down, boron swallows them';
  if (m.key === 'crude') return 'Crude oil · as it heats it gives off fuel gas (from 40 °C), gasoline (150 °C), kerosene (220 °C) and diesel (300 °C), and what is left is tar · burns · liquid at room temperature';
  if (m.burn && m.burn.self) return m.name + ' (rust and aluminium powder) · lights at ' + m.burn.at + ' °C, too hot for an ordinary flame · burns at ' + m.burn.heat + ' °C and leaves molten iron';
  let text = m.name + (m.sym ? ' (' + m.sym + ')' : '') + ' · melts ' + degC(m.melt) + ' · boils ' + degC(m.boil) + ' · ' + m.dens + ' g/cm³';
  text += ' · holds ' + m.cap.toFixed(2) + '× the heat of water';
  if (m.burn) text += ' · burns';
  if (m.wet) text += ' · reacts with water';
  const s = stateAt(m, AMBIENT);
  if (m.hal) text += ' · attacks metals';
  const n = m.nuc;
  if (n) {
    if (n.fisT) text += ' · fissile, neutrons split it';
    if (n.breed) text += ' · becomes uranium when it captures a neutron';
    else if (n.absT >= 0.15) text += ' · absorbs neutrons';
    if (n.mod) text += ' · slows neutrons down';
    if (n.sf >= 0.005) text += ' · gives off neutrons by itself';
  }
  if (m.warm) text += ' · warm from its own decay';
  if (m.decay) text += ' · decays to ' + m.decay.into.map(id => MATS[id].name.toLowerCase()).join(', ') + ', half-life ' + m.decay.half + ' s in this game';
  text += ' · ' + (s === GAS ? 'gas' : s === LIQUID ? 'liquid' : s === POWDER ? 'powder' : 'solid') + ' at room temperature';
  if (m.est) text += ' · numbers are predictions, too little has been made to measure';
  if (m.gen) text += ' · made from ' + (m.made.from || MATS[ID[m.made.A]].name.toLowerCase() + ' and ' + MATS[ID[m.made.B]].name.toLowerCase() + (m.made.act > 25 ? ' above ' + m.made.act + ' °C' : '')) + ' · properties estimated';
  return text;
}
function palDefault() { palInfo.textContent = describe(MATS[curMat]); }

function cpdButton(m) {
  const b = palButton(m, '');
  const sw = document.createElement('span');
  sw.className = 'sw'; sw.style.background = css(m.color);
  b.append(sw, m.name + ' ' + m.sym);
  return b;
}
// compounds that have formed in this session, newest last
const madeEl = document.getElementById('made'), madeHead = document.getElementById('madeHead');
const madeShown = new Set();
// The compounds discovered so far are kept by the browser between visits (by name, so they survive new
// versions of the material list), and travel in save files.
const MADE_KEY = 'powder-works-made';
function rememberMade() {
  try { localStorage.setItem(MADE_KEY, JSON.stringify([...made].filter(id => MATS[id] && MATS[id].gen).map(id => MATS[id].key))); } catch (e) {}
}
function learnMade(keys) {
  let n = 0;
  for (const k of keys || []) { const id = ID[k]; if (id !== undefined && MATS[id].gen && !made.has(id)) { made.add(id); n++; } }
  return n;
}
// any compound lying on the bench or making up a part counts as discovered
function learnFromBench() {
  let n = 0;
  for (let i = 0; i < N; i++) { const t = type[i]; if (st[i] && MATS[t].gen && !made.has(t)) { made.add(t); n++; } }
  for (const rb of bodies.values()) if (MATS[rb.mat].gen && !made.has(rb.mat)) { made.add(rb.mat); n++; }
  return n;
}
try { learnMade(JSON.parse(localStorage.getItem(MADE_KEY) || '[]')); } catch (e) {}
function showMade() {
  for (const id of made) {
    if (madeShown.has(id) || !MATS[id].gen) continue;
    madeShown.add(id);
    madeEl.appendChild(cpdButton(MATS[id]));
    madeHead.hidden = false;
  }
  rememberMade();
}
function palButton(m, text) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.pal = m.id;
  b.style.setProperty('--c', css(m.color));
  b.setAttribute('aria-label', m.name);
  b.setAttribute('aria-pressed', 'false');
  if (text) b.textContent = text;
  const show = () => { palInfo.textContent = describe(m); };
  b.addEventListener('pointerenter', show);
  b.addEventListener('focus', show);
  b.addEventListener('pointerleave', palDefault);
  b.addEventListener('click', () => { setMat(m.id); openPalette(false); });
  return b;
}
(function buildPalette() {
  const table = document.getElementById('ptable');
  SYMS.forEach((sym, n) => {
    const z = n + 1, [row, col] = tablePos(z);
    const m = MATS[ID[sym]];
    let b;
    if (m && m.z === z) b = palButton(m, sym);
    else {
      b = document.createElement('button');
      b.type = 'button'; b.disabled = true; b.textContent = sym;
      b.setAttribute('aria-label', sym + ', not added yet');
    }
    b.style.gridRow = row; b.style.gridColumn = col;
    table.appendChild(b);
  });
  // every compound the elements can make, shown only when a search matches it
  const all = document.getElementById('allcpd');
  for (const m of MATS) if (m.gen) all.appendChild(cpdButton(m));
  const comp = document.getElementById('compounds');
  for (const key of ['water', 'sand', 'crude', 'gasoline', 'kerosene', 'diesel', 'lpg', 'tar', 'salt', 'rust', 'thermite', 'waste', 'neutron', 'wall']) {
    const m = MATS[ID[key]];
    const b = palButton(m, '');
    const sw = document.createElement('span');
    sw.className = 'sw'; sw.style.background = css(m.color);
    b.append(sw, m.name);
    comp.appendChild(b);
  }
})();

// Search by name, symbol or atomic number. Enter picks the best match.
const palSearch = document.getElementById('palSearch');
let palBest = null;
function runSearch() {
  const q = palSearch.value.trim().toLowerCase();
  const tiles = palette.querySelectorAll('[data-pal]');
  palBest = null;
  let bestScore = 0;
  tiles.forEach(b => {
    const m = MATS[+b.dataset.pal];
    let score = 0;
    if (q) {
      const name = m.name.toLowerCase(), sym = m.sym.toLowerCase();
      if (m.z && sym === q) score = 6;
      else if (m.z && String(m.z) === q) score = 5;
      else if (name === q) score = 5;
      else if (name.startsWith(q)) score = 4;
      else if (m.z && sym.startsWith(q)) score = 3;
      else if (name.includes(q)) score = 2;
      else if (!m.z && m.sym && m.sym.replace(/[₀-₉]/g, d => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(d))).toLowerCase() === q) score = 6;
      else if (m.names && m.names.some(n => n.toLowerCase().includes(q))) score = 1;
    }
    b.classList.toggle('hit', score > 0);
    b.classList.remove('best');
    if (score > bestScore) { bestScore = score; palBest = b; }
  });
  palette.classList.toggle('searching', q !== '');
  if (palBest) { palBest.classList.add('best'); palInfo.textContent = describe(MATS[+palBest.dataset.pal]); }
  else if (q) palInfo.textContent = 'Nothing matches "' + palSearch.value.trim() + '". Try a name, a symbol like Fe, or an atomic number.';
  else palDefault();
}
palSearch.addEventListener('input', runSearch);
palSearch.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && palBest) { ev.preventDefault(); palBest.click(); }
  else if (ev.key === 'Escape') { ev.preventDefault(); openPalette(false); }
});

function openPalette(show) {
  palette.hidden = !show;
  matBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
  palSearch.value = '';
  runSearch();
  if (show) palSearch.focus(); else palSearch.blur();
}
matBtn.addEventListener('click', () => openPalette(palette.hidden));
document.getElementById('palClose').addEventListener('click', () => openPalette(false));

function setMat(id) {
  curMat = id;
  const m = MATS[id];
  document.getElementById('matSw').style.background = css(m.color);
  document.getElementById('matName').textContent = m.name;
  const pc = css(MATS[partMat()].color);
  document.getElementById('partSw').style.background = pc;
  document.getElementById('blockSw').style.background = pc;
  document.querySelectorAll('[data-pal]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.pal === id ? 'true' : 'false'));
  if (tool !== 'part' && tool !== 'block') setTool('brush');
  else setTool(tool);
}
document.querySelectorAll('[data-mat]').forEach(b => b.addEventListener('click', () => setMat(ID[b.dataset.mat])));

// ---------- pointer ----------
function placeJoint(kind, fx, fy) {
  const s = snapAt(fx, fy);
  if (s.joint) {
    select({ rec: s.joint });
    setHint('Joint selected. Change it in the panel.');
    return;
  }
  const near = bodiesAt(Math.floor(s.x), Math.floor(s.y), 2);
  if (!near.length) { setHint('Nothing to join there. Click on a part, or where two parts touch.'); return; }
  const rec = makeJoint(kind, near[0], near[1] || null, planck.Vec2(s.x * S, s.y * S));
  select({ rec });
  setHint(rec.B ? 'Joined two parts.' : (s.center ? 'Pinned at the part’s centre.' : 'Pinned the part to the background.'));
}

function startMove(rb, fx, fy) {
  select({ rb });
  const p = rb.b.getPosition();
  drag = playing
    ? { mode: 'grab', j: grab(rb, fx, fy) }
    : { mode: 'move', rb, sx: fx, sy: fy, px: p.x, py: p.y, dx: 0, dy: 0 };
}

canvas.addEventListener('pointerdown', ev => {
  if (ev.button === 0) pushUndo();
  ev.preventDefault();
  try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
  openPalette(false);
  const [fx, fy] = pointAt(ev);
  const x = Math.floor(fx), y = Math.floor(fy);
  down = true; lastX = x; lastY = y; dragX = x; dragY = y; hoverX = x; hoverY = y;
  if (tool === 'block') { dragX = lastX = snapCell(x); dragY = lastY = snapCell(y); }
  if (tool === 'hinge' || tool === 'motor') {
    placeJoint(tool, fx, fy);
    down = false;
  } else if (tool === 'spring') {
    const s = snapAt(fx, fy);
    const near = bodiesAt(Math.floor(s.x), Math.floor(s.y), 2);
    if (!near.length) { setHint('Press on a part, then drag to where the spring\u2019s other end goes.'); down = false; return; }
    drag = { mode: 'spring', A: near[0], x: s.x, y: s.y, cx: fx, cy: fy };
  } else if (tool === 'slider') {
    const s = snapAt(fx, fy);
    if (s.joint) { select({ rec: s.joint }); down = false; return; }
    const near = bodiesAt(Math.floor(s.x), Math.floor(s.y), 2);
    if (!near.length) { setHint('Press on a part, then drag the way it should slide.'); down = false; return; }
    drag = { mode: 'slider', A: near[0], x: s.x, y: s.y, cx: fx, cy: fy };
  } else if (tool === 'move') {
    const jn = jointNear(fx, fy, 1.6);
    const rb = bodiesAt(x, y, 0)[0] || bodiesAt(x, y, 1)[0];
    if (jn) {
      // a click selects the joint; dragging from it moves the part underneath instead
      select({ rec: jn });
      if (rb) drag = { mode: 'pending', rb, sx: fx, sy: fy }; else down = false;
      return;
    }
    if (!rb) {
      const dev = deviceAt(x, y);
      select(dev);
      if (dev && dev.dev === SWITCH) { setDevice(dset[dev.cells[0]] ? 0 : 1); setHint('Switch turned ' + (dset[dev.cells[0]] ? 'on.' : 'off.')); }
      down = false; return;
    }
    startMove(rb, fx, fy);
  } else if (BRUSHED[tool]) {
    const ctrl = ev.ctrlKey || ev.metaKey;
    altHeld = ev.altKey;
    if (ctrl && ev.shiftKey) { floodFill(x, y); down = false; }
    else if (ev.shiftKey) shape = { kind: 'line', x0: snapCell(x), y0: snapCell(y), x1: snapCell(x), y1: snapCell(y) };
    else if (ctrl) shape = { kind: 'rect', x0: snapCell(x), y0: snapCell(y), x1: snapCell(x), y1: snapCell(y) };
    else dab(x, y);
  }
});

canvas.addEventListener('pointermove', ev => {
  const [fx, fy] = pointAt(ev);
  const x = Math.floor(fx), y = Math.floor(fy);
  hoverX = x; hoverY = y; hoverFX = fx; hoverFY = fy;
  if (!down) return;
  if (drag && drag.mode === 'pending' && Math.hypot(fx - drag.sx, fy - drag.sy) > 1.5) startMove(drag.rb, drag.sx, drag.sy);
  if (drag && (drag.mode === 'slider' || drag.mode === 'spring')) { drag.cx = fx; drag.cy = fy; }
  else if (drag && drag.mode === 'grab') drag.j.setTarget(planck.Vec2(fx * S, fy * S));
  else if (drag && drag.mode === 'move') {
    const dx = snapCell(Math.round(fx - drag.sx)), dy = snapCell(Math.round(fy - drag.sy));
    if (dx !== drag.dx || dy !== drag.dy) {
      if (movePart(drag.rb, drag.px + dx * S, drag.py + dy * S, drag.rb.b.getAngle())) { drag.dx = dx; drag.dy = dy; }
    }
  } else if (shape) { shape.x1 = snapCell(x); shape.y1 = snapCell(y); altHeld = ev.altKey; }
  else if (BRUSHED[tool]) stroke(lastX, lastY, x, y);
  if (tool === 'block') { lastX = snapCell(x); lastY = snapCell(y); return; }
  lastX = x; lastY = y;
});

// Where the line or rectangle ends, snapped as Powder Toy does (GameView::lineSnapCoords and rectSnapCoords)
// while Alt is held: lines to horizontal, vertical or 45°, rectangles to squares.
function shapeEnd() {
  const { x0, y0, x1, y1 } = shape, dx = x1 - x0, dy = y1 - y0;
  if (!altHeld) return [x1, y1];
  altUsed = true;
  if (shape.kind === 'line') {
    if (Math.abs(dx) > 2 * Math.abs(dy)) return [x1, y0];
    if (Math.abs(dy) > 2 * Math.abs(dx)) return [x0, y1];
  }
  const d = Math.round(dx * dy > 0 ? (dx + dy) / 2 : (dx - dy) / 2);
  return dx * dy > 0 ? [x0 + d, y0 + d] : [x0 + d, y0 - d];
}
// The squares a line (stamped with the brush all along it) or a rectangle covers, each once
function shapeCells() {
  const [x1, y1] = shapeEnd(), out = new Set();
  const add = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) out.add(y * W + x); };
  if (shape.kind === 'rect') {
    for (let y = Math.min(shape.y0, y1); y <= Math.max(shape.y0, y1); y++)
      for (let x = Math.min(shape.x0, x1); x <= Math.max(shape.x0, x1); x++) add(x, y);
  } else {
    const r = brush - 1;
    for (const [cx, cy] of lineCells(shape.x0, shape.y0, x1, y1))
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 0.5) add(cx + dx, cy + dy);
  }
  return out;
}
const toolMat = () => tool === 'part' ? partMat() : tool === 'fan' ? fanDir : curMat;
function paintCells(cells) { const m = toolMat(); for (const i of cells) paint(i % W, (i / W) | 0, tool, 0, m, true); }
function applyShape() { paintCells(shapeCells()); }
function floodFill(x, y) {
  const cells = floodRegion(x, y);
  if (!cells.length) { setHint('Fill works on empty space or loose material, not on a part.'); return; }
  paintCells(cells);
  if (tool === 'part') {
    const n = finishPart();
    if (n) setHint((n === 1 ? 'Part made' : n + ' parts made') + passNote() + '. Join parts with Hinge.');
  } else setHint('Filled ' + cells.length + ' squares.');
}
// Holding Alt only snaps; stop a lone Alt press from sending the browser to its menu bar after drawing.
window.addEventListener('keydown', ev => { if (ev.key === 'Alt') { altHeld = true; if (shape) ev.preventDefault(); } });
window.addEventListener('keyup', ev => { if (ev.key === 'Alt') { altHeld = false; if (shape || altUsed) ev.preventDefault(); altUsed = false; } });

function release() {
  if (!down) return;
  down = false;
  if (shape) { applyShape(); shape = null; }
  if (drag && drag.mode === 'spring') {
    const end = snapAt(drag.cx, drag.cy);
    if (Math.hypot(end.x - drag.x, end.y - drag.y) < 1.5) setHint('Drag further: a spring needs some length.');
    else {
      const other = bodiesAt(Math.floor(end.x), Math.floor(end.y), 1).find(rb => rb !== drag.A) || null;
      const rec = makeJoint('spring', drag.A, other, planck.Vec2(drag.x * S, drag.y * S), planck.Vec2(end.x * S, end.y * S));
      select({ rec });
      setHint(other ? 'Spring joins the two parts.' : 'Spring hangs the part from the background.');
    }
  } else if (drag && drag.mode === 'slider') {
    const rec = makeJoint('slider', drag.A, null, planck.Vec2(drag.x * S, drag.y * S), sliderAxis(drag));
    select({ rec });
    setHint('Slider added. The part can now only move along the dashed track.');
  } else if (drag && drag.mode === 'grab') ungrab(drag.j);
  else if (tool === 'block') {
    const rb = makePart(cellsRect(dragX, dragY, lastX, lastY), partMat());
    if (rb) select({ rb });
    setHint(rb ? MATS[rb.mat].name + ' block placed' + passNote() + '. Pin it with Hinge, or let it fall.' : 'A block needs clear space. Drag it where no wall is in the way.');
  } else if (tool === 'part') {
    const n = finishPart();
    if (n) setHint((n === 1 ? 'Part made' : n + ' parts made') + passNote() + '. Join parts with Hinge.');
  }
  drag = null;
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('contextmenu', ev => ev.preventDefault());   // Ctrl-click on a Mac is a right click
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('pointerleave', () => { hoverX = -1; snap = null; });
canvas.addEventListener('wheel', ev => {
  if (tool !== 'move' || !sel || !sel.rb) return;
  ev.preventDefault();
  turnSelected(ev.deltaY > 0 ? 1 : -1);
}, { passive: false });

// ---------- tools, play and rewind ----------
const passNote = () => passedLast ? ' (it passes through the ' + (passedLast === 1 ? 'part' : passedLast + ' parts') + ' it was drawn over)' : '';
function toolHint(name) {
  if (name === 'brush') return 'Painting ' + label(curMat, stateAt(MATS[curMat], AMBIENT)).toLowerCase() + '. Shift-drag: line (Alt snaps), Ctrl-drag: box, Ctrl+Shift-click: fill. T: all materials.';
  if (name === 'part' || name === 'block') {
    const made = MATS[partMat()].name.toLowerCase();
    const why = partMat() === curMat ? '' : ' (' + MATS[curMat].name + ' is not a solid block, so parts use iron)';
    return name === 'part'
      ? 'Draw a shape in ' + made + why + '. Each connected piece becomes a solid part when you let go. Draw over other parts and it passes through them, so a rod can cross a flywheel.'
      : 'Drag a rectangle to make a solid ' + made + ' part' + why + '. Over other parts, it passes through them.';
  }
  return TOOL_HINTS[name];
}
function setTool(name) {
  if (down) release();
  tool = name;
  document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === name ? 'true' : 'false'));
  const quick = name === 'brush';
  document.querySelectorAll('[data-mat]').forEach(b => b.setAttribute('aria-pressed', quick && ID[b.dataset.mat] === curMat ? 'true' : 'false'));
  const hint = toolHint(name);
  if (hint) setHint(hint);
}
document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
function setFanDir(d) {
  fanDir = d; G.paintDir = d;
  document.querySelectorAll('[data-dir]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.dir === d ? 'true' : 'false'));
}
document.querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => { setFanDir(+b.dataset.dir); if (tool !== 'inverter' && tool !== 'pump') setTool('fan'); }));
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  view = +b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(o => o.setAttribute('aria-pressed', o === b ? 'true' : 'false'));
  if (view === 4) setHint('Blue: fresh air · amber: burnt gas (or no air at all) · green: fuel not yet burned.');
}));

const playBtn = document.getElementById('play');
const rewindBtn = document.getElementById('rewind');
const modeEl = document.getElementById('mode');
let saved = null;
function setPlaying(p) {
  if (p && !playing) { saved = snapshot(); rewindBtn.disabled = false; }
  if (!p && drag && drag.mode === 'grab') { ungrab(drag.j); drag = null; }
  playing = p;
  playBtn.textContent = p ? 'Pause' : 'Play';
  modeEl.textContent = p ? 'Running' : 'Building';
  modeEl.dataset.mode = p ? 'run' : 'build';
}
playBtn.addEventListener('click', () => setPlaying(!playing));
function rewind() {
  if (!saved) return;
  if (drag && drag.mode === 'grab') ungrab(drag.j);
  drag = null; down = false;
  restore(saved);
  select(null);
  setPlaying(false);
  setHint('Rewound to how it was when you pressed Play.');
}
rewindBtn.addEventListener('click', rewind);

const presetEl = document.getElementById('preset');
function load(name) {
  if (undoReady) pushUndo();
  preset = name;
  drag = null; down = false;
  loadPreset(name);
  select(null);
  saved = null;
  rewindBtn.disabled = true;
  setPlaying(false);
  setTool(name === 'blank' ? 'brush' : name === 'reactor' || name === 'diesel' || name === 'hydraulic' || name === 'wind' || name === 'engine' || name === 'chem' || name === 'refinery' || name === 'components' ? 'move' : 'fire');
  setHint(HINTS[name]);
}
presetEl.addEventListener('change', () => load(presetEl.value));
document.getElementById('reset').addEventListener('click', () => load(preset));
const brushEl = document.getElementById('brush');
brushEl.addEventListener('input', () => {
  brush = +brushEl.value;
  document.getElementById('brushval').textContent = brush;
});
const KEYS = { 'y': 'sensor', 'u': 'inverter', 'l': 'pump', 'z': 'electrode', 'g': 'spring', 'k': 'contact', 'w': 'wire', 'p': 'plug', 'i': 'injector', 'v': 'valve', 'o': 'switch', 'j': 'heater', 'f': 'fan', '5': 'fire', '6': 'part', '7': 'block', '8': 'hinge', '9': 'motor', '0': 'erase', 'm': 'move', 's': 'slider', 'b': 'brush', 'h': 'heat', 'c': 'cool' };
const MAT_KEYS = { '1': 'sand', '2': 'water', '3': 'gasoline', '4': 'wall' };
window.addEventListener('keydown', ev => {
  const tag = ev.target.tagName;
  if (tag === 'SELECT' || tag === 'INPUT' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (KEYS[k]) setTool(KEYS[k]);
  else if (MAT_KEYS[k]) { setMat(ID[MAT_KEYS[k]]); setTool('brush'); }
  else if (tool === 'fan' && k.startsWith('arrow')) { ev.preventDefault(); setFanDir({ arrowright: 1, arrowleft: 2, arrowup: 3, arrowdown: 4 }[k]); }
  else if (k === 't') { ev.preventDefault(); openPalette(palette.hidden); }
  else if (k === ' ') { ev.preventDefault(); setPlaying(!playing); }
  else if (k === 'r') rewind();
  else if (k === 'q') turnSelected(-1);
  else if (k === 'e') turnSelected(1);
  else if (k === 'delete' || k === 'backspace') { if (sel) { ev.preventDefault(); pushUndo(); deleteSelection(); } }
  else if (k === 'escape') { if (!palette.hidden) openPalette(false); else select(null); }
});

// ---------- version ----------
// Filled in by the build (vite.config.js): package.json's version, the commit, and the build time.
const APP_VERSION = __APP_VERSION__;
const versionEl = document.getElementById('version');
versionEl.textContent = 'v' + APP_VERSION + ' \u00b7 ' + __COMMIT__;
versionEl.title = __COMMIT__ === 'dev' ? 'Running from the dev server' : 'Built ' + new Date(__BUILT__).toLocaleString();

let frameNo = 0;
function frame() {
  if (down && BRUSHED[tool] && tool !== 'part' && !shape) dab(lastX, lastY);
  if (playing) step();
  if (sel && ((sel.rb && !bodies.has(sel.rb.id)) || (sel.rec && !jrecs.includes(sel.rec)) || (sel.dev && fan[sel.cells[0]] !== sel.dev))) select(null);
  snap = hoverX >= 0 && (tool === 'hinge' || tool === 'motor' || tool === 'slider' || tool === 'spring') ? snapAt(hoverFX, hoverFY) : null;
  render();
  const news = G.madeNews;
  if (news !== null) {
    G.madeNews = null;
    if (MATS[news].gen) setHint('New compound: ' + MATS[news].name + ' (' + MATS[news].sym + '). It is in Materials under Made so far.');
    showMade();
  }
  if (++frameNo % 6 === 0) {
    if (hoverX >= 0) {
      const i = hoverY * W + hoverX;
      const p = SOL[st[i]] ? '' : ' · ' + (P[i] + LP[i]).toFixed(2) + ' atm';
      const fd = fan[i];
      const over = fd >= CONTACT ? devName(i) + (lit[i] >= 4 ? ' (live)' : '') + ' \u00b7 ' : fd && !SOL[st[i]] ? 'Fan \u00b7 ' : '';
      const burnt = st[i] === NONE && ox[i] < 0.95 ? ' (' + Math.round(100 - ox[i] * 100) + '% burnt)' : '';
      const so = solute(i), mix = so ? ' (' + (100 * massShare(i)).toFixed(massShare(i) < 0.1 ? 1 : 0) + '% ' + MATS[so].name.toLowerCase() + ' by mass)' : '';
      readoutEl.textContent = (G.nCount ? G.nCount + ' neutrons \u00b7 ' : '') + over + label(type[i], st[i]) + mix + burnt + ' · ' + Math.round(temp[i]) + ' °C' + p;
    } else readoutEl.textContent = G.nCount ? G.nCount + ' neutrons' : ' ';
  }
  requestAnimationFrame(frame);
}
setMat(ID.sand);
load('engine');
showMade();   // compounds discovered on earlier visits
requestAnimationFrame(frame);

// ---------- undo / redo ----------
// Every edit first saves the whole bench, so it can be put back. Undo goes back past edits, not past time:
// while it plays, undo also puts the clock back to when the edit was made.
const undoStack = [], redoStack = [];
var undoReady = true;   // (scenes load before this point while the page starts; those are not edits)
// edits in the inspector: one undo step per touch, not one per slider movement
let lastInsPush = 0;
function pushUndoSoon() { const t = performance.now(); if (t - lastInsPush > 700) pushUndo(); lastInsPush = t; }
ins.addEventListener('pointerdown', ev => { if (ev.target.closest('button, input')) pushUndoSoon(); }, true);
ins.addEventListener('focusin', ev => { if (ev.target.tagName === 'INPUT') pushUndoSoon(); }, true);
const UNDO_MAX = 25;
const undoBtn = document.getElementById('undo'), redoBtn = document.getElementById('redo');
function refreshUndo() { undoBtn.disabled = !undoStack.length; redoBtn.disabled = !redoStack.length; }
function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack.length = 0;
  refreshUndo();
}
function undo() {
  if (!undoStack.length) { setHint('Nothing to undo.'); return; }
  redoStack.push(snapshot());
  drag = null; down = false; select(null);
  restore(undoStack.pop());
  refreshUndo();
  setHint('Undone.');
}
function redo() {
  if (!redoStack.length) { setHint('Nothing to redo.'); return; }
  undoStack.push(snapshot());
  drag = null; down = false; select(null);
  restore(redoStack.pop());
  refreshUndo();
  setHint('Redone.');
}
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
refreshUndo();

// ---------- save / open ----------
// A save is the whole bench as one compressed file. Materials are stored by name, so a save still opens
// after materials have been added or reordered in a later version.
const SAVE_VERSION = 1;
function encodeValue(v) {
  if (ArrayBuffer.isView(v)) {
    const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    let bin = '';
    for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
    return { $t: v.constructor.name, $d: btoa(bin) };
  }
  if (Array.isArray(v)) return v.map(encodeValue);
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = encodeValue(v[k]); return o; }
  return v;
}
const ARRAY_TYPES = { Uint8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, Int8Array, Uint8ClampedArray };
function decodeValue(v) {
  if (Array.isArray(v)) return v.map(decodeValue);
  if (v && typeof v === 'object') {
    if (v.$t) {
      const bin = atob(v.$d), bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      return new ARRAY_TYPES[v.$t](bytes.buffer);
    }
    const o = {}; for (const k in v) o[k] = decodeValue(v[k]); return o;
  }
  return v;
}
async function gzip(text, back) {
  const stream = (text instanceof Blob ? text : new Blob([text])).stream().pipeThrough(back ? new DecompressionStream('gzip') : new CompressionStream('gzip'));
  return back ? await new Response(stream).text() : await new Response(stream).blob();
}
// The file is a small JSON wrapper around the compressed bench, so it travels as an ordinary .json file.
async function saveBench() {
  try {
    const data = { app: 'powder-works', version: SAVE_VERSION, game: APP_VERSION, W, H, scene: preset, mats: MATS.map(m => m.key), made: [...made].filter(id => MATS[id].gen).map(id => MATS[id].key), snap: encodeValue(snapshot()) };
    const packed = new Uint8Array(await (await gzip(JSON.stringify(data))).arrayBuffer());
    let bin = '';
    for (let k = 0; k < packed.length; k += 0x8000) bin += String.fromCharCode.apply(null, packed.subarray(k, k + 0x8000));
    const text = JSON.stringify({ app: 'powder-works', gz: btoa(bin) });
    const name = 'powder-works-' + new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-') + '.json';
    // inside Claude the page cannot download by itself: it offers the file, and you confirm
    let dl = null;
    try { if (window.claude && window.claude.use) dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
    if (dl) {
      try { await dl.save({ filename: name, data: text }); setHint('Saved ' + name + '.'); }
      catch (e) { setHint(e && e.code === 'declined' ? 'Not saved.' : e && e.code === 'rate_limited' ? 'A save is already waiting for you to confirm.' : 'Could not save here (' + (e && e.code || 'unavailable') + ').'); }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    setHint('Saved ' + name + ' to your downloads.');
  } catch (err) {
    setHint('Could not save: ' + err.message);
  }
}
async function openBench(file) {
  try {
    let data = JSON.parse(await file.text());
    if (data && data.gz) {
      const bin = atob(data.gz), bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      data = JSON.parse(await gzip(new Blob([bytes]), true));
    }
    if (data.app !== 'powder-works' || !data.snap) throw new Error('that is not a Powder Works save');
    if (data.W !== W || data.H !== H) throw new Error('that save is for a different bench size');
    const snap = decodeValue(data.snap);
    // materials by name: map each saved id to today's id for the same material
    const map = new Uint16Array(Math.max(1, data.mats.length));
    data.mats.forEach((key, k) => { map[k] = ID[key] !== undefined ? ID[key] : 0; });
    for (let i = 0; i < snap.type.length; i++) {
      snap.type[i] = map[snap.type[i]] || 0;
      if (snap.st[i] === GAS && snap.aux[i] && snap.aux[i] !== NOTHING && snap.type[i] === FIRE) snap.aux[i] = map[snap.aux[i]] || NOTHING;
    }
    for (const b of snap.bodies) b.mat = map[b.mat] || ID.Fe;
    if (snap.sol) for (let i = 0; i < snap.sol.length; i++) { snap.sol[i] = map[snap.sol[i]] || 0; snap.sh[i] = map[snap.sh[i]] || 0; }
    pushUndo();
    drag = null; down = false; select(null);
    restore(snap);
    saved = null; rewindBtn.disabled = true; setPlaying(false);
    if (data.scene && HINTS[data.scene] !== undefined) { preset = data.scene; presetEl.value = data.scene; }
    const learnt = learnMade(data.made) + learnFromBench();
    showMade();
    setHint('Opened ' + file.name + '.' + (learnt ? ' ' + learnt + (learnt === 1 ? ' compound' : ' compounds') + ' from it added to Made so far.' : ''));
  } catch (err) {
    setHint('Could not open that file: ' + err.message);
  }
}
const fileIn = document.getElementById('fileIn');
document.getElementById('save').addEventListener('click', saveBench);
document.getElementById('open').addEventListener('click', () => fileIn.click());
fileIn.addEventListener('change', () => { if (fileIn.files[0]) openBench(fileIn.files[0]); fileIn.value = ''; });
// a save file dropped onto the bench opens too
canvas.addEventListener('dragover', ev => { ev.preventDefault(); });
canvas.addEventListener('drop', ev => { ev.preventDefault(); const f = ev.dataTransfer.files[0]; if (f) openBench(f); });

const gridBtn = document.getElementById('grid'), gridSizeEl = document.getElementById('gridSize'), snapBtn = document.getElementById('snap');
function showGridState() {
  gridBtn.setAttribute('aria-pressed', gridOn ? 'true' : 'false');
  snapBtn.setAttribute('aria-pressed', snapOn ? 'true' : 'false');
  gridSizeEl.value = String(gridN);
}
showGridState();
gridBtn.addEventListener('click', () => { gridOn = !gridOn; showGridState(); keepGrid(); setHint(gridOn ? 'Grid on, every ' + gridN + ' cells.' + (snapOn ? '' : ' Turn on Snap to lock lines, boxes, joints and moves to it.') : 'Grid hidden.' + (snapOn ? ' Snap stays on.' : '')); });
gridSizeEl.addEventListener('change', () => { gridN = +gridSizeEl.value; keepGrid(); setHint('Grid every ' + gridN + ' cells.'); });
snapBtn.addEventListener('click', () => {
  snapOn = !snapOn;
  if (snapOn && !gridOn) gridOn = true;          // snapping to a grid you cannot see would be confusing
  showGridState(); keepGrid();
  setHint(snapOn ? 'Snap on: Shift lines, Ctrl boxes, Block corners, joints and moved parts lock to the grid. Freehand drawing stays free.' : 'Snap off.');
});

const edgesBtn = document.getElementById('edges');
edgesBtn.addEventListener('click', () => {
  const open = edgesBtn.getAttribute('aria-pressed') !== 'true';
  edgesBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
  edgesBtn.textContent = open ? 'Edges: open' : 'Edges: walled';
  G.openEdges = open;
  setHint(open ? 'Anything loose that reaches the edge of the bench leaves it.' : 'The edges of the bench hold everything in, like walls.');
});

window.addEventListener('keydown', ev => {
  if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
  const tag = ev.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT') return;
  const k = ev.key.toLowerCase();
  if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); redo(); }
  else if (k === 's') { ev.preventDefault(); saveBench(); }
  else if (k === 'o') { ev.preventDefault(); fileIn.click(); }
});
