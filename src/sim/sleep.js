// Chunk sleeping: the bench is split into 16x16 chunks, and the costly passes over the whole grid (gas
// pressure and flow, heat, moving air) only work on chunks where something is going on, plus the chunks
// around them. A chunk where every field has settled keeps its values exactly until something nearby
// changes.
//
// Once a frame, after the cells have moved and before those passes, one scan of the whole bench marks a
// chunk busy if a cell in it changed material or state, gas is flowing, pressure, temperature or fresh air
// differs between neighbouring cells, outdoor air has not cooled to room temperature, or a fan or squeezed
// liquid is in it. Because it looks at the state itself, nothing that edits the bench has to remember to
// wake anything.
import { AMBIENT, AIR_COOL, H, LIQUID, N, NONE, SOL, W } from './constants.js';
import { aux, fan, ox, st, type } from './grid.js';
import { FX, FY, P, outGen, outdoors, temp } from './flow.js';

export const CS = 16, CSHIFT = 4;
export const CW = Math.ceil(W / CS), CH = Math.ceil(H / CS), NC = CW * CH;
export const awake = new Uint8Array(NC).fill(1);   // chunks the field passes work on this frame
export const busy = new Uint8Array(NC);
const prevType = new Uint16Array(N), prevSt = new Uint8Array(N);

// How small a difference counts as settled
const EP = 2e-4;     // atm, between neighbouring open cells
const EF = 2e-3;     // flow across a face (moves air about 0.1 cells a second: far below what carries heat)
const ET = 0.2;      // °C, between neighbours
const EO = 2e-3;     // fresh-air fraction, between neighbouring air cells

export let sleeping = true;    // off: every chunk is always awake (for comparing results)
export function setSleeping(on) { sleeping = on; if (!on) awake.fill(1); }
export const asleepCount = () => { let n = 0; for (let c = 0; c < NC; c++) if (!awake[c]) n++; return n; };

function cellBusy(i, x, y) {
  if (type[i] !== prevType[i] || st[i] !== prevSt[i]) return true;
  const s = st[i];
  if (fan[i] && fan[i] <= 4) return true;                             // fans push all the time
  if (s === LIQUID && aux[i]) return true;                            // liquid squeezed by a part
  const t = temp[i];
  if (x < W - 1 && Math.abs(t - temp[i + 1]) > ET) return true;
  if (y < H - 1 && Math.abs(t - temp[i + W]) > ET) return true;
  if (SOL[s]) return false;
  if (FX[i] > EF || FX[i] < -EF || FY[i] > EF || FY[i] < -EF) return true;
  const p = P[i];
  if (x < W - 1 && !SOL[st[i + 1]] && Math.abs(p - P[i + 1]) > EP) return true;
  if (y < H - 1 && !SOL[st[i + W]] && Math.abs(p - P[i + W]) > EP) return true;
  if (s === NONE) {
    if (outdoors[i] === outGen && ox[i] > 0.3 && Math.abs(t - AMBIENT) > ET && AIR_COOL > 0) return true;
    if (x < W - 1 && st[i + 1] === NONE && Math.abs(ox[i] - ox[i + 1]) > EO) return true;
    if (y < H - 1 && st[i + W] === NONE && Math.abs(ox[i] - ox[i + W]) > EO) return true;
  }
  return false;
}

// Decide which chunks are awake this frame.
export function scanChunks() {
  if (!sleeping) { prevType.set(type); prevSt.set(st); return; }
  busy.fill(0);
  for (let cy = 0; cy < CH; cy++) {
    const y0 = cy * CS, y1 = Math.min(H, y0 + CS);
    for (let cx = 0; cx < CW; cx++) {
      const x0 = cx * CS, x1 = Math.min(W, x0 + CS);
      let b = 0;
      for (let y = y0; y < y1 && !b; y++) {
        let i = y * W + x0;
        for (let x = x0; x < x1; x++, i++) if (cellBusy(i, x, y)) { b = 1; break; }
      }
      busy[cy * CW + cx] = b;
    }
  }
  prevType.set(type); prevSt.set(st);
  // a busy chunk wakes the chunks around it, so changes can spread
  awake.fill(0);
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
    if (!busy[cy * CW + cx]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && ny >= 0 && nx < CW && ny < CH) awake[ny * CW + nx] = 1;
    }
  }
}

// Everything awake for the next frame (after loading or rewinding, when nothing can be assumed settled)
export function wakeAll() { awake.fill(1); prevType.fill(65535); }
