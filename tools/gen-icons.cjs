// Regenerates src/ui/icons.ts from the Lucide and Tabler outline sets. Edit SET below, then (from the repo root):
//   npm i --no-save lucide-static @tabler/icons && node tools/gen-icons.cjs
// Both packages are dev-time only; nothing is fetched at runtime. See docs/icons.md.
const fs = require('fs');
const L = 'node_modules/lucide-static/icons/', T = 'node_modules/@tabler/icons/icons/outline/';
// [our name, library, library icon name]
const SET = [
  ['book', 'l', 'book-open'], ['grid', 'l', 'layout-grid'], ['square', 'l', 'square'], ['layers', 'l', 'layers'], ['x', 'l', 'x'], ['lock', 'l', 'lock'],
  ['gem', 'l', 'gem'], ['backpack', 'l', 'backpack'], ['form', 'l', 'wand-sparkles'], ['core', 'l', 'circle-dot'], ['behavior', 't', 'arrows-split-2'],
  ['trigger', 'l', 'zap'], ['modifier', 'l', 'wrench'], ['spell', 'l', 'sparkles'], ['react', 'l', 'flask-conical'], ['forge', 'l', 'hammer'], ['stats', 'l', 'chart-bar'],
  ['damage', 't', 'bolt'], ['cooldown', 'l', 'timer'], ['dps', 'l', 'activity'], ['runes', 'l', 'puzzle'], ['cost', 'l', 'diamond'], ['plus', 'l', 'plus'],
  ['launch', 'l', 'corner-down-right'], ['check', 'l', 'check'], ['link', 'l', 'link'], ['none', 'l', 'ban'], ['dna', 'l', 'dna'], ['coins', 'l', 'coins'], ['search', 'l', 'search'],
];
const lines = SET.map(([n, lib, id]) => {
  let svg = fs.readFileSync((lib === 'l' ? L : T) + id + '.svg', 'utf8');
  svg = svg.replace(/<!--[\s\S]*?-->/g, '');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '')
    .replace(/<path[^>]*stroke="none"[^>]*\/>/g, '')   // tabler's invisible 24x24 bounding path
    .replace(/\s+/g, ' ').trim();
  return `  ${n}: ${JSON.stringify(inner)}, // ${lib === 'l' ? 'Lucide' : 'Tabler'} ${id}`;
});
const out = `// Inline SVG icons for the UI chrome. Generated from the Lucide (ISC) and Tabler (MIT) outline sets; see docs/icons.md.
// Only the icons below ship. Rune and element icons are emoji in src/data and are not part of this set.
const PATHS = {
${lines.join('\n')}
} as const;

export type IconName = keyof typeof PATHS;

/** An inline SVG that inherits the surrounding text colour and scales with \`size\` (px). */
export function icon(name: IconName, size = 14): string {
  return \`<svg class="ico" viewBox="0 0 24 24" width="\${size}" height="\${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">\${PATHS[name]}</svg>\`;
}
`;
fs.writeFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'icons.ts'), out);
console.log(SET.length, 'icons');
