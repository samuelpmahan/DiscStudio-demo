/**
 * RimFit v3 for the new ship. Authored code, not build-injected.
 *
 * RimFit recovers the outer rim ellipse of a disc from photo pixels, then
 * proposes a crop. It runs as two PxC calculations:
 *
 *   oc.studio.rimFitV3            photo raster -> recovery evidence
 *   fn.studio.rimFitCropProposal  evidence -> crop proposal
 *
 * The UI drives it through composeRimFitCrop(), which rasterizes a canvas,
 * composes both calculations, and returns the evidence plus the proposal.
 * Geometry helpers (clampCropSelection, cropForSourceSamples) are passed in
 * by the caller so this module never imports from the UI.
 *
 * API:
 *   recoverRimEllipseV3(image, options)  core recovery, sync. image is
 *                                        {width,height,data} RGBA pixels.
 *                                        Returns {status, ellipse, ...}.
 *   createRimFitWorkerClient()           async worker wrapper for the same.
 *   sourceEllipseFromFit(local, photo)   map fitted ellipse from working
 *                                        coords back to source coords.
 *   ensureRimFitCalculations(pxc, helpers)  register both calculations on pxc.
 *   composeRimFitCrop(pxc, source, fitCanvas, serial, helpers)
 *                                        full orchestration. Returns
 *                                        {photoIntake, circleFit, cropEdit,
 *                                         evidence, proposal}.
 */

import { Part } from '../part-first-kernel/src/pxc.mjs';
import { recoverRimEllipseV3 } from './rimfit-v3/recover.mjs';
import { createRimFitWorkerClient } from './rimfit-v3/worker-client.mjs';

export { recoverRimEllipseV3, createRimFitWorkerClient };

export type RimFitGeometryHelpers = {
  clampCropSelection: (width: number, height: number, crop: any) => any;
  cropForSourceSamples: (width: number, height: number, geometry: any) => any;
};

export type RimFitLocalCrop = {
  centerPx: [number, number];
  radiiPx: [number, number];
  rotationRadians: number;
  rotationDegrees: number;
};

export type RimFitPhoto = {
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
};

/**
 * Map a fitted ellipse from working (downsampled) coordinates back to the
 * source photo coordinates. A downsample may round width and height
 * independently, so the ellipse covariance is mapped through the exact
 * anisotropic source transform, then principal axes are recovered. This
 * keeps geometry and the UI crop identical.
 */
export function sourceEllipseFromFit(local: RimFitLocalCrop, photo: RimFitPhoto) {
  const [fitX, fitY] = local.centerPx, [fitRadiusX, fitRadiusY] = local.radiiPx, theta = local.rotationRadians;
  const sx = photo.sourceWidth / photo.width, sy = photo.sourceHeight / photo.height;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const rx2 = fitRadiusX * fitRadiusX, ry2 = fitRadiusY * fitRadiusY;
  const xx = sx * sx * (rx2 * cos * cos + ry2 * sin * sin);
  const xy = sx * sy * (rx2 - ry2) * sin * cos;
  const yy = sy * sy * (rx2 * sin * sin + ry2 * cos * cos);
  const spread = Math.hypot(xx - yy, 2 * xy);
  const major = Math.max(0, (xx + yy + spread) / 2), minor = Math.max(0, (xx + yy - spread) / 2);
  return {
    x: (fitX + .5) * sx - .5,
    y: (fitY + .5) * sy - .5,
    radiusX: Math.sqrt(major),
    radiusY: Math.sqrt(minor),
    rotation: .5 * Math.atan2(2 * xy, xx - yy),
  };
}

/**
 * Register the RimFit calculations on a PxC instance. Idempotent; safe to
 * call more than once. The helpers are the UI's geometry functions, passed
 * in to avoid a UI import.
 */
export function ensureRimFitCalculations(pxc: any, helpers: RimFitGeometryHelpers) {
  const names = new Set(pxc.entries().map(([address]: [string, unknown]) => address));
  if (!names.has('oc.studio.rimFitV3')) pxc.set('oc.studio.rimFitV3', new Part(({ photo }: any) => {
    const started = performance.now();
    let result: any;
    try {
      result = recoverRimEllipseV3({ width: photo.width, height: photo.height, data: photo.rgba });
    } catch (error) {
      result = {
        schema: 'RimEllipseRecovery@3-browser', status: 'abstained', error: String(error), executionError: true,
        input: { cropWidth: photo.width, cropHeight: photo.height },
        algorithm: { quality: { abstainReasons: ['browser_recovery_error'] } },
      };
    }
    return Object.freeze({
      schema: 'RimFitBrowserEvidence@1', execution: 'browser-native-js', executionThread: 'main-thread',
      sourceAlgorithm: 'recover_rim_ellipse_v3.py',
      sourceAlgorithmSha256: '6356b02505f40873e9281f4cf9a892f59bb8da6f53688cd741281e65de7f8fcb',
      status: result.status, error: result.error, executionError: result.executionError === true,
      input: result.input, algorithm: result.algorithm, ellipse: result.ellipse,
      diagnosticFit: result.diagnosticFit, sourceAlgorithmSchema: result.sourceAlgorithmSchema,
      elapsedMs: performance.now() - started,
    });
  }));
  if (!names.has('fn.studio.rimFitCropProposal')) pxc.set('fn.studio.rimFitCropProposal', new Part(({ photo, evidence }: any) => {
    if (evidence.status !== 'accepted' || !evidence.ellipse?.localCrop) return Object.freeze({
      schema: 'RimFitCropProposal@1', status: 'abstained',
      reason: evidence.error ?? evidence.algorithm?.quality?.abstainReasons ?? ['fixed_contour_gate'],
      crop: null,
    });
    const geometry = sourceEllipseFromFit(evidence.ellipse.localCrop, photo);
    const crop = helpers.clampCropSelection(
      photo.sourceWidth, photo.sourceHeight,
      helpers.cropForSourceSamples(photo.sourceWidth, photo.sourceHeight, geometry)
    );
    return Object.freeze({
      schema: 'RimFitCropProposal@1', status: 'accepted',
      detector: 'recoverRimEllipseV3 (browser-native-js)',
      geometry, crop, sourcePhoto: photo.source,
    });
  }));
}

/**
 * Full RimFit orchestration for the upload UI. Rasterizes the fit canvas into
 * session-only PxC correction evidence, then composes recovery and proposal.
 * Returns the addresses plus the evidence and proposal values.
 */
export async function composeRimFitCrop(
  pxc: any,
  source: { width: number; height: number },
  fitCanvas: HTMLCanvasElement,
  serial: number,
  helpers: RimFitGeometryHelpers,
) {
  ensureRimFitCalculations(pxc, helpers);
  const photoIntake = `ds.px.PhotoIntake.rimfit.${serial}`;
  const circleFit = `ds.px.CircleFit.rimfit.${serial}`;
  const cropEdit = `ds.px.CropEdit.rimfit.${serial}`;
  const ctx = fitCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw Error('RimFit raster canvas is unavailable.');
  const raster = Object.freeze({
    schema: 'PhotoRaster@1',
    width: fitCanvas.width, height: fitCanvas.height,
    rgba: ctx.getImageData(0, 0, fitCanvas.width, fitCanvas.height).data,
    sourceWidth: source.width, sourceHeight: source.height,
    source: {
      workingWidth: source.width, workingHeight: source.height,
      fitScaleX: source.width / fitCanvas.width, fitScaleY: source.height / fitCanvas.height,
    },
  });
  pxc.set(photoIntake, new Part(raster));
  await pxc.compose({ into: circleFit, calculation: 'oc.studio.rimFitV3', inputs: { photo: photoIntake } });
  await pxc.compose({ into: cropEdit, calculation: 'fn.studio.rimFitCropProposal', inputs: { photo: photoIntake, evidence: circleFit } });
  return {
    photoIntake, circleFit, cropEdit,
    evidence: pxc.get(circleFit).value,
    proposal: pxc.get(cropEdit).value,
  };
}
