# Powder Works

A falling-sand sandbox where the chemistry and the machines are the same world: burn fuel in a cylinder and the
pressure drives a real piston, crank and flywheel. Powder Toy's materials and reactions, Algodoo's rigid parts,
hinges, motors, sliders and springs.

- Every element of the periodic table, with melting, boiling, heat capacity and density from real data
- Compounds worked out from electronegativity and valence (about 980 of them), acids, lye, smelting, thermite
- Gas pressure, flow with momentum, a gas law, heat, latent heat, liquids under pressure, buoyancy, radioactivity
- Rigid parts built from cells, which melt, burn, rust and break apart
- Circuits: contacts, wire, switches, sensors, inverters, spark plugs, injectors, valves, heaters, pumps, electrodes
- Scenes: a two-stroke engine, an oil refinery, a chemistry bench, a reactor and more
- Undo/redo, save/open, five views (materials, pressure, heat, flow, burnt gas)

Play it at **https://zerofaux716.github.io/powder-works/** (rebuilt automatically from `main` whenever the checks pass).

## Layout

- `index.html`: the page's markup
- `src/sim/`: the simulation, as ES modules (no DOM; runs in Node for the tests):
  - `constants.js`, `materials.js`, `chemdata.js`, `tables.js`: the data
  - `grid.js`: the cell arrays, the physics world, and `G`, the shared state several modules change
  - `reactions.js` (heat, burning, chemistry, distilling), `electrics.js`, `neutrons.js`, `cells.js` (each cell's own update)
  - `flow.js` (pressure, gas and heat flow), `parts.js` (rigid parts), `joints.js`
  - `world.js` (one step, snapshots), `editing.js` (painting and filling), `scenes.js`
  - `index.js`: re-exports everything, plus the `Sim` object the tests use
- `src/ui.js`: the page's behaviour; `src/style.css`: its look
- `src/main.js` and `vite.config.js`: the entry point. For now the simulation and the page share one scope
  (the page reads the simulation's arrays directly), so the config joins them into one module.
- `tests/checks/`: self-checking tests. `npm test` runs them all (under 3 minutes) and reports pass or fail
  for each: every material simulates cleanly, gases layer, edges, springs and Rewind, the engine and crank,
  compounds and acids, thermite, the refinery's jars, the components scene, hydraulics, the fan wheel, the
  diesel hammer, and critical mass. Math.random is seeded, so a run gives the same numbers every time.
  `node --test tests/checks/engine.test.js` runs one file.
- `tests/explore/`: the older scripts that print measurements rather than pass or fail, handy when tuning
  (`node tests/explore/test15.js` prints the engine's rpm, firings and fuel every 2 s)
- `tools/`: generators for the element and chemistry data tables (from Periodic-Table-JSON)

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
