import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Every run record is stamped with these, so analytics can compare balance changes across versions.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'dev'; }
}

// Relative base so the build works on GitHub Pages under any repo name.
export default defineConfig({
  base: './',
  define: {
    __GAME_VERSION__: JSON.stringify(pkg.version),
    __GAME_BUILD__: JSON.stringify(gitSha()),
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: { manualChunks: { phaser: ['phaser'] } },
    },
  },
});
