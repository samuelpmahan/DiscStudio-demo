import { adaptRimFitResult } from './fit-adapter.mjs';
import { validateEllipseBounds } from './ellipse-geometry.mjs';
import { refineEllipseWithRimEvidence } from './rim-aware-refinement.mjs';

const finiteEllipse = ellipse => ellipse &&
  [ellipse.centerX, ellipse.centerY, ellipse.radiusX, ellipse.radiusY, ellipse.axisAngle].every(Number.isFinite);

/**
 * Complete the explicit Try ellipse fit review path. The worker sees a
 * transferred copy, while adaptation and rim refinement receive the exact
 * source ImageData bytes retained by the caller. The result always remains a
 * MAYBE for creator review; ABSTAIN keeps the adapter's original geometry.
 */
export async function runEllipseFitReview({ worker, image, isCurrent = () => true }) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
      image.width <= 1 || image.height <= 1 || !image.data ||
      image.data.length !== image.width * image.height * 4) {
    throw Error('Ellipse fit review needs the exact full-source RGBA raster.');
  }

  const result = await worker.recover(image, { maxRefinementDimension: 384 });
  if (!isCurrent()) return Object.freeze({ status: 'STALE' });

  const proposal = adaptRimFitResult(result, {
    data: image.data,
    width: image.width,
    height: image.height,
    maxRefinementDimension: 384,
  });
  if (proposal.status !== 'MAYBE' || !finiteEllipse(proposal.ellipse))
    return Object.freeze({ status: 'READY', proposal });

  let refinement;
  try {
    refinement = refineEllipseWithRimEvidence(
      { data: image.data, width: image.width, height: image.height },
      proposal,
      { enabled: true },
    );
  } catch {
    refinement = { status: 'ABSTAIN', reason: 'rim-refinement-unavailable', trace: null };
  }

  const usableRefinement = refinement?.status === 'MAYBE' && finiteEllipse(refinement.ellipse) &&
    validateEllipseBounds(image.width, image.height, refinement.ellipse, 0);
  if (usableRefinement) {
    const reviewed = Object.freeze({
      ...proposal,
      ellipse: Object.freeze({ ...refinement.ellipse }),
      refinement: Object.freeze({
        status: 'MAYBE',
        reason: refinement.reason,
        trace: refinement.trace ?? null,
        originalEllipse: refinement.originalEllipse ?? proposal.ellipse,
      }),
    });
    return Object.freeze({ status: 'READY', proposal: reviewed });
  }

  // ABSTAIN is deliberately non-destructive: retain the adapter's MAYBE and
  // exact seed ellipse, while recording why no paired-boundary dots are shown.
  const fallback = Object.freeze({
    ...proposal,
    ellipse: proposal.ellipse,
    refinement: Object.freeze({
      status: 'ABSTAIN',
      reason: refinement?.reason ?? 'invalid-refinement-result',
      trace: refinement?.trace ?? null,
    }),
  });
  return Object.freeze({ status: 'READY', proposal: fallback });
}
