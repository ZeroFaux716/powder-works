// The grid of cells, the physics world, and the shared state object G.
import * as planck from 'planck';
import { GRAVITY, H, N, NONE, P0, W } from './constants.js';
import { need } from './reactions.js';
import { temp } from './flow.js';
import { cur } from './world.js';

// Shared state that several modules change. (ES module bindings can only be changed by their own module,
// so these live on one object instead.)
export const G = {
  ground: null,   // the static body that holds the walls (made once the world exists)
  groundDirty: true,   // the static ground body needs rebuilding
  lpCells: [],   // liquid cells holding squeezed pressure this frame
  nextId: 1,   // next part id
  nCount: 0,   // neutrons in flight
  nextJointId: 1,   // next joint id
  grabBase: null,   // body a dragged part is pulled towards
  madeNews: null,   // the latest newly made compound, for the status line
  openEdges: true,   // whether loose things leave at the edge of the bench
  paintDir: 1,   // the way new inverters and pumps face
};
// ---------- the grid ----------
export const type = new Uint16Array(N);     // material id
export const st = new Uint8Array(N);        // cell state
export const life = new Int16Array(N);
export const aux = new Uint16Array(N);      // for fire: what it leaves behind
export const lat = new Float32Array(N);    // latent heat banked towards the next change of state
export const ox = new Float32Array(N).fill(1);   // how much of the air in a cell is still fresh: 1 is clean air, 0 is all burnt gas
export const Pref = new Float32Array(N).fill(P0);   // pressure at the end of last frame, to see how much each cell was squeezed
export const cpc = new Float32Array(N);
export const pcap = new Float32Array(N);   // pressure capacity per cell: 1 for gas, tiny for liquid
export const smooth = new Uint8Array(N);
export const LP = new Float32Array(N);     // extra pressure in squeezed liquid, atm
export const stocked = [];                 // liquid cells holding squeezed-in liquid this frame
export const stamp = new Uint8Array(N);
export const bid = new Uint16Array(N);
export const open = new Uint8Array(N);
export const cnd = new Float32Array(N);
export const HDX = new Float32Array(N), HDY = new Float32Array(N);   // pressure a fan adds across each right / bottom face
export const headFaces = [];
export const fan = new Uint8Array(N);      // things laid over cells. Fans: 1 blows right, 2 left, 3 up, 4 down. Electrics: 5 contact, 6 wire, 7 spark plug, 8 injector, 9 valve, 10 switch, 11 heater,
// 12-14 sensors (temperature, pressure, touch), 15 inverter, 16 pump, 17 electrode
export const CONTACT = 5, WIRE = 6, PLUG = 7, INJECTOR = 8, VALVE = 9, SWITCH = 10, HEATER = 11;
export const SENSE_T = 12, SENSE_P = 13, SENSE_C = 14, INVERTER = 15, PUMP = 16, ELECTRODE = 17;
export const ddir = new Uint8Array(N);   // which way an inverter or pump faces: 1 right, 2 left, 3 up, 4 down
export const DIR_STEP = [0, 1, -1, -W, W];
// Each device's setting: how far a valve opens (0-100 %), puffs an injector sprays per frame, a switch on (1) or off (0)
export const dset = new Uint8Array(N);
export const DEV_DEFAULT = { [VALVE]: 100, [INJECTOR]: 6, [SWITCH]: 1, [HEATER]: 40, [SENSE_T]: 10, [SENSE_P]: 15, [SENSE_C]: 1, [INVERTER]: 1, [PUMP]: 3, [ELECTRODE]: 1 };
// a heater's and a temperature sensor's setting is tens of °C, a pressure sensor's tenths of an atmosphere
export const gate = new Float32Array(N).fill(1);   // how freely gas passes a cell: 1 normally, less in a part-open valve
// a valve's opening sets how freely gas passes it, on a steep curve: half open passes about 1 % as easily
export function valveGate(pct) { return pct >= 100 ? 1 : Math.pow(10, -4 * (1 - pct / 100)); }
export const INJ_RATE = 6, INJ_UNITS = 4;   // puffs of vapour an injector sprays per frame while live, and the fuel in each
export const lit = new Uint8Array(N);      // frames a wire stays lit up after carrying a pulse
export const eq = new Int32Array(N), eseen = new Uint32Array(N);
export const cpBuf = new Float64Array(Math.max(W, H));
export const dpBuf = new Float64Array(Math.max(W, H));
export const kfBuf = new Float64Array(Math.max(W, H));

export const world = planck.World({ gravity: planck.Vec2(0, GRAVITY) });
G.ground = world.createBody();
export const bodies = new Map();

export function swap(i, j) {
  const t = type[i]; type[i] = type[j]; type[j] = t;
  const s = st[i]; st[i] = st[j]; st[j] = s;
  const f = temp[i]; temp[i] = temp[j]; temp[j] = f;
  const l = life[i]; life[i] = life[j]; life[j] = l;
  const a = aux[i]; aux[i] = aux[j]; aux[j] = a;
  const q = lat[i]; lat[i] = lat[j]; lat[j] = q;
  const nd = need[i]; need[i] = need[j]; need[j] = nd;
  stamp[i] = cur; stamp[j] = cur;
}

export function clearCell(i) { type[i] = 0; st[i] = NONE; life[i] = 0; aux[i] = 0; lat[i] = 0; need[i] = 0; }

// Melting, freezing, boiling and condensing all take or give energy. A cell that reaches the threshold
// holds at that temperature and banks the extra heat; only when the bank is full does it change state.
// Returns the state the cell should now be in.
