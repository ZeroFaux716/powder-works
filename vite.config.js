import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// The simulation (src/sim.js) and the page (src/ui.js) share one scope: the page reads the simulation's
// arrays directly. Until they are split into proper modules, this joins them into one module, with the
// physics library imported under the name they expect.
const GAME_PARTS = ['src/sim.js', 'src/ui.js'];

export default defineConfig({
  base: './',
  plugins: [{
    name: 'powder-works-game',
    resolveId(id) { if (id === 'virtual:game') return '\0virtual:game'; },
    load(id) {
      if (id !== '\0virtual:game') return;
      const files = GAME_PARTS.map(f => path.resolve(f));
      files.forEach(f => this.addWatchFile(f));
      return "import * as planck from 'planck';\n" + files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
    },
    handleHotUpdate({ file, server }) {
      if (GAME_PARTS.some(p => file.endsWith(p))) { server.ws.send({ type: 'full-reload' }); return []; }
    }
  }]
});
