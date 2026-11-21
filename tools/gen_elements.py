import json, sys
d = json.load(open(sys.argv[1]))['elements'][:118]
K = dict(H=.18, He=.15, Li=85, Be=200, B=27, C=120, N=.026, O=.027, F=.028, Ne=.049, Na=142, Mg=156, Al=237, Si=150, P=.24, S=.2, Cl=.009, Ar=.018,
 K=102, Ca=200, Sc=16, Ti=22, V=31, Cr=94, Mn=7.8, Fe=80, Co=100, Ni=91, Cu=401, Zn=116, Ga=29, Ge=60, As=50, Se=.5, Br=.12, Kr=.009,
 Rb=58, Sr=35, Y=17, Zr=23, Nb=54, Mo=138, Tc=51, Ru=117, Rh=150, Pd=72, Ag=429, Cd=97, In=82, Sn=67, Sb=24, Te=3, I=.45, Xe=.006,
 Cs=36, Ba=18, La=13, Ce=11, Pr=13, Nd=17, Pm=15, Sm=13, Eu=14, Gd=11, Tb=11, Dy=11, Ho=16, Er=15, Tm=17, Yb=39, Lu=16,
 Hf=23, Ta=57, W=173, Re=48, Os=88, Ir=147, Pt=72, Au=318, Hg=8.3, Tl=46, Pb=35, Bi=8, Po=20, At=2, Rn=.004,
 Fr=15, Ra=19, Ac=12, Th=54, Pa=47, U=27, Np=6, Pu=6, Am=10, Cm=10)
FAM_COLOR = dict(alkali=(200,198,205), alkaline=(190,192,186), transition=(165,172,182), post=(176,180,188), metalloid=(108,114,128),
 lanthanide=(196,196,184), actinide=(170,186,172), noble=(200,200,220), nonmetal=(150,150,150), halogen=(150,150,150))
COLOR = dict(H=(206,224,255), He=(255,214,232), Li=(200,200,210), B=(74,64,56), C=(54,54,60), N=(150,168,224), O=(168,212,255), F=(224,236,150), Ne=(255,150,120),
 Na=(208,206,190), Mg=(204,208,214), Al=(190,197,206), Si=(88,98,116), P=(236,224,196), S=(228,210,72), Cl=(190,226,90), Ar=(190,160,255),
 K=(192,188,204), Ti=(152,156,166), Cr=(198,206,216), Fe=(159,179,200), Co=(150,160,192), Ni=(188,188,172), Cu=(204,124,82), Zn=(172,182,194), Ga=(178,194,212),
 Ge=(140,146,152), As=(120,124,128), Se=(132,72,72), Br=(152,52,30), Kr=(170,235,235), Ag=(224,226,230), Sn=(210,210,204), Sb=(170,176,186), Te=(150,150,160),
 I=(74,44,96), Xe=(130,170,255), Cs=(214,196,140), W=(112,116,126), Os=(150,170,202), Pt=(214,214,208), Au=(238,192,70), Hg=(192,198,208), Pb=(98,102,116),
 Bi=(206,182,196), At=(62,52,62), Rn=(150,230,170), U=(122,142,122), Pu=(150,152,140), Ts=(84,84,94), Og=(200,200,220))
POWDER = set('Li Na K Rb Cs Fr Ca Sr Ba C P S Se I At'.split())
HAL = dict(F=1, Cl=.5, Br=.25, I=.1, At=.05)
WET = dict(Li=(.03,150), Na=(.08,350), K=(.2,750), Rb=(.35,900), Cs=(.5,1100), Fr=(.5,1100), Ca=(.015,90), Sr=(.02,110), Ba=(.04,160))
BURN = dict(H="{ at: 500, fast: true, burst: 8, heat: 1500, life: 6, product: 'water' }", C="{ at: 700, heat: 1150, rate: 0.003 }",
 Mg="{ at: 630, heat: 2800, rate: 0.012 }", S="{ at: 232, heat: 720, rate: 0.006 }", P="{ at: 34, heat: 1300, rate: 0.02 }",
 Li="{ at: 180, heat: 1400, rate: 0.01 }", Ca="{ at: 790, heat: 2200, rate: 0.01 }", Ti="{ at: 1200, heat: 3000, rate: 0.008 }", Zr="{ at: 1000, heat: 3000, rate: 0.008 }")
NOBLE_METAL = dict(Au=0, Pt=0, Ir=0, Os=0, Ru=0, Rh=0, Pd=0, Ag=.02)
REACT = dict(alkali=1, alkaline=.6, lanthanide=.3, actinide=.3, transition=.05, post=.05)
DIATOMIC = set('H N O F Cl Br I'.split())
def fam(e):
    s, c = e['symbol'], e['category']
    if s in ('F','Cl','Br','I','At','Ts'): return 'halogen'
    if 'noble' in c: return 'noble'
    if 'alkali metal' in c: return 'alkali'
    if 'alkaline' in c: return 'alkaline'
    if 'post-transition' in c: return 'post'
    if 'transition' in c: return 'transition'
    if 'metalloid' in c: return 'metalloid'
    if 'lanthanide' in c: return 'lanthanide'
    if 'actinide' in c: return 'actinide'
    return 'nonmetal'
def c(v):
    v = v - 273.15
    return round(v, 1) if abs(v) < 100 else round(v)
out = []
for e in d:
    s, z, f = e['symbol'], e['number'], fam(e)
    est = e['melt'] is None or e['boil'] is None or e['density'] is None or 'unknown' in e['category']
    melt = c(e['melt']) if e['melt'] is not None else 1800
    boil = c(e['boil']) if e['boil'] is not None else melt + 1500
    if s == 'C': melt = boil = 3642          # sublimes
    if s == 'As': melt = boil = 615          # sublimes
    if s == 'P': boil = 280
    if s == 'Og': melt = 52
    if s == 'He': melt = -272.2
    if boil < melt: boil = melt
    dens = e['density'] if e['density'] is not None else 10
    if e['phase'] == 'Gas': dens = round(dens / 1000, 6)
    k = K.get(s, 15)
    col = COLOR.get(s)
    if col is None:
        base = FAM_COLOR[f]
        h = (z * 2654435761) & 0xffffffff
        col = tuple(max(0, min(255, base[i] + ((h >> (8 * i)) & 31) - 15)) for i in range(3))
    M = e['atomic_mass'] * (2 if s in DIATOMIC else 1)
    extra = ["family: '%s'" % f]
    lift = 1 if M < 24 else -1 if M > 34 else 0
    if lift: extra.append('lift: %d' % lift)
    if s in POWDER: extra.append('powder: true')
    if s in WET: extra.append('wet: { p: %g, gasTemp: %d }' % WET[s])
    if s in BURN: extra.append('burn: ' + BURN[s])
    if s in HAL: extra.append('hal: %g' % HAL[s])
    r = NOBLE_METAL.get(s, 0.3 if s == 'Al' else REACT.get(f, 0))
    if r: extra.append('react: %g' % r)
    # heat capacity per volume, as a fraction of water's (4.18 J per cm3 per K), from molar heat capacity
    mh = e.get('molar_heat')
    cap = mh / e['atomic_mass'] * dens / 4.18 if mh and e['phase'] != 'Gas' else 0.5
    extra.append('cap: %.2f' % max(0.25, min(1.2, cap)))
    metal = f in ('alkali', 'alkaline', 'transition', 'post', 'lanthanide', 'actinide')
    if not metal: extra.append('soft: true')
    if est: extra.append('est: true')
    out.append("el('%s', '%s', %d, %s, %s, %s, %s, [%d, %d, %d], { %s });" % (s, e['name'], z, melt, boil, dens, k, col[0], col[1], col[2], ', '.join(extra)))
print('\n'.join(out))
