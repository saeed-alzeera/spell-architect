# UI icons

Editor chrome (tabs, filters, legend, stat tiles, add/remove buttons, relic bar) uses inline SVG icons from two open-source sets:

- [Lucide](https://github.com/lucide-icons/lucide) (ISC)
- [Tabler Icons](https://github.com/tabler/tabler-icons) (MIT)

`src/ui/icons.ts` holds only the icons we use, as `icon(name, size)` returning an inline `<svg>` that inherits `currentColor`. The file is generated: edit the `SET` list in `tools/gen-icons.cjs` and run it (the header comment has the command). Each entry in `icons.ts` notes which library and icon it came from. Nothing is fetched at runtime and neither package is a project dependency.

Rune, element, trigger and relic icons are emoji in the data files (`src/data`, `src/game/relics.ts`) and are not part of this set. Prefer an icon plus a tooltip (`title`) over a text label when space is tight.
