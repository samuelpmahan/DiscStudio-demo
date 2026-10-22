/** One cover crop for preview and combined scene export. */
export function coverSourceRect(sourceWidth, sourceHeight, frameWidth, frameHeight) {
  if (![sourceWidth, sourceHeight, frameWidth, frameHeight].every(value => Number.isFinite(value) && value > 0)) throw Error('Background and frame dimensions must be positive');
  const frameRatio = frameWidth / frameHeight, sourceRatio = sourceWidth / sourceHeight;
  if (sourceRatio > frameRatio) {
    const width = sourceHeight * frameRatio;
    return { x: (sourceWidth - width) / 2, y: 0, width, height: sourceHeight };
  }
  const height = sourceWidth / frameRatio;
  return { x: 0, y: (sourceHeight - height) / 2, width: sourceWidth, height };
}

export function framedCoverSourceRect(sourceWidth, sourceHeight, frameWidth, frameHeight, framing = { x: .5, y: .5, zoom: 1 }) {
  const cover = coverSourceRect(sourceWidth, sourceHeight, frameWidth, frameHeight);
  const zoom = Number.isFinite(framing.zoom) ? Math.min(2, Math.max(1, framing.zoom)) : 1;
  const width = cover.width / zoom, height = cover.height / zoom;
  const x = Number.isFinite(framing.x) ? Math.min(1, Math.max(0, framing.x)) : .5;
  const y = Number.isFinite(framing.y) ? Math.min(1, Math.max(0, framing.y)) : .5;
  return { x: Math.min(sourceWidth - width, Math.max(0, x * sourceWidth - width / 2)), y: Math.min(sourceHeight - height, Math.max(0, y * sourceHeight - height / 2)), width, height };
}

/** Store only the effective crop center so changing zoom cannot reveal hidden pan. */
export function effectiveCoverFraming(sourceWidth, sourceHeight, frameWidth, frameHeight, framing) {
  const crop = framedCoverSourceRect(sourceWidth, sourceHeight, frameWidth, frameHeight, framing);
  return { x: (crop.x + crop.width / 2) / sourceWidth, y: (crop.y + crop.height / 2) / sourceHeight, zoom: Number.isFinite(framing.zoom) ? Math.min(2, Math.max(1, framing.zoom)) : 1 };
}

export function drawBackgroundCover(context, image, width, height, framing) {
  const sourceWidth = image.naturalWidth || image.width, sourceHeight = image.naturalHeight || image.height;
  const crop = framedCoverSourceRect(sourceWidth, sourceHeight, width, height, framing);
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  return crop;
}
