// Grid size, cell states and the physical constants the simulation is tuned with.

export const W = 240, H = 150, N = W * H;
// what a cell is doing right now
export const NONE = 0, STATIC = 1, POWDER = 2, LIQUID = 3, GAS = 4, PART = 5, DRAFT = 6;
export const SOL = new Uint8Array([0, 1, 0, 0, 0, 1, 1]);   // states that block gas and loose material
export const P0 = 1;            // ambient pressure, atm
export const AMBIENT = 20;      // room temperature, deg C
export const FIRE_P = 0.01;     // pressure a burning cell adds per frame
export const FLAME_GAIN = 8;    // atm added to a cell of room-temperature air when all its oxygen is burned
export const NOTHING = 65535;   // a flame that leaves nothing behind (a spark)
export const DIFF = 0.24;       // local pressure smoothing per iteration
export const P_ITERS = 2;
export const KFLOW = 600;       // how far pressure equalizes per frame along a row or column
export const FLOW_ROUNDS = 2;
export const KLIQ = 6;          // the same through liquid: pressure gets through, but gas cannot simply blow through it
export const GAMMA = 1.4;       // ratio of specific heats for gas: squeezing it stores extra energy as heat
export const KAPPA = (GAMMA - 1) / GAMMA;
export const CAPG = 0.15;       // heat capacity of a cell of gas or air, as a fraction of water's (real gas is far lower, this keeps the maths stable)
export const LIQCAP = 0.03;      // how much a cell of liquid gives when gas presses on it, next to gas at 1
export const BULK = 300;        // atm of pressure per fraction of its volume a trapped liquid is squeezed by (real water: about 22,000)
export const KEEP_GAS = 0.985, KEEP_LIQUID = 0.6, KEEP_POWDER = 0.3;   // share of its motion a flow keeps each frame
export const WIND = 0.01;        // atm of push on a surface per (cell per frame) squared of air blowing onto it
export const FAN_HEAD = 0.04, FAN_TOP = 6;   // pressure a fan cell adds across its face (atm), and the flow at which it stops helping
export const AIR_COOL = 0.004;  // how fast open air sheds heat back to room temperature
export const S = 0.1;           // metres per cell, for the rigid-body engine
export const GRAVITY = 14;      // m/s^2
export const PFORCE = 0.54;     // newtons on one exposed cell face per atm above ambient
export const DT = 1 / 60;
export const SKIN = 0.022;      // metres trimmed off each side of a part's collision boxes
