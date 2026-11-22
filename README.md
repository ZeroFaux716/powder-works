# Powder Works

A falling-sand sandbox where the chemistry and the machines are the same world: burn fuel in a cylinder and the
pressure drives a real piston, crank and flywheel. Powder Toy's materials and reactions, Algodoo's rigid parts,
hinges, motors, sliders and springs.

- Every element of the periodic table, with melting, boiling, heat capacity and density from real data
- Compounds worked out from electronegativity and valence (about 980 of them), acids, lye, smelting, thermite
- Gas pressure, flow with momentum, a gas law, heat, latent heat, liquids under pressure, buoyancy, radioactivity
- Boiling points that rise with pressure, so a sealed boiler builds steam and settles at a steady pressure
- Rigid parts built from cells, which melt, burn, rust and break apart
- Parts can be drawn over other parts and pass through the ones they cover, so you can build a crank, a
  piston and a connecting rod yourself
- Circuits: contacts, wire, switches, sensors, inverters, spark plugs, injectors, valves, heaters, pumps, electrodes
- Scenes: a two-stroke engine, an oil refinery, a chemistry bench, a reactor and more
- Undo/redo, save/open, five views (materials, pressure, heat, flow, burnt gas)
- Powder Toy's drawing keys: Shift-drag a line, Ctrl-drag (Cmd on a Mac) a filled box, Alt snaps them to 45° and
  squares, Ctrl+Shift-click fills an area. They work with every painting tool, including Part
- An adjustable grid (2 to 16 cells) with Snap, which locks lines, boxes, Block corners, joints and moved parts to it
- Compounds you discover stay in Made so far between visits and travel in save files

Play it at **https://zerofaux716.github.io/powder-works/** (rebuilt automatically from `main` whenever the checks pass).

## Layout

- `index.html`: the page's markup
- `src/sim/`: the simulation, as ES modules (no DOM; runs in Node for the tests):
  - `constants.js`, `materials.js`, `chemdata.js`, `tables.js`: the data
  - `grid.js`: the cell arrays, the physics world, and `G`, the shared state several modules change
  - `reactions.js` (heat, burning, chemistry, distilling), `electrics.js`, `neutrons.js`, `cells.js` (each cell's own update)
  - `flow.js` (pressure, gas and heat flow), `parts.js` (rigid parts), `joints.js`
  - `world.js` (one step, snapshots), `editing.js` (painting and filling), `scenes.js`
  - `energy.js`: chemistry driven by energy. Whether elements combine (only where that lowers the Gibbs
    energy), how hot it gets (from the enthalpy), when compounds fall apart, and which element wins when a
    compound meets another (per shared atom, the lower Gibbs energy, as on an Ellingham diagram: smelting,
    thermite, displacement), all from `thermo.gen.js`; how fast is Arrhenius' law with a calibrated barrier
  - `sleep.js`: chunk sleeping. The gas, heat and air passes skip 16x16 chunks where everything has settled;
    a scan each frame wakes any chunk where something changed, and its neighbours
  - `index.js`: re-exports everything, plus the `Sim` object the tests use
- `src/ui.js`: the page's behaviour; `src/style.css`: its look
- `src/main.js` and `vite.config.js`: the entry point. For now the simulation and the page share one scope
  (the page reads the simulation's arrays directly), so the config joins them into one module.
- `tests/checks/`: self-checking tests. `npm test` runs them all (under 4 minutes) and reports pass or fail
  for each: every material simulates cleanly, gases layer, edges, springs and Rewind, the engine and crank,
  compounds and acids, thermite, the refinery's jars, the components scene, hydraulics, the fan wheel, the
  diesel hammer, critical mass, building parts over parts, steam, chunk sleeping, and energy-driven chemistry (sealed boilers, boiling under pressure, the steam piston). Math.random is seeded, so a run gives the same numbers every time.
  `node --test tests/checks/engine.test.js` runs one file.
- `tests/explore/`: the older scripts that print measurements rather than pass or fail, handy when tuning
  (`node tests/explore/test15.js` prints the engine's rpm, firings and fuel every 2 s)
- `tools/`: generators for the element and chemistry data tables (from Periodic-Table-JSON)
  - `gen_thermo.py`: energy data (enthalpy and Gibbs energy against temperature) for every chemical material,
    into `src/sim/thermo.gen.js`, from NASA's thermodynamic tables (TM-4513, via Cantera's `data/` folder),
    textbook values, and estimates fitted to the real values. `tools/thermo-report.md` says where each number
    came from, how good the estimates are, and checks reactions against what really happens. To rebuild:
    `node tools/dump_chem.mjs > tools/chem_materials.json && python3 tools/gen_thermo.py <cantera>/data`

## Running

    npm install
    npm run dev        # live-reloading copy at http://localhost:5173
    npm run build      # the deployable page in dist/
    npm run preview    # serve dist/ to check the build

## Versions

The version lives in `package.json` and shows in the bottom-right corner with the commit the site was built
from (hover it for the build time). Bump the last number for fixes (0.1.0 → 0.1.1) and the middle one for new
features (0.1.0 → 0.2.0), then tag the commit: `git tag v0.2.0 && git push origin v0.2.0`. Save files carry
their own format number (`version`), which only changes when the save layout does, plus the game version that
wrote them (`game`).
