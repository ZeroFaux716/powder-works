import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

// The version shown in the corner: package.json's version, the commit the build came from, and when.
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
let commit = 'dev';
try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git checkout */ }

export default defineConfig(({ command }) => ({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT__: JSON.stringify(command === 'serve' ? 'dev' : commit),
    __BUILT__: JSON.stringify(new Date().toISOString())
  }
}));
