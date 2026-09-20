import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(evidenceDir, '..');

test('real-pair candidate receipt reuses one PhotoIntake across session rounds', () => {
  execFileSync(process.execPath, ['--experimental-strip-types', 'candidate-evidence/candidate-receipt.mjs'], { cwd: repoDir, stdio: 'ignore' });
  const receipt = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'out/candidate-receipt.json'), 'utf8'));
  assert.equal(receipt.schema, 'DiscStudioCandidateReceipt@1');
  assert.equal(receipt.inputs.length, 2);
  for (const result of receipt.inputs) {
    assert.equal(result.api, 'circle-candidate-session');
    assert.equal(result.detectorCalls, 2, 'initial and explicit other searches are the only global detector rounds');
    assert.equal(result.candidateRequest.requested, 3);
    assert.ok(result.candidateRequest.returned >= 0 && result.candidateRequest.returned <= 3);
    assert.equal(result.top3Available, result.candidateCount === 3);
    assert.ok(Array.isArray(result.trace.initial));
    assert.ok(Array.isArray(result.trace.refinementRound1));
    assert.ok(Array.isArray(result.trace.refinementRound2));
    assert.equal(result.acceptance.twoRefinementRounds, 'present');
    assert.equal(result.acceptance.selectedAnchorPreserved, true);
    assert.equal(result.acceptance.anchorChecks.initialToRound1.exact, true);
    assert.equal(result.acceptance.anchorChecks.round1ToRound2.exact, true);
    assert.equal(result.acceptance.anchorChecks.initialToRound1.requestedId, result.acceptance.anchorChecks.initialToRound1.returnedId);
    assert.equal(result.acceptance.anchorChecks.round1ToRound2.requestedId, result.acceptance.anchorChecks.round1ToRound2.returnedId);
    assert.equal(result.pxc.photoIntakeCount, 1);
    assert.equal(result.pxc.requestCount, 4);
    assert.equal(result.pxc.candidatePartCount, 4);
    assert.equal(result.pxc.cropChoicesPartCount, 4);
    assert.equal(result.pxc.onePhotoIntakeAcrossRounds, true);
    assert.equal(result.pxc.noRepeatedFullRasterIntake, true);
    assert.deepEqual(result.pxc.oldCircleFitOrCropEditParts, []);
    assert.equal(result.pxc.receiptCount, 8);
    assert.deepEqual(result.pxc.rounds.map(round => round.operation), ['initial', 'refine', 'refine', 'other']);
    assert.ok(result.pxc.rounds.every(round => round.photoInputReused));
    assert.ok(fs.existsSync(path.join(evidenceDir, result.traceGeometry)));
  }
  assert.ok(receipt.inputs.some(result => result.input === 'IMG_6082(1).jpeg'));
});
