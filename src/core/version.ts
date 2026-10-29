// Injected by vite.config.ts at build time. GAME_VERSION is package.json's version: bump it whenever a change affects
// gameplay or balance, so run analytics can tell versions apart. GAME_BUILD is the git commit of the build.
declare const __GAME_VERSION__: string;
declare const __GAME_BUILD__: string;

export const GAME_VERSION = typeof __GAME_VERSION__ === 'string' ? __GAME_VERSION__ : 'dev';
export const GAME_BUILD = typeof __GAME_BUILD__ === 'string' ? __GAME_BUILD__ : 'dev';
export const versionLabel = () => `v${GAME_VERSION} (${GAME_BUILD})`;
