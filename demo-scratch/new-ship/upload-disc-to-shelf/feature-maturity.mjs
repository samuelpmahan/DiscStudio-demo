import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function readFeatureMaturity(appDirectory) {
  const ledgerName = 'feature-implementation-maturity.json';
  const decisionName = 'feature-version-decision.md';
  const erratumName = 'feature-maturity-erratum.json';
  const ledgerBytes = fs.readFileSync(path.join(appDirectory, ledgerName));
  const decisionBytes = fs.readFileSync(path.join(appDirectory, decisionName));
  const erratumBytes = fs.readFileSync(path.join(appDirectory, erratumName));
  const ledger = JSON.parse(ledgerBytes);
  const erratum = JSON.parse(erratumBytes);
  const stages = ledger.demo?.stages;
  const features = stages?.flatMap(stage => stage.features ?? []);
  const expectedFeatureNames = [
    'Photo intake', 'RimFit', 'Crop refinement and rotation', 'Prepared image creation',
    'Mold and plastic details', 'Save to Today’s Bag', 'Shelf persistence', 'Card selection',
    'Card rendering', 'HighlightColor', 'HighlightOn', 'Mirrored', 'Canvas sizing and placement',
    'Preview', 'Approval / Add to Export', 'Approved graphic rendering', 'Transparent PNG export', 'ZIP packaging',
  ];
  const featureNames = features?.map(feature => feature.name) ?? [];
  const parseVersion = value => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value ?? '');
    return match ? match.slice(1).map(Number) : null;
  };
  const implementationVersionsAreValid = features?.every(feature => parseVersion(feature.implementationVersion) !== null);
  const expectedImplementationVersions = {
    'Photo intake':'0.5.0', 'RimFit':'0.5.0', 'Crop refinement and rotation':'0.5.0', 'Prepared image creation':'0.1.2',
    'Mold and plastic details':'0.1.3', 'Save to Today’s Bag':'0.1.1', 'Shelf persistence':'0.1.1', 'Card selection':'0.1.1',
    'Card rendering':'0.1.2', 'HighlightColor':'0.1.1', 'HighlightOn':'0.1.1', 'Mirrored':'0.1.1',
    'Canvas sizing and placement':'0.1.1', 'Preview':'0.1.2', 'Approval / Add to Export':'0.1.1',
    'Approved graphic rendering':'0.1.1', 'Transparent PNG export':'0.1.1', 'ZIP packaging':'0.1.1',
  };
  const implementationVersionsMatchCheckpoint = features?.every(feature => feature.implementationVersion === expectedImplementationVersions[feature.name]
    && typeof feature.implementationMilestone === 'string' && feature.implementationMilestone.length > 0);
  const currentCheckpoint = ledger.implementationCheckpoint;
  const transitions = currentCheckpoint?.transitions ?? [];
  const implementationCheckpointIsBound = currentCheckpoint?.sourceVersion === '6.5.3' && currentCheckpoint?.status === 'LOCAL_CREATOR_REVIEW'
    && currentCheckpoint?.evidenceReceipt === 'DiscStudio-ellipse-fit-integration-receipt.json'
    && transitions.length === 4
    && transitions.every((item, index) => JSON.stringify(item) === JSON.stringify([
      {feature:'Crop refinement and rotation',from:'0.1.1',to:'0.1.2'},
      {feature:'RimFit',from:'0.1.1',to:'0.1.2'},
      {feature:'Prepared image creation',from:'0.1.1',to:'0.1.2'},
      {feature:'Mold and plastic details',from:'0.1.2',to:'0.1.3'},
    ][index]));
  const latestCheckpoint = ledger.historicalImplementationCheckpoints?.find(checkpoint => checkpoint.sourceVersion === '6.5.5');
  const latestCheckpointIsBound = latestCheckpoint?.sourceVersion === '6.5.5' && latestCheckpoint?.status === 'RELEASE_BUILD_READY'
    && latestCheckpoint?.transitions?.length === 2
    && JSON.stringify(latestCheckpoint.transitions[0]) === JSON.stringify({feature:'RimFit',from:'0.1.2',to:'0.1.3'})
    && JSON.stringify(latestCheckpoint.transitions[1]) === JSON.stringify({feature:'Crop refinement and rotation',from:'0.1.2',to:'0.1.3'})
    && latestCheckpoint?.servoVisualPin?.sourcePhotoSha256 === '1d6c7ad370b2fe8896a0bf10d0b31f83df6c3c03d2540ccc8350b67ec075ec27'
    && latestCheckpoint?.servoVisualPin?.refinerSha256 === 'cd296f24561a3ec33d89e330ce19eaddd58eae3684279c96f2ca69e8f5003b3a'
    && latestCheckpoint?.servoVisualPin?.status === 'MAYBE'
    && latestCheckpoint?.servoVisualPin?.sampleCount === 64
    && latestCheckpoint?.servoVisualPin?.geometryInlierSamples === 63
    && latestCheckpoint?.boundaries?.ellipseProposal === 'best available proposal is selected automatically; MAYBE geometry still requires the explicit Use photo action'
    && latestCheckpoint?.boundaries?.abstain === 'the known IMG_6167 abstainer receives a usable CircleFit suggestion without teal dots'
    && latestCheckpoint?.evidence?.length === 5;
  const requestedCheckpoint = ledger.historicalImplementationCheckpoints?.find(checkpoint => checkpoint.sourceVersion === '6.5.6');
  const requestedCheckpointIsBound = requestedCheckpoint?.sourceVersion === '6.5.6'
    && requestedCheckpoint?.status === 'PROVISIONALLY_ACCEPTED'
    && requestedCheckpoint?.acceptedBehaviorBuildId === '5332eac2f2c9e7fc'
    && requestedCheckpoint?.acceptedBehaviorSourceId === '4c8fd8568acac1dfb67aea3f57706b147b149638fb1e1e51518f835af798bf02'
    && requestedCheckpoint?.boundaries?.contracts === '0.1.0 unchanged'
    && requestedCheckpoint?.boundaries?.behavior === 'metadata-only version change; default refinement behavior unchanged'
    && JSON.stringify(requestedCheckpoint?.transitions) === JSON.stringify([
      {feature:'RimFit',from:'0.1.3',to:'0.5.0'},
      {feature:'Crop refinement and rotation',from:'0.1.3',to:'0.5.0'},
    ]);
  const intakeCheckpoint = ledger.latestImplementationCheckpoint;
  const intakeCheckpointIsBound = intakeCheckpoint?.sourceVersion === '6.5.7'
    && intakeCheckpoint?.status === 'RELEASE_BUILD_READY'
    && intakeCheckpoint?.boundaries?.contracts === '0.1.0 unchanged'
    && intakeCheckpoint?.boundaries?.behavior === 'Re-crop reuses retained source and accepted geometry; no fitting or persistence format change'
    && JSON.stringify(intakeCheckpoint?.transitions) === JSON.stringify([{feature:'Photo intake',from:'0.1.1',to:'0.5.0'}]);
  if (ledger.schema !== 'discstudio-feature-implementation-maturity@1' || ledger.decision !== 'ACCEPTED_PATCH_PROGRESS' || ledger.demo?.version !== '0.0.0' || stages?.length !== 3 || stages.some(stage => stage.version !== '0.0.0') || featureNames.length !== expectedFeatureNames.length || new Set(featureNames).size !== featureNames.length || expectedFeatureNames.some(name => !featureNames.includes(name)) || features?.some(feature => feature.contractVersion !== '0.1.0') || !implementationVersionsAreValid || !implementationVersionsMatchCheckpoint || !implementationCheckpointIsBound || !latestCheckpointIsBound || !requestedCheckpointIsBound || !intakeCheckpointIsBound || ledger.dependencies?.NCTK !== '0.0.0' || ledger.dependencies?.PxC !== '0.0.0' || ledger.boundaries?.historicalBuildVersion !== '6.5.2' || ledger.boundaries?.canonicalPromotion !== false) {
    throw Error('Feature maturity ledger does not match the accepted 2026-10-01 composition decision.');
  }
  const priorDecisionBytes = ledger.historicalErratumSnapshot?.decisionBytes;
  const historicalDecisionIsBound = digest(decisionBytes) === erratum.corrected?.decisionSha256
    || (ledger.historicalErratumSnapshot?.decisionSha256 === erratum.corrected?.decisionSha256
      && Number.isSafeInteger(priorDecisionBytes) && priorDecisionBytes > 0 && decisionBytes.length > priorDecisionBytes
      && digest(decisionBytes.subarray(0, priorDecisionBytes)) === erratum.corrected?.decisionSha256);
  const historicalErratumSnapshotIsBound = digest(ledgerBytes) === erratum.corrected?.ledgerSha256
    || (ledger.historicalErratumSnapshot?.ledgerSha256 === erratum.corrected?.ledgerSha256 && historicalDecisionIsBound);
  if (erratum.schema !== 'discstudio-feature-maturity-citation-erratum@1' || !historicalErratumSnapshotIsBound || !historicalDecisionIsBound || !ledgerBytes.includes(erratum.corrected.verifiedPreviewSelectionDriveId) || !decisionBytes.includes(erratum.corrected.verifiedPreviewSelectionDriveId) || ledgerBytes.includes(erratum.original.previewSelectionDriveIdAsWritten) || decisionBytes.includes(erratum.original.previewSelectionDriveIdAsWritten)) {
    throw Error('Feature maturity citation erratum is inconsistent with its corrected files.');
  }
  return {
    ledger,
    ledgerBytes,
    decisionBytes,
    erratumBytes,
    binding: {
      ledger: { path: ledgerName, bytes: ledgerBytes.length, sha256: digest(ledgerBytes) },
      decision: { path: decisionName, bytes: decisionBytes.length, sha256: digest(decisionBytes) },
      erratum: { path: erratumName, bytes: erratumBytes.length, sha256: digest(erratumBytes), scope: erratum.scope },
      demoVersion: ledger.demo.version,
      stages: stages.map(stage => ({ name: stage.name, version: stage.version })),
      features: features.map(feature => ({ name: feature.name, contractVersion: feature.contractVersion, implementationVersion: feature.implementationVersion })),
      dependencies: ledger.dependencies,
      historicalBuildVersion: ledger.boundaries.historicalBuildVersion,
    },
    html: stages.map(stage => `<details class="feature-version-stage"><summary>${escapeHtml(stage.name)} · ${escapeHtml(stage.version)}</summary><ul>${stage.features.map(feature => `<li>${escapeHtml(feature.name)} · ${escapeHtml(feature.implementationVersion)} <small>(contract ${escapeHtml(feature.contractVersion)})</small></li>`).join('')}</ul></details>`).join(''),
  };
}
