import { render } from './vendor/painter/painter.mjs';
import type { Draft, Depiction } from './model.ts';

export function colorBackground(draft: Draft): string {
  return draft.paintMode === 'halo'
    ? `radial-gradient(circle, ${draft.Color1} 48%, ${draft.Color2} 72%)`
    : `linear-gradient(135deg, ${draft.Color1} 50%, ${draft.Color2} 50%)`;
}
export const asImage = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
function nested(svg: string, prefix: string) {
  return svg.replace(/<\?xml[^>]*\?>/g, '')
    .replace(/width="(?:42|96|220)" height="(?:42|96|220)"/, 'width="512" height="512"')
    .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^)]*)\)/g, `url(#${prefix}-$1)`);
}
export function renderPalettePainting({ family, seed, base, accent, target, label, mode }: {
  family: string; seed: number; base: string; accent: string; target: number; label: string; mode: 'solid' | 'split' | 'halo';
}): string {
  const paint = (first: string, second: string) => render(family, seed, first, second, target, label);
  if (mode === 'solid') return asImage(paint(base, accent));
  const a = nested(paint(base, accent), 'primary');
  const b = nested(paint(accent, base), 'secondary');
  const mask = mode === 'halo'
    ? '<defs><radialGradient id="halo"><stop offset="48%" stop-color="black"/><stop offset="85%" stop-color="white"/></radialGradient><mask id="field"><rect width="512" height="512" fill="url(#halo)"/></mask></defs>'
    : '<defs><mask id="field"><rect width="512" height="512" fill="black"/><path d="M512 0V512H0Z" fill="white"/></mask></defs>';
  return asImage(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${mask}${a}<g mask="url(#field)">${b}</g></svg>`);
}
/** Same geometry and seed, different palette fields; no bitmap tint or new RNG. */
export function renderDiscPainting({ draft, depiction }: { draft: Draft; depiction: Depiction }): string {
  if (depiction.kind === 'photo') return depiction.src;
  const families = ['pressed-fern', 'chevron-run', 'contour-basin'];
  const index = families.indexOf(depiction.name);
  if (index < 0) throw new Error('Unknown painting family.');
  // {?} Preserve a per-specimen geometry seed when we expose more than family selection.
  return renderPalettePainting({
    family: depiction.name, seed: 40 + index,
    base: draft.colorPainting ? draft.Color1 : '#f8f1dc', accent: draft.colorPainting ? draft.Color2 : '#24594b',
    target: 220, label: draft.nickname, mode: draft.colorPainting ? draft.paintMode : 'solid',
  });
}
