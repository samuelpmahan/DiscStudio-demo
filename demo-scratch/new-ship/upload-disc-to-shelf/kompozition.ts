export const activeOverlays = Object.freeze([] as string[]);

export const kompozition = Object.freeze({
  id: 'discstudio-demo-photo-first',
  overlays: activeOverlays,
  capabilities: Object.freeze({
    paintedDiscs: activeOverlays.includes('painted-discs'),
  }),
});

export const paintedDiscsEnabled = kompozition.capabilities.paintedDiscs;
