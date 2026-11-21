const W = 240, H = 150, N = W * H;
// what a cell is doing right now
const NONE = 0, STATIC = 1, POWDER = 2, LIQUID = 3, GAS = 4, PART = 5, DRAFT = 6;
const SOL = new Uint8Array([0, 1, 0, 0, 0, 1, 1]);   // states that block gas and loose material
const P0 = 1;            // ambient pressure, atm
const AMBIENT = 20;      // room temperature, deg C
const FIRE_P = 0.01;     // pressure a burning cell adds per frame
const FLAME_GAIN = 8;    // atm added to a cell of room-temperature air when all its oxygen is burned
const NOTHING = 65535;   // a flame that leaves nothing behind (a spark)
const DIFF = 0.24;       // local pressure smoothing per iteration
const P_ITERS = 2;
const KFLOW = 600;       // how far pressure equalizes per frame along a row or column
const FLOW_ROUNDS = 2;
const KLIQ = 6;          // the same through liquid: pressure gets through, but gas cannot simply blow through it
const GAMMA = 1.4;       // ratio of specific heats for gas: squeezing it stores extra energy as heat
const KAPPA = (GAMMA - 1) / GAMMA;
const CAPG = 0.15;       // heat capacity of a cell of gas or air, as a fraction of water's (real gas is far lower, this keeps the maths stable)
const LIQCAP = 0.03;      // how much a cell of liquid gives when gas presses on it, next to gas at 1
const BULK = 300;        // atm of pressure per fraction of its volume a trapped liquid is squeezed by (real water: about 22,000)
const KEEP_GAS = 0.985, KEEP_LIQUID = 0.6, KEEP_POWDER = 0.3;   // share of its motion a flow keeps each frame
const WIND = 0.01;        // atm of push on a surface per (cell per frame) squared of air blowing onto it
const FAN_HEAD = 0.04, FAN_TOP = 6;   // pressure a fan cell adds across its face (atm), and the flow at which it stops helping
const AIR_COOL = 0.004;  // how fast open air sheds heat back to room temperature
const S = 0.1;           // metres per cell, for the rigid-body engine
const GRAVITY = 14;      // m/s^2
const PFORCE = 0.54;     // newtons on one exposed cell face per atm above ambient
const DT = 1 / 60;
const SKIN = 0.022;      // metres trimmed off each side of a part's collision boxes

// ---------- materials ----------
// One row per material. melt and boil are deg C, dens is g/cm^3, k is thermal conductivity in W/(m K).
// Everything else follows from shared rules: phase from temperature, sinking from density,
// heat flow from conductivity.
const MATS = [], ID = {};
function def(key, name, o) {
  const m = Object.assign({ id: MATS.length, key, name, sym: '', z: 0, melt: 1e9, boil: 1e9, dens: 1, k: 1, color: [128, 128, 128], lift: 0, gasP: 4, cap: 0.5 }, o);
  MATS.push(m); ID[key] = m.id;
  return m;
}
function el(sym, name, z, melt, boil, dens, k, color, extra) {
  return def(sym, name, Object.assign({ sym, z, melt, boil, dens, k, color }, extra));
}
def('air', 'Air', { melt: -1e9, boil: -1e9, k: 0.026, cond: 0.01, color: [11, 15, 20] });
def('wall', 'Wall', { fixed: true, cond: 0.08, dens: 9, cap: 0.6, color: [107, 114, 125] });
def('fire', 'Fire', { special: 'fire', color: [255, 138, 42], lift: 1 });
def('smoke', 'Smoke', { special: 'smoke', color: [84, 86, 92], lift: 1 });
def('water', 'Water', { sym: 'H₂O', melt: 0, boil: 100, dens: 1, k: 0.6, cond: 0.15, color: [59, 127, 217], gasColor: [196, 209, 222], solidColor: [176, 208, 238], lift: 1, gasP: 6, cap: 1, lf: 80, lv: 540, names: ['Ice', 'Water', 'Steam'] });
def('sand', 'Sand', { sym: 'SiO₂', melt: 1713, boil: 2950, dens: 2.65, k: 1, cap: 0.45, soft: true, powder: true, color: [217, 183, 106], solidColor: [188, 210, 204], names: ['Glass', 'Molten glass', 'Silica vapor'] });
def('gasoline', 'Gasoline', { melt: -60, boil: 150, dens: 0.75, k: 0.15, cond: 0.12, cap: 0.4, lf: 40, lv: 160, color: [168, 194, 58], gasColor: [196, 204, 120], gasP: 3, lift: -1, vapor: true, fades: 0.01, burn: { at: 280, fast: true, heat: 1500, life: 6, units: 64, }, names: ['Frozen gasoline', 'Gasoline', 'Gasoline vapor'] });

// Crude oil and what a refinery splits it into. Each fraction boils at its own temperature, which is what
// lets a still or a column separate them; heavy fuel left behind in the pot ends up as tar.
def('crude', 'Crude oil', { melt: -20, boil: 1e9, dens: 0.87, k: 0.15, cond: 0.12, cap: 0.45, lf: 40, color: [44, 33, 24], lift: -1,
  burn: { at: 350, fast: true, heat: 1300, life: 6, units: 64 }, names: ['Frozen crude oil', 'Crude oil', 'Crude oil'] });
def('lpg', 'Fuel gas', { sym: 'C₃H₈+C₄H₁₀', melt: -188, boil: -20, dens: 0.58, k: 0.02, cap: 0.5, color: [232, 220, 196], lift: -1, fades: 0.01,
  burn: { at: 470, fast: true, heat: 1900, life: 5, units: 1, o2: 2.5 }, names: ['Solid fuel gas', 'Liquid fuel gas (LPG)', 'Fuel gas'] });
def('kerosene', 'Kerosene', { melt: -45, boil: 220, dens: 0.8, k: 0.14, cond: 0.12, cap: 0.48, lf: 40, lv: 120, color: [214, 206, 150], gasColor: [214, 210, 170], lift: -1,
  vapor: true, fades: 0.01, burn: { at: 220, fast: true, heat: 1400, life: 6, units: 64 }, names: ['Frozen kerosene', 'Kerosene', 'Kerosene vapor'] });
def('diesel', 'Diesel', { melt: -10, boil: 300, dens: 0.84, k: 0.13, cond: 0.12, cap: 0.48, lf: 40, lv: 110, color: [190, 150, 60], gasColor: [200, 180, 120], lift: -1,
  vapor: true, fades: 0.01, burn: { at: 210, fast: true, heat: 1400, life: 6, units: 64 }, names: ['Frozen diesel', 'Diesel', 'Diesel vapor'] });
def('tar', 'Tar', { melt: 80, boil: 550, dens: 1.0, k: 0.17, cap: 0.4, color: [22, 20, 19], soft: true,
  burn: { at: 400, heat: 1100, rate: 0.004 }, names: ['Tar', 'Molten tar', 'Tar fumes'] });
def('salt', 'Salt', { sym: 'NaCl', melt: 801, boil: 1413, dens: 2.16, k: 6, cap: 0.45, soft: true, powder: true, color: [236, 236, 230], names: ['Salt', 'Molten salt', 'Salt vapor'] });
def('rust', 'Rust', { sym: 'Fe\u2082O\u2083', melt: 1565, boil: 3414, dens: 5.24, k: 6, cap: 0.8, soft: true, powder: true, color: [150, 74, 44], names: ['Rust', 'Molten iron oxide', 'Iron oxide vapor'] });

def('thermite', 'Thermite', { sym: 'Fe\u2082O\u2083+Al', melt: 1e9, boil: 1e9, dens: 3.9, k: 4, cond: 0.12, powder: true, color: [128, 96, 92], burn: { at: 1500, heat: 2500, rate: 0.04, self: true, product: 'Fe' } });
def('waste', 'Fission waste', { melt: 2000, boil: 3800, dens: 8, k: 5, cap: 0.5, color: [86, 110, 70], names: ['Fission waste', 'Molten fission waste', 'Fission waste vapor'] });
def('neutron', 'Neutrons', { special: 'neutron', color: [190, 255, 236] });

// The elements. Generated by tools/gen_elements.py from the open Periodic-Table-JSON dataset
// (melting point, boiling point, density), with thermal conductivity, colours and behaviour added.
// est marks elements whose numbers are predictions or placeholders, because too little has ever been made to measure.
el('H', 'Hydrogen', 1, -259, -253, 9e-05, 0.18, [206, 224, 255], { family: 'nonmetal', lift: 1, burn: { at: 500, fast: true, heat: 1800, life: 5, units: 1, o2: 0.5, product: 'water' }, cap: 0.50, soft: true });
el('He', 'Helium', 2, -272.2, -269, 0.000179, 0.15, [255, 214, 232], { family: 'noble', lift: 1, cap: 0.50, soft: true });
el('Li', 'Lithium', 3, 180, 1330, 0.534, 85, [200, 200, 210], { family: 'alkali', lift: 1, powder: true, wet: { p: 0.03, gasTemp: 150 }, burn: { at: 180, heat: 1400, rate: 0.01 }, react: 1, cap: 0.46 });
el('Be', 'Beryllium', 4, 1287, 2469, 1.85, 200, [179, 183, 200], { family: 'alkaline', lift: 1, react: 0.6, cap: 0.81 });
el('B', 'Boron', 5, 2076, 3927, 2.08, 27, [74, 64, 56], { family: 'metalloid', lift: 1, cap: 0.51, soft: true });
el('C', 'Carbon', 6, 3642, 3642, 1.821, 120, [54, 54, 60], { family: 'nonmetal', lift: 1, powder: true, burn: { at: 700, heat: 1150, rate: 0.003 }, cap: 0.31, soft: true, est: true });
el('N', 'Nitrogen', 7, -210, -196, 0.001251, 0.026, [150, 168, 224], { family: 'nonmetal', cap: 0.50, soft: true });
el('O', 'Oxygen', 8, -219, -183, 0.001429, 0.027, [168, 212, 255], { family: 'nonmetal', cap: 0.50, soft: true });
el('F', 'Fluorine', 9, -220, -188, 0.001696, 0.028, [224, 236, 150], { family: 'halogen', lift: -1, hal: 1, cap: 0.50, soft: true });
el('Ne', 'Neon', 10, -249, -246, 0.0009, 0.049, [255, 150, 120], { family: 'noble', lift: 1, cap: 0.50, soft: true });
el('Na', 'Sodium', 11, 97.8, 883, 0.968, 142, [208, 206, 190], { family: 'alkali', lift: 1, powder: true, wet: { p: 0.08, gasTemp: 350 }, react: 1, cap: 0.28 });
el('Mg', 'Magnesium', 12, 650, 1090, 1.738, 156, [204, 208, 214], { family: 'alkaline', burn: { at: 630, heat: 2800, rate: 0.012 }, react: 0.6, cap: 0.43 });
el('Al', 'Aluminium', 13, 660, 2470, 2.7, 237, [190, 197, 206], { family: 'post', react: 0.3, cap: 0.58 });
el('Si', 'Silicon', 14, 1414, 3265, 2.329, 150, [88, 98, 116], { family: 'metalloid', cap: 0.39, soft: true });
el('P', 'Phosphorus', 15, 44.2, 280, 1.823, 0.24, [236, 224, 196], { family: 'nonmetal', powder: true, burn: { at: 34, heat: 1300, rate: 0.02 }, cap: 0.34, soft: true, est: true });
el('S', 'Sulfur', 16, 115, 445, 2.07, 0.2, [228, 210, 72], { family: 'nonmetal', powder: true, burn: { at: 232, heat: 720, rate: 0.006 }, cap: 0.35, soft: true });
el('Cl', 'Chlorine', 17, -102, -34.0, 0.0032, 0.009, [190, 226, 90], { family: 'halogen', lift: -1, hal: 0.5, cap: 0.50, soft: true });
el('Ar', 'Argon', 18, -189, -186, 0.001784, 0.018, [190, 160, 255], { family: 'noble', lift: -1, cap: 0.50, soft: true });
el('K', 'Potassium', 19, 63.6, 759, 0.862, 102, [192, 188, 204], { family: 'alkali', lift: -1, powder: true, wet: { p: 0.2, gasTemp: 750 }, react: 1, cap: 0.25 });
el('Ca', 'Calcium', 20, 842, 1484, 1.55, 200, [195, 178, 192], { family: 'alkaline', lift: -1, powder: true, wet: { p: 0.015, gasTemp: 90 }, burn: { at: 790, heat: 2200, rate: 0.01 }, react: 0.6, cap: 0.25 });
el('Sc', 'Scandium', 21, 1541, 2836, 2.985, 16, [155, 184, 179], { family: 'transition', lift: -1, react: 0.05, cap: 0.41 });
el('Ti', 'Titanium', 22, 1668, 3287, 4.506, 22, [152, 156, 166], { family: 'transition', lift: -1, burn: { at: 1200, heat: 3000, rate: 0.008 }, react: 0.05, cap: 0.56 });
el('V', 'Vanadium', 23, 1910, 3407, 6, 31, [157, 171, 194], { family: 'transition', lift: -1, react: 0.05, cap: 0.70 });
el('Cr', 'Chromium', 24, 1907, 2671, 7.19, 94, [198, 206, 216], { family: 'transition', lift: -1, react: 0.05, cap: 0.77 });
el('Mn', 'Manganese', 25, 1246, 2061, 7.21, 7.8, [159, 159, 177], { family: 'transition', lift: -1, react: 0.05, cap: 0.83 });
el('Fe', 'Iron', 26, 1538, 2861, 7.874, 80, [159, 179, 200], { family: 'transition', lift: -1, react: 0.05, cap: 0.85 });
el('Co', 'Cobalt', 27, 1495, 2927, 8.9, 100, [150, 160, 192], { family: 'transition', lift: -1, react: 0.05, cap: 0.90 });
el('Ni', 'Nickel', 28, 1455, 2730, 8.908, 91, [188, 188, 172], { family: 'transition', lift: -1, react: 0.05, cap: 0.95 });
el('Cu', 'Copper', 29, 1085, 2562, 8.96, 401, [204, 124, 82], { family: 'transition', lift: -1, react: 0.05, cap: 0.82 });
el('Zn', 'Zinc', 30, 420, 907, 7.14, 116, [172, 182, 194], { family: 'transition', lift: -1, react: 0.05, cap: 0.67 });
el('Ga', 'Gallium', 31, 29.8, 2400, 5.91, 29, [178, 194, 212], { family: 'post', lift: -1, react: 0.05, cap: 0.52 });
el('Ge', 'Germanium', 32, 938, 2833, 5.323, 60, [140, 146, 152], { family: 'metalloid', lift: -1, cap: 0.41, soft: true });
el('As', 'Arsenic', 33, 615, 615, 5.727, 50, [120, 124, 128], { family: 'metalloid', lift: -1, cap: 0.45, soft: true, est: true });
el('Se', 'Selenium', 34, 221, 685, 4.81, 0.5, [132, 72, 72], { family: 'nonmetal', lift: -1, powder: true, cap: 0.37, soft: true });
el('Br', 'Bromine', 35, -7.3, 58.9, 3.1028, 0.12, [152, 52, 30], { family: 'halogen', lift: -1, hal: 0.25, cap: 0.50, soft: true });
el('Kr', 'Krypton', 36, -157, -153, 0.003749, 0.009, [170, 235, 235], { family: 'noble', lift: -1, cap: 0.50, soft: true });
el('Rb', 'Rubidium', 37, 39.3, 688, 1.532, 58, [206, 205, 194], { family: 'alkali', lift: -1, powder: true, wet: { p: 0.35, gasTemp: 900 }, react: 1, cap: 0.25 });
el('Sr', 'Strontium', 38, 777, 1377, 2.64, 35, [181, 193, 199], { family: 'alkaline', lift: -1, powder: true, wet: { p: 0.02, gasTemp: 110 }, react: 0.6, cap: 0.25 });
el('Y', 'Yttrium', 39, 1526, 2930, 4.472, 17, [173, 166, 186], { family: 'transition', lift: -1, react: 0.05, cap: 0.32 });
el('Zr', 'Zirconium', 40, 1855, 4377, 6.52, 23, [158, 160, 178], { family: 'transition', lift: -1, burn: { at: 1000, heat: 3000, rate: 0.008 }, react: 0.05, cap: 0.43 });
el('Nb', 'Niobium', 41, 2477, 4744, 8.57, 54, [175, 186, 169], { family: 'transition', lift: -1, react: 0.05, cap: 0.54 });
el('Mo', 'Molybdenum', 42, 2623, 4639, 10.28, 138, [160, 180, 192], { family: 'transition', lift: -1, react: 0.05, cap: 0.62 });
el('Tc', 'Technetium', 43, 2157, 4265, 11, 51, [177, 173, 184], { family: 'transition', lift: -1, react: 0.05, cap: 0.65 });
el('Ru', 'Ruthenium', 44, 2334, 4150, 12.45, 117, [162, 167, 175], { family: 'transition', lift: -1, cap: 0.71 });
el('Rh', 'Rhodium', 45, 1964, 3695, 12.41, 150, [179, 161, 167], { family: 'transition', lift: -1, cap: 0.72 });
el('Pd', 'Palladium', 46, 1555, 2963, 12.023, 72, [164, 186, 190], { family: 'transition', lift: -1, cap: 0.70 });
el('Ag', 'Silver', 47, 962, 2162, 10.49, 429, [224, 226, 230], { family: 'transition', lift: -1, react: 0.02, cap: 0.59 });
el('Cd', 'Cadmium', 48, 321, 767, 8.65, 97, [166, 174, 173], { family: 'transition', lift: -1, react: 0.05, cap: 0.48 });
el('In', 'Indium', 49, 157, 2072, 7.31, 82, [162, 175, 203], { family: 'post', lift: -1, react: 0.05, cap: 0.41 });
el('Sn', 'Tin', 50, 232, 2602, 7.365, 67, [210, 210, 204], { family: 'post', lift: -1, react: 0.05, cap: 0.40 });
el('Sb', 'Antimony', 51, 631, 1635, 6.697, 24, [170, 176, 186], { family: 'metalloid', lift: -1, cap: 0.33, soft: true });
el('Te', 'Tellurium', 52, 450, 988, 6.24, 3, [150, 150, 160], { family: 'metalloid', lift: -1, cap: 0.30, soft: true });
el('I', 'Iodine', 53, 114, 184, 4.933, 0.45, [74, 44, 96], { family: 'halogen', lift: -1, powder: true, hal: 0.1, cap: 0.50, soft: true });
el('Xe', 'Xenon', 54, -112, -108, 0.005894, 0.006, [130, 170, 255], { family: 'noble', lift: -1, cap: 0.50, soft: true });
el('Cs', 'Cesium', 55, 28.6, 671, 1.93, 36, [214, 196, 140], { family: 'alkali', lift: -1, powder: true, wet: { p: 0.5, gasTemp: 1100 }, react: 1, cap: 0.25 });
el('Ba', 'Barium', 56, 727, 1845, 3.51, 18, [199, 207, 173], { family: 'alkaline', lift: -1, powder: true, wet: { p: 0.04, gasTemp: 160 }, react: 0.6, cap: 0.25 });
el('La', 'Lanthanum', 57, 920, 3464, 6.162, 13, [190, 205, 195], { family: 'lanthanide', lift: -1, react: 0.3, cap: 0.29 });
el('Ce', 'Cerium', 58, 795, 3443, 6.77, 11, [207, 199, 186], { family: 'lanthanide', lift: -1, react: 0.3, cap: 0.31 });
el('Pr', 'Praseodymium', 59, 935, 3130, 6.77, 13, [192, 192, 178], { family: 'lanthanide', lift: -1, react: 0.3, cap: 0.31 });
el('Nd', 'Neodymium', 60, 1024, 3074, 7.01, 17, [209, 186, 169], { family: 'lanthanide', lift: -1, react: 0.3, cap: 0.32 });
el('Pm', 'Promethium', 61, 1042, 3000, 7.26, 15, [194, 212, 192], { family: 'lanthanide', lift: -1, react: 0.3, cap: 0.50 });
el('Sm', 'Samarium', 62, 1072, 1900, 7.52, 13, [211, 205, 184], { family: 'lanthanide', lift: -1, react: 0.3, cap: 0.35 });
el('Eu', 'Europium', 63, 826, 1529, 5.264, 14, [196, 199, 175], { family: 'lanthanide', lift: -1, react: 0.3, cap: 0.25 });
el('Gd', 'Gadolinium', 64, 1312, 3000, 7.9, 11, [181, 193, 199], { family: 'lanthanide', lift: -1, react: 0.3, cap: 0.45 });
el('Tb', 'Terbium', 65, 1356, 3123, 8.23, 11, [198, 186, 190], { family: 'lanthanide', lift: -1, react: 0.3, cap: 0.36 });
el('Dy', 'Dysprosium', 66, 1407, 2567, 8.54, 11, [183, 212, 182], { family: 'lanthanide', lift: -1, react: 0.3, cap: 0.35 });
el('Ho', 'Holmium', 67, 1461, 2600, 8.79, 16, [200, 206, 173], { family: 'lanthanide', lift: -1, react: 0.3, cap: 0.35 });
el('Er', 'Erbium', 68, 1529, 2868, 9.066, 15, [185, 200, 197], { family: 'lanthanide', lift: -1, react: 0.3, cap: 0.36 });
el('Tm', 'Thulium', 69, 1545, 1950, 9.32, 17, [202, 193, 188], { family: 'lanthanide', lift: -1, react: 0.3, cap: 0.36 });
el('Yb', 'Ytterbium', 70, 824, 1196, 6.9, 39, [187, 187, 180], { family: 'lanthanide', lift: -1, react: 0.3, cap: 0.26 });
el('Lu', 'Lutetium', 71, 1652, 3402, 9.841, 16, [204, 181, 171], { family: 'lanthanide', lift: -1, react: 0.3, cap: 0.36 });
el('Hf', 'Hafnium', 72, 2233, 4603, 13.31, 23, [158, 182, 193], { family: 'transition', lift: -1, react: 0.05, cap: 0.46 });
el('Ta', 'Tantalum', 73, 3017, 5458, 16.69, 57, [175, 176, 184], { family: 'transition', lift: -1, react: 0.05, cap: 0.56 });
el('W', 'Tungsten', 74, 3422, 5930, 19.25, 173, [112, 116, 126], { family: 'transition', lift: -1, react: 0.05, cap: 0.61 });
el('Re', 'Rhenium', 75, 3186, 5596, 21.02, 48, [177, 163, 167], { family: 'transition', lift: -1, react: 0.05, cap: 0.69 });
el('Os', 'Osmium', 76, 3033, 5012, 22.59, 88, [150, 170, 202], { family: 'transition', lift: -1, cap: 0.70 });
el('Ir', 'Iridium', 77, 2446, 4130, 22.56, 147, [179, 183, 182], { family: 'transition', lift: -1, cap: 0.70 });
el('Pt', 'Platinum', 78, 1768, 3825, 21.45, 72, [214, 214, 208], { family: 'transition', lift: -1, cap: 0.68 });
el('Au', 'Gold', 79, 1064, 2970, 19.3, 318, [238, 192, 70], { family: 'transition', lift: -1, cap: 0.60 });
el('Hg', 'Mercury', 80, -38.8, 357, 13.534, 8.3, [192, 198, 208], { family: 'transition', lift: -1, react: 0.05, cap: 0.45 });
el('Tl', 'Thallium', 81, 304, 1473, 11.85, 46, [162, 166, 186], { family: 'post', lift: -1, react: 0.05, cap: 0.37 });
el('Pb', 'Lead', 82, 327, 1749, 11.34, 35, [98, 102, 116], { family: 'post', lift: -1, react: 0.05, cap: 0.35 });
el('Bi', 'Bismuth', 83, 272, 1564, 9.78, 8, [206, 182, 196], { family: 'post', lift: -1, react: 0.05, cap: 0.29 });
el('Po', 'Polonium', 84, 254, 962, 9.196, 20, [181, 179, 192], { family: 'post', lift: -1, react: 0.05, cap: 0.28 });
el('At', 'Astatine', 85, 302, 337, 6.35, 2, [62, 52, 62], { family: 'halogen', lift: -1, powder: true, hal: 0.05, cap: 0.50, soft: true });
el('Rn', 'Radon', 86, -71.1, -61.6, 0.00973, 0.004, [150, 230, 170], { family: 'noble', lift: -1, cap: 0.50, soft: true });
el('Fr', 'Francium', 87, 26.9, 677, 1.87, 15, [192, 210, 216], { family: 'alkali', lift: -1, powder: true, wet: { p: 0.5, gasTemp: 1100 }, react: 1, cap: 0.50 });
el('Ra', 'Radium', 88, 960, 1737, 5.5, 19, [199, 197, 188], { family: 'alkaline', lift: -1, react: 0.6, cap: 0.50 });
el('Ac', 'Actinium', 89, 1227, 3227, 10, 12, [164, 185, 166], { family: 'actinide', lift: -1, react: 0.3, cap: 0.29 });
el('Th', 'Thorium', 90, 1750, 4788, 11.724, 54, [181, 179, 157], { family: 'actinide', lift: -1, react: 0.3, cap: 0.32 });
el('Pa', 'Protactinium', 91, 1568, 4027, 15.37, 47, [166, 172, 181], { family: 'actinide', lift: -1, react: 0.3, cap: 0.50 });
el('U', 'Uranium', 92, 1132, 4131, 19.1, 27, [122, 142, 122], { family: 'actinide', lift: -1, react: 0.3, cap: 0.53 });
el('Np', 'Neptunium', 93, 639, 4174, 20.45, 6, [168, 192, 164], { family: 'actinide', lift: -1, react: 0.3, cap: 0.61 });
el('Pu', 'Plutonium', 94, 639, 3232, 19.816, 6, [150, 152, 140], { family: 'actinide', lift: -1, react: 0.3, cap: 0.69 });
el('Am', 'Americium', 95, 1176, 2607, 12, 10, [170, 179, 179], { family: 'actinide', lift: -1, react: 0.3, cap: 0.74 });
el('Cm', 'Curium', 96, 1340, 3110, 13.51, 10, [155, 173, 170], { family: 'actinide', lift: -1, react: 0.3, cap: 0.50 });
el('Bk', 'Berkelium', 97, 986, 2627, 14.78, 15, [172, 199, 162], { family: 'actinide', lift: -1, react: 0.3, cap: 0.50 });
el('Cf', 'Californium', 98, 900, 1470, 15.1, 15, [157, 192, 185], { family: 'actinide', lift: -1, react: 0.3, cap: 0.50 });
el('Es', 'Einsteinium', 99, 860, 996, 8.84, 15, [174, 186, 177], { family: 'actinide', lift: -1, react: 0.3, cap: 0.50 });
el('Fm', 'Fermium', 100, 1527, 3027, 10, 15, [159, 180, 168], { family: 'actinide', lift: -1, react: 0.3, cap: 0.50, est: true });
el('Md', 'Mendelevium', 101, 827, 2327, 10, 15, [176, 173, 160], { family: 'actinide', lift: -1, react: 0.3, cap: 0.50, est: true });
el('No', 'Nobelium', 102, 827, 2327, 10, 15, [161, 199, 183], { family: 'actinide', lift: -1, react: 0.3, cap: 0.50, est: true });
el('Lr', 'Lawrencium', 103, 1627, 3127, 10, 15, [178, 193, 174], { family: 'actinide', lift: -1, react: 0.3, cap: 0.50, est: true });
el('Rf', 'Rutherfordium', 104, 2127, 5527, 23.2, 15, [158, 172, 176], { family: 'transition', lift: -1, react: 0.05, cap: 0.50 });
el('Db', 'Dubnium', 105, 1800, 3300, 29.3, 15, [175, 166, 167], { family: 'transition', lift: -1, react: 0.05, cap: 0.50, est: true });
el('Sg', 'Seaborgium', 106, 1800, 3300, 35, 15, [160, 160, 191], { family: 'transition', lift: -1, react: 0.05, cap: 0.50, est: true });
el('Bh', 'Bohrium', 107, 1800, 3300, 37.1, 15, [177, 185, 182], { family: 'transition', lift: -1, react: 0.05, cap: 0.50, est: true });
el('Hs', 'Hassium', 108, 1800, 3300, 40.7, 15, [162, 179, 174], { family: 'transition', lift: -1, react: 0.05, cap: 0.50, est: true });
el('Mt', 'Meitnerium', 109, 1800, 3300, 37.4, 15, [179, 173, 197], { family: 'transition', lift: -1, react: 0.05, cap: 0.50, est: true });
el('Ds', 'Darmstadtium', 110, 1800, 3300, 34.8, 15, [164, 167, 189], { family: 'transition', lift: -1, react: 0.05, cap: 0.50, est: true });
el('Rg', 'Roentgenium', 111, 1800, 3300, 28.7, 15, [181, 160, 180], { family: 'transition', lift: -1, react: 0.05, cap: 0.50, est: true });
el('Cn', 'Copernicium', 112, 9.9, 66.9, 14.0, 15, [166, 186, 172], { family: 'transition', lift: -1, react: 0.05, cap: 0.50 });
el('Nh', 'Nihonium', 113, 427, 1157, 16, 15, [151, 180, 195], { family: 'transition', lift: -1, react: 0.05, cap: 0.50, est: true });
el('Fl', 'Flerovium', 114, 66.9, 147, 14, 15, [179, 181, 193], { family: 'post', lift: -1, react: 0.05, cap: 0.50 });
el('Mc', 'Moscovium', 115, 397, 1127, 13.5, 15, [164, 175, 184], { family: 'post', lift: -1, react: 0.05, cap: 0.50, est: true });
el('Lv', 'Livermorium', 116, 436, 812, 12.9, 15, [181, 169, 176], { family: 'post', lift: -1, react: 0.05, cap: 0.50, est: true });
el('Ts', 'Tennessine', 117, 450, 610, 7.17, 15, [84, 84, 94], { family: 'halogen', lift: -1, cap: 0.50, soft: true, est: true });
el('Og', 'Oganesson', 118, 52, 76.9, 4.95, 15, [200, 200, 220], { family: 'noble', lift: -1, cap: 0.50, soft: true, est: true });

const CHEM_DATA = 'H:2.2:1.01 He::4.0 Li:0.98:6.94 Be:1.57:9.01 B:2.04:10.81 C:2.55:12.01 N:3.04:14.01 O:3.44:16.0 F:3.98:19.0 Ne::20.18 Na:0.93:22.99 Mg:1.31:24.3 Al:1.61:26.98 Si:1.9:28.09 P:2.19:30.97 S:2.58:32.06 Cl:3.16:35.45 Ar::39.95 K:0.82:39.1 Ca:1:40.08 Sc:1.36:44.96 Ti:1.54:47.87 V:1.63:50.94 Cr:1.66:52.0 Mn:1.55:54.94 Fe:1.83:55.85 Co:1.88:58.93 Ni:1.91:58.69 Cu:1.9:63.55 Zn:1.65:65.38 Ga:1.81:69.72 Ge:2.01:72.63 As:2.18:74.92 Se:2.55:78.97 Br:2.96:79.9 Kr:3:83.8 Rb:0.82:85.47 Sr:0.95:87.62 Y:1.22:88.91 Zr:1.33:91.22 Nb:1.6:92.91 Mo:2.16:95.95 Tc:1.9:98 Ru:2.2:101.07 Rh:2.28:102.91 Pd:2.2:106.42 Ag:1.93:107.87 Cd:1.69:112.41 In:1.78:114.82 Sn:1.96:118.71 Sb:2.05:121.76 Te:2.1:127.6 I:2.66:126.9 Xe:2.6:131.29 Cs:0.79:132.91 Ba:0.89:137.33 La:1.1:138.91 Ce:1.12:140.12 Pr:1.13:140.91 Nd:1.14:144.24 Pm:1.13:145 Sm:1.17:150.36 Eu:1.2:151.96 Gd:1.2:157.25 Tb:1.1:158.93 Dy:1.22:162.5 Ho:1.23:164.93 Er:1.24:167.26 Tm:1.25:168.93 Yb:1.1:173.05 Lu:1.27:174.97 Hf:1.3:178.49 Ta:1.5:180.95 W:2.36:183.84 Re:1.9:186.21 Os:2.2:190.23 Ir:2.2:192.22 Pt:2.28:195.08 Au:2.54:196.97 Hg:2:200.59 Tl:1.62:204.38 Pb:1.87:207.21 Bi:2.02:208.98 Po:2:209 At:2.2:210 Rn:2.2:222 Fr:0.79:223 Ra:0.9:226 Ac:1.1:227 Th:1.3:232.04 Pa:1.5:231.04 U:1.38:238.03 Np:1.36:237 Pu:1.28:244 Am:1.13:243 Cm:1.28:247 Bk:1.3:247 Cf:1.3:251 Es:1.3:252 Fm:1.3:257 Md:1.3:258 No:1.3:259 Lr:1.3:266 Rf::267 Db::268 Sg::269 Bh::270 Hs::269 Mt::278 Ds::281 Rg::282 Cn::285 Nh::286 Fl::289 Mc::289 Lv::293 Ts::294 Og::294';
// ---------- chemistry: compounds worked out from the elements ----------
// Two elements react when one pulls on electrons much harder than the other (electronegativity).
// The difference sets how readily they react, how much heat comes out and what kind of compound forms;
// the usual charges of the two (valence) set the formula. Properties of the product are estimated from
// the same numbers, so they are a good guess rather than measured.
// (CHEM_DATA, generated by tools/gen_chem.py from Periodic-Table-JSON: symbol:electronegativity:atomic mass)
const ENEG = {}, AMASS = {};
for (const part of CHEM_DATA.split(' ')) {
  const [sym, en, mass] = part.split(':');
  if (en !== '') ENEG[sym] = +en;
  AMASS[sym] = +mass;
}
// The charge an element usually takes when it gives electrons up, and, for the ones that take electrons, when it takes them.
const POS_STATE = {
  H: 1, Li: 1, Na: 1, K: 1, Rb: 1, Cs: 1, Fr: 1, Be: 2, Mg: 2, Ca: 2, Sr: 2, Ba: 2, Ra: 2,
  B: 3, Al: 3, Ga: 3, In: 3, Tl: 1, C: 4, Si: 4, Ge: 4, Sn: 4, Pb: 2, N: 3, P: 3, As: 3, Sb: 3, Bi: 3,
  S: 2, Se: 4, Te: 4, Po: 2,
  Sc: 3, Ti: 4, V: 5, Cr: 3, Mn: 2, Fe: 3, Co: 2, Ni: 2, Cu: 2, Zn: 2, Y: 3, Zr: 4, Nb: 5, Mo: 6, Tc: 7, Ru: 4, Rh: 3, Pd: 2, Ag: 1, Cd: 2,
  Hf: 4, Ta: 5, W: 6, Re: 7, Os: 4, Ir: 4, Pt: 2, Au: 3, Hg: 2,
  La: 3, Ce: 3, Pr: 3, Nd: 3, Pm: 3, Sm: 3, Eu: 3, Gd: 3, Tb: 3, Dy: 3, Ho: 3, Er: 3, Tm: 3, Yb: 3, Lu: 3,
  Ac: 3, Th: 4, Pa: 5, U: 4, Np: 4, Pu: 4, Am: 3, Cm: 3, Bk: 3, Cf: 3, Es: 3, Fm: 3, Md: 3, No: 2, Lr: 3
};
// with oxygen (and fluorine) some reach higher charges than they show elsewhere
const POS_WITH = { O: { N: 4, P: 5, S: 4, Mn: 4, C: 4, Xe: 6 }, F: { S: 6, P: 5, Xe: 2, Kr: 2 }, S: { Fe: 2, Cu: 1 } };
const NEG_STATE = { H: 1, C: 4, N: 3, P: 3, O: 2, S: 2, Se: 2, Te: 2, F: 1, Cl: 1, Br: 1, I: 1, At: 1 };
const ANION_NAME = { H: 'hydride', C: 'carbide', N: 'nitride', P: 'phosphide', O: 'oxide', S: 'sulfide', Se: 'selenide', Te: 'telluride',
  F: 'fluoride', Cl: 'chloride', Br: 'bromide', I: 'iodide', At: 'astatide' };
const HYDRIDE_NAME = { C: 'Methane', N: 'Ammonia', P: 'Phosphine', Si: 'Silane', B: 'Borane', Ge: 'Germane', As: 'Arsine', Sb: 'Stibine' };
// already in the game with properties of their own
const KNOWN_CPD = { 'H2O': 'water', 'NaCl': 'salt', 'Fe2O3': 'rust', 'SiO2': 'sand' };
// colours of a few well-known compounds; the rest are mixed from the metal and the other element
const CPD_COLOR = { CuO: [44, 38, 36], CuCl2: [76, 164, 150], CuBr2: [40, 34, 32], CuS: [30, 32, 44], NiCl2: [112, 168, 88], CoCl2: [88, 78, 168],
  Cr2O3: [74, 120, 62], FeCl3: [148, 88, 40], FeS: [70, 62, 50], NO2: [150, 80, 40], MnO2: [40, 38, 38], PbS: [50, 50, 56], HgS: [196, 40, 36],
  V2O5: [196, 140, 40], ZnS: [226, 226, 214], AgCl: [232, 232, 226], AgBr: [222, 214, 170], AgI: [226, 210, 120], PbI2: [236, 200, 40], Fe3C: [90, 90, 96] };
const ANION_TINT = { O: [128, 104, 86], S: [70, 64, 48], N: [150, 140, 110], C: [62, 62, 66], P: [140, 120, 92], H: [222, 222, 222],
  F: [236, 236, 228], Cl: [230, 236, 214], Br: [214, 170, 120], I: [150, 110, 140], Se: [120, 60, 50], Te: [90, 90, 96], At: [60, 60, 60] };
const PALE_METAL = { alkali: 1, alkaline: 1, post: 1, lanthanide: 1, actinide: 1 };
// metals so unreactive that their oxides fall apart again on gentle heating
const NOBLE_OXIDE = { Ag: 300, Au: 200, Pt: 450, Pd: 750, Hg: 500, Ir: 1000, Os: 400, Rh: 1000, Ru: 1000 };
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const sub = n => n === 1 ? '' : String(n).split('').map(d => SUBS[+d]).join('');
const PREFIX = ['', 'mono', 'di', 'tri', 'tetra', 'penta', 'hexa', 'hepta', 'octa'];
function prefixed(n, word) {
  if (n === 1) return word;
  const p = PREFIX[n];
  return (/^[ao]/.test(word) && /[ao]$/.test(p) ? p.slice(0, -1) : p) + word;
}
const gcd = (a, b) => b ? gcd(b, a % b) : a;
const isMetal = m => m.family !== 'nonmetal' && m.family !== 'metalloid' && m.family !== 'halogen' && m.family !== 'noble' && m.key !== 'H';

// Work out what (if anything) elements a and b make together.
function planCompound(a, b) {
  const ma = MATS[ID[a]], mb = MATS[ID[b]];
  if (!ma || !mb || ENEG[a] === undefined || ENEG[b] === undefined) return null;
  // the noble gases stay out of it, except that xenon and krypton can be forced to bond with fluorine (and xenon with oxygen)
  const nob = m => m.family === 'noble';
  if (nob(ma) || nob(mb)) {
    const g = nob(ma) ? a : b, o = nob(ma) ? b : a;
    if (!(POS_WITH[o] && POS_WITH[o][g])) return null;
  }
  // the one that pulls harder takes the electrons; hydrogen only takes them from the most reactive metals,
  // and gives them to any non-metal (so phosphorus makes phosphine, PH3)
  let A = a, B = b;
  if (ENEG[a] > ENEG[b]) { A = b; B = a; }
  if (B === 'H' && !(MATS[ID[A]].family === 'alkali' || MATS[ID[A]].family === 'alkaline')) {
    if (NEG_STATE[A] === undefined) return null;
    [A, B] = [B, A];
  }
  const mA = MATS[ID[A]], mB = MATS[ID[B]];
  if (NEG_STATE[B] === undefined || (POS_STATE[A] === undefined && !(POS_WITH[B] && POS_WITH[B][A])) || A === B) return null;
  if (B === 'C' && mA.family === 'transition' && A !== 'Ti' && A !== 'W') return null;   // only a few metals make carbides here
  if (mA.family === 'halogen') return null;
  const qA = (POS_WITH[B] && POS_WITH[B][A]) || POS_STATE[A], qB = NEG_STATE[B];
  if (!qA) return null;
  const g = gcd(qA, qB), x = qB / g, y = qA / g;
  const dX = Math.abs(ENEG[B] - ENEG[A]);
  if (dX < 0.2) return null;
  const metal = isMetal(mA), hyd = A === 'H' && (B === 'C' || B === 'N' || B === 'P');
  let formula = hyd ? B + sub(y) + 'H' + sub(x) : A + sub(x) + B + sub(y);
  // Fe with carbon is cementite, Fe3C, not a salt
  if (A === 'Fe' && B === 'C') formula = 'Fe₃C';
  const plain = formula.replace(/[₀-₉]/g, c => String(SUBS.indexOf(c)));
  const mass = AMASS[A] * x + AMASS[B] * y;
  // kind: a salt-like solid, a hard network solid, or a small molecule
  let kind = metal ? 'ionic' : (mA.family === 'metalloid' && (B === 'O' || B === 'N' || B === 'C')) ? 'network' : 'molecule';
  if (kind === 'ionic' && qA >= 3 && dX < 1.7 && (B === 'Cl' || B === 'Br' || B === 'I')) kind = 'molecule';   // e.g. AlCl3, TiCl4
  if (A === 'Fe' && B === 'C') kind = 'ionic';
  // how readily it goes: what temperature it needs, how fast, how much heat it gives
  let act;
  if (B === 'F') act = 20;
  else if (B === 'Cl') act = 1200 - 600 * dX;
  else if (B === 'Br') act = 1300 - 600 * dX;
  else if (B === 'I') act = 1400 - 600 * dX;
  else if (B === 'O') act = 1500 - 450 * dX;
  else if (B === 'S' || B === 'Se' || B === 'Te') act = 700 - 300 * dX;
  else if (B === 'N') act = 1300 - 300 * dX;
  else if (B === 'C') act = 1500 - 300 * dX;
  else if (B === 'H') act = 600 - 100 * dX;
  else act = 1000 - 300 * dX;
  act = Math.max(20, Math.round(act));
  if (B === 'O' && NOBLE_OXIDE[A] !== undefined) act = Math.max(act, 150);
  const heat = Math.round(Math.min(3200, 150 + 420 * dX * dX));
  const rate = Math.min(0.6, 0.02 + 0.25 * dX);
  // the compound's own properties
  let melt, boil, dens, color, lift = 0, soft = true, powder = false, k, cap, dec = 1e9;
  const tint = ANION_TINT[B] || [200, 200, 200];
  if (kind === 'ionic' || kind === 'network') {
    melt = Math.round(Math.min(2900, Math.max(300, 250 + 220 * qA * qB + 120 * dX)));
    if (kind === 'network') melt = Math.round(Math.min(2900, 1400 + 150 * qA));
    boil = Math.round(melt + 400 + 200 * qA);
    dens = Math.min(8, Math.max(1.8, 0.5 * mA.dens + 1.6));
    const base = PALE_METAL[mA.family] || A === 'Al' || A === 'Zn' || A === 'Mg' ? [238, 236, 230] : mA.color.map(c => c * 0.7);
    color = CPD_COLOR[plain] || base.map((c, n) => Math.round(c * 0.55 + tint[n] * 0.45));
    powder = true; k = 5; cap = 0.7;
    if (B === 'O' && NOBLE_OXIDE[A] !== undefined) dec = NOBLE_OXIDE[A];
  } else {
    // small molecules: heavier and more lopsided ones boil higher; O-H and N-H bonds hold molecules together harder
    const hb = A === 'H' ? (B === 'O' ? 200 : B === 'N' ? 90 : B === 'F' ? 60 : 0) : 0;
    const bK = 25 * Math.sqrt(mass) + 60 * dX + hb;
    boil = Math.round(bK - 273);
    melt = Math.round(0.62 * bK - 273);
    dens = Math.min(3.2, Math.max(0.6, 0.9 + 0.006 * mass));
    lift = mass < 29 ? 1 : -1;
    color = CPD_COLOR[plain] || (B === 'Br' ? [150, 90, 50] : B === 'I' ? [110, 70, 120] : B === 'Cl' ? [214, 226, 180] : B === 'S' ? [222, 214, 150] : [210, 214, 220]);
    k = 0.2; cap = 0.6;
    dec = Math.round(400 + 1100 * dX);
  }
  // name
  const nA = mA.name, an = ANION_NAME[B];
  let name;
  if (A === 'H' && HYDRIDE_NAME[B]) name = HYDRIDE_NAME[B];
  else if (B === 'H' && HYDRIDE_NAME[A]) name = HYDRIDE_NAME[A];
  else if (A === 'Fe' && B === 'C') name = 'Cementite';
  else if (metal || A === 'H') name = nA + ' ' + an;
  else name = (x > 1 ? prefixed(x, nA.toLowerCase()).replace(/^./, c => c.toUpperCase()) : nA) + ' ' + prefixed(y, an);
  const roomGas = boil < 20, roomLiquid = !roomGas && melt < 20;
  const names = roomGas ? ['Solid ' + name.toLowerCase(), 'Liquid ' + name.toLowerCase(), name]
    : roomLiquid ? ['Frozen ' + name.toLowerCase(), name, name + ' vapor'] : [name, 'Molten ' + name.toLowerCase(), name + ' vapor'];
  return { A, B, x, y, formula, plain, name, names, kind, act, heat, rate, dec, dX,
    props: { sym: formula, melt, boil, dens: Math.round(dens * 100) / 100, k, cap, color, lift, soft, powder, names, gen: true, cpd: kind } };
}

// Every pair of elements gets its compound now, so the material tables below cover them all.
const NE0 = MATS.length;                 // elements and the hand-made materials come first
const PAIR_PRODUCT = new Uint16Array(NE0 * NE0), PAIR_A = new Uint16Array(NE0 * NE0);
const PAIR_RATIO = new Float32Array(NE0 * NE0), PAIR_ACT = new Float32Array(NE0 * NE0), PAIR_HEAT = new Float32Array(NE0 * NE0), PAIR_RATE = new Float32Array(NE0 * NE0);
const CPD_INFO = {};                     // product id -> { A, B (ids), ratio: B per A, dec }
{
  const syms = MATS.filter(m => m.z && m.z <= 118).map(m => m.key);
  const madeBy = {};
  for (let p = 0; p < syms.length; p++) for (let q = p + 1; q < syms.length; q++) {
    const plan = planCompound(syms[p], syms[q]);
    if (!plan) continue;
    let pid = KNOWN_CPD[plan.plain] !== undefined ? ID[KNOWN_CPD[plan.plain]] : madeBy[plan.plain];
    if (pid === undefined) {
      pid = def('cpd_' + plan.plain, plan.name, plan.props).id;
      MATS[pid].made = plan;
    }
    madeBy[plan.plain] = pid;
    const ia = ID[plan.A], ib = ID[plan.B];
    for (const [u, v] of [[ia, ib], [ib, ia]]) {
      const k = u * NE0 + v;
      PAIR_PRODUCT[k] = pid; PAIR_A[k] = ia; PAIR_RATIO[k] = plan.y / plan.x;
      PAIR_ACT[k] = plan.act; PAIR_HEAT[k] = plan.heat; PAIR_RATE[k] = plan.rate;
    }
    if (!CPD_INFO[pid]) CPD_INFO[pid] = { A: ia, B: ib, ratio: plan.y / plan.x, heat: plan.heat, dec: KNOWN_CPD[plan.plain] ? 1e9 : plan.dec };
  }
}

// Hydroxides of the metals that react with water, and the acids the hydrogen halides make in water.
const HYDROXIDE_KEY = {}, ACID_KEY = {};
{
  for (const m of MATS) {
    if (!m.z || !m.wet) continue;
    const q = POS_STATE[m.key], f = q === 1 ? m.key + 'OH' : m.key + '(OH)' + sub(q);
    const h = def('oh_' + m.key, m.name + ' hydroxide', { sym: f, melt: q === 1 ? 360 : 520, boil: 1390, dens: 2.1, k: 1, cap: 0.6, color: [240, 240, 236], powder: true, soft: true,
      gen: true, cpd: 'ionic', names: [m.name + ' hydroxide (lye)', 'Molten ' + m.name.toLowerCase() + ' hydroxide', m.name + ' hydroxide vapor'] });
    h.made = { from: m.name.toLowerCase() + ' and water' };
    HYDROXIDE_KEY[m.key] = h.key;
  }
  const tints = { F: [196, 222, 230], Cl: [206, 230, 196], Br: [226, 184, 140], I: [196, 150, 120] };
  for (const X of ['F', 'Cl', 'Br', 'I']) {
    const nm = 'Hydro' + MATS[ID[X]].name.toLowerCase().replace(/ine$/, 'ic') + ' acid';
    const a = def('acid_' + X, nm, { sym: 'H' + X + '(aq)', melt: -30, boil: 108, dens: 1.15, k: 0.55, cond: 0.6, cap: 0.85, lf: 300, lv: 2100,
      color: tints[X], gen: true, names: ['Frozen ' + nm.toLowerCase(), nm, nm + ' vapor'] });
    a.made = { from: 'hydrogen ' + MATS[ID[X]].name.toLowerCase().replace(/ine$/, 'ide') + ' and water' };
    ACID_KEY[X] = a.key;
  }
}

const CRUDE = ID.crude, TAR = ID.tar;
// what crude gives off as it heats up: [fraction, temperature it comes off at, units of the 64 in a cell]
const CRUDE_CUTS = [['lpg', 40, 6], ['gasoline', 150, 16], ['kerosene', 220, 12], ['diesel', 300, 16]];
const WALL = ID.wall, FIRE = ID.fire, SMOKE = ID.smoke, WATER = ID.water, FE = ID.Fe, AL = ID.Al, OX = ID.O, RUST = ID.rust, SALT = ID.salt;
const NM = MATS.length;
const MELT = new Float32Array(NM), BOIL = new Float32Array(NM), IGN = new Float32Array(NM);
const CAPS = new Float32Array(NM), LF = new Float32Array(NM), LV = new Float32Array(NM), GASP = new Float32Array(NM), SOLIDST = new Uint8Array(NM);
const PARTRX = new Uint8Array(NM), NOCOND = new Uint8Array(NM);
const HALV = new Float32Array(NM), REACTV = new Float32Array(NM), RX = new Uint8Array(NM);
const CONDS = new Float32Array(NM), CONDG = new Float32Array(NM), DENS = new Float32Array(NM), LIFT = new Int8Array(NM);
for (const m of MATS) {
  const locked = m.fixed || m.special;
  MELT[m.id] = locked ? 1e9 : m.melt;
  BOIL[m.id] = locked ? 1e9 : Math.max(m.boil, m.melt + 1);
  CAPS[m.id] = m.cap;
  // Latent heat: the energy soaked up by melting and by boiling, as "degrees of heating this material" times its
  // heat capacity. Where no figure is given it follows the usual rules of thumb: about a third of the melting
  // point (in kelvin) for metals, and about three times the boiling point for a metal to vaporise.
  m.lfDeg = m.lf !== undefined ? m.lf : Math.round((m.soft ? 0.25 : 0.36) * (m.melt + 273));
  m.lvDeg = m.lv !== undefined ? m.lv : Math.round((m.soft ? 1.2 : 3) * (m.boil + 273));
  LF[m.id] = locked ? 1e9 : m.lfDeg * m.cap;
  LV[m.id] = locked ? 1e9 : m.lvDeg * m.cap;
  GASP[m.id] = m.gasP;
  SOLIDST[m.id] = m.powder ? POWDER : STATIC;
  IGN[m.id] = m.burn ? m.burn.at : 1e9;
  CONDS[m.id] = m.cond !== undefined ? m.cond : 0.04 + 0.18 * Math.min(1, Math.log10(1 + m.k) / 2.604);
  CONDG[m.id] = m.special === 'fire' ? 0.1 : 0.01;      // gases pass heat on slowly; an open flame is the exception
  DENS[m.id] = m.dens;
  LIFT[m.id] = m.lift;
  HALV[m.id] = m.hal || 0;
  NOCOND[m.id] = m.vapor ? 1 : 0;
  PARTRX[m.id] = (m.burn && !m.burn.fast && !m.burn.self) || m.wet || m.key === 'Fe' ? 1 : 0;
  REACTV[m.id] = m.react || 0;
  RX[m.id] = m.id === FE ? 1 : 0;
}
const CHEMV = new Uint8Array(NM), CPDI = new Array(NM).fill(null);
for (let k = 0; k < NE0 * NE0; k++) if (PAIR_PRODUCT[k]) CHEMV[(k / NE0) | 0] = 1;
for (const id in CPD_INFO) CPDI[id] = CPD_INFO[id];
const OXIDE_OF = new Uint16Array(NM);
for (const m of MATS) if (m.z && m.burn && !m.burn.fast && isMetal(m) && PAIR_PRODUCT[m.id * NE0 + OX]) OXIDE_OF[m.id] = PAIR_PRODUCT[m.id * NE0 + OX];
// ---------- chemistry, second step: compounds reacting with a third substance ----------
// Water and the reactive metals give a hydroxide (lye) and hydrogen. Hydrogen halides dissolve in water as
// acids. Acids eat metals that are more reactive than hydrogen, giving the metal's salt and hydrogen, and turn
// bases and metal oxides into the salt and water. A metal that holds the other element harder takes it from a
// compound and frees the first metal (aluminium with rust is thermite). Carbon at furnace heat and hot hydrogen
// strip the oxygen from the less reactive metals' oxides, which is how ores are smelted.
const ENV = new Float32Array(NM).fill(NaN), METAL = new Uint8Array(NM);
for (const m of MATS) if (m.z) { if (ENEG[m.key] !== undefined) ENV[m.id] = ENEG[m.key]; METAL[m.id] = isMetal(m) ? 1 : 0; }
const HYDROXIDE = new Uint16Array(NM), BASE_METAL = new Uint16Array(NM), ACID_OF = new Uint16Array(NM), ACID_X = new Uint16Array(NM);
for (const k in HYDROXIDE_KEY) { HYDROXIDE[ID[k]] = ID[HYDROXIDE_KEY[k]]; BASE_METAL[ID[HYDROXIDE_KEY[k]]] = ID[k]; }
for (const X in ACID_KEY) { const hx = PAIR_PRODUCT[ID.H * NE0 + ID[X]]; if (hx) ACID_OF[hx] = ID[ACID_KEY[X]]; ACID_X[ID[ACID_KEY[X]]] = ID[X]; }
const CARBON = ID.C, HYD = ID.H;

// ---------- nuclear behaviour ----------
// Chances are per cell a neutron passes through. fisF/fisT: fission by a fast/slow neutron, nu: neutrons
// released, sf: spontaneous fission per frame, absF/absT: swallows the neutron, scat: bounces it,
// mod: a bounce also slows it down, breed: capturing a neutron turns it into this, warm: deg C per frame of decay heat.
const NUC = {
  U: { fisF: 0.03, fisT: 0.3, nu: 2.5, sf: 0.00002 },
  Pu: { fisF: 0.1, fisT: 0.3, nu: 3, sf: 0.0002, warm: 0.25 },
  Np: { fisF: 0.02, fisT: 0.02, nu: 2.5 },
  Am: { fisF: 0.02, fisT: 0.05, nu: 3, warm: 0.1 },
  Cm: { fisF: 0.04, fisT: 0.1, nu: 3, sf: 0.0005 },
  Cf: { fisF: 0.05, fisT: 0.2, nu: 3.7, sf: 0.01 },
  Th: { absF: 0.02, absT: 0.08, breed: 'U' },
  B: { absF: 0.08, absT: 0.5 }, Cd: { absF: 0.03, absT: 0.6 }, Gd: { absF: 0.03, absT: 0.8 }, Hf: { absF: 0.05, absT: 0.3 },
  Xe: { absT: 0.4 }, In: { absT: 0.2 }, Ag: { absT: 0.15 }, Li: { absT: 0.15 },
  water: { scat: 0.35, mod: 0.5, absT: 0.004 }, gasoline: { scat: 0.3, mod: 0.4, absT: 0.004 },
  C: { scat: 0.3, mod: 0.25 }, Be: { scat: 0.4, mod: 0.2 }, H: { scat: 0.3, mod: 0.6 }
};
// Decay: [half-life in game seconds, what it becomes, heat released in deg C]. Real half-lives run from
// microseconds to millennia, so these are squeezed onto a scale you can watch. Uranium and thorium last
// billions of years and do not decay here.
const DECAY = {
  Pm: [120, 'Nd', 150], Po: [45, 'Pb', 600], At: [8, 'Bi', 400], Rn: [20, 'Po', 300], Fr: [6, 'Ra', 300], Ra: [180, 'Rn', 300],
  Ac: [90, 'Ra', 300], Pa: [240, 'Ac', 300], Am: [300, 'Np', 300], Cm: [60, 'Pu', 400], Bk: [40, 'Cf', 200], Cf: [50, 'Cm', 400],
  Es: [15, 'Bk', 300], Fm: [10, 'Cf', 300], Md: [8, 'Es', 300], No: [5, 'Fm', 300], Lr: [5, 'Md', 300],
  waste: [120, ['Zr', 'Mo', 'Ba', 'Ce', 'Nd', 'Xe', 'Cs', 'Sr'], 200]
};
const FISF = new Float32Array(NM), FIST = new Float32Array(NM), NUV = new Float32Array(NM), SFV = new Float32Array(NM);
const ABSF = new Float32Array(NM), ABST = new Float32Array(NM), SCAT = new Float32Array(NM), MODV = new Float32Array(NM);
const BREED = new Uint16Array(NM), RAD = new Uint8Array(NM);
const BYZ = [];
for (const m of MATS) if (m.z) BYZ[m.z] = m;
for (const m of MATS) {
  const n = NUC[m.key] || {};
  m.nuc = NUC[m.key] || null;
  FISF[m.id] = n.fisF || 0; FIST[m.id] = n.fisT || 0; NUV[m.id] = n.nu || 0; SFV[m.id] = n.sf || 0;
  ABSF[m.id] = n.absF || 0; ABST[m.id] = n.absT || 0;
  SCAT[m.id] = n.scat !== undefined ? n.scat : m.id === 0 || m.special ? 0 : 0.08;
  MODV[m.id] = n.mod || 0;
  BREED[m.id] = n.breed ? ID[n.breed] : 0;
  if (n.warm) m.warm = n.warm;
  let d = DECAY[m.key];
  // the superheavy elements shed an alpha particle within seconds and step two places down the table
  if (!d && m.z >= 104) d = [2 + m.z % 3, BYZ[m.z - 2].key, 300];
  if (d) {
    const into = (Array.isArray(d[1]) ? d[1] : [d[1]]).map(k => ID[k]);
    m.decay = { half: d[0], p: Math.LN2 / (d[0] * 60), into, q: d[2], alpha: m.z > 82 && MATS[into[0]].z === m.z - 2 };
  }
  RAD[m.id] = m.warm || SFV[m.id] || m.decay ? 1 : 0;
}
const WASTE = ID.waste, HE = ID.He;

function stateAt(m, T) {
  if (m.fixed) return STATIC;
  if (m.special) return GAS;
  return T < m.melt ? (m.powder ? POWDER : STATIC) : T < m.boil ? LIQUID : GAS;
}

// ---------- the grid ----------
const type = new Uint16Array(N);     // material id
const st = new Uint8Array(N);        // cell state
let temp = new Float32Array(N).fill(AMBIENT);
let temp2 = new Float32Array(N);
const life = new Int16Array(N);
const aux = new Uint16Array(N);      // for fire: what it leaves behind
const lat = new Float32Array(N);    // latent heat banked towards the next change of state
const ox = new Float32Array(N).fill(1);   // how much of the air in a cell is still fresh: 1 is clean air, 0 is all burnt gas
const Pref = new Float32Array(N).fill(P0);   // pressure at the end of last frame, to see how much each cell was squeezed
const cpc = new Float32Array(N);
const pcap = new Float32Array(N);   // pressure capacity per cell: 1 for gas, tiny for liquid
const smooth = new Uint8Array(N);
const LP = new Float32Array(N);     // extra pressure in squeezed liquid, atm
const stocked = [];                 // liquid cells holding squeezed-in liquid this frame
let lpCells = [];
let P = new Float32Array(N).fill(P0);
let P2 = new Float32Array(N);
const stamp = new Uint8Array(N);
const bid = new Uint16Array(N);
const open = new Uint8Array(N);
const cnd = new Float32Array(N);
let FX = new Float32Array(N);       // flow across each cell's right face, atm x cells per frame
let FY = new Float32Array(N);       // same for the bottom face
let GX = new Float32Array(N), GY = new Float32Array(N);
const HDX = new Float32Array(N), HDY = new Float32Array(N);   // pressure a fan adds across each right / bottom face
const headFaces = [];
const fan = new Uint8Array(N);      // things laid over cells. Fans: 1 blows right, 2 left, 3 up, 4 down. Electrics: 5 contact, 6 wire, 7 spark plug, 8 injector, 9 valve, 10 switch, 11 heater,
// 12-14 sensors (temperature, pressure, touch), 15 inverter, 16 pump, 17 electrode
const CONTACT = 5, WIRE = 6, PLUG = 7, INJECTOR = 8, VALVE = 9, SWITCH = 10, HEATER = 11;
const SENSE_T = 12, SENSE_P = 13, SENSE_C = 14, INVERTER = 15, PUMP = 16, ELECTRODE = 17;
const ddir = new Uint8Array(N);   // which way an inverter or pump faces: 1 right, 2 left, 3 up, 4 down
const DIR_STEP = [0, 1, -1, -W, W];
// Each device's setting: how far a valve opens (0-100 %), puffs an injector sprays per frame, a switch on (1) or off (0)
const dset = new Uint8Array(N);
const DEV_DEFAULT = { [VALVE]: 100, [INJECTOR]: 6, [SWITCH]: 1, [HEATER]: 40, [SENSE_T]: 10, [SENSE_P]: 15, [SENSE_C]: 1, [INVERTER]: 1, [PUMP]: 3, [ELECTRODE]: 1 };
// a heater's and a temperature sensor's setting is tens of °C, a pressure sensor's tenths of an atmosphere
const gate = new Float32Array(N).fill(1);   // how freely gas passes a cell: 1 normally, less in a part-open valve
// a valve's opening sets how freely gas passes it, on a steep curve: half open passes about 1 % as easily
function valveGate(pct) { return pct >= 100 ? 1 : Math.pow(10, -4 * (1 - pct / 100)); }
const INJ_RATE = 6, INJ_UNITS = 4;   // puffs of vapour an injector sprays per frame while live, and the fuel in each
const lit = new Uint8Array(N);      // frames a wire stays lit up after carrying a pulse
const eq = new Int32Array(N), eseen = new Uint32Array(N);
let egen = 0;
const cpBuf = new Float64Array(Math.max(W, H));
const dpBuf = new Float64Array(Math.max(W, H));
const kfBuf = new Float64Array(Math.max(W, H));
let tick = 0, cur = 1;

const world = planck.World({ gravity: planck.Vec2(0, GRAVITY) });
let ground = world.createBody();
let groundDirty = true;
const bodies = new Map();
let nextId = 1;

function swap(i, j) {
  const t = type[i]; type[i] = type[j]; type[j] = t;
  const s = st[i]; st[i] = st[j]; st[j] = s;
  const f = temp[i]; temp[i] = temp[j]; temp[j] = f;
  const l = life[i]; life[i] = life[j]; life[j] = l;
  const a = aux[i]; aux[i] = aux[j]; aux[j] = a;
  const q = lat[i]; lat[i] = lat[j]; lat[j] = q;
  const nd = need[i]; need[i] = need[j]; need[j] = nd;
  stamp[i] = cur; stamp[j] = cur;
}

function clearCell(i) { type[i] = 0; st[i] = NONE; life[i] = 0; aux[i] = 0; lat[i] = 0; need[i] = 0; }

// Melting, freezing, boiling and condensing all take or give energy. A cell that reaches the threshold
// holds at that temperature and banks the extra heat; only when the bank is full does it change state.
// Returns the state the cell should now be in.
function phase(i, t, s) {
  const T = temp[i];
  if (s === GAS) {
    const b = BOIL[t];
    if (T < b) {
      if (NOCOND[t]) return GAS;                   // vapour thinned out in air stays vapour
      lat[i] += (b - T) * CAPG; temp[i] = b;
      if (lat[i] >= LV[t]) { lat[i] = 0; P[i] = Math.max(0, P[i] - GASP[t]); return LIQUID; }
    } else if (lat[i] > 0) {
      const d = Math.min(lat[i], (T - b) * CAPG);
      lat[i] -= d; temp[i] = T - d / CAPG;
    }
    return GAS;
  }
  const c = CAPS[t];
  if (s === LIQUID) {
    const b = BOIL[t], m = MELT[t];
    if (T > b) {
      if (lat[i] < 0) lat[i] = 0;
      lat[i] += (T - b) * c; temp[i] = b;
      if (lat[i] >= LV[t]) { lat[i] = 0; P[i] += GASP[t]; return GAS; }
    } else if (T < m) {
      if (lat[i] > 0) lat[i] = 0;
      lat[i] -= (m - T) * c; temp[i] = m;
      if (lat[i] <= -LF[t]) { lat[i] = 0; return SOLIDST[t]; }
    } else if (lat[i] > 0) {
      const d = Math.min(lat[i], (b - T) * c);
      lat[i] -= d; temp[i] = T + d / c;
    } else if (lat[i] < 0) {
      const d = Math.min(-lat[i], (T - m) * c);
      lat[i] += d; temp[i] = T - d / c;
    }
    return LIQUID;
  }
  const m = MELT[t];
  if (T > m) {
    lat[i] += (T - m) * c; temp[i] = m;
    if (lat[i] >= LF[t]) { lat[i] = 0; return LIQUID; }
  } else if (lat[i] > 0) {
    const d = Math.min(lat[i], (m - T) * c);
    lat[i] -= d; temp[i] = T + d / c;
  }
  return s;
}

// Fast fuels (gasoline, hydrogen) burn only with oxygen. Empty space is air, and each cell of air
// holds oxygen in proportion to its density, so squeezed air burns more fuel. The air a fuel cell
// burns with is used up: it flashes to flame, its pressure jumps, and it is left as burnt gas, which
// nothing can burn in until fresh air replaces it. A cell of liquid gasoline holds 8 units of fuel and each unit needs one cell
// of ordinary air. Liquid burns from its surface a couple of units at a time; vapour goes at once.
// Returns false if there was no air to burn with.
function burn(i) {
  const t = type[i], b = MATS[t].burn, s = st[i];
  const full = b.units || 1;
  const content = s === GAS ? (life[i] > 0 ? life[i] : 1) : full - life[i];
  if (content <= 0) { clearCell(i); return false; }
  const want = s === GAS ? content : Math.min(content, 2);
  const per = b.o2 || 1;
  let need = want * per;
  const x = i % W, y = (i / W) | 0;
  for (let r = 1; r <= 2 && need > 0.01; r++) {
    for (let dy = -r; dy <= r && need > 0.01; dy++) for (let dx = -r; dx <= r; dx++) {
      if ((dx < 0 ? -dx : dx) !== r && (dy < 0 ? -dy : dy) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const c = ny * W + nx, sc = st[c];
      let rich;
      if (sc === NONE) rich = ox[c]; else if (sc === GAS && type[c] === OX) rich = 3; else continue;
      if (r === 2 && SOL[st[i + Math.sign(dx) + Math.sign(dy) * W]]) continue;    // not through a wall
      // how much oxygen is in the cell: its density, which is pressure over temperature (hot air is thin)
      const o = P[c] * 293 / (temp[c] + 273) * rich;
      if (o < 0.05) continue;
      const used = o < need ? o : need;
      need -= used;
      P[c] += FLAME_GAIN * used;
      if (sc === NONE) ox[c] *= 1 - used / o;        // that share of the cell's air is now burnt gas
      type[c] = FIRE; st[c] = GAS; aux[c] = NOTHING; lat[c] = 0;
      life[c] = 4 + (Math.random() * 8 | 0);
      const h = b.heat + (rich > 1 ? 800 : 0);
      if (temp[c] < h) temp[c] = h;
      stamp[c] = cur;
      if (need <= 0.01) break;
    }
  }
  const burned = want - (need > 0 ? need : 0) / per;
  if (burned < 0.05) return false;
  const left = content - burned;
  if (left < 0.3) {
    if (s === STATIC) groundDirty = true;
    aux[i] = b.product ? ID[b.product] : NOTHING;
    lat[i] = 0;
    type[i] = FIRE; st[i] = GAS;
    life[i] = (b.life || 6) + (Math.random() * 6 | 0);
    if (temp[i] < b.heat) temp[i] = b.heat;
    stamp[i] = cur;
  } else if (s === GAS) life[i] = Math.max(1, Math.round(left));
  else life[i] = Math.min(full - 1, Math.round(full - left));
  return true;
}

// A part cell that has burned, dissolved or corroded is no longer part of its part.
const fk = new Int32Array(N);       // for a part cell: which of its part's own cells it is
function detach(i) {
  const rb = bodies.get(bid[i]);
  if (rb) { rb.occ[fk[i]] = 0; rb.dirty = true; }
  bid[i] = 0;
}

// What a flame does to the cell next to it. Returns true if it found oxygen to feed on.
function fireTouch(n, flameT) {
  const s = st[n];
  if (s === NONE) return false;
  if (s === PART) {
    // a part made of something that burns can be lit by a flame hot enough
    const pb = MATS[type[n]].burn;
    if (pb && !pb.fast && !pb.self && flameT >= pb.at && temp[n] < pb.at + 60 && Math.random() < 0.08) temp[n] = pb.at + 60;
    return false;
  }
  if (type[n] === OX && s === GAS) {
    if (Math.random() < 0.5) clearCell(n);
    return true;
  }
  const b = MATS[type[n]].burn;
  if (!b) return false;
  if (b.fast) { if (Math.random() < 0.5) burn(n); }
  else if (flameT >= b.at && temp[n] < b.at + 60 && Math.random() < 0.08) temp[n] = b.self ? b.heat : b.at + 60;   // the flame has to be hot enough
  return false;
}

// A spent flame can still light what it touches, but has no fuel to feed on oxygen with.
function fireTouchLit(n, flameT) {
  const s = st[n];
  if (s === NONE || (type[n] === OX && s === GAS)) return;
  fireTouch(n, flameT);
}
// Reactions between neighbours, by chemical family:
//   halogens attack metals and leave salt, faster for fluorine and for the more reactive metals
//   iron rusts slowly in water and burns to rust in hot oxygen
const NB = [-1, 1, -W, W];
function react(i, x, y, t, s) {
  // iron rusts slowly in water (with oxygen, iron burns to the same oxide through the general chemistry)
  for (let k = 0; k < 4; k++) {
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = i + NB[k];
    if (type[n] === WATER && st[n] === LIQUID && Math.random() < 0.0004) {
      if (s === STATIC) groundDirty = true;
      type[i] = RUST; st[i] = stateAt(MATS[RUST], temp[i]); stamp[i] = cur;
      return true;
    }
  }
  return false;
}

// ---------- chemistry at work ----------
// need: how much more of one of its two elements a freshly made compound cell still takes in to match its
// formula (positive: more of the electron-taker, B; negative: more of the giver, A). One cell of each element
// meets one cell of the other, and the compound keeps drawing in neighbours until the proportions are right.
const need = new Float32Array(N);
const made = new Set();                  // compounds that have formed since the page opened
let madeNews = null;                     // the latest new one, for the status line
function chemSkip(ia, ib) {
  // burning in air and oxygen already has its own, more detailed rules
  return ib === OX && MATS[ia].burn;
}
function becomeCompound(c, pid, T, heat) {
  if (st[c] === PART) detach(c);
  if (st[c] === STATIC) groundDirty = true;
  type[c] = pid; life[c] = 0; aux[c] = 0; lat[c] = 0;
  temp[c] = T + heat;
  st[c] = stateAt(MATS[pid], temp[c]);
  if (st[c] === GAS && P[c] < P0) P[c] = P0;
  stamp[c] = cur;
  if (!made.has(pid)) { made.add(pid); madeNews = pid; }
  const x = c % W, y = (c / W) | 0, warm = temp[c] * 0.6, R = st[c] === GAS ? 2 : 1;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const nx = x + dx, ny = y + dy;
    if ((dx || dy) && nx >= 0 && nx < W && ny >= 0 && ny < H) { const n = ny * W + nx; if ((st[n] !== NONE || R === 2) && !MATS[type[n]].fixed && !SOL[st[n]] && temp[n] < warm) temp[n] = warm; else if (st[n] !== NONE && SOL[st[n]] && !MATS[type[n]].fixed && temp[n] < warm) temp[n] = warm; }
  }
}
function useUp(c) {
  if (st[c] === PART) detach(c);
  if (st[c] === STATIC) groundDirty = true;
  // a gas taken up into a solid leaves next to nothing behind: the pressure there drops and no fresh air appears
  if (st[c] === GAS) { P[c] *= 0.15; ox[c] = 0; }
  clearCell(c);
  stamp[c] = cur;
}
// a flash of flame where a strong reaction happens next to open space
function flash(c, x, y, heat) {
  if (heat < 700) return;
  for (let k = 0; k < 4; k++) {
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = c + NB[k];
    if (st[n] === NONE) { type[n] = FIRE; st[n] = GAS; aux[n] = NOTHING; life[n] = 3 + (heat / 600 | 0); temp[n] = Math.min(2500, 400 + heat); lat[n] = 0; stamp[n] = cur; return; }
  }
}
function chemReact(i, x, y, t) {
  const k0 = (Math.random() * 4) | 0;
  for (let q = 0; q < 4; q++) {
    const k = (k0 + q) & 3;
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = i + NB[k], tn = type[n], sn = st[n];
    if (sn === NONE || sn === DRAFT || tn >= NE0 || stamp[n] === cur) continue;
    const pk = t * NE0 + tn, pid = PAIR_PRODUCT[pk];
    if (!pid) continue;
    const ia = PAIR_A[pk], ib = ia === t ? tn : t;
    if (chemSkip(ia, ib)) continue;
    const T = temp[i] > temp[n] ? temp[i] : temp[n];
    if (T < PAIR_ACT[pk] || Math.random() > PAIR_RATE[pk]) continue;
    return combine(i, n, t, tn, pk, pid, ia);
  }
  // gases are thin: a gas reacts with a partner a couple of cells away as well
  if (st[i] === GAS) {
    const dx = ((Math.random() * 5) | 0) - 2, dy = ((Math.random() * 5) | 0) - 2;
    const nx = x + dx, ny = y + dy;
    if ((dx < -1 || dx > 1 || dy < -1 || dy > 1) && nx >= 0 && nx < W && ny >= 0 && ny < H) {
      const n = ny * W + nx, tn = type[n];
      const mid = (y + ny >> 1) * W + (x + nx >> 1);
      if (st[n] === GAS && tn < NE0 && stamp[n] !== cur && !SOL[st[mid]]) {
        const pk = t * NE0 + tn, pid = PAIR_PRODUCT[pk];
        if (pid) {
          const ia = PAIR_A[pk], ib = ia === t ? tn : t;
          const T = Math.max(temp[i], temp[n], temp[mid]);   // the air between them counts: a flame front heats it
          if (!chemSkip(ia, ib) && T >= PAIR_ACT[pk] && Math.random() < PAIR_RATE[pk]) return combine(i, n, t, tn, pk, pid, ia);
        }
      }
    }
  }
  return false;
}
function combine(i, n, t, tn, pk, pid, ia) {
  // the compound forms in the place of the element it has more atoms of; the other cell is used up
  const r = PAIR_RATIO[pk], heat = PAIR_HEAT[pk];
  const cA = ia === t ? i : n, cB = ia === t ? n : i;
  const keep = r >= 1 ? cA : cB, gone = keep === cA ? cB : cA;
  const T0 = Math.max(temp[cA], temp[cB]);
  useUp(gone);
  becomeCompound(keep, pid, T0, heat);
  need[keep] = r >= 1 ? r - 1 : -(1 / r - 1);
  flash(keep, keep % W, (keep / W) | 0, heat);
  return true;
}
function swapTo(c, id, T) {
  if (st[c] === PART) detach(c);
  if (st[c] === STATIC) groundDirty = true;
  type[c] = id; life[c] = 0; aux[c] = 0; lat[c] = 0; need[c] = 0;
  temp[c] = T; st[c] = stateAt(MATS[id], T);
  if (st[c] === GAS && P[c] < P0) P[c] = P0;
  stamp[c] = cur;
  if (MATS[id].gen && !made.has(id)) { made.add(id); madeNews = id; }
}
function cpdReact(i, x, y, t) {
  const X = ACID_X[t], info = CPDI[t];
  const k0 = (Math.random() * 4) | 0;
  for (let q = 0; q < 4; q++) {
    const k = (k0 + q) & 3;
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = i + NB[k], sn = st[n];
    if (sn === NONE || sn === DRAFT || stamp[n] === cur) continue;
    const tn = type[n], T = temp[i] > temp[n] ? temp[i] : temp[n];
    if (X) {
      // an acid eats away a metal more reactive than hydrogen: hydrogen bubbles off where the metal was,
      // and the metal's salt comes out of the acid (so the next bit of metal is bare to the acid again)
      if (METAL[tn] && ENV[tn] < 1.85) {
        const salt = PAIR_PRODUCT[tn * NE0 + X];
        if (salt && Math.random() < Math.min(0.2, Math.max(0.003, (1.9 - ENV[tn]) * 0.15))) {
          swapTo(n, HYD, temp[n] + 60); P[n] += 1;
          if (Math.random() < 0.4) swapTo(i, salt, temp[i] + 60); else swapTo(i, WATER, temp[i] + 60);   // spent acid is mostly water
          return true;
        }
      }
      // and turns a base or a metal oxide into the salt and water
      const ci = CPDI[tn];
      const bm = BASE_METAL[tn] || (ci && ci.B === OX && METAL[ci.A] ? ci.A : 0);
      if (bm) {
        const salt = PAIR_PRODUCT[bm * NE0 + X];
        if (salt && Math.random() < 0.1) { swapTo(n, salt, temp[n] + 150); swapTo(i, WATER, temp[i] + 150); return true; }
      }
      continue;
    }
    if (!info) return false;
    // a hydrogen halide dissolves in water to make the acid
    if (ACID_OF[t] && tn === WATER && sn === LIQUID) { swapTo(n, ACID_OF[t], temp[n] + 40); useUp(i); return true; }
    if (t === WATER || tn >= NE0 || isNaN(ENV[tn])) continue;
    const A = info.A, B = info.B;
    if (A === HYD) continue;
    // a metal that holds the other element harder takes it over and frees the first one
    if (METAL[tn] && tn !== A) {
      const pk = tn * NE0 + B, prod = PAIR_PRODUCT[pk];
      if (prod && ENV[A] - ENV[tn] > 0.15 && T >= Math.max(400, PAIR_ACT[pk]) && Math.random() < 0.2) {
        const heat = Math.max(60, PAIR_HEAT[pk] - info.heat);
        swapTo(n, prod, T + heat); swapTo(i, A, T + heat);
        return true;
      }
    }
    if (B !== OX) continue;
    // smelting: carbon takes the oxygen from the oxide of a not-too-reactive metal at furnace heat
    if (tn === CARBON && ENV[OX] - ENV[A] < 1.9 && T >= 1000 && Math.random() < 0.05) {
      swapTo(i, A, T - 80); swapTo(n, PAIR_PRODUCT[CARBON * NE0 + OX], T - 80);
      return true;
    }
    // hot hydrogen does the same to the oxides of the less reactive metals, leaving water
    if (tn === HYD && ENV[OX] - ENV[A] < 1.6 && T >= 300 && Math.random() < 0.1) {
      swapTo(i, A, T); swapTo(n, WATER, T);
      return true;
    }
  }
  return false;
}
// A compound short of one of its elements takes it in from a neighbour, and an unstable one falls apart when hot.
function chemCompound(i, x, y, t, info) {
  if (temp[i] > info.dec && Math.random() < 0.05) {
    // back to its elements: this cell becomes the giver, and a free neighbour takes the other one if there is room
    const T = temp[i];
    type[i] = info.A; life[i] = 0; aux[i] = 0; lat[i] = 0; need[i] = 0;
    st[i] = stateAt(MATS[info.A], T); stamp[i] = cur;
    for (let k = 0; k < 4; k++) {
      if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
      const n = i + NB[k];
      if (st[n] === NONE) { type[n] = info.B; st[n] = stateAt(MATS[info.B], T); temp[n] = T; life[n] = 0; aux[n] = 0; lat[n] = 0; stamp[n] = cur; break; }
    }
    return true;
  }
  const nd = need[i];
  if (nd === 0) return false;
  const want = nd > 0 ? info.B : info.A;
  for (let k = 0; k < 4; k++) {
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = i + NB[k];
    if (type[n] !== want || st[n] === NONE || st[n] === DRAFT || stamp[n] === cur) continue;
    useUp(n);
    temp[i] += info.heat * 0.5;
    const left = nd > 0 ? nd - 1 : nd + 1;
    need[i] = (nd > 0 ? left > 0.01 : left < -0.01) ? left : 0;
    if (st[i] !== PART) st[i] = stateAt(MATS[t], temp[i]);
    return true;
  }
  return false;
}

// Crude oil gives off each of its fractions once it is hot enough for that one to boil, lightest first,
// and what is left once they have all gone is tar.
function distill(i, x, y) {
  let k = 0, sum = 0;
  for (; k < CRUDE_CUTS.length; k++) { sum += CRUDE_CUTS[k][2]; if (life[i] < sum) break; }
  if (k === CRUDE_CUTS.length) {
    type[i] = TAR; st[i] = stateAt(MATS[TAR], temp[i]); life[i] = 0; stamp[i] = cur;
    if (st[i] === STATIC) groundDirty = true;
    return true;
  }
  const [key, at, size] = CRUDE_CUTS[k];
  // the hotter it is past the boiling point, the faster it boils, and boiling takes the heat away again:
  // so the crude sits at each fraction's boiling point until that fraction has gone
  if (temp[i] < at || Math.random() > 0.03 + (temp[i] - at) / 30) return false;
  // it boils into open space above it, bubbling up through the crude on top if it is not at the surface
  let a = -1;
  for (let q = i - W, n = 0; q >= 0 && n < 30; q -= W, n++) {
    if (st[q] === NONE) { a = q; break; }
    if (st[q] !== LIQUID) break;
  }
  if (a < 0) a = x > 0 && st[i - 1] === NONE ? i - 1 : x < W - 1 && st[i + 1] === NONE ? i + 1 : -1;
  if (a < 0) return false;
  // the whole of that fraction leaves as one cell of vapour: what is in a cell of crude is a lot of vapour
  const f = ID[key], units = sum - life[i];
  type[a] = f; st[a] = GAS; life[a] = key === 'lpg' ? 1 : units; aux[a] = 0; lat[a] = 0; temp[a] = temp[i]; stamp[a] = cur;
  P[a] += 0.6;                                    // boiling pushes the vapour out and up
  life[i] += units;
  temp[i] -= 20;                                  // boiling takes heat
  return true;
}
// Vapour only turns back to liquid where it is crowded against something cool, as in a condenser or up a
// column: a wisp of it out in the open air stays vapour. The liquid joins any drop of the same next to it.
function condense(i, x, y, t, m) {
  // it condenses on a surface colder than its boiling point
  let open = 0, touch = 0, drop = -1;
  const b = BOIL[t];
  for (let k = 0; k < 4; k++) {
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = i + NB[k], sn = st[n];
    if (sn === NONE) open++;
    else if ((sn === LIQUID || SOL[sn]) && temp[n] < b) { touch++; if (sn === LIQUID && type[n] === t && life[n] > 0) drop = n; }
  }
  // out in the air it needs to be crowded; inside sealed equipment with no air in it, touching is enough
  if (!touch || Math.random() > 0.2) return false;
  if (open > 1) {
    for (let k = 0; k < 4; k++) { const n = i + NB[k]; if (n >= 0 && n < N && st[n] === NONE && ox[n] > 0.3) return false; }
  }
  const units = life[i] > 0 ? life[i] : 1, full = m.burn.units;
  if (temp[i] > b) temp[i] = b;                   // it comes off the surface at its boiling point
  if (drop >= 0) {
    const room = life[drop];
    if (units <= room) { life[drop] -= units; temp[drop] = (temp[drop] + temp[i]) / 2; clearCell(i); return true; }
    life[drop] = 0; life[i] = units - room;
  }
  st[i] = LIQUID; life[i] = full - (life[i] > 0 ? life[i] : 1); lat[i] = 0; stamp[i] = cur;
  P[i] = Math.max(0, P[i] - 0.2);
  return true;
}
// Drops of the same liquid fuel run together, so condensate collects into a proper pool.
function pool(i, x, y, t, m) {
  const full = m.burn.units, mine = full - life[i];
  if (mine >= full) return false;
  const k = (Math.random() * 4) | 0;
  if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) return false;
  const n = i + NB[k];
  if (type[n] !== t || st[n] !== LIQUID || stamp[n] === cur) return false;
  const room = life[n];
  if (room <= 0) return false;
  if (mine <= room) { life[n] -= mine; clearCell(i); stamp[n] = cur; return true; }
  life[n] = 0; life[i] += room; stamp[n] = cur;
  return true;
}

// Slow fuels (coal, sulfur, magnesium) burn from the surface: they stay hot, throw off flame, and are eaten away.
function smolder(i, x, y, m) {
  const b = m.burn;
  if (b.self) {
    // carries its own oxygen: burns buried, with no flame, straight to its product
    temp[i] = b.heat;
    for (let k = 0; k < 4; k++) {
      if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
      const n = i + NB[k];
      if (type[n] === type[i] && temp[n] < b.heat && Math.random() < 0.3) temp[n] = b.heat;   // the reaction front spreads by contact
    }
    if (Math.random() < b.rate) {
      type[i] = ID[b.product]; st[i] = stateAt(MATS[type[i]], b.heat); stamp[i] = cur;
      return true;
    }
    return false;
  }
  // it needs a neighbour it can draw oxygen from: fresh air (not burnt gas) or oxygen itself
  const breathes = n => (st[n] === NONE && ox[n] > 0.15) || (st[n] === GAS && type[n] === OX);
  let air = -1;
  if (y > 0 && breathes(i - W)) air = i - W;
  else {
    const side = Math.random() < 0.5 ? -1 : 1;
    if (x + side >= 0 && x + side < W && breathes(i + side)) air = i + side;
    else if (x - side >= 0 && x - side < W && breathes(i - side)) air = i - side;
    else if (y < H - 1 && breathes(i + W)) air = i + W;
  }
  if (air < 0) {
    // flame or smoke against the surface still counts as burning; buried fuel is smothered
    const lit = (y > 0 && type[i - W] === FIRE) || (x > 0 && type[i - 1] === FIRE) || (x < W - 1 && type[i + 1] === FIRE);
    if (!lit) return false;
  }
  let heat = b.heat;
  // pure oxygen against the surface makes it burn much hotter
  for (let k = 0; k < 4; k++) {
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = i + NB[k];
    if (type[n] === OX && st[n] === GAS) { heat += 800; if (Math.random() < 0.3) clearCell(n); break; }
  }
  if (temp[i] < heat) temp[i] = heat;              // a burning surface holds its flame temperature
  // it lights any slow fuel it is touching, provided it burns hot enough to
  for (let k = 0; k < 4; k++) {
    if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
    const n = i + NB[k], sn = st[n];
    if (sn === NONE) continue;
    const nb = MATS[type[n]].burn;
    if (nb && !nb.fast && b.heat >= nb.at && temp[n] < nb.at + 60 && Math.random() < 0.2) temp[n] = nb.self ? nb.heat : nb.at + 60;
  }
  if (air >= 0 && st[air] === NONE && Math.random() < 0.25) {
    type[air] = FIRE; st[air] = GAS; aux[air] = 0;
    life[air] = 8 + (Math.random() * 10 | 0);
    temp[air] = b.heat; stamp[air] = cur;
  }
  if (Math.random() < b.rate) {
    if (st[i] === STATIC) groundDirty = true;
    // a burning metal leaves its oxide behind as ash (magnesium burns to white magnesium oxide)
    const ash = OXIDE_OF[type[i]];
    type[i] = FIRE; st[i] = GAS; aux[i] = ash; life[i] = 10; stamp[i] = cur;
    if (ash && !made.has(ash)) { made.add(ash); madeNews = ash; }
    return true;
  }
  return false;
}

// Alkali metals in water: hydrogen and heat. Potassium runs hot enough to light the hydrogen.
function wetReact(i, x, y, m) {
  let w = -1;
  if (y < H - 1 && type[i + W] === WATER && st[i + W] === LIQUID) w = i + W;
  else if (x > 0 && type[i - 1] === WATER && st[i - 1] === LIQUID) w = i - 1;
  else if (x < W - 1 && type[i + 1] === WATER && st[i + 1] === LIQUID) w = i + 1;
  else if (y > 0 && type[i - W] === WATER && st[i - W] === LIQUID) w = i - W;
  if (w < 0 || Math.random() > m.wet.p) return false;
  type[i] = ID.H; st[i] = GAS; life[i] = 0; aux[i] = 0;
  temp[i] = m.wet.gasTemp;
  P[i] += 2;
  temp[w] += 40;
  // the water it took the hydrogen from is left as the metal's hydroxide (lye)
  const oh = HYDROXIDE[m.id];
  if (oh && Math.random() < 0.5) swapTo(w, oh, temp[w]);
  else if (Math.random() < 0.3) clearCell(w);
  stamp[i] = cur;
  return true;
}

// ---------- electrics ----------
// A contact is live while a part is passing over it. Everything wired to a live contact is live,
// and a live spark plug fires. Wires can run through walls and do not get in the way of anything.
function spark(c) {
  const x = c % W, y = (c / W) | 0;
  if (st[c] === NONE) { type[c] = FIRE; st[c] = GAS; aux[c] = NOTHING; life[c] = 3; lat[c] = 0; temp[c] = 1600; stamp[c] = cur; }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const n = ny * W + nx, sn = st[n];
    if (sn === NONE || sn === PART || sn === DRAFT) continue;
    if ((sn === GAS || sn === LIQUID) && temp[n] < 1200) temp[n] = 1200;   // the spark heats the gas around it enough to set off most mixtures
    const b = MATS[type[n]].burn;
    if (b && b.fast) burn(n);
  }
}
// A live injector takes whatever liquid or gas touches its line in the tank and sprays it from its open end.
// Fuel that can turn to vapour sprays as a fine mist of vapour; anything else goes over a cell at a time.
const injSrc = [], injSeed = [];
// A gas in a tank does not have to drift onto the pickup: the injector draws on the whole tankful near it.
const rseen = new Uint32Array(N);
let rgen = 0;
function reachGas(ox, oy) {
  // start from the gas the line touches, and from open space next to it in case the gas has drifted off
  const seeds = [];
  for (const c of injSrc) if (st[c] === GAS) seeds.push(c);
  for (const c of injSeed) if (Math.abs(c % W - ox) > 6 || Math.abs(((c / W) | 0) - oy) > 6) seeds.push(c);
  if (!seeds.length) return;
  rgen++;
  const q = [];
  for (const c of seeds) if (rseen[c] !== rgen) { rseen[c] = rgen; q.push(c); }
  let t = -1;
  for (let h = 0; h < q.length && q.length < 500; h++) {
    const c = q[h], x = c % W, y = (c / W) | 0;
    if (st[c] === GAS && type[c] !== FIRE && (t < 0 || type[c] === t)) { t = type[c]; injSrc.unshift(c); }
    for (let d = 0; d < 4; d++) {
      if ((d === 0 && x === 0) || (d === 1 && x === W - 1) || (d === 2 && y === 0) || (d === 3 && y === H - 1)) continue;
      const n = c + NB[d];
      if (rseen[n] === rgen || !(st[n] === GAS || st[n] === NONE)) continue;
      if (Math.abs(n % W - ox) <= 6 && Math.abs(((n / W) | 0) - oy) <= 6) continue;   // never reach round to the nozzle's side
      rseen[n] = rgen; q.push(n);
    }
  }
}
function inject(o, rate) {
  const ox = o % W, oy = (o / W) | 0;
  for (let k = 0; k < rate && injSrc.length; k++) {
    let src = -1;
    while (injSrc.length) { const c = injSrc[injSrc.length - 1]; if (st[c] === LIQUID || st[c] === GAS) { src = c; break; } injSrc.pop(); }
    if (src < 0) return;
    let n = -1;
    for (let tries = 0; tries < 4 && n < 0; tries++) {
      const dx = (Math.random() * 15 | 0) - 7, dy = (Math.random() * 15 | 0) - 7;
      const nx = ox + dx, ny = oy + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H || st[ny * W + nx] !== NONE) continue;
      let clear = true;
      for (let q = 1; q < 6 && clear; q++) if (SOL[st[Math.round(oy + dy * q / 6) * W + Math.round(ox + dx * q / 6)]]) clear = false;
      if (clear) n = ny * W + nx;
    }
    if (n < 0) continue;
    const t = type[src], m = MATS[t];
    if (st[src] === LIQUID && m.vapor) {
      type[n] = t; st[n] = GAS; life[n] = INJ_UNITS; aux[n] = 0; lat[n] = 0; temp[n] = temp[src]; stamp[n] = cur;
      life[src] += INJ_UNITS;
      if (life[src] >= m.burn.units) { clearCell(src); injSrc.pop(); }
    } else {
      type[n] = t; st[n] = st[src]; life[n] = life[src]; aux[n] = aux[src]; lat[n] = lat[src]; temp[n] = temp[src]; stamp[n] = cur;
      P[n] = P[src] > 0 ? P[src] : P0;
      clearCell(src); injSrc.pop();
    }
  }
}
// A sensor is live while what it measures is at or past its setting, and passes power on while it is.
function sensed(c) {
  const f = fan[c];
  if (f === SENSE_T) return temp[c] >= dset[c] * 10;
  if (f === SENSE_P) return (st[c] === NONE || st[c] === GAS) && P[c] * 10 >= dset[c];
  return st[c] !== NONE;   // touch: anything at all on it but air
}
const invSeed = [], pumpOn = [];
// Nothing flows backwards through a pump, running or not: liquid cannot move against the way it faces.
const DIR_X = [0, 1, -1, 0, 0], DIR_Y = [0, 0, 0, -1, 1];
function backflow(a, b) {
  const fa = fan[a] === PUMP, fb = fan[b] === PUMP;
  if (!fa && !fb) return false;
  const dx = b % W - a % W, dy = ((b / W) | 0) - ((a / W) | 0);
  if (fb && dx * DIR_X[ddir[b]] + dy * DIR_Y[ddir[b]] < 0) return true;
  if (fa && dx * DIR_X[ddir[a]] + dy * DIR_Y[ddir[a]] < 0) return true;
  return false;
}
// A live pump takes liquid from behind it, or from its own cell, and pushes it on ahead: through whatever
// liquid already fills the pipe in front, to the nearest open space beyond (up a pipe, too).
const pseen = new Uint32Array(N);
let pgen = 0;
const pq = new Int32Array(N);
function pump(c) {
  const d = DIR_STEP[ddir[c] || 1], back = c - d, front = c + d;
  if (back < 0 || front < 0 || back >= N || front >= N) return;
  for (let k = 0; k < dset[c]; k++) {
    const src = st[c] === LIQUID ? c : st[back] === LIQUID ? back : -1;
    if (src < 0 || SOL[st[front]]) return;
    let dst = -1;
    if (st[front] === NONE || st[front] === GAS) dst = front;
    else if (st[front] === LIQUID) {
      pgen++;
      let h = 0, t = 0;
      pq[t++] = front; pseen[front] = pgen; pseen[c] = pgen; pseen[back] = pgen;
      while (h < t && t < 600 && dst < 0) {
        const p = pq[h++], x = p % W, y = (p / W) | 0;
        for (let q = 0; q < 4; q++) {
          if ((q === 0 && x === 0) || (q === 1 && x === W - 1) || (q === 2 && y === 0) || (q === 3 && y === H - 1)) continue;
          const n = p + NB[q];
          if (pseen[n] === pgen || fan[n] === PUMP) continue;
          pseen[n] = pgen;
          if (st[n] === NONE || st[n] === GAS) { dst = n; break; }
          if (st[n] === LIQUID) pq[t++] = n;
        }
      }
    }
    if (dst < 0) return;                      // nowhere for it to go: the pipe ahead is full and closed
    swap(src, dst);
    stamp[src] = cur; stamp[dst] = cur;
  }
}
// A live electrode splits a liquid compound touching it back into its elements: water into hydrogen and
// oxygen, molten salt into sodium and chlorine, an acid into hydrogen and the halogen.
function electrolyse(c) {
  const x = c % W, y = (c / W) | 0;
  for (let k = -1; k < 4; k++) {
    let n = c;
    if (k >= 0) {
      if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
      n = c + NB[k];
    }
    if (st[n] !== LIQUID || Math.random() > 0.01) continue;
    const t = type[n];
    let A = 0, B = 0;
    if (ACID_X[t]) { A = HYD; B = ACID_X[t]; }
    else if (CPDI[t]) { A = CPDI[t].A; B = CPDI[t].B; }
    else continue;
    // each split gives off one of the two elements, in the proportions of the formula (water: two hydrogens to one oxygen)
    const T = temp[n], info = CPDI[t];
    const r = ACID_X[t] ? 1 : info.ratio, pA = 1 / (1 + r);
    swapTo(n, Math.random() < pA ? A : B, T);
    if (st[n] === GAS) P[n] = P0;
    return;
  }
}
function electric() {
  egen++;
  // An inverter powers what is in front of it whenever what is behind it was not powered a moment ago.
  // (It reads the moment before, so one fed from its own output flips every frame.)
  invSeed.length = 0;
  for (let i = 0; i < N; i++) {
    if (fan[i] === INVERTER) {
      const d = DIR_STEP[ddir[i] || 1], back = i - d, front = i + d;
      // (a cell before this one has already been counted down from 5 this frame)
      if (back >= 0 && front >= 0 && back < N && front < N && lit[back] < (back < i ? 4 : 5) && fan[front] >= CONTACT && fan[front] !== INVERTER) invSeed.push(front);
    }
    if (lit[i]) lit[i]--;
  }
  for (let q = 0; q < N + invSeed.length; q++) {
    const i = q < N ? q : invSeed[q - N];
    if (eseen[i] === egen) continue;
    const f = fan[i];
    if (q < N && !((f === CONTACT && st[i] === PART) || (f === SWITCH && dset[i] > 0) || (f >= SENSE_T && f <= SENSE_C && sensed(i)))) continue;
    let head = 0, tail = 0, out = -1;
    injSrc.length = 0; injSeed.length = 0;
    eq[tail++] = i; eseen[i] = egen;
    while (head < tail) {
      const c = eq[head++], x = c % W, y = (c / W) | 0;
      lit[c] = 5;
      if (fan[c] === PLUG) spark(c);
      else if (fan[c] === HEATER) { const target = dset[c] * 10; temp[c] += (target - temp[c]) * 0.5; }   // holds whatever it is in at its setting, heating or cooling
      else if (fan[c] === SWITCH && dset[c] === 0) continue;   // an open switch passes nothing on
      else if (fan[c] >= SENSE_T && fan[c] <= SENSE_C && !sensed(c)) continue;   // nor does a sensor that is not tripped
      else if (fan[c] === INVERTER) continue;                  // an inverter's two sides are separate circuits
      else if (fan[c] === PUMP) pumpOn.push(c);
      else if (fan[c] === ELECTRODE) electrolyse(c);
      else if (fan[c] === INJECTOR) {
        if (st[c] === NONE || st[c] === GAS) {
          // only the open end of the line sprays, not a stretch of it that happens to cross open air
          let links = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if ((dx || dy) && nx >= 0 && nx < W && ny >= 0 && ny < H && fan[ny * W + nx] === INJECTOR) links++;
          }
          if (links <= 1) out = c;
        }
        for (let k = 0; k < 4; k++) {
          if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
          const n = c + NB[k];
          if ((st[n] === LIQUID || st[n] === GAS) && type[n] !== FIRE && fan[n] !== INJECTOR) injSrc.push(n);
          else if (st[n] === NONE && fan[n] !== INJECTOR) injSeed.push(n);
        }
      }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const n = ny * W + nx;
        if (eseen[n] !== egen && fan[n] >= CONTACT && fan[n] !== INVERTER) { eseen[n] = egen; eq[tail++] = n; }
      }
    }
    if (out >= 0 && injSrc.length) {
      // nothing is drawn from right by the nozzle: that is where the spray goes, not the tank
      const ox = out % W, oy = (out / W) | 0;
      for (let k = injSrc.length - 1; k >= 0; k--) { const c = injSrc[k]; if (Math.abs(c % W - ox) <= 3 && Math.abs(((c / W) | 0) - oy) <= 3) injSrc.splice(k, 1); }
      reachGas(ox, oy);
      inject(out, dset[out]);
    }
  }
  for (const c of pumpOn) pump(c);
  pumpOn.length = 0;
  // Valves are solid wall while unpowered and open while powered.
  for (let i = W; i < N - W; i++) {
    if (fan[i] !== VALVE) continue;
    const on = eseen[i] === egen && dset[i] > 0;
    if (on) gate[i] = valveGate(dset[i]);
    if (on && st[i] === STATIC && type[i] === WALL) {
      let p = 0, t = 0, o = 0, n = 0;
      for (let k = 0; k < 4; k++) { const j = i + NB[k]; if (st[j] === NONE) { p += P[j]; t += temp[j]; o += ox[j]; n++; } }
      type[i] = 0; st[i] = NONE; life[i] = 0; aux[i] = 0; lat[i] = 0;
      if (n) { P[i] = p / n; temp[i] = t / n; ox[i] = o / n; } else { P[i] = P0; ox[i] = 1; }
      groundDirty = true;
    } else if (!on && (st[i] === NONE || st[i] === GAS)) {
      // shutting: whatever gas was in the opening is pushed into the neighbour with the least pressure
      let j = -1;
      for (let k = 0; k < 4; k++) { const n = i + NB[k]; if ((st[n] === NONE || st[n] === GAS) && fan[n] !== VALVE && (j < 0 || P[n] < P[j])) j = n; }
      if (j >= 0) P[j] += P[i];
      type[i] = WALL; st[i] = STATIC; P[i] = 0; life[i] = 0; aux[i] = 0; lat[i] = 0; gate[i] = 1;
      groundDirty = true;
    }
  }
}

// ---------- neutrons ----------
// Neutrons are not cells: they fly straight through the grid and only sometimes hit what they cross.
const MAXN = 6000, FIS_HEAT = 80;
const nX = new Float32Array(MAXN), nY = new Float32Array(MAXN), nDX = new Float32Array(MAXN), nDY = new Float32Array(MAXN);
const nFast = new Uint8Array(MAXN), nLife = new Uint16Array(MAXN);
let nCount = 0;

function emit(x, y, fast) {
  if (nCount >= MAXN) return;
  const a = Math.random() * 6.2832, n = nCount++;
  nX[n] = x + 0.5; nY[n] = y + 0.5; nDX[n] = Math.cos(a); nDY[n] = Math.sin(a);
  nFast[n] = fast ? 1 : 0; nLife[n] = 900;
}

function fission(i, x, y, t, s) {
  temp[i] += FIS_HEAT;
  let k = NUV[t] | 0;
  if (Math.random() < NUV[t] - k) k++;
  for (; k > 0; k--) emit(x, y, true);
  if (s !== PART && Math.random() < 0.003) {
    // the split atom is now fission waste
    type[i] = WASTE; life[i] = 0;
    const ns = s === GAS ? GAS : stateAt(MATS[WASTE], temp[i]);
    if (ns !== s && (ns === STATIC || s === STATIC)) groundDirty = true;
    st[i] = ns;
  }
}

function stepNeutrons() {
  for (let n = nCount - 1; n >= 0; n--) {
    let alive = --nLife[n] > 0;
    for (let q = nFast[n] ? 2 : 1; q > 0 && alive; q--) {
      const ox = nX[n] | 0, oy = nY[n] | 0;
      nX[n] += nDX[n]; nY[n] += nDY[n];
      const x = Math.floor(nX[n]), y = Math.floor(nY[n]);
      if (x < 0 || x >= W || y < 0 || y >= H) { alive = false; break; }
      if (x === ox && y === oy) continue;
      const i = y * W + x, s = st[i];
      if (s === NONE) continue;
      const t = type[i], thin = s === GAS ? 0.02 : 1, fast = nFast[n];
      // hot fuel is a little less willing to fission
      const pf = (fast ? FISF[t] : FIST[t]) * thin / (1 + temp[i] / 800);
      if (pf > 0 && Math.random() < pf) { fission(i, x, y, t, s); alive = false; break; }
      const pa = (fast ? ABSF[t] : ABST[t]) * thin;
      if (pa > 0 && Math.random() < pa) {
        if (BREED[t] && s !== PART) {
          type[i] = BREED[t];
          const ns = stateAt(MATS[BREED[t]], temp[i]);
          if (ns !== s && (ns === STATIC || s === STATIC)) groundDirty = true;
          st[i] = ns;
        }
        alive = false; break;
      }
      if (Math.random() < SCAT[t] * thin) {
        const a = Math.random() * 6.2832;
        nDX[n] = Math.cos(a); nDY[n] = Math.sin(a);
        if (fast && Math.random() < MODV[t]) nFast[n] = 0;
      }
    }
    if (!alive) {
      const l = --nCount;
      nX[n] = nX[l]; nY[n] = nY[l]; nDX[n] = nDX[l]; nDY[n] = nDY[l]; nFast[n] = nFast[l]; nLife[n] = nLife[l];
    }
  }
}

// Decay heat, spontaneous fission and decay into the next element down the chain.
// Returns true if the cell changed into something else.
function radiate(i, x, y, t, s) {
  const m = MATS[t];
  if (m.warm) temp[i] += m.warm;
  if (SFV[t] && Math.random() < SFV[t]) { temp[i] += FIS_HEAT; emit(x, y, true); emit(x, y, true); }
  const d = m.decay;
  if (!d || s === PART || Math.random() > d.p) return false;
  const to = d.into[d.into.length === 1 ? 0 : (Math.random() * d.into.length) | 0];
  type[i] = to; life[i] = 0; aux[i] = 0;
  temp[i] += d.q;
  const ns = stateAt(MATS[to], temp[i]);
  if (ns === STATIC || s === STATIC) groundDirty = true;
  st[i] = ns; stamp[i] = cur;
  if (d.alpha && Math.random() < 0.25) {
    // the alpha particle it threw off is a helium nucleus
    const j = y > 0 && st[i - W] === NONE ? i - W : x > 0 && st[i - 1] === NONE ? i - 1 : x < W - 1 && st[i + 1] === NONE ? i + 1 : -1;
    if (j >= 0) { type[j] = HE; st[j] = GAS; temp[j] = temp[i]; life[j] = 0; aux[j] = 0; stamp[j] = cur; }
  }
  return true;
}

function updateCell(i, x, y) {
  const t = type[i], m = MATS[t];
  let s = st[i];

  if (t === FIRE) {
    if (--life[i] <= 0) {
      const a = aux[i];
      aux[i] = 0; life[i] = 0;
      if (a === NOTHING) { type[i] = 0; st[i] = NONE; }
      else if (a) { type[i] = a; st[i] = stateAt(MATS[a], temp[i]); if (st[i] === STATIC) groundDirty = true; }
      else if (Math.random() < 0.35) { type[i] = SMOKE; life[i] = 60 + (Math.random() * 90 | 0); }
      else { type[i] = 0; st[i] = NONE; }
      return;
    }
    // An open flame (a torch, burning coal) is fed from outside and holds its temperature. The flame left by
    // fuel burning its air is just hot gas: it cools as it gives up heat, and its pressure falls with it.
    if (aux[i] !== NOTHING) { if (temp[i] < 1100) temp[i] = 1100; P[i] += FIRE_P; }
    let fed = false;
    const flameT = temp[i];
    // only an open flame feeds on oxygen; the flash of a reaction or of burnt fuel has nothing left to burn
    if (aux[i] === NOTHING) {
      if (x > 0) fireTouchLit(i - 1, flameT);
      if (x < W - 1) fireTouchLit(i + 1, flameT);
      if (y > 0) fireTouchLit(i - W, flameT);
      if (y < H - 1) fireTouchLit(i + W, flameT);
    } else {
      if (x > 0 && fireTouch(i - 1, flameT)) fed = true;
      if (x < W - 1 && fireTouch(i + 1, flameT)) fed = true;
      if (y > 0 && fireTouch(i - W, flameT)) fed = true;
      if (y < H - 1 && fireTouch(i + W, flameT)) fed = true;
    }
    if (fed) {
      // a flame fed with oxygen burns hotter and longer
      temp[i] = Math.min(2800, temp[i] + 500);
      if (life[i] < 40) life[i] += 5;
    }
  } else if (t === SMOKE) {
    if (--life[i] <= 0) { clearCell(i); return; }
  } else {
    if (RAD[t] && radiate(i, x, y, t, s)) return;
    const T = temp[i];
    if (m.fades && s === GAS && Math.random() < m.fades) {
      // a wisp out in the open air thins away to nothing
      let airy = 0;
      // (only real air thins it: in a sealed still or tank there is nothing to thin it into)
      if (x > 0 && st[i - 1] === NONE && ox[i - 1] > 0.3) airy++;
      if (x < W - 1 && st[i + 1] === NONE && ox[i + 1] > 0.3) airy++;
      if (y > 0 && st[i - W] === NONE && ox[i - W] > 0.3) airy++;
      if (y < H - 1 && st[i + W] === NONE && ox[i + W] > 0.3) airy++;
      if (airy >= 3) { clearCell(i); return; }
    }
    if (t === CRUDE && s === LIQUID && distill(i, x, y)) return;
    if (m.vapor && s === GAS && condense(i, x, y, t, m)) return;
    if (m.vapor && s === LIQUID && Math.random() < 0.15 && pool(i, x, y, t, m)) return;
    if (s === LIQUID && m.vapor && y > 0 && Math.random() < 0.004 * (1 + (T > 20 ? (T - 20) / 25 : 0))) {
      // the surface gives off vapour, faster when warm, until the air right above it is full of it
      // (into open air: in a sealed tank or still the space above soon holds all the vapour it can)
      const a = st[i - W] === NONE ? i - W : x > 0 && st[i - 1] === NONE ? i - 1 : x < W - 1 && st[i + 1] === NONE ? i + 1 : -1;
      if (a >= 0 && ox[a] > 0.3) {
        type[a] = t; st[a] = GAS; life[a] = 1; aux[a] = 0; lat[a] = 0; temp[a] = T; stamp[a] = cur;
        if (++life[i] >= m.burn.units) { clearCell(i); return; }
      }
    }
    if (T > IGN[t]) {
      if (m.burn.fast) { if (burn(i)) return; }
      else if (smolder(i, x, y, m)) return;
    } else if (m.burn && m.burn.fast && s !== GAS && y > 1 && !SOL[st[i - W]] && st[i - W] !== LIQUID && !SOL[st[i - 2 * W]] && (temp[i - W] > IGN[t] || temp[i - 2 * W] > IGN[t]) && Math.random() < 0.5) {
      // air hot enough to light it, as in a diesel: the fuel does not have to boil first
      if (burn(i)) return;
    }
    if (m.wet && s !== GAS && wetReact(i, x, y, m)) return;
    if (RX[t] && react(i, x, y, t, s)) return;
    if (CHEMV[t] && chemReact(i, x, y, t)) return;
    if ((CPDI[t] || ACID_X[t]) && cpdReact(i, x, y, t)) return;
    if (CPDI[t] && chemCompound(i, x, y, t, CPDI[t])) return;
    const ns = phase(i, t, s);
    if (ns !== s) {
      if (m.vapor && s === LIQUID && ns === GAS) life[i] = m.burn.units - life[i];   // the vapour carries what fuel was left
      st[i] = ns; stamp[i] = cur; aux[i] = 0;
      if (ns === STATIC) { groundDirty = true; return; }
    }
  }

  s = st[i];
  const gas = s === GAS;

  // The flow that evened out the pressure last frame carries loose material with it.
  // Gas goes all the way along; liquid and powder are dragged a fraction as far.
  {
    const p = P[i] > 0.3 ? P[i] : 0.3;
    const k = (gas ? 0.5 : s === POWDER ? 0.08 : 0.4) / p;
    const vx = ((x > 0 ? FX[i - 1] : 0) + FX[i]) * k;
    const vy = ((y > 0 ? FY[i - W] : 0) + FY[i]) * k;
    const ax = vx < 0 ? -vx : vx, ay = vy < 0 ? -vy : vy, sp = ax + ay;
    if (sp > 0.02) {
      let n = sp | 0;
      if (Math.random() < sp - n) n++;
      if (n > 8) n = 8;
      const px = ax / sp, sx = vx > 0 ? 1 : -1, sy = vy > 0 ? 1 : -1;
      let j = i, cx = x, cy = y, moved = false;
      for (; n > 0; n--) {
        const alongX = Math.random() < px;
        const dx = alongX ? sx : 0, dy = alongX ? 0 : sy;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) break;
        const d = dx + dy * W;
        // find room ahead: gas in the way is shoved along in front, up to a few cells
        let e = j + d, ex = nx, ey = ny, room = false;
        for (let c = 0, reach = gas ? 12 : 4; c < reach; c++) {
          const se = st[e];
          if (se === NONE) { room = true; break; }
          if (se !== GAS) break;
          ex += dx; ey += dy;
          if (ex < 0 || ex >= W || ey < 0 || ey >= H) break;
          e += d;
        }
        if (!room || (s === LIQUID && backflow(j, j + d))) continue;
        for (let q = e; q !== j; q -= d) swap(q, q - d);
        j += d; cx = nx; cy = ny; moved = true;
      }
      if (moved) return;
    }
  }

  // ordinary movement
  if (s === POWDER) {
    if (y >= H - 1) return;
    const d = i + W, sd = st[d];
    if (sd === NONE || sd === GAS || (sd === LIQUID && DENS[t] > DENS[type[d]] && Math.random() < 0.6)) { swap(i, d); return; }
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (let k = 0; k < 2; k++) {
      const q = k ? -dir : dir, nx = x + q;
      if (nx < 0 || nx >= W || SOL[st[i + q]]) continue;
      const sj = st[d + q];
      if (sj === NONE || sj === GAS || (sj === LIQUID && DENS[t] > DENS[type[d + q]] && Math.random() < 0.4)) { swap(i, d + q); return; }
    }
  } else if (s === LIQUID) {
    if (y < H - 1) {
      const d = i + W, sd = st[d];
      if ((sd === NONE || sd === GAS || (sd === LIQUID && DENS[t] > DENS[type[d]] + 0.01 && Math.random() < 0.5)) && !backflow(i, d)) { swap(i, d); return; }
      const dir = Math.random() < 0.5 ? -1 : 1;
      for (let k = 0; k < 2; k++) {
        const q = k ? -dir : dir, nx = x + q;
        if (nx < 0 || nx >= W || SOL[st[i + q]]) continue;
        const sj = st[d + q];
        if ((sj === NONE || sj === GAS) && !backflow(i, d + q)) { swap(i, d + q); return; }
      }
    }
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (let k = 0; k < 2; k++) {
      const q = k ? -dir : dir;
      let j = i, cx = x, moved = false;
      for (let n = 0; n < 3; n++) {
        const nx = cx + q;
        if (nx < 0 || nx >= W) break;
        const sj = st[j + q];
        if ((sj !== NONE && sj !== GAS) || backflow(j, j + q)) break;
        swap(j, j + q); j += q; cx = nx; moved = true;
      }
      if (moved) return;
    }
  } else {
    // gases: light or hot ones rise, heavy ones sink, the rest wander
    // different gases also mix into each other where they meet, so a light one does not just sit on a heavy one
    if (t !== FIRE && Math.random() < 0.2) {
      const k = (Math.random() * 4) | 0;
      if (!((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1))) {
        const n = i + NB[k];
        if (st[n] === GAS && type[n] !== t && type[n] !== FIRE && stamp[n] !== cur) { swap(i, n); return; }
      }
    }
    const r = Math.random();
    const side = Math.random() < 0.5 ? -1 : 1;
    const lift = temp[i] > 120 ? 1 : LIFT[t];      // hot gas rises whatever it is
    const up = t === FIRE ? 0.6 : lift > 0 ? 0.45 : lift < 0 ? 0.1 : 0.25;
    const dn = lift > 0 ? 0 : lift < 0 ? 0.45 : 0.25;
    if (r < up) {
      if (y > 0) {
        const sj = st[i - W];
        if (sj === NONE || sj === LIQUID) swap(i, i - W);
        // hot gas rises through cooler gas packed above it
        else if (sj === GAS && lift > 0 && temp[i] > temp[i - W] + 5 && type[i - W] !== FIRE && stamp[i - W] !== cur) swap(i, i - W);
      }
    } else if (r < up + dn) {
      if (y < H - 1 && st[i + W] === NONE) swap(i, i + W);
    } else if (lift > 0 && r < up + dn + 0.3) {
      const nx = x + side;
      if (y > 0 && nx >= 0 && nx < W && !SOL[st[i + side]] && st[i - W + side] === NONE) swap(i, i - W + side);
    } else {
      const nx = x + side;
      if (nx >= 0 && nx < W && st[i + side] === NONE) swap(i, i + side);
    }
  }
}

// ---------- pressure ----------
// Implicit diffusion along one run of open cells. Stable for any KFLOW, so pressure
// can cross a whole chamber in one frame while still only passing through real openings.
const poBuf = new Float64Array(Math.max(W, H)), oxBuf = new Float64Array(Math.max(W, H));
function solveRun(start, stride, n, x, y, sx, sy, F, HD) {
  for (let k = 0; k < n; k++) { const idx = start + k * stride; oxBuf[k] = ox[idx]; poBuf[k] = P[idx] * pcap[idx]; }
  // kf[k] is how easily flow passes between cell k and cell k + 1 of the run
  for (let k = 0; k < n - 1; k++) {
    const idx = start + k * stride;
    const g = gate[idx] < gate[idx + stride] ? gate[idx] : gate[idx + stride];
    kfBuf[k] = (st[idx] === LIQUID || st[idx + stride] === LIQUID ? KLIQ : KFLOW) * g;
  }
  for (let k = 0; k < n; k++) {
    const cx = x + sx * k, cy = y + sy * k;
    let a, b, c, d;
    if (cx === 0 || cx === W - 1 || cy === 0 || cy === H - 1) { a = 0; b = 1; c = 0; d = P0; }
    else {
      const idx = start + k * stride, q = pcap[idx];
      a = k > 0 ? -kfBuf[k - 1] : 0; c = k < n - 1 ? -kfBuf[k] : 0; b = q - a - c;
      // what the flow already under way carries out of this cell, less what it carries in
      d = q * P[idx] - (F[idx] - (k > 0 ? F[idx - stride] : 0));
      // a fan across a face acts like an extra pressure difference there
      if (k < n - 1) d -= kfBuf[k] * HD[idx];
      if (k > 0) d += kfBuf[k - 1] * HD[idx - stride];
    }
    if (k === 0) { cpBuf[0] = c / b; dpBuf[0] = d / b; }
    else { const m = b - a * cpBuf[k - 1]; cpBuf[k] = c / m; dpBuf[k] = (d - a * dpBuf[k - 1]) / m; }
  }
  let v = dpBuf[n - 1];
  P[start + (n - 1) * stride] = v;
  for (let k = n - 2; k >= 0; k--) {
    const nv = dpBuf[k] - cpBuf[k] * v;
    F[start + k * stride] += kfBuf[k] * (nv - v + HD[start + k * stride]);  // the pressure difference (and any fan) speeds the flow up or slows it down
    v = nv;
    P[start + k * stride] = v;
  }
  // Fresh and burnt gas travel with the flow. Each cell ends up as a mix of what it held and what flowed in
  // (worked out implicitly, so fast flow through small cells cannot overshoot): one pass along the run
  // settles everything carried rightwards, a second pass back settles everything carried leftwards.
  let moving = false, mix = false;
  for (let k = 0; k < n - 1; k++) {
    const f = F[start + k * stride];
    if (f > 1e-3 || f < -1e-3) { moving = true; if (oxBuf[k] !== oxBuf[k + 1]) { mix = true; break; } }
  }
  if (!moving || !mix) return;          // nothing flowing, or all the same air: nothing changes
  for (let pass = 0; pass < 2; pass++) {
    for (let q = 0; q < n; q++) {
      const k = pass ? n - 1 - q : q, idx = start + k * stride;
      const fl = k > 0 ? F[idx - stride] : 0, fr = k < n - 1 ? F[idx] : 0;
      let m = poBuf[k], acc = m * oxBuf[k];
      if (fl > 0) { m += fl; acc += fl * ox[idx - stride]; }
      if (fr < 0) { m -= fr; acc -= fr * ox[idx + stride]; }
      if (m > 1e-6) ox[idx] = acc / m;
    }
  }
}
function flowRows() {
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let x = 0;
    while (x < W) {
      if (!open[row + x]) { x++; continue; }
      let e = x; while (e + 1 < W && open[row + e + 1]) e++;
      solveRun(row + x, 1, e - x + 1, x, y, 1, 0, FX, HDX);
      x = e + 1;
    }
  }
}
function flowCols() {
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!open[y * W + x]) { y++; continue; }
      let e = y; while (e + 1 < H && open[(e + 1) * W + x]) e++;
      solveRun(y * W + x, W, e - y + 1, x, y, 0, 1, FY, HDY);
      y = e + 1;
    }
  }
}

// Flow has momentum. Each frame the moving gas carries its own motion along with it (so a jet keeps
// going and fast flow through a narrowing drops in pressure), loses a little to drag, and is zeroed
// wherever a wall or part is in the way. Fans add to it.
function carryFlow() {
  for (let y = 0; y < H; y++) {
    const edgeY = y === 0 || y === H - 1;
    let i = y * W;
    for (let x = 0; x < W; x++, i++) {
      const oi = open[i];
      // right face, between i and i + 1
      if (!oi || x === W - 1 || !open[i + 1]) GX[i] = 0;
      else {
        let g = FX[i];
        const si = st[i], sj = st[i + 1];
        const keep = si === LIQUID || sj === LIQUID ? KEEP_LIQUID : si === POWDER || sj === POWDER ? KEEP_POWDER : KEEP_GAS;
        if (!edgeY && x > 0 && x < W - 2) {
          const pf = 0.5 * (P[i] + P[i + 1]), inv = 1 / (pf > 0.3 ? pf : 0.3);
          let ux = g * inv, uy = 0.25 * (FY[i] + FY[i + 1] + FY[i - W] + FY[i + 1 - W]) * inv;
          if (ux > 0.02 || ux < -0.02 || uy > 0.02 || uy < -0.02) {
            ux = ux > 12 ? 12 : ux < -12 ? -12 : ux; uy = uy > 12 ? 12 : uy < -12 ? -12 : uy;
            let sx = x - ux, sy = y - uy;
            sx = sx < 0 ? 0 : sx > W - 2.001 ? W - 2.001 : sx; sy = sy < 0 ? 0 : sy > H - 1.001 ? H - 1.001 : sy;
            const x0 = sx | 0, y0 = sy | 0, tx = sx - x0, ty = sy - y0, j = y0 * W + x0;
            g = (FX[j] * (1 - tx) + FX[j + 1] * tx) * (1 - ty) + (FX[j + W] * (1 - tx) + FX[j + W + 1] * tx) * ty;
          }
        }
        GX[i] = g * keep * (gate[i] < gate[i + 1] ? gate[i] : gate[i + 1]);
      }
      // bottom face, between i and i + W
      if (!oi || y === H - 1 || !open[i + W]) GY[i] = 0;
      else {
        let g = FY[i];
        const si = st[i], sj = st[i + W];
        const keep = si === LIQUID || sj === LIQUID ? KEEP_LIQUID : si === POWDER || sj === POWDER ? KEEP_POWDER : KEEP_GAS;
        if (y > 0 && y < H - 2 && x > 0 && x < W - 1) {
          const pf = 0.5 * (P[i] + P[i + W]), inv = 1 / (pf > 0.3 ? pf : 0.3);
          let uy = g * inv, ux = 0.25 * (FX[i] + FX[i - 1] + FX[i + W] + FX[i + W - 1]) * inv;
          if (ux > 0.02 || ux < -0.02 || uy > 0.02 || uy < -0.02) {
            ux = ux > 12 ? 12 : ux < -12 ? -12 : ux; uy = uy > 12 ? 12 : uy < -12 ? -12 : uy;
            let sx = x - ux, sy = y - uy;
            sx = sx < 0 ? 0 : sx > W - 1.001 ? W - 1.001 : sx; sy = sy < 0 ? 0 : sy > H - 2.001 ? H - 2.001 : sy;
            const x0 = sx | 0, y0 = sy | 0, tx = sx - x0, ty = sy - y0, j = y0 * W + x0;
            g = (FY[j] * (1 - tx) + FY[j + 1] * tx) * (1 - ty) + (FY[j + W] * (1 - tx) + FY[j + W + 1] * tx) * ty;
          }
        }
        GY[i] = g * keep * (gate[i] < gate[i + W] ? gate[i] : gate[i + W]);
      }
    }
  }
  let t = FX; FX = GX; GX = t;
  t = FY; FY = GY; GY = t;
  // Fans: a pressure jump across the face in front of each fan cell, fading out as the flow through it
  // nears the fan's top speed.
  for (const k of headFaces) { HDX[k] = 0; HDY[k] = 0; }
  headFaces.length = 0;
  for (let i = 0; i < N; i++) {
    const f = fan[i];
    if (!f || f > 4 || !open[i]) continue;
    const x = i % W, top = FAN_TOP * (P[i] > 0.3 ? P[i] : 0.3);
    let k = -1, sgn = 1, F = FX;
    if (f === 1) { if (x < W - 1 && open[i + 1]) k = i; }
    else if (f === 2) { if (x > 0 && open[i - 1]) { k = i - 1; sgn = -1; } }
    else if (f === 3) { if (i >= W && open[i - W]) { k = i - W; sgn = -1; F = FY; } }
    else if (i < N - W && open[i + W]) { k = i; F = FY; }
    if (k < 0) continue;
    const r = 1 - sgn * F[k] / top, h = FAN_HEAD * (r < 0 ? 0 : r > 1 ? 1 : r);
    if (F === FX) HDX[k] += sgn * h; else HDY[k] += sgn * h;
    headFaces.push(k);
  }
}
function diffusePressure() {
  stocked.length = 0;
  for (let i = 0; i < N; i++) {
    const s = st[i];
    open[i] = SOL[s] ? 0 : 1;
    pcap[i] = s === LIQUID ? LIQCAP : 1;
    smooth[i] = open[i] && s !== LIQUID ? 1 : 0;
    if (s === LIQUID && aux[i]) stocked.push(i);
  }
  carryFlow();
  // Several rounds a frame. Each round can only pass a corner's worth of gas round a bend,
  // so one round alone throttles ports and passages far too much.
  for (let r = 0; r < FLOW_ROUNDS; r++) { if ((tick + r) & 1) { flowRows(); flowCols(); } else { flowCols(); flowRows(); } }
  for (let it = 0; it < P_ITERS; it++) {
    for (let y = 1; y < H - 1; y++) {
      let i = y * W + 1;
      for (let x = 1; x < W - 1; x++, i++) {
        const p = P[i];
        if (!smooth[i]) { P2[i] = p; continue; }
        let acc = 0;
        if (smooth[i - 1]) acc += P[i - 1] - p;
        if (smooth[i + 1]) acc += P[i + 1] - p;
        if (smooth[i - W]) acc += P[i - W] - p;
        if (smooth[i + W]) acc += P[i + W] - p;
        P2[i] = p + DIFF * acc;
      }
    }
    // the border of the world is open air
    for (let x = 0; x < W; x++) { P2[x] = P0; P2[(H - 1) * W + x] = P0; }
    for (let y = 0; y < H; y++) { P2[y * W] = P0; P2[y * W + W - 1] = P0; }
    const t = P; P = P2; P2 = t;
  }
  // Gas that was squeezed this frame gets hotter, gas that expanded gets colder (adiabatic change).
  for (let i = 0; i < N; i++) {
    if (!open[i]) continue;
    let p = P[i];
    p = p > 200 ? 200 : p < 0 ? 0 : p;
    P[i] = p;
    const s = st[i], was = Pref[i];
    if ((s === NONE || s === GAS) && (type[i] !== FIRE || aux[i] === NOTHING) && was > 0.05 && p > 0.05) {
      let r = p / was;
      if (r > 1.0002 || r < 0.9998) {
        if (r > 2) r = 2; else if (r < 0.5) r = 0.5;
        const d = r - 1;
        const f = d < 0.03 && d > -0.03 ? 1 + KAPPA * d : Math.pow(r, KAPPA);
        const tk = (temp[i] + 273.15) * f - 273.15;
        temp[i] = tk > 6000 ? 6000 : tk;
      }
    }
    Pref[i] = p;
  }
}

// Liquid that a part pushes into with nowhere to go is squeezed into the liquid next to it.
// Each frame that squeezed-in liquid comes back out wherever the same body of liquid has room:
// the far end of a pipe, the other arm of a U-tube, the surface of a pool, the gap under a piston
// that has moved. What cannot get out raises the pressure of the whole trapped body evenly
// (Pascal's law), and that pressure pushes on every part the liquid touches.
const bq = new Int32Array(N), bseen = new Uint32Array(N), spots = new Int32Array(256);
let bgen = 0;
function liquidPressure() {
  for (const i of lpCells) LP[i] = 0;
  lpCells = [];
  bgen++;
  for (const i0 of stocked) {
    if (bseen[i0] === bgen || st[i0] !== LIQUID) continue;
    let head = 0, tail = 0, nSpots = 0, stock = 0;
    bq[tail++] = i0; bseen[i0] = bgen;
    while (head < tail) {
      const i = bq[head++], x = i % W, y = (i / W) | 0;
      stock += aux[i];
      for (let k = 0; k < 4; k++) {
        if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
        const j = i + NB[k];
        if (bseen[j] === bgen) continue;
        bseen[j] = bgen;
        const s = st[j];
        if (s === LIQUID) bq[tail++] = j;
        else if (s === NONE && nSpots < 256) spots[nSpots++] = j;
      }
    }
    // let it back out into free space, nearest first
    let q = 0;
    for (let h = 0; h < tail && q < nSpots && stock > 0; h++) {
      const i = bq[h];
      while (aux[i] > 0 && q < nSpots) {
        const j = spots[q++];
        type[j] = type[i]; st[j] = LIQUID; temp[j] = temp[i]; life[j] = 0; aux[j] = 0; lat[j] = lat[i]; stamp[j] = cur;
        aux[i]--; stock--;
      }
    }
    if (stock > 0) {
      const extra = Math.min(150, BULK * stock / tail);
      for (let h = 0; h < tail; h++) { LP[bq[h]] = extra; lpCells.push(bq[h]); }
    }
  }
}

// Moving air takes its temperature with it: each cell of air becomes whatever air the flow
// brought there this frame.
function advectAir() {
  let any = false;
  for (let y = 1; y < H - 1; y++) {
    let i = y * W + 1;
    for (let x = 1; x < W - 1; x++, i++) {
      if (st[i] !== NONE) continue;
      const inv = 0.5 / (P[i] > 0.3 ? P[i] : 0.3);
      let ux = (FX[i - 1] + FX[i]) * inv, uy = (FY[i - W] + FY[i]) * inv;
      if (ux < 0.05 && ux > -0.05 && uy < 0.05 && uy > -0.05) continue;
      if (!any) { temp2.set(temp); any = true; }
      ux = ux > 8 ? 8 : ux < -8 ? -8 : ux; uy = uy > 8 ? 8 : uy < -8 ? -8 : uy;
      // where this air was a frame ago; the random part makes slow drifts add up correctly over time
      const sx = Math.floor(x + 0.5 - ux + Math.random() - 0.5), sy = Math.floor(y + 0.5 - uy + Math.random() - 0.5);
      if (sx < 0 || sx >= W || sy < 0 || sy >= H) { temp[i] = AMBIENT; continue; }
      const j = sy * W + sx;
      // only air swaps with air: smoke and steam carry their own heat as they move
      if (j !== i && st[j] === NONE) temp[i] = temp2[j];
    }
  }
  // burnt gas and fresh air mix where they meet, and the edge of the bench is always fresh
  for (let y = 1; y < H - 1; y++) {
    let i = y * W + 1;
    for (let x = 1; x < W - 1; x++, i++) {
      if (st[i] !== NONE) continue;
      let sum = 0, n = 0;
      if (st[i - 1] === NONE) { sum += ox[i - 1]; n++; }
      if (st[i + 1] === NONE) { sum += ox[i + 1]; n++; }
      if (st[i - W] === NONE) { sum += ox[i - W]; n++; }
      if (st[i + W] === NONE) { sum += ox[i + W]; n++; }
      if (n) ox[i] += 0.03 * (sum / n - ox[i]);
    }
  }
  for (let x = 0; x < W; x++) { ox[x] = 1; ox[(H - 1) * W + x] = 1; }
  for (let y = 0; y < H; y++) { ox[y * W] = 1; ox[y * W + W - 1] = 1; }
}

function diffuseHeat() {
  // Heat flows between neighbours at the rate the worse conductor allows, and each cell warms by
  // the energy it received divided by its own heat capacity.
  for (let i = 0; i < N; i++) {
    const s = st[i], t = type[i];
    const c = s === NONE || s === GAS ? CAPG : CAPS[t];
    const k = s === GAS ? (t === FIRE && aux[i] === NOTHING ? 0.01 : CONDG[t]) : CONDS[t];
    cpc[i] = c;
    cnd[i] = k < c / 4.5 ? k : c / 4.5;        // keeps the exchange stable for low-capacity cells
  }
  for (let y = 1; y < H - 1; y++) {
    let i = y * W + 1;
    for (let x = 1; x < W - 1; x++, i++) {
      const c = cnd[i], t0 = temp[i];
      let acc = 0, k;
      k = cnd[i - 1]; acc += (k < c ? k : c) * (temp[i - 1] - t0);
      k = cnd[i + 1]; acc += (k < c ? k : c) * (temp[i + 1] - t0);
      k = cnd[i - W]; acc += (k < c ? k : c) * (temp[i - W] - t0);
      k = cnd[i + W]; acc += (k < c ? k : c) * (temp[i + W] - t0);
      let t = t0 + acc / cpc[i];
      const s = st[i];
      if (s === NONE && ox[i] > 0.3) t += (AMBIENT - t) * AIR_COOL;   // (the gas sealed inside equipment has no room to lose its heat to)
      temp2[i] = t;
      // gas law: heating gas in place raises its pressure, cooling lowers it
      if ((s === NONE || s === GAS) && (type[i] !== FIRE || aux[i] === NOTHING) && t !== t0) {
        const f = (t + 273.15) / (t0 + 273.15);
        P[i] *= f; Pref[i] *= f;
      }
    }
  }
  for (let x = 0; x < W; x++) {
    let i = x; temp2[i] = temp[i] + (AMBIENT - temp[i]) * 0.1;
    i = (H - 1) * W + x; temp2[i] = temp[i] + (AMBIENT - temp[i]) * 0.1;
  }
  for (let y = 0; y < H; y++) {
    let i = y * W; temp2[i] = temp[i] + (AMBIENT - temp[i]) * 0.1;
    i = y * W + W - 1; temp2[i] = temp[i] + (AMBIENT - temp[i]) * 0.1;
  }
  const t = temp; temp = temp2; temp2 = t;
}

// ---------- rigid parts made of cells ----------
// Each part keeps its own grid of cells. Every frame it is lifted out of the world grid,
// moved by the physics engine, and stamped back in at its new position and angle.

function rectsOf(occ, w, h) {
  const used = new Uint8Array(w * h), out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (!occ[k] || used[k]) continue;
    let x1 = x;
    while (x1 + 1 < w && occ[y * w + x1 + 1] && !used[y * w + x1 + 1]) x1++;
    let y1 = y;
    grow: while (y1 + 1 < h) {
      for (let xx = x; xx <= x1; xx++) { const kk = (y1 + 1) * w + xx; if (!occ[kk] || used[kk]) break grow; }
      y1++;
    }
    for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) used[yy * w + xx] = 1;
    out.push([x, y, x1, y1]);
  }
  return out;
}

function addFixtures(b, occ, w, h, ox, oy, matId) {
  // iron is the reference weight; lighter and heavier metals scale from it
  const density = Math.max(0.05, Math.min(2.5, MATS[matId].dens / 7.87));
  for (const [x0, y0, x1, y1] of rectsOf(occ, w, h)) {
    const hx = (x1 - x0 + 1) / 2, hy = (y1 - y0 + 1) / 2;
    const lx = ox + x0 + hx, ly = oy + y0 + hy;
    // shrunk by the engine's contact skin, so a part that exactly fills a bore slides instead of snagging
    b.createFixture(planck.Box(hx * S - SKIN, hy * S - SKIN, planck.Vec2(lx * S, ly * S), 0), { density, friction: 0.15, restitution: 0.1 });
  }
}

function spawn(occ, temps, w, h, ox, oy, R, x, y, angle, matId, id, lats) {
  const b = world.createBody({ type: 'dynamic', position: planck.Vec2(x, y), angle, angularDamping: 0.01 });
  addFixtures(b, occ, w, h, ox, oy, matId);
  if (!id) { id = nextId++; if (nextId > 65000) nextId = 1; }
  const rb = { id, b, occ, temps, lats: lats || new Float32Array(w * h), w, h, ox, oy, R, mat: matId, foot: [], footK: [], old: [], lastPos: planck.Vec2(x, y), lastAngle: angle };
  bodies.set(id, rb);
  return rb;
}

function makeBody(cells, matId) {
  const list = cells.filter(i => st[i] !== STATIC && st[i] !== PART);
  if (!list.length) return null;
  let minX = W, minY = H, maxX = 0, maxY = 0, sx = 0, sy = 0;
  for (const i of list) {
    const x = i % W, y = (i / W) | 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    sx += x + 0.5; sy += y + 0.5;
  }
  const cx = sx / list.length, cy = sy / list.length;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const occ = new Uint8Array(w * h), temps = new Float32Array(w * h).fill(AMBIENT);
  for (const i of list) {
    const k = ((i / W | 0) - minY) * w + (i % W - minX);
    occ[k] = 1;
    if (st[i] === DRAFT || st[i] === NONE) temps[k] = temp[i];
  }
  const ox = minX - cx, oy = minY - cy;
  let R = 0;
  for (const [ax, ay] of [[ox, oy], [ox + w, oy], [ox, oy + h], [ox + w, oy + h]]) R = Math.max(R, Math.hypot(ax, ay));
  return spawn(occ, temps, w, h, ox, oy, R + 1, cx * S, cy * S, 0, matId);
}

function liftBody(rb) {
  const foot = rb.foot, footK = rb.footK;
  for (let k = 0; k < foot.length; k++) {
    const i = foot[k];
    if (st[i] === PART && bid[i] === rb.id) {
      rb.temps[footK[k]] = temp[i]; rb.lats[footK[k]] = lat[i];
      type[i] = 0; st[i] = NONE; bid[i] = 0; life[i] = 0; lat[i] = 0;
    }
  }
  foot.length = 0; footK.length = 0;
}

// Placing a part: first claim its new footprint, then find room nearby for whatever was
// there. Gas can always be squeezed out; powder and liquid need a free cell, and if there is
// none the move is refused, so packed sand and trapped water hold a part up.
const mark = new Uint32Array(N);
let gen = 0;
const fpI = [], fpK = [], moves = [];
function freeNear(x, y, ax, ay, claim) {
  let best = -1, bestScore = -1e9;
  for (let r = 1; r <= 3 && best < 0; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const j = ny * W + nx;
      if (st[j] !== NONE || mark[j] === gen) continue;
      const sc = dx * ax + dy * ay;
      if (sc > bestScore) { bestScore = sc; best = j; }
    }
  }
  if (best >= 0 && claim) mark[best] = gen;
  return best;
}

function placeBody(rb) {
  const pos = rb.b.getPosition(), a = rb.b.getAngle();
  const c = Math.cos(a), s = Math.sin(a);
  const px = pos.x / S, py = pos.y / S;
  const x0 = Math.max(0, Math.floor(px - rb.R)), x1 = Math.min(W - 1, Math.ceil(px + rb.R));
  const y0 = Math.max(0, Math.floor(py - rb.R)), y1 = Math.min(H - 1, Math.ceil(py + rb.R));
  const { occ, w, h, ox: offX, oy: offY } = rb;   // (offX/offY: where the part's grid sits; ox is the fresh-air field)
  gen++;
  fpI.length = 0; fpK.length = 0; moves.length = 0;
  for (let Y = y0; Y <= y1; Y++) {
    const dy = Y + 0.5 - py;
    for (let X = x0; X <= x1; X++) {
      const dx = X + 0.5 - px;
      const ix = Math.floor(c * dx + s * dy - offX), iy = Math.floor(-s * dx + c * dy - offY);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
      const k = iy * w + ix;
      if (!occ[k]) continue;
      const i = Y * W + X;
      if (SOL[st[i]]) continue;
      fpI.push(i); fpK.push(k); mark[i] = gen;
    }
  }
  for (let n = 0; n < fpI.length; n++) {
    const i = fpI[n], si = st[i];
    if (si === NONE) continue;
    const x = i % W, y = (i / W) | 0;
    let dst = freeNear(x, y, x + 0.5 - px, y + 0.5 - py, true);
    if (dst < 0 && si === LIQUID) {
      // no room nearby: squeeze it into a neighbouring cell of the same liquid (see liquidPressure)
      const t = type[i];
      for (let k = 0; k < 4 && dst < 0; k++) {
        if ((k === 0 && x === 0) || (k === 1 && x === W - 1) || (k === 2 && y === 0) || (k === 3 && y === H - 1)) continue;
        const n = i + NB[k];
        if (st[n] === LIQUID && type[n] === t && mark[n] !== gen && aux[n] < 60000) dst = -2 - n;
      }
      if (dst === -1) {
        // the liquid beside it is also being pushed: look two cells out
        for (let r = 2; r <= 6 && dst === -1; r++) for (let dy = -r; dy <= r && dst === -1; dy++) for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const n = ny * W + nx;
          if (st[n] === LIQUID && type[n] === t && mark[n] !== gen && aux[n] < 60000) { dst = -2 - n; break; }
        }
      }
    }
    if (dst === -1 && si !== GAS) return false;
    moves.push(i, dst);
  }
  for (let n = 0; n < moves.length; n += 2) {
    const i = moves[n], j = moves[n + 1];
    if (j <= -2) { aux[-2 - j] += 1 + aux[i]; aux[i] = 0; P[i] = 0; continue; }
    if (j >= 0) {
      type[j] = type[i]; st[j] = st[i]; temp[j] = temp[i]; life[j] = life[i]; aux[j] = aux[i]; lat[j] = lat[i];
      P[j] += P[i]; stamp[j] = cur; P[i] = 0;
    }
  }
  for (let n = 0; n < fpI.length; n++) {
    const i = fpI[n];
    if (P[i] > 0) {
      // the gas this cell held is squeezed into a neighbour, and the work of squeezing it goes in as extra energy
      const x = i % W, y = (i / W) | 0;
      const j = freeNear(x, y, x + 0.5 - px, y + 0.5 - py, false);
      if (j >= 0) {
        if (st[i] === NONE && st[j] === NONE) ox[j] = (ox[j] * P[j] + ox[i] * P[i]) / (P[j] + P[i]);   // its share of fresh air goes with it
        P[j] += P[i] * GAMMA;
      }
    }
    fk[i] = fpK[n];
    type[i] = rb.mat; st[i] = PART; bid[i] = rb.id; temp[i] = rb.temps[fpK[n]]; lat[i] = rb.lats[fpK[n]]; life[i] = 0; aux[i] = 0; P[i] = 0;
    rb.foot.push(i); rb.footK.push(fpK[n]);
  }
  return true;
}

function stampBody(rb) {
  if (placeBody(rb)) return;
  // refused at the new pose: go back to where it was and stop
  rb.b.setTransform(rb.lastPos, rb.lastAngle);
  rb.b.setLinearVelocity(planck.Vec2(0, 0));
  rb.b.setAngularVelocity(0);
  placeBody(rb);
}

// Gas pressure on every exposed face pushes the part, off-centre pushes make it turn.
function pressOn(rb) {
  const wc = rb.b.getWorldCenter();
  const cx = wc.x / S, cy = wc.y / S;
  // the part's own motion, in cells per frame, so wind only pushes a surface it is catching up with
  const lv = rb.b.getLinearVelocity(), om = rb.b.getAngularVelocity() * DT;
  const bvx = lv.x * DT / S, bvy = lv.y * DT / S;
  let fx = 0, fy = 0, tq = 0;
  for (const i of rb.foot) {
    const x = i % W, y = (i / W) | 0;
    const rx = x + 0.5 - cx, ry = y + 0.5 - cy;
    let g;
    // wind: air arriving at a face pushes it, by the square of how fast it closes on the face
    if (x > 1 && !SOL[st[i - 1]] && (g = FX[i - 2]) > 0.05) {
      const u = g / (P[i - 1] > 0.3 ? P[i - 1] : 0.3) - (bvx - om * ry);
      if (u > 0) { const q = WIND * u * u; fx += q; tq -= ry * q; }
    }
    if (x < W - 2 && !SOL[st[i + 1]] && (g = -FX[i + 1]) > 0.05) {
      const u = g / (P[i + 1] > 0.3 ? P[i + 1] : 0.3) + (bvx - om * ry);
      if (u > 0) { const q = WIND * u * u; fx -= q; tq += ry * q; }
    }
    if (y > 1 && !SOL[st[i - W]] && (g = FY[i - 2 * W]) > 0.05) {
      const u = g / (P[i - W] > 0.3 ? P[i - W] : 0.3) - (bvy + om * rx);
      if (u > 0) { const q = WIND * u * u; fy += q; tq += rx * q; }
    }
    if (y < H - 2 && !SOL[st[i + W]] && (g = -FY[i + W]) > 0.05) {
      const u = g / (P[i + W] > 0.3 ? P[i + W] : 0.3) + (bvy + om * rx);
      if (u > 0) { const q = WIND * u * u; fy -= q; tq -= rx * q; }
    }
    if (x > 0 && !SOL[st[i - 1]] && (g = P[i - 1] - P0 + LP[i - 1])) { fx += g; tq -= ry * g; }
    if (x < W - 1 && !SOL[st[i + 1]] && (g = P[i + 1] - P0 + LP[i + 1])) { fx -= g; tq += ry * g; }
    if (y > 0 && !SOL[st[i - W]] && (g = P[i - W] - P0 + LP[i - W])) { fy += g; tq += rx * g; }
    if (y < H - 1 && !SOL[st[i + W]] && (g = P[i + W] - P0 + LP[i + W])) { fy -= g; tq -= rx * g; }
  }
  if (Math.abs(fx) + Math.abs(fy) + Math.abs(tq) < 0.02) return;
  rb.b.applyForceToCenter(planck.Vec2(fx * PFORCE, fy * PFORCE), true);
  rb.b.applyTorque(tq * PFORCE * S, true);
}

// A part sitting in liquid is pushed up by the weight of the liquid it displaces, row by row,
// and slowed by the liquid as it moves.
function floatOn(rb) {
  const foot = rb.foot, n = foot.length;
  if (!n) return;
  const v = rb.b.getLinearVelocity();
  let k = 0, wet = 0;
  while (k < n) {
    const y = (foot[k] / W) | 0;
    let minX = W, maxX = -1, cnt = 0, sum = 0;
    while (k < n && ((foot[k] / W) | 0) === y) {
      const x = foot[k] % W;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      sum += x; cnt++; k++;
    }
    let d = 0, sides = 0;
    if (minX > 0 && st[y * W + minX - 1] === LIQUID) { d += DENS[type[y * W + minX - 1]]; sides++; }
    if (maxX < W - 1 && st[y * W + maxX + 1] === LIQUID) { d += DENS[type[y * W + maxX + 1]]; sides++; }
    if (!sides) continue;
    wet += cnt;
    const lift = d / sides / 7.87 * S * S * GRAVITY * cnt;
    const drag = 0.6 * S * S * cnt;
    rb.b.applyForce(planck.Vec2(-v.x * drag, -lift - v.y * drag), planck.Vec2((sum / cnt + 0.5) * S, (y + 0.5) * S), true);
  }
  if (wet) rb.b.applyTorque(-rb.b.getAngularVelocity() * 0.02 * S * S * wet, true);
}

// Cells of a part that reach the melting point drip off as liquid. What is left is re-shaped,
// and if the part is cut in two, each piece carries on as its own part.
function meltPart(rb) {
  const melt = MELT[rb.mat], t = rb.mat;
  let changed = false;
  for (let k = 0; k < rb.foot.length; k++) {
    const i = rb.foot[k];
    if (st[i] !== PART || bid[i] !== rb.id || (temp[i] <= melt && lat[i] <= 0)) continue;
    if (phase(i, t, PART) === LIQUID) {
      st[i] = LIQUID; bid[i] = 0; stamp[i] = cur;
      rb.occ[rb.footK[k]] = 0;
      changed = true;
    }
  }
  if (changed) refit(rb);
}

function refit(rb) {
  const { occ, w, h } = rb;
  const lab = new Int32Array(w * h), sizes = [0];
  let n = 0;
  for (let k0 = 0; k0 < w * h; k0++) {
    if (!occ[k0] || lab[k0]) continue;
    n++;
    let size = 0;
    const stack = [k0];
    lab[k0] = n;
    while (stack.length) {
      const k = stack.pop(), x = k % w, y = (k / w) | 0;
      size++;
      if (x > 0 && occ[k - 1] && !lab[k - 1]) { lab[k - 1] = n; stack.push(k - 1); }
      if (x < w - 1 && occ[k + 1] && !lab[k + 1]) { lab[k + 1] = n; stack.push(k + 1); }
      if (y > 0 && occ[k - w] && !lab[k - w]) { lab[k - w] = n; stack.push(k - w); }
      if (y < h - 1 && occ[k + w] && !lab[k + w]) { lab[k + w] = n; stack.push(k + w); }
    }
    sizes.push(size);
  }
  if (n === 0) { removeBody(rb.id); return; }
  let keep = 1;
  for (let L = 2; L <= n; L++) if (sizes[L] > sizes[keep]) keep = L;
  const pieces = new Map();
  if (n > 1) {
    const p = rb.b.getPosition(), v = rb.b.getLinearVelocity();
    for (let L = 1; L <= n; L++) {
      if (L === keep) continue;
      const o = new Uint8Array(w * h);
      for (let k = 0; k < w * h; k++) if (lab[k] === L) { o[k] = 1; occ[k] = 0; }
      const nb = spawn(o, rb.temps.slice(), w, h, rb.ox, rb.oy, rb.R, p.x, p.y, rb.b.getAngle(), rb.mat, 0, rb.lats.slice());
      nb.b.setLinearVelocity(planck.Vec2(v.x, v.y));
      nb.b.setAngularVelocity(rb.b.getAngularVelocity());
      pieces.set(L, nb);
    }
  }
  for (let f = rb.b.getFixtureList(); f;) { const nx = f.getNext(); rb.b.destroyFixture(f); f = nx; }
  addFixtures(rb.b, occ, w, h, rb.ox, rb.oy, rb.mat);
  // joints follow the piece their pin sits on; a pin whose metal melted away lets go
  const labelNear = (lx, ly) => {
    const ix = Math.floor(lx / S - rb.ox), iy = Math.floor(ly / S - rb.oy);
    for (let r = 0; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = ix + dx, y = iy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (lab[y * w + x]) return lab[y * w + x];
    }
    return 0;
  };
  for (const rec of jrecs.slice()) {
    for (const side of ['A', 'B']) {
      if (rec[side] !== rb || !jrecs.includes(rec)) continue;
      const local = side === 'A' ? rec.localA : rec.localB;
      const L = labelNear(local.x, local.y);
      if (L === 0) removeJoint(rec);
      else if (L !== keep) {
        const anchor = rb.b.getWorldPoint(local);
        const ends = rec.kind === 'spring' ? springEnds(rec) : null;
        dropJoint(rec);
        rec[side] = pieces.get(L);
        if (ends) buildJoint(rec, ends[0], ends[1]); else buildJoint(rec, anchor);
      }
    }
  }
}

function rebuildGround() {
  groundDirty = false;
  for (let f = ground.getFixtureList(); f;) { const n = f.getNext(); ground.destroyFixture(f); f = n; }
  const occ = new Uint8Array(N);
  for (let i = 0; i < N; i++) occ[i] = st[i] === STATIC ? 1 : 0;
  for (const [x0, y0, x1, y1] of rectsOf(occ, W, H)) {
    const hx = (x1 - x0 + 1) / 2, hy = (y1 - y0 + 1) / 2;
    ground.createFixture(planck.Box(hx * S, hy * S, planck.Vec2((x0 + hx) * S, (y0 + hy) * S), 0), { friction: 0.4 });
  }
  // the edges of the bench keep parts in view
  ground.createFixture(planck.Edge(planck.Vec2(0, 0), planck.Vec2(0, H * S)));
  ground.createFixture(planck.Edge(planck.Vec2(W * S, 0), planck.Vec2(W * S, H * S)));
  ground.createFixture(planck.Edge(planck.Vec2(0, H * S), planck.Vec2(W * S, H * S)));
}

function removeBody(id) {
  const rb = bodies.get(id);
  if (!rb) return;
  for (const rec of jrecs.filter(r => r.A === rb || r.B === rb)) removeJoint(rec);
  liftBody(rb);
  world.destroyBody(rb.b);
  bodies.delete(id);
}

function physicsStep() {
  if (groundDirty && (tick & 3) === 0) rebuildGround();
  for (const rb of Array.from(bodies.values())) {
    if (rb.dirty) { rb.dirty = false; refit(rb); }
    if (bodies.has(rb.id)) meltPart(rb);
  }
  for (const rb of bodies.values()) { pressOn(rb); floatOn(rb); }
  for (const rb of bodies.values()) {
    rb.old = rb.foot.slice();
    liftBody(rb);
    const p = rb.b.getPosition();
    rb.lastPos = planck.Vec2(p.x, p.y); rb.lastAngle = rb.b.getAngle();
  }
  world.step(DT, 8, 3);
  const order = Array.from(bodies.values()).reverse();   // newest on top
  for (const rb of order) {
    const p = rb.b.getPosition();
    if (p.y > (H + 40) * S || p.y < -200 * S) { removeBody(rb.id); continue; }
    stampBody(rb);
  }
  // Gas that expands into the space a part just left has done work pushing it, and pays for that in energy.
  for (const rb of order) {
    for (const i of rb.old) {
      if (st[i] !== NONE || P[i] !== 0) continue;
      const x = i % W, y = (i / W) | 0;
      let j = -1, best = 0;
      if (x > 0 && !SOL[st[i - 1]] && P[i - 1] > best) { best = P[i - 1]; j = i - 1; }
      if (x < W - 1 && !SOL[st[i + 1]] && P[i + 1] > best) { best = P[i + 1]; j = i + 1; }
      if (y > 0 && !SOL[st[i - W]] && P[i - W] > best) { best = P[i - W]; j = i - W; }
      if (y < H - 1 && !SOL[st[i + W]] && P[i + W] > best) { best = P[i + W]; j = i + W; }
      if (j >= 0) { P[j] -= (GAMMA - 1) * best; ox[i] = ox[j]; }
    }
  }
}

// Which parts cover (or nearly cover) a cell, nearest first.
function bodiesAt(x, y, reach) {
  const found = [];
  for (const rb of bodies.values()) {
    const pos = rb.b.getPosition(), a = rb.b.getAngle();
    const c = Math.cos(a), s = Math.sin(a), px = pos.x / S, py = pos.y / S;
    let best = Infinity;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > reach || d >= best) continue;
      const qx = x + dx + 0.5 - px, qy = y + dy + 0.5 - py;
      const ix = Math.floor(c * qx + s * qy - rb.ox), iy = Math.floor(-s * qx + c * qy - rb.oy);
      if (ix < 0 || iy < 0 || ix >= rb.w || iy >= rb.h || !rb.occ[iy * rb.w + ix]) continue;
      best = d;
    }
    if (best < Infinity) found.push([best, rb]);
  }
  found.sort((p, q) => p[0] - q[0]);
  return found.map(f => f[1]);
}

// ---------- joints ----------
// Every joint has a primary part A. B is a second part, or null for the background.
// Hinges and motors pin A to B at a point; sliders let A move only along a straight track.
const jrecs = [];
let nextJointId = 1;

function dropJoint(rec) {
  if (rec.anchorBody) { world.destroyBody(rec.anchorBody); rec.anchorBody = null; }
  else if (rec.j) world.destroyJoint(rec.j);
  rec.j = null;
}

// Where each end of a spring is now, in the world.
function springEnds(rec) {
  return [rec.A.b.getWorldPoint(rec.localA), rec.B ? rec.B.b.getWorldPoint(rec.localB) : rec.worldB];
}
function buildJoint(rec, anchor, anchorB) {
  if (rec.kind === 'spring') {
    // a spring joins a point on A to a point on B (or on the background), pulling them back to its length
    const [a0, b0] = anchorB ? [anchor, anchorB] : springEnds(rec);
    const other = rec.B ? rec.B.b : (rec.anchorBody = world.createBody({ type: 'static', position: b0 }));
    rec.j = world.createJoint(planck.DistanceJoint({ collideConnected: true, frequencyHz: rec.hz, dampingRatio: rec.damp, length: rec.len * S }, rec.A.b, other, a0, b0));
    rec.localA = rec.A.b.getLocalPoint(a0);
    rec.localB = rec.B ? rec.B.b.getLocalPoint(b0) : null;
    rec.worldB = rec.B ? null : b0;
    rec.A.b.setAwake(true);
    return;
  }
  const other = rec.B ? rec.B.b : (rec.anchorBody = world.createBody({ type: 'static', position: anchor }));
  if (rec.kind === 'slider') {
    rec.j = world.createJoint(planck.PrismaticJoint({ collideConnected: false }, other, rec.A.b, anchor, rec.axis));
  } else {
    rec.j = world.createJoint(planck.RevoluteJoint({
      collideConnected: false, enableMotor: rec.kind === 'motor',
      motorSpeed: -rec.spin, maxMotorTorque: Math.min(rec.strength, 1e12)
    }, rec.A.b, other, anchor));
  }
  rec.localA = rec.A.b.getLocalPoint(anchor);
  rec.localB = rec.B ? rec.B.b.getLocalPoint(anchor) : null;
  rec.A.b.setAwake(true);
}

function makeJoint(kind, A, B, anchor, axis) {
  const rec = { id: nextJointId++, kind, A, B: kind === 'slider' ? null : B, axis: kind === 'spring' ? null : axis || null, spin: Math.PI, strength: 60, j: null, anchorBody: null,
    hz: 3, damp: 0.3, len: kind === 'spring' ? Math.hypot(anchor.x - axis.x, anchor.y - axis.y) / S : 0 };
  if (kind === 'spring') buildJoint(rec, anchor, axis);   // for a spring the fifth argument is its other end
  else buildJoint(rec, anchor);
  jrecs.push(rec);
  return rec;
}

function removeJoint(rec) {
  const k = jrecs.indexOf(rec);
  if (k < 0) return;
  dropJoint(rec);
  jrecs.splice(k, 1);
}

function setJointKind(rec, kind) {
  if (rec.kind === 'slider' || kind === 'slider' || rec.kind === 'spring' || kind === 'spring') return;
  rec.kind = kind;
  rec.j.enableMotor(kind === 'motor');
  rec.j.setMotorSpeed(-rec.spin);
  rec.j.setMaxMotorTorque(Math.min(rec.strength, 1e12));
  rec.A.b.setAwake(true);
}

// A spring's stiffness (how many times a second it would bounce), damping (0 none, 1 no bounce) and length in cells.
function setSpring(rec, hz, damp, len) {
  rec.hz = hz; rec.damp = damp; rec.len = len;
  rec.j.setFrequency(hz); rec.j.setDampingRatio(damp); rec.j.setLength(len * S);
  rec.A.b.setAwake(true);
  if (rec.B) rec.B.b.setAwake(true);
}

// spin: radians per second the part turns, positive is clockwise on screen
function setMotor(rec, spin, strength) {
  rec.spin = spin; rec.strength = strength;
  if (rec.kind !== 'motor') return;
  rec.j.setMotorSpeed(-spin);
  rec.j.setMaxMotorTorque(Math.min(strength, 1e12));     // "inf" is stored as given, the engine gets a huge finite number
  rec.A.b.setAwake(true);
}

// Where the joint sits on its primary part, in cells.
function jointPoint(rec) {
  const p = rec.A.b.getWorldPoint(rec.localA);
  return [p.x / S, p.y / S];
}

function jointNear(fx, fy, reach, noSprings) {
  let best = null, bd = reach;
  for (const rec of jrecs) {
    if (rec.kind === 'spring' && noSprings) continue;
    let [x, y] = jointPoint(rec);
    if (rec.kind === 'spring') { const [a, b] = springEnds(rec); x = (a.x + b.x) / 2 / S; y = (a.y + b.y) / 2 / S; }   // a spring is picked by its middle
    const d = Math.hypot(x - fx, y - fy);
    if (d <= bd) { bd = d; best = rec; }
  }
  return best;
}

// Snap a point (in cells) to an existing joint, then to a part's centre, then to the cell centre.
function snapPoint(fx, fy) {
  const j = jointNear(fx, fy, 2.2, true);
  if (j) { const [x, y] = jointPoint(j); return { x, y, joint: j }; }
  let best = null, bd = 2.5;
  for (const rb of bodies.values()) {
    const c = rb.b.getWorldCenter();
    const d = Math.hypot(c.x / S - fx, c.y / S - fy);
    if (d <= bd) { bd = d; best = [c.x / S, c.y / S]; }
  }
  if (best) return { x: best[0], y: best[1], center: true };
  return { x: Math.floor(fx) + 0.5, y: Math.floor(fy) + 0.5 };
}

function longAxis(rb) {
  const a = rb.b.getAngle();
  return rb.w >= rb.h ? planck.Vec2(Math.cos(a), Math.sin(a)) : planck.Vec2(-Math.sin(a), Math.cos(a));
}

// Move or turn a part by hand. Joints on it come along: a pin stays where it was on the moved part.
function movePart(rb, x, y, angle) {
  const op = rb.b.getPosition(), oldX = op.x, oldY = op.y, oldA = rb.b.getAngle();
  liftBody(rb);
  rb.b.setTransform(planck.Vec2(x, y), angle);
  if (!placeBody(rb)) {
    rb.b.setTransform(planck.Vec2(oldX, oldY), oldA);
    placeBody(rb);
    return false;
  }
  rb.lastPos = planck.Vec2(x, y); rb.lastAngle = angle;
  rb.b.setLinearVelocity(planck.Vec2(0, 0));
  rb.b.setAngularVelocity(0);
  const dA = angle - oldA, c = Math.cos(dA), s = Math.sin(dA);
  for (const rec of jrecs) {
    if (rec.A !== rb && rec.B !== rb) continue;
    if (rec.kind === 'spring') { const ends = springEnds(rec); dropJoint(rec); buildJoint(rec, ends[0], ends[1]); continue; }
    const anchor = rb.b.getWorldPoint(rec.A === rb ? rec.localA : rec.localB);
    if (rec.axis && dA) rec.axis = planck.Vec2(c * rec.axis.x - s * rec.axis.y, s * rec.axis.x + c * rec.axis.y);
    dropJoint(rec);
    buildJoint(rec, anchor);
  }
  rb.b.setAwake(true);
  return true;
}

// Dragging a part while the simulation runs pulls it with a spring.
let grabBase = null;
function grab(rb, fx, fy) {
  if (!grabBase) grabBase = world.createBody();
  return world.createJoint(planck.MouseJoint({ maxForce: 250 * rb.b.getMass(), frequencyHz: 5, dampingRatio: 0.7 }, grabBase, rb.b, planck.Vec2(fx * S, fy * S)));
}
function ungrab(j) {
  for (let k = world.getJointList(); k; k = k.getNext()) if (k === j) { world.destroyJoint(j); return; }
}

// ---------- snapshots for Play and Rewind ----------
function snapshot() {
  return {
    fan: fan.slice(), dset: dset.slice(), gate: gate.slice(), ddir: ddir.slice(), fx: FX.slice(), fy: FY.slice(), type: type.slice(), st: st.slice(), temp: temp.slice(), life: life.slice(), aux: aux.slice(), lat: lat.slice(), need: need.slice(), ox: ox.slice(), P: P.slice(), bid: bid.slice(), nextId,
    neutrons: { n: nCount, x: nX.slice(0, nCount), y: nY.slice(0, nCount), dx: nDX.slice(0, nCount), dy: nDY.slice(0, nCount), fast: nFast.slice(0, nCount), life: nLife.slice(0, nCount) },
    bodies: Array.from(bodies.values(), rb => {
      const p = rb.b.getPosition(), v = rb.b.getLinearVelocity();
      return {
        id: rb.id, occ: rb.occ.slice(), temps: rb.temps.slice(), lats: rb.lats.slice(), w: rb.w, h: rb.h, ox: rb.ox, oy: rb.oy, R: rb.R, mat: rb.mat,
        foot: rb.foot.slice(), footK: rb.footK.slice(), x: p.x, y: p.y, a: rb.b.getAngle(), vx: v.x, vy: v.y, av: rb.b.getAngularVelocity()
      };
    }),
    joints: jrecs.map(r => ({
      kind: r.kind, A: r.A.id, B: r.B ? r.B.id : 0, lx: r.localA.x, ly: r.localA.y,
      axis: r.axis ? [r.axis.x, r.axis.y] : null, spin: r.spin, strength: r.strength,
      hz: r.hz, damp: r.damp, len: r.len, lb: r.localB ? [r.localB.x, r.localB.y] : null, wb: r.worldB ? [r.worldB.x, r.worldB.y] : null
    }))
  };
}

function restore(snap) {
  clearAll();
  type.set(snap.type); st.set(snap.st); temp.set(snap.temp); life.set(snap.life); aux.set(snap.aux); lat.set(snap.lat); need.set(snap.need); ox.set(snap.ox); P.set(snap.P); Pref.set(snap.P); bid.set(snap.bid);
  fan.set(snap.fan); dset.set(snap.dset); gate.set(snap.gate); ddir.set(snap.ddir); FX.set(snap.fx); FY.set(snap.fy);
  nextId = snap.nextId;
  const sn = snap.neutrons;
  nCount = sn.n; nX.set(sn.x); nY.set(sn.y); nDX.set(sn.dx); nDY.set(sn.dy); nFast.set(sn.fast); nLife.set(sn.life);
  for (const d of snap.bodies) {
    const rb = spawn(d.occ.slice(), d.temps.slice(), d.w, d.h, d.ox, d.oy, d.R, d.x, d.y, d.a, d.mat, d.id, d.lats.slice());
    rb.b.setLinearVelocity(planck.Vec2(d.vx, d.vy));
    rb.b.setAngularVelocity(d.av);
    rb.foot = d.foot.slice(); rb.footK = d.footK.slice();
  }
  for (const jd of snap.joints) {
    const A = bodies.get(jd.A), B = jd.B ? bodies.get(jd.B) : null;
    if (!A) continue;
    const rec = { id: nextJointId++, kind: jd.kind, A, B, axis: jd.axis ? planck.Vec2(jd.axis[0], jd.axis[1]) : null, spin: jd.spin, strength: jd.strength, j: null, anchorBody: null,
      hz: jd.hz, damp: jd.damp, len: jd.len };
    if (jd.kind === 'spring') {
      if (jd.B && !B) continue;
      buildJoint(rec, A.b.getWorldPoint(planck.Vec2(jd.lx, jd.ly)), B ? B.b.getWorldPoint(planck.Vec2(jd.lb[0], jd.lb[1])) : planck.Vec2(jd.wb[0], jd.wb[1]));
    } else buildJoint(rec, A.b.getWorldPoint(planck.Vec2(jd.lx, jd.ly)));
    jrecs.push(rec);
  }
  groundDirty = true;
  rebuildGround();
}

// Open edges: anything loose that reaches the edge of the bench leaves it, like gas drifting off into the sky.
let openEdges = true;
function clearEdges() {
  const out = i => { const s = st[i]; if (s === GAS || s === LIQUID || s === POWDER) { clearCell(i); P[i] = P0; ox[i] = 1; } };
  for (let x = 0; x < W; x++) { out(x); out((H - 1) * W + x); }
  for (let y = 1; y < H - 1; y++) { out(y * W); out(y * W + W - 1); }
}
function step() {
  if (openEdges) clearEdges();
  tick++;
  cur = (tick % 255) + 1;
  const ltr = tick & 1;
  for (let y = H - 1; y >= 0; y--) {
    const row = y * W;
    for (let k = 0; k < W; k++) {
      const x = ltr ? k : W - 1 - k, i = row + x, s = st[i];
      if (s === NONE || s === DRAFT) continue;
      if (s === PART) {
        const t = type[i];
        if (RAD[t]) radiate(i, x, y, t, PART);
        if (PARTRX[t]) {
          // parts burn, fizz in water and are cut by hot oxygen like loose material; the cell that goes is lost from the part
          const m = MATS[t];
          if (m.burn && temp[i] > IGN[t]) { if (smolder(i, x, y, m)) detach(i); }
          else if (m.wet && wetReact(i, x, y, m)) detach(i);
        }
        if (CHEMV[t]) chemReact(i, x, y, t);
        continue;
      }
      if (s === STATIC) {
        // solid material sits still, but it can still melt, catch fire or decay
        const t = type[i];
        if (RAD[t] && radiate(i, x, y, t, STATIC)) continue;
        const T = temp[i];
        if (T > IGN[t]) { const m = MATS[t]; if (m.burn.fast) burn(i); else smolder(i, x, y, m); }
        else if (T > MELT[t] || lat[i] > 0) { if (phase(i, t, STATIC) !== STATIC) { st[i] = LIQUID; groundDirty = true; } }
        else if (RX[t] && react(i, x, y, t, STATIC)) continue;
        else if (CHEMV[t]) chemReact(i, x, y, t);
        else if (CPDI[t]) { if (!cpdReact(i, x, y, t)) chemCompound(i, x, y, t, CPDI[t]); }
        continue;
      }
      if (stamp[i] === cur) continue;
      updateCell(i, x, y);
    }
  }
  electric();
  stepNeutrons();
  diffusePressure();
  liquidPressure();
  advectAir();
  diffuseHeat();
  physicsStep();
}

function clearAll() {
  for (let b = world.getBodyList(); b;) { const n = b.getNext(); world.destroyBody(b); b = n; }
  ground = world.createBody();
  grabBase = null;
  bodies.clear();
  jrecs.length = 0;
  nCount = 0;
  LP.fill(0); lpCells = []; lit.fill(0);
  fan.fill(0); dset.fill(0); gate.fill(1); ddir.fill(0); FX.fill(0); FY.fill(0);
  type.fill(0); st.fill(0); temp.fill(AMBIENT); life.fill(0); aux.fill(0); lat.fill(0); need.fill(0); ox.fill(1); P.fill(P0); Pref.fill(P0); bid.fill(0); stamp.fill(0);
  groundDirty = true;
}

// Fill a rectangle with a material in the state it has at room temperature. key null clears it.
const TRAYS = [[59, 96, 100], [75, 110, 180], [87, 124, 240]];   // refinery draw-offs: tray row, jar centre, temperature   // refinery draw-offs: tray row and jar centre, top to bottom
const offCells = [];     // switches a scene wants to start switched off
function fill(x0, y0, x1, y1, key) {
  const m = key ? MATS[ID[key]] : null;
  const s = m ? stateAt(m, AMBIENT) : NONE;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    type[i] = m ? m.id : 0; st[i] = s; temp[i] = AMBIENT; life[i] = 0; aux[i] = 0; lat[i] = 0;
  }
  groundDirty = true;
}

function cellsRect(x0, y0, x1, y1) {
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
function cellsDisc(cx, cy, r) {
  const out = [];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r && x >= 0 && y >= 0 && x < W && y < H) out.push(y * W + x);
  return out;
}
function cellsLine(x0, y0, x1, y1, half) {
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
function addBody(cells, matId) {
  if (matId === undefined) matId = ID.Fe;
  const rb = makeBody(cells, matId);
  if (rb && !placeBody(rb)) {
    // nowhere to push what is underneath: keep only the open cells
    world.destroyBody(rb.b); bodies.delete(rb.id);
    return addBody(cells.filter(i => st[i] === NONE || st[i] === GAS), matId);
  }
  return rb;
}

// Cells drawn with the Part tool become one part per connected piece when the stroke ends.
let strokeCells = [];
function finishPart() {
  const seen = new Set();
  let made = 0;
  for (const start of strokeCells) {
    if (seen.has(start) || st[start] !== DRAFT) continue;
    const matId = type[start];
    const comp = [start], stack = [start];
    seen.add(start);
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (st[j] !== DRAFT || type[j] !== matId || seen.has(j)) continue;
        seen.add(j); comp.push(j); stack.push(j);
      }
    }
    for (const i of comp) { type[i] = 0; st[i] = NONE; P[i] = 0; }
    if (addBody(comp, matId)) made++;
  }
  strokeCells = [];
  return made;
}

// tool: 'brush' paints matId, 'part' drafts a part of matId, plus 'fire', 'heat', 'cool', 'erase'.
let paintDir = 1;   // the direction new inverters and pumps face (the fan arrows set it)
const DEV_TOOLS = { contact: CONTACT, wire: WIRE, plug: PLUG, injector: INJECTOR, valve: VALVE, switch: SWITCH, heater: HEATER, sensor: SENSE_T, inverter: INVERTER, pump: PUMP, electrode: ELECTRODE };
// for the device tools matId carries the new device's setting (left out: the usual default)
function paint(cx, cy, tool, r, matId) {
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
        if (SOL[s]) { P[i] = P0; temp[i] = AMBIENT; groundDirty = true; }
        clearCell(i);
      }
    } else if (DEV_TOOLS[tool]) {
      const d = DEV_TOOLS[tool];
      if (fan[i] !== d) { fan[i] = d; dset[i] = matId !== undefined && DEV_DEFAULT[d] !== undefined ? matId : DEV_DEFAULT[d] || 0; gate[i] = 1; }
      if (d === INVERTER || d === PUMP) ddir[i] = paintDir;
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
      if (s === NONE || s === GAS) { type[i] = m.id; st[i] = DRAFT; life[i] = 0; aux[i] = 0; temp[i] = AMBIENT; strokeCells.push(i); }
    } else if (ms === STATIC) {
      if (!SOL[s]) { type[i] = m.id; st[i] = STATIC; life[i] = 0; aux[i] = 0; lat[i] = 0; temp[i] = AMBIENT; P[i] = P0; groundDirty = true; }
    } else if (s === NONE && Math.random() < (ms === GAS ? 0.6 : 0.8)) {
      type[i] = m.id; st[i] = ms; temp[i] = AMBIENT; life[i] = 0; aux[i] = 0; lat[i] = 0;
    }
  }
}

function loadPreset(name) {
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

const Sim = {
  W, H, P0, S, MATS, ID, NONE, STATIC, POWDER, LIQUID, GAS, PART, type, st, life, bid, bodies,
  setOpenEdges(v) { openEdges = v; }, fan, lit, dset, gate, ddir, setPaintDir(d) { paintDir = d; }, need, made, CPDI, NE0, PAIR_PRODUCT, PAIR_ACT, takeNews() { const m = madeNews; madeNews = null; return m; }, burn, spark, get FX() { return FX; }, get FY() { return FY; }, nX, nY, nFast, emit, get neutrons() { return nCount; }, get temp() { return temp; }, get P() { return P; }, get world() { return world; },
  lat, aux, ox, LP, CAPS, jrecs, springEnds, setSpring, step, paint, finishPart, addBody, cellsRect, cellsDisc, removeBody, loadPreset, clearAll, fill, stateAt,
  bodiesAt, makeJoint, removeJoint, setJointKind, setMotor, jointPoint, jointNear, snapPoint, longAxis,
  movePart, grab, ungrab, snapshot, restore
};
