#!/usr/bin/env python3
"""Energy data for every chemical material: enthalpy H(T) and Gibbs energy G(T) per formula unit.

Real values come from NASA's thermodynamic tables (McBride, Gordon & Reno, NASA TM-4513, 1993, public
domain) in the copy the Cantera project ships (data/nasa_condensed.yaml and data/nasa_gas.yaml). Materials
those tables lack are estimated: compounds by Pauling's electronegativity rule fitted to the real ones,
family by family, elements and phase changes by Dulong-Petit, Richards' and Trouton's rules. A few
important compounds NASA lacks use standard textbook values.

    node tools/dump_chem.mjs > tools/chem_materials.json
    python3 tools/gen_thermo.py <cantera>/data      # writes src/sim/thermo.gen.js and tools/thermo-report.md
"""
import json, math, os, sys
import yaml

R = 8.314462618
TG = [298.15, 500, 800, 1100, 1500, 2000, 2700, 3500]     # temperatures of the table, K
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = sys.argv[1] if len(sys.argv) > 1 else '/tmp/thermo-src/c/data'

# ---------- NASA species ----------
species = []
for fname, phase in (('nasa_condensed.yaml', 'c'), ('nasa_gas.yaml', 'g')):
    for sp in yaml.safe_load(open(os.path.join(DATA, fname)))['species']:
        th = sp.get('thermo', {})
        if th.get('model') not in ('NASA7', 'NASA9'):
            continue
        comp = {k[0].upper() + k[1:].lower(): v for k, v in sp['composition'].items() if k not in ('E', 'e')}
        if any(k in ('E', 'e') for k in sp['composition']):
            continue                                              # ions
        species.append({'name': str(sp['name']), 'comp': comp, 'phase': phase, 'nine': th['model'] == 'NASA9',
                        'ranges': th['temperature-ranges'], 'data': th['data']})

def nasa_hs(sp, T, extrapolate=False):
    r = sp['ranges']
    for k in range(len(r) - 1):
        # (many solid fits start at 300 K: they are used down to room temperature, 298.15 K)
        if r[k] - (5 if k == 0 else 1e-6) <= T <= r[k + 1] + 1e-6:
            break
    else:
        if not extrapolate:
            return None
        k = 0 if T < r[0] else len(r) - 2
    a = sp['data'][k]
    if sp['nine']:
        # NASA 9-coefficient form: a1..a7, then the enthalpy and entropy constants b1, b2
        lt = math.log(T)
        h = -a[0] / T ** 2 + a[1] * lt / T + a[2] + a[3] * T / 2 + a[4] * T ** 2 / 3 + a[5] * T ** 3 / 4 + a[6] * T ** 4 / 5 + a[7] / T
        s = -a[0] / T ** 2 / 2 - a[1] / T + a[2] * lt + a[3] * T + a[4] * T ** 2 / 2 + a[5] * T ** 3 / 3 + a[6] * T ** 4 / 4 + a[8]
        return h * R * T, s * R
    h = a[0] + a[1] * T / 2 + a[2] * T ** 2 / 3 + a[3] * T ** 3 / 4 + a[4] * T ** 4 / 5 + a[5] / T
    s = a[0] * math.log(T) + a[1] * T + a[2] * T ** 2 / 2 + a[3] * T ** 3 / 3 + a[4] * T ** 4 / 4 + a[6]
    return h * R * T, s * R

def ckey(comp):
    return tuple(sorted(comp.items()))

by_comp = {}
for sp in species:
    by_comp.setdefault(ckey(sp['comp']), []).append(sp)

def stable(sps, T):
    """(G, H) of the most stable phase at T, or None if no phase covers T (condensed ones are extended)."""
    best = None
    for sp in sps:
        hs = nasa_hs(sp, T)
        if hs and (best is None or hs[0] - T * hs[1] < best[0]):
            best = (hs[0] - T * hs[1], hs[0])
    if best is None:                                              # past the last range of every phase: extend the hottest
        sp = max(sps, key=lambda s: s['ranges'][-1])
        h, s = nasa_hs(sp, T, extrapolate=True)
        best = (h - T * s, h)
    return best

# reference state of each element, per atom: the most stable form of the pure element (O2, S8, Fe ...)
elem_sps = {}
for sp in species:
    if len(sp['comp']) == 1:
        el, n = next(iter(sp['comp'].items()))
        elem_sps.setdefault(el, []).append((sp, n))

def elem_ref(el, T):
    best = None
    for sp, n in elem_sps.get(el, []):
        hs = nasa_hs(sp, T)
        if hs:
            g, h = (hs[0] - T * hs[1]) / n, hs[0] / n
            if best is None or g < best[0]:
                best = (g, h)
    return best

# ---------- textbook values for important compounds NASA lacks: dHf(298) kJ/mol, S(298) J/mol K ----------
TEXTBOOK = {
    'ZnO': (-350.5, 43.6), 'ZnCl2': (-415.1, 111.5), 'ZnS': (-206.0, 57.7), 'Ag2O': (-31.1, 121.3),
    'SnO2': (-577.6, 49.0), 'MnO2': (-520.0, 53.1), 'WO3': (-842.9, 75.9), 'UO2': (-1085.0, 77.0),
    'CuCl2': (-220.1, 108.1), 'AgCl': (-127.0, 96.3), 'NiO': (-239.7, 38.0), 'CoO': (-237.9, 53.0),
    'Cs2O': (-345.8, 146.9), 'Rb2O': (-339.0, 125.0),
    # oxides of the noble metals, which the electronegativity rule makes far too stable
    'Au2O3': (-3.4, 125.0), 'PtO2': (-80.0, 42.0), 'PdO': (-85.4, 38.9), 'IrO2': (-274.1, 50.6),
    'RuO2': (-305.0, 52.2), 'OsO4': (-394.1, 143.9), 'Rh2O3': (-343.0, 75.7), 'Ag2S': (-32.6, 144.0),
}

# standard entropies at 25 °C (J/mol K) of elements NASA's tables lack; the rest get a typical 40 (solids)
ELEMENT_S = {
    'Ag': 42.6, 'Au': 47.4, 'Zn': 41.6, 'Sn': 51.2, 'Pt': 41.6, 'Pd': 37.6, 'Mn': 32.0, 'Co': 30.0, 'W': 32.6,
    'U': 50.2, 'Bi': 56.7, 'Sb': 45.7, 'Cd': 51.8, 'In': 57.8, 'Ga': 40.8, 'Ge': 31.1, 'As': 35.1, 'Se': 42.4,
    'Te': 49.7, 'Zr': 39.0, 'Hf': 43.6, 'Rh': 31.5, 'Ru': 28.5, 'Ir': 35.5, 'Os': 32.6, 'Re': 36.9, 'Tl': 64.2,
    'Rb': 76.8, 'Y': 44.4, 'Sc': 34.6, 'La': 56.9, 'Ce': 72.0, 'Th': 51.8, 'Pu': 54.5, 'Ra': 71.0, 'Po': 62.8,
}

mats = json.load(open(os.path.join(HERE, 'chem_materials.json')))
NEG_FAMILY = lambda m: m.get('B')

def formula(comp):
    return ''.join(el + (str(n) if n > 1 else '') for el, n in comp.items())

def atoms(comp):
    return sum(comp.values())

def piecewise(h298, s298, cp, tm, tb, dsf, dsv, start_state):
    """H(T), S(T) from 298 K with constant heat capacity and a melting and boiling step."""
    out = []
    for T in TG:
        h, s, t0 = h298, s298, 298.15
        for tt, step, state in ((tm, dsf, 'solid'), (tb, dsv, 'liquid')):
            if tt is None or tt <= 298.15:
                continue
            if tt < T and not (start_state == 'gas' or (start_state == 'liquid' and state == 'solid')):
                h += cp * (tt - t0); s += cp * math.log(tt / t0); t0 = tt
                h += tt * step; s += step
        h += cp * (T - t0); s += cp * math.log(T / t0)
        out.append((h - T * s, h))
    return out

def start_state(m):
    if m['boil'] is not None and m['boil'] < 25:
        return 'gas'
    if m['melt'] is not None and m['melt'] < 25:
        return 'liquid'
    return 'solid'

result, src = {}, {}
for m in mats:
    comp = m['comp']
    if m.get('element'):
        el = next(iter(comp))
        if el in elem_sps:
            result[m['key']] = [elem_ref(el, T) or stable([s for s, _ in elem_sps[el]], T) for T in TG]
            src[m['key']] = 'nasa'
        continue
    sps = by_comp.get(ckey(comp))
    # (NASA's tables only count if they have the material as a solid or liquid when the game has it so at
    # room temperature: the gas alone, e.g. gaseous NiO, says nothing about the solid)
    if sps and (start_state(m) == 'gas' or any(sp['phase'] == 'c' for sp in sps)):
        result[m['key']] = [stable(sps, T) for T in TG]
        src[m['key']] = 'nasa'

# ---------- fits on the compounds with real data ----------
def h298(key):
    return result[key][0][1] / 1000                               # kJ/mol (elements in their reference state are 0)

def s298(key):
    g, h = result[key][0]
    return (h - g) / 298.15                                       # J/mol K

S_ELEM = {}
for m in mats:
    if m.get('element') and m['key'] in result:
        S_ELEM[next(iter(m['comp']))] = s298(m['key'])

real = [m for m in mats if m['key'] in result and m.get('B') and m.get('bonds')]

def lstsq(pts):
    n = len(pts)
    if n < 2:
        return None
    mx = sum(p[0] for p in pts) / n; my = sum(p[1] for p in pts) / n
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    if sxx < 1e-9:
        return (0.0, my)
    a = sum((p[0] - mx) * (p[1] - my) for p in pts) / sxx
    return (a, my - a * mx)

def lstsq3(rows):
    # least squares for y = c0 + c1 u + c2 v (normal equations, small ridge for stability)
    import itertools
    X = [[1.0, u, v] for u, v, _ in rows]; Y = [y for _, _, y in rows]
    A = [[sum(X[k][i] * X[k][j] for k in range(len(X))) + (1e-6 if i == j else 0) for j in range(3)] for i in range(3)]
    b = [sum(X[k][i] * Y[k] for k in range(len(X))) for i in range(3)]
    for i in range(3):                                            # Gaussian elimination
        piv = max(range(i, 3), key=lambda r: abs(A[r][i])); A[i], A[piv] = A[piv], A[i]; b[i], b[piv] = b[piv], b[i]
        for r in range(i + 1, 3):
            f = A[r][i] / A[i][i]
            for c in range(i, 3): A[r][c] -= f * A[i][c]
            b[r] -= f * b[i]
    c = [0.0] * 3
    for i in (2, 1, 0):
        c[i] = (b[i] - sum(A[i][j] * c[j] for j in range(i + 1, 3))) / A[i][i]
    return c

def charge(m):
    return m['bonds'] / m['comp'][m['A']]                         # the metal's charge in the compound

def fit_h(pool):
    # per bond: a x dX^2 + b + c x (charge of the metal), fitted per family of B
    fam, allp = {}, []
    for m in pool:
        p = (m['dX'] ** 2, charge(m), h298(m['key']) / m['bonds'])
        fam.setdefault(m['B'], []).append(p); allp.append(p)
    glob = lstsq3(allp)
    return {b: (lstsq3(p) if len(p) >= 6 else glob) for b, p in fam.items()}, glob

def est_h(m, fits):
    fam, glob = fits
    c0, c1, c2 = fam.get(m['B'], glob)
    return (c0 + c1 * m['dX'] ** 2 + c2 * charge(m)) * m['bonds']

def fit_s(pool):
    fam, allp = {}, []
    for m in pool:
        A = m['A']
        if A not in S_ELEM or start_state(m) == 'gas':
            continue
        c = (s298(m['key']) - m['comp'][A] * S_ELEM[A]) / m['comp'][m['B']]
        fam.setdefault(m['B'], []).append(c); allp.append(c)
    glob = sum(allp) / len(allp)
    return {b: (sum(c) / len(c) if len(c) >= 3 else glob) for b, c in fam.items()}, glob

gas_pts = [(atoms(m['comp']), s298(m['key'])) for m in real if start_state(m) == 'gas']
GAS_S = lstsq(gas_pts) if len(gas_pts) >= 2 else (30.0, 150.0)

def est_s(m, sfit):
    if start_state(m) == 'gas':
        return GAS_S[0] * atoms(m['comp']) + GAS_S[1]
    fam, glob = sfit
    A = m['A']
    return m['comp'][A] * S_ELEM.get(A, 40.0) + m['comp'][m['B']] * fam.get(m['B'], glob)

HFIT, SFIT = fit_h(real), fit_s(real)

# leave-one-out errors: how well the estimate would do on a compound it had not seen
loo = []
for k, m in enumerate(real):
    rest = real[:k] + real[k + 1:]
    eh = est_h(m, fit_h(rest)); es = est_s(m, fit_s(rest))
    loo.append((m, h298(m['key']), eh, s298(m['key']), es))

# ---------- estimates for everything else ----------
DSF_ATOM = 9.2                      # Richards' rule: entropy of melting per atom, J/mol K
DSV = 88.0                          # Trouton's rule: entropy of boiling, J/mol K
for m in mats:
    if m['key'] in result:
        continue
    comp, n = m['comp'], atoms(m['comp'])
    tm = m['melt'] + 273.15 if m['melt'] is not None and m['melt'] < 9000 else None
    tb = m['boil'] + 273.15 if m['boil'] is not None and m['boil'] < 9000 else None
    state = start_state(m)
    cp = 3 * R * n if state != 'gas' else R * (2.5 + 1.5 * n)    # Dulong-Petit / Neumann-Kopp; ideal gas
    if m.get('element'):
        el = next(iter(comp))
        if el in ELEMENT_S:
            H, S, how = 0.0, ELEMENT_S[el], 'textbook'
        else:
            H, S, how = 0.0, (40.0 if state != 'gas' else 150.0), 'estimate'
    elif formula(comp) in TEXTBOOK:
        H, S = TEXTBOOK[formula(comp)]; how = 'textbook'
    elif m.get('B'):
        H, S, how = est_h(m, HFIT), est_s(m, SFIT), 'estimate'
    else:
        continue                                                  # (nothing left without a formula family)
    result[m['key']] = piecewise(H * 1000, S, cp, tm, tb, DSF_ATOM * n, DSV, state)
    src[m['key']] = how

# ---------- write the table ----------
SRC = {'nasa': 0, 'textbook': 1, 'estimate': 2}
lines = ['// Generated by tools/gen_thermo.py from NASA TM-4513 thermodynamic data (via Cantera) and fitted',
         '// estimates. Do not edit by hand.',
         '// For each material: [source, H at each temperature..., G at each temperature...], per formula unit, kJ/mol.',
         '// source: 0 NASA tables, 1 textbook value, 2 estimate. H is 0 for elements in their usual form at 298 K.',
         'export const THERMO_T = ' + json.dumps(TG) + ';',
         'export const THERMO = {']
for m in mats:
    if m['key'] not in result:
        continue
    gs = [round(g / 1000, 1) for g, h in result[m['key']]]
    hs = [round(h / 1000, 1) for g, h in result[m['key']]]
    lines.append('  %s: %s,' % (json.dumps(m['key']), json.dumps([SRC[src[m['key']]]] + hs + gs, separators=(',', ':'))))
lines.append('};')
open(os.path.join(HERE, '..', 'src', 'sim', 'thermo.gen.js'), 'w').write('\n'.join(lines) + '\n')

# ---------- report ----------
def G(key, T):
    tab = result[key]
    for k in range(len(TG) - 1):
        if T <= TG[k + 1]:
            f = (T - TG[k]) / (TG[k + 1] - TG[k])
            return (tab[k][0] + f * (tab[k + 1][0] - tab[k][0])) / 1000
    return tab[-1][0] / 1000

def dG(side_l, side_r, T):
    return sum(c * G(k, T) for k, c in side_r) - sum(c * G(k, T) for k, c in side_l)

def crossing(side_l, side_r, lo=300, hi=3500):
    """lowest temperature at which the reaction runs (dG < 0), or None"""
    prev = dG(side_l, side_r, lo)
    if prev < 0:
        return lo
    for T in range(lo + 10, hi + 1, 10):
        if dG(side_l, side_r, T) < 0:
            return T
    return None

key_of = {formula(m['comp']): m['key'] for m in mats}
k = lambda f: key_of.get(f, 'cpd_' + f)
rep = ['# Energy data report', '',
       'Generated by `tools/gen_thermo.py`. Sources: NASA TM-4513 tables (via Cantera), a few textbook values,',
       'and estimates fitted to the real values.', '']
counts = {}
for m in mats:
    if m['key'] in src:
        kind = 'element' if m.get('element') else 'compound'
        counts.setdefault((kind, src[m['key']]), 0)
        counts[(kind, src[m['key']])] += 1
rep += ['## Where the numbers come from', '', '| | NASA | textbook | estimate |', '|---|---|---|---|']
for kind in ('element', 'compound'):
    rep.append('| %ss | %d | %d | %d |' % (kind, counts.get((kind, 'nasa'), 0), counts.get((kind, 'textbook'), 0), counts.get((kind, 'estimate'), 0)))
missing = [m['key'] for m in mats if m['key'] not in result]
rep += ['', 'Not covered: ' + (', '.join(missing) if missing else 'none') + '.', '']

errs_h = sorted(abs(e - r) for _, r, e, _, _ in loo)
rel_h = sorted(abs(e - r) / max(20, abs(r)) for _, r, e, _, _ in loo)
errs_s = sorted(abs(e - r) for _, _, _, r, e in loo)
med = lambda a: a[len(a) // 2]
p80 = lambda a: a[int(len(a) * 0.8)]
rep += ['## How good the estimates are', '',
        'Each of the %d compounds with real data was estimated from a fit to the other ones (leave one out):' % len(loo), '',
        '| | typical error (median) | 4 in 5 within |', '|---|---|---|',
        '| enthalpy of formation | %.0f kJ/mol (%.0f%%) | %.0f kJ/mol |' % (med(errs_h), 100 * med(rel_h), p80(errs_h)),
        '| entropy at 25 °C | %.0f J/mol K | %.0f J/mol K |' % (med(errs_s), p80(errs_s)), '',
        'Fitted rule, per family of the electron-taking element B: dHf = bonds x (b + a x dX^2 + c x q), dX the',
        'electronegativity difference, q the metal\'s charge, bonds = atoms of B x its usual charge.', '',
        '| family | a | b | c | compounds |', '|---|---|---|---|---|']
famcount = {}
for m in real:
    famcount[m['B']] = famcount.get(m['B'], 0) + 1
for b, (c0, c1, c2) in sorted(HFIT[0].items(), key=lambda x: -famcount.get(x[0], 0)):
    rep.append('| %s | %.0f | %.0f | %.0f | %d%s |' % (b, c1, c0, c2, famcount.get(b, 0), '' if famcount.get(b, 0) >= 6 else ' (uses the overall fit)'))
rep += ['', 'Worst estimates (real vs estimated enthalpy of formation, kJ/mol):', '']
for m, r, e, _, _ in sorted(loo, key=lambda x: -abs(x[2] - x[1]))[:8]:
    rep.append('- %s (%s): real %.0f, estimate %.0f' % (formula(m['comp']), m['name'], r, e))

checks = [
    ('Carbon smelts iron oxide (2 Fe2O3 + 3 C -> 4 Fe + 3 CO2)', [(k('Fe2O3'), 2), ('C', 3)], [('Fe', 4), (k('CO2'), 3)]),
    ('Carbon smelts alumina (2 Al2O3 + 3 C -> 4 Al + 3 CO2)', [(k('Al2O3'), 2), ('C', 3)], [('Al', 4), (k('CO2'), 3)]),
    ('Carbon smelts zinc oxide (2 ZnO + C -> 2 Zn + CO2)', [(k('ZnO'), 2), ('C', 1)], [('Zn', 2), (k('CO2'), 1)]),
    ('Hydrogen reduces copper oxide (CuO + H2 -> Cu + H2O)', [(k('CuO'), 1), ('H', 2)], [('Cu', 1), (k('H2O'), 1)]),
    ('Hydrogen reduces zinc oxide (ZnO + H2 -> Zn + H2O)', [(k('ZnO'), 1), ('H', 2)], [('Zn', 1), (k('H2O'), 1)]),
    ('Mercury oxide falls apart (HgO -> Hg + O)', [(k('HgO'), 1)], [('Hg', 1), ('O', 1)]),
    ('Silver oxide falls apart (Ag2O -> 2 Ag + O)', [(k('Ag2O'), 1)], [('Ag', 2), ('O', 1)]),
    ('Iron burns (4 Fe + 6 O -> 2 Fe2O3)', [('Fe', 4), ('O', 6)], [(k('Fe2O3'), 2)]),
    ('Gold burns (Au + O)', [('Au', 2), ('O', 3)], [(k('Au2O3'), 1)]),
    ('Thermite (2 Al + Fe2O3 -> Al2O3 + 2 Fe)', [('Al', 2), (k('Fe2O3'), 1)], [(k('Al2O3'), 1), ('Fe', 2)]),
    ('Nitrogen and hydrogen (N + 3 H -> NH3)', [('N', 1), ('H', 3)], [(k('NH3'), 1)]),
]
rep += ['', '## Sanity checks: what the numbers say should happen', '',
        'In the game an element cell stands for one atom-sized unit, so O is half an O2, H half an H2.', '',
        '| reaction | dG at 25 °C | runs from | heat at 25 °C | data |', '|---|---|---|---|---|']
for label, l, r in checks:
    try:
        g0 = dG(l, r, 298.15)
        h0 = sum(c * result[kk][0][1] for kk, c in r) / 1000 - sum(c * result[kk][0][1] for kk, c in l) / 1000
        cr = crossing(l, r)
        srcs = '/'.join(sorted({src[kk] for kk, _ in l + r}))
        rep.append('| %s | %.0f kJ | %s | %.0f kJ | %s |' % (label, g0, ('%d °C' % (cr - 273) if cr else 'never (below 3500 K)'), -h0, srcs))
    except KeyError as e:
        rep.append('| %s | (missing %s) | | | |' % (label, e))
open(os.path.join(HERE, 'thermo-report.md'), 'w').write('\n'.join(rep) + '\n')
print('\n'.join(rep))
