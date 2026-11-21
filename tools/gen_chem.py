# Emits the per-element chemistry data line for sim.js: electronegativity (Pauling) and atomic mass,
# from the open Periodic-Table-JSON dataset. Usage: python3 gen_chem.py PeriodicTableJSON.json
import json, sys
d = json.load(open(sys.argv[1]))['elements'][:118]
parts = []
for e in d:
    en = e.get('electronegativity_pauling')
    parts.append('%s:%s:%s' % (e['symbol'], '' if en is None else en, round(e['atomic_mass'], 2)))
print("const CHEM_DATA = '" + ' '.join(parts) + "';")
