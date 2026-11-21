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

## Layout

- `src/sim.js`: the simulation (no DOM; runs in Node for the tests)
- `src/ui.js`, `src/body.html`, `src/head.html`, `src/add2.css`: the page
- `build.py`: stitches `src/` into a single page, `dist/index.html`
- `tests/`: headless scene tests (`node tests/test15.js` runs the engine)
- `tools/`: generators for the element and chemistry data tables (from Periodic-Table-JSON)

## Running

    npm install          # planck, for the tests
    python3 build.py     # then open dist/index.html

The page loads Planck.js (a port of Box2D) from jsDelivr.
