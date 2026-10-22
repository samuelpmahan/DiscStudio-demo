/** Pure frame seam. Scene snapshots contain explicit dimensions, ordered layers,
 * transforms, and optional timed states. No clock, persistence, or approvals.
 * Raster cache keys are exact immutable identities; composition runs every seek.
 */
export function frameStateAt(snapshot, t) {
  if (!Number.isFinite(t) || t < 0) throw Error('seek time must be finite and non-negative');
  const states = snapshot.states;
  if (!states) return snapshot;
  if (!states.length || states.some((s, i) => !Number.isFinite(s.t) || s.t < 0 || (i && s.t <= states[i - 1].t))) throw Error('Explicit states must have increasing seek times');
  const state = [...states].reverse().find(s => s.t <= t);
  if (!state) throw Error('No explicit frame state at this time');
  return { ...snapshot, ...state, states: undefined };
}
export function createFrameRenderer({ createCanvas, maxLayers = 24 }) {
  const retained = new Map();
  let totals = { rasterized: 0, reused: 0, composited: 0, seeks: 0 };
  function seek(context, snapshot, t) {
    const state = frameStateAt(snapshot, t), { width, height, layers } = state;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !Array.isArray(layers)) throw Error('Explicit frame dimensions and layers required');
    const ids = new Set(), receipt = { t, rasterized: [], reused: [], composited: [], width, height };
    context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, width, height);
    for (const layer of layers) {
      if (!layer.id || !layer.identity || ids.has(layer.id)) throw Error('Frame layers need unique stable IDs and exact identities');
      ids.add(layer.id);
      const key = JSON.stringify([layer.id, layer.identity, layer.width ?? width, layer.height ?? height]);
      let raster = retained.get(key);
      if (raster) { retained.delete(key); retained.set(key, raster); receipt.reused.push(layer.id); totals.reused++; }
      else {
        raster = createCanvas(layer.width ?? width, layer.height ?? height);
        const rasterContext = raster.getContext('2d');
        layer.draw(rasterContext);
        retained.set(key, raster); receipt.rasterized.push(layer.id); totals.rasterized++;
        while (retained.size > maxLayers) retained.delete(retained.keys().next().value);
      }
      const transform = layer.transform ?? { scale: 1, dx: 0, dy: 0 };
      context.save();
      context.translate(width / 2 + transform.dx * width, height / 2 + transform.dy * height);
      context.scale(transform.scale, transform.scale);
      context.drawImage(raster, (layer.x ?? 0) - width / 2, (layer.y ?? 0) - height / 2);
      context.restore(); receipt.composited.push(layer.id); totals.composited++;
    }
    context.restore(); totals.seeks++;
    return Object.freeze({ ...receipt, totals: { ...totals }, retainedLayers: retained.size });
  }
  return { seek, bind: (context, snapshot) => t => seek(context, snapshot, t), metrics: () => ({ ...totals, retainedLayers: retained.size }), clear: () => retained.clear() };
}
export function imageLayer(id, identity, image, width, height, transform) {
  return { id, identity, width, height, transform, draw: context => context.drawImage(image, 0, 0, width, height) };
}
