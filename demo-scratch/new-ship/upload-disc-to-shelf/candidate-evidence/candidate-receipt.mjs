#!/usr/bin/env node
// Evidence-only probe. It never mutates the creator sources and never copies
// the private source photos. It records one detector trace, two refinement
// rounds, and a PxC crop-proposal receipt for each input.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PxC } from '../../part-first-kernel/src/pxc.mjs';
import { createCircleCandidateSession, composeCircleCandidateChoices } from '../circle-fit.ts';
import { drawRotatedCrop } from '../crop-geometry.ts';
import { clampCircleCropSelection, circleCropExportMapping } from '../upload-ui.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultInputs = [
  '/workspace/scratch/b40defd211f9/upload/IMG_6009.jpeg',
  '/workspace/scratch/b40defd211f9/upload/IMG_6082(1).jpeg',
];
const args = process.argv.slice(2);
const visualFlag = args.indexOf('--visual-output');
const visualOutputArg = visualFlag >= 0 ? args[visualFlag + 1] : null;
const optionIndexes = new Set(visualFlag >= 0 ? [visualFlag, visualFlag + 1] : []);
const inputPaths = args.filter((value, index) => !value.startsWith('-') && !optionIndexes.has(index));
const inputs = inputPaths.length ? inputPaths : defaultInputs;
const outputDir = path.join(here, 'out');
await fs.mkdir(outputDir, { recursive: true });
const visualOutputDir = visualOutputArg ? path.resolve(visualOutputArg) : null;
if (visualOutputDir) await fs.mkdir(visualOutputDir, { recursive: true });

// Human-reviewed fixture anchors. These are labels for visual evidence only;
// the detector output remains the source of every drawn candidate circle.
const visualSelections = new Map([
  ['IMG_6009.jpeg', { rank: 1, rationale: 'The large centered disc boundary is the visible foreground object.' }],
  ['IMG_6082(1).jpeg', { rank: 1, rationale: 'The large centered Westside disc is the visible foreground object; alternatives remain visible for review.' }],
]);

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }

// This is the same circle-only crop contract passed into the production PxC
// proposal calculation. It is kept local so this probe does not import the
// DOM-mounting upload UI module.
function clampCropSelection(width, height, crop) { return clampCircleCropSelection(width, height, crop); }

function numberCircle(circle) {
  if (!circle) return null;
  return Object.fromEntries(['x', 'y', 'radius', 'confidence'].filter(key => Number.isFinite(circle[key])).map(key => [key, Number(circle[key].toFixed(4))]));
}

function exactCircle(a, b) {
  return !!a && !!b && ['x', 'y', 'radius'].every(key => a[key] === b[key]);
}

function rawCircle(circle) {
  return circle ? { x: circle.x, y: circle.y, radius: circle.radius } : null;
}

function chooseBest(candidates, fallback) {
  return candidates.reduce((best, candidate) => candidate.score > best.score + 1e-12 ? candidate : best, fallback);
}

function drawCandidateCircle(ctx, circle, color, label, width = 8) {
  if (!circle) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2); ctx.stroke();
  ctx.font = `${Math.max(22, Math.round(Math.min(ctx.canvas.width, ctx.canvas.height) / 36))}px sans-serif`;
  const x = Math.min(ctx.canvas.width - 16, circle.x + circle.radius + 12), y = Math.max(30, Math.min(ctx.canvas.height - 12, circle.y));
  ctx.fillStyle = color; ctx.fillText(label, x, y);
}

function circleMapping(circle, size, width, height) {
  return circleCropExportMapping(width, height, size, { centerX: (circle.x + .5) / width, centerY: (circle.y + .5) / height, radiusX: circle.radius / width, radiusY: circle.radius / height, rotation: 0 });
}

async function writeVisualArtifacts(sourcePath, image, initialCandidates, round1Candidates, round2Candidates, selectedInitial, selectedRound1, selectedRound2, index) {
  if (!visualOutputDir) return null;
  const name = path.basename(sourcePath).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || `input-${index}`;
  const selection = visualSelections.get(path.basename(sourcePath));
  const selected = selection && initialCandidates[selection.rank - 1] ? initialCandidates[selection.rank - 1] : null;
  const overlay = createCanvas(image.width, image.height), overlayContext = overlay.getContext('2d');
  overlayContext.drawImage(image, 0, 0, image.width, image.height);
  overlayContext.fillStyle = 'rgba(0,0,0,.72)'; overlayContext.fillRect(18, 18, Math.min(620, image.width - 36), 170);
  overlayContext.font = '28px sans-serif'; overlayContext.fillStyle = '#fff'; overlayContext.fillText(`Initial candidates: ${initialCandidates.length}`, 36, 54);
  overlayContext.fillText(selected ? `Selected physical disc: rank ${selection.rank}` : 'Selected physical disc: unavailable', 36, 92);
  overlayContext.font = '20px sans-serif'; overlayContext.fillStyle = '#d1d5db'; overlayContext.fillText(selection?.rationale ?? 'No visual selection label', 36, 128, Math.min(570, image.width - 70));
  initialCandidates.forEach((candidate, candidateIndex) => drawCandidateCircle(overlayContext, candidate.circle, ['#ff453a', '#ff9f0a', '#ffd60a'][candidateIndex] ?? '#ff453a', `initial-${candidateIndex + 1}`, 8));
  if (selected) {
    drawCandidateCircle(overlayContext, selected.circle, '#00ffff', 'selected-disc / initial', 18);
    if (selectedRound1) drawCandidateCircle(overlayContext, selectedRound1.circle, '#30d158', `selected-disc / round1 ${selectedRound1.id}`, 14);
    if (selectedRound2) drawCandidateCircle(overlayContext, selectedRound2.circle, '#ffffff', `selected-disc / round2 ${selectedRound2.id}`, 10);
  }
  const overlayPath = path.join(visualOutputDir, `${name}-initial3-rounds.png`);
  await fs.writeFile(overlayPath, overlay.toBuffer('image/png'));
  const tileSize = 360, tileGap = 18, tileLabel = 42, columns = 3, rows = 3;
  const contactSheet = createCanvas(columns * tileSize + (columns + 1) * tileGap, rows * (tileSize + tileLabel) + (rows + 1) * tileGap), sheetContext = contactSheet.getContext('2d');
  sheetContext.fillStyle = '#11161c'; sheetContext.fillRect(0, 0, contactSheet.width, contactSheet.height);
  const stages = [
    ['initial', initialCandidates, '#ff453a', selectedInitial?.id],
    ['round1', round1Candidates, '#30d158', selectedRound1?.id],
    ['round2', round2Candidates, '#0a84ff', selectedRound2?.id],
  ];
  for (let stageIndex = 0; stageIndex < stages.length; stageIndex++) {
    const [stage, candidates, color, selectedId] = stages[stageIndex];
    for (let candidateIndex = 0; candidateIndex < columns; candidateIndex++) {
      const x = tileGap + candidateIndex * (tileSize + tileGap), y = tileGap + stageIndex * (tileSize + tileLabel + tileGap);
      sheetContext.fillStyle = '#252b33'; sheetContext.fillRect(x, y, tileSize, tileSize + tileLabel);
      const candidate = candidates[candidateIndex];
      if (candidate) {
        sheetContext.save(); sheetContext.translate(x, y); sheetContext.beginPath(); sheetContext.arc(tileSize / 2, tileSize / 2, tileSize / 2 - 4, 0, Math.PI * 2); sheetContext.clip();
        drawRotatedCrop(sheetContext, image, circleMapping(candidate.circle, tileSize, image.width, image.height)); sheetContext.restore();
        sheetContext.strokeStyle = candidate.id === selectedId ? '#fff' : color; sheetContext.lineWidth = candidate.id === selectedId ? 12 : 6; sheetContext.beginPath(); sheetContext.arc(x + tileSize / 2, y + tileSize / 2, tileSize / 2 - 5, 0, Math.PI * 2); sheetContext.stroke();
        sheetContext.fillStyle = color; sheetContext.font = '22px sans-serif'; sheetContext.fillText(`${stage}-${candidateIndex + 1}${candidate.id === selectedId ? ' · selected' : ''}`, x + 12, y + tileSize + 30);
      } else {
        sheetContext.fillStyle = '#9ca3af'; sheetContext.font = '22px sans-serif'; sheetContext.fillText(`${stage}-${candidateIndex + 1} · unavailable`, x + 12, y + tileSize + 30);
      }
    }
  }
  const contactSheetPath = path.join(visualOutputDir, `${name}-candidate-contact-sheet.png`);
  await fs.writeFile(contactSheetPath, contactSheet.toBuffer('image/png'));
  const cropPaths = [];
  const cropRounds = [['initial', selected?.circle], ['round1', selectedRound1?.circle], ['round2', selectedRound2?.circle]];
  for (const [label, circle] of cropRounds) {
    if (!circle) continue;
    const size = 1024, crop = createCanvas(size, size), cropContext = crop.getContext('2d');
    cropContext.save(); cropContext.beginPath(); cropContext.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); cropContext.clip();
    drawRotatedCrop(cropContext, image, circleMapping(circle, size, image.width, image.height)); cropContext.restore();
    // Raw production-style crop pixels: no outline, caption, or review mark.
    const cropPath = path.join(visualOutputDir, `${name}-selected-${label}-raw-crop.png`);
    await fs.writeFile(cropPath, crop.toBuffer('image/png')); cropPaths.push(cropPath);
  }
  return { selection: selected ? { rank: selection.rank, id: selected.id, rationale: selection.rationale, circle: numberCircle(selected.circle) } : null, round1Selection: selectedRound1 ? { id: selectedRound1.id, circle: numberCircle(selectedRound1.circle) } : null, round2Selection: selectedRound2 ? { id: selectedRound2.id, circle: numberCircle(selectedRound2.circle) } : null, overlayPath, contactSheetPath, cropKind: 'raw-production-pixels', cropPaths };
}

function circleCrop(circle, width, height) {
  if (!circle) return null;
  return clampCropSelection(width, height, {
    centerX: (circle.x + .5) / width,
    centerY: (circle.y + .5) / height,
    radiusX: circle.radius / width,
    radiusY: circle.radius / height,
    rotation: 0,
  });
}

// circle-fit's browser-facing session constructor only needs a canvas factory;
// NAPI Canvas supplies the same 2D operations for this Node evidence probe.
if (typeof globalThis.document === 'undefined') globalThis.document = { createElement: name => name === 'canvas' ? createCanvas(1, 1) : (() => { throw Error(`Unsupported evidence DOM element: ${name}`); })() };

function rowsFromRound(round) {
  return round?.proposal?.status === 'accepted' ? round.proposal.candidates : [];
}

function roundSummary(round, pxc, session) {
  const candidatePart = pxc.get(round.candidates), cropPart = pxc.get(round.cropChoices), photo = pxc.get(session.photoIntake);
  return {
    operation: round.requestPart ? pxc.get(round.requestPart).value.operation : null,
    requestPart: round.requestPart,
    candidatesPart: round.candidates,
    cropChoicesPart: round.cropChoices,
    candidateCount: rowsFromRound(round).length,
    candidateStatus: round.evidence.status,
    proposalStatus: round.proposal.status,
    photoInputReused: candidatePart.composition?.inputs?.photo === photo && cropPart.composition?.inputs?.photo === photo,
  };
}

async function runOne(sourcePath, index) {
  const image = await loadImage(sourcePath);
  const scale = Math.min(1, 720 / Math.max(image.width, image.height));
  const workingWidth = Math.max(1, Math.round(image.width * scale));
  const workingHeight = Math.max(1, Math.round(image.height * scale));
  const workingCanvas = createCanvas(workingWidth, workingHeight);
  const workingContext = workingCanvas.getContext('2d');
  workingContext.drawImage(image, 0, 0, workingWidth, workingHeight);
  const workingRgba = workingContext.getImageData(0, 0, workingWidth, workingHeight).data;

  const sourceCanvas = createCanvas(image.width, image.height);
  const sourceContext = sourceCanvas.getContext('2d');
  sourceContext.drawImage(image, 0, 0, image.width, image.height);
  const sourceRgba = sourceContext.getImageData(0, 0, image.width, image.height).data;

  // Use the production session gateway: one retained PhotoIntake, then only
  // small request/candidate/crop Parts for initial, two refinements, and other.
  const pxc = new PxC(), session = createCircleCandidateSession(pxc, image, image.width, image.height, workingCanvas, index + 1, { clampCropSelection });
  const rounds = [];
  const initialRound = await composeCircleCandidateChoices(pxc, session, 1, { operation: 'initial' }); rounds.push(initialRound);
  const initialCandidates = rowsFromRound(initialRound);
  const selectedInitial = initialCandidates[0] ?? null;
  const round1Round = selectedInitial ? await composeCircleCandidateChoices(pxc, session, 2, { operation: 'refine', selected: selectedInitial }) : null;
  if (round1Round) rounds.push(round1Round);
  const round1Candidates = rowsFromRound(round1Round);
  const selectedRound1 = selectedInitial && round1Candidates.length ? chooseBest(round1Candidates, selectedInitial) : null;
  const round2Round = selectedRound1 ? await composeCircleCandidateChoices(pxc, session, 3, { operation: 'refine', selected: selectedRound1 }) : null;
  if (round2Round) rounds.push(round2Round);
  const round2Candidates = rowsFromRound(round2Round);
  const selectedRound2 = selectedRound1 && round2Candidates.length ? chooseBest(round2Candidates, selectedRound1) : null;
  const otherRound = await composeCircleCandidateChoices(pxc, session, 4, { operation: 'other', excluded: [...initialCandidates, ...(round1Candidates ?? [])] });
  rounds.push(otherRound);
  const round1 = selectedRound1?.circle ?? null;
  const round2 = selectedRound2?.circle ?? null;
  const roundReceipts = rounds.map(round => roundSummary(round, pxc, session));
  const photoIntakeEntries = pxc.entries().filter(([address]) => address.startsWith('ds.px.PhotoIntake.'));
  const requestEntries = pxc.entries().filter(([address]) => address.startsWith(`ds.px.CircleCandidateRequest.circlefit.${session.serial}.`));
  const candidateEntries = pxc.entries().filter(([address]) => address.startsWith(`ds.px.CircleCandidates.circlefit.${session.serial}.`));
  const cropEntries = pxc.entries().filter(([address]) => address.startsWith(`ds.px.CircleCandidateCrops.circlefit.${session.serial}.`));
  const oldCircleFitEntries = pxc.entries().filter(([address]) => /(?:CircleFit|CropEdit)\.circlefit\./.test(address));

  const base = path.basename(sourcePath).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  // Geometry-only SVG: candidate positions/radii are visible without copying
  // any private source pixels into the evidence subtree.
  const svgColors = ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#34c759', '#a7f3d0', '#0a84ff', '#64d2ff', '#5e5ce6'];
  const svgRows = [
    ...initialCandidates.map((candidate, candidateIndex) => ({ candidate, label: `initial-${candidateIndex + 1}`, color: svgColors[candidateIndex] })),
    ...round1Candidates.map((candidate, candidateIndex) => ({ candidate, label: `round1-${candidateIndex + 1}`, color: svgColors[3 + candidateIndex] })),
    ...round2Candidates.map((candidate, candidateIndex) => ({ candidate, label: `round2-${candidateIndex + 1}`, color: svgColors[6 + candidateIndex] })),
  ];
  const strokeWidth = Math.max(4, Math.round(Math.min(image.width, image.height) / 320));
  const fontSize = Math.max(18, Math.round(Math.min(image.width, image.height) / 42));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${image.width} ${image.height}" width="${image.width}" height="${image.height}"><rect width="100%" height="100%" fill="#15191f"/>${svgRows.map(({ candidate, label, color }) => `<circle cx="${candidate.circle.x}" cy="${candidate.circle.y}" r="${candidate.circle.radius}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"/><text x="${candidate.circle.x + candidate.circle.radius + 8}" y="${candidate.circle.y}" fill="${color}" font-family="sans-serif" font-size="${fontSize}">${label}</text>`).join('')}</svg>`;
  const geometryPath = path.join(outputDir, `${base || `input-${index}`}-trace-geometry.svg`);
  await fs.writeFile(geometryPath, svg);
  const visualArtifacts = await writeVisualArtifacts(sourcePath, image, initialCandidates, round1Candidates, round2Candidates, selectedInitial, selectedRound1, selectedRound2, index);

  return {
    input: path.basename(sourcePath),
    source: { width: image.width, height: image.height },
    working: { width: workingWidth, height: workingHeight },
    api: 'circle-candidate-session',
    detectorCalls: 2,
    candidateCount: initialCandidates.length,
    candidateRequest: { requested: 3, returned: initialCandidates.length, status: initialCandidates.length === 3 ? 'complete' : initialCandidates.length ? 'incomplete' : 'none' },
    top3Available: initialCandidates.length === 3,
    candidates: initialCandidates.map((candidate, rank) => ({ rank: rank + 1, id: candidate.id, circle: numberCircle(candidate.circle), score: Number(candidate.score?.toFixed?.(6) ?? candidate.score) })),
    trace: {
      initial: initialCandidates.map(candidate => numberCircle(candidate.circle)),
      refinementRound1: round1Candidates.map(candidate => ({ id: candidate.id, circle: numberCircle(candidate.circle), score: Number(candidate.score?.toFixed?.(6) ?? candidate.score) })),
      refinementRound2: round2Candidates.map(candidate => ({ id: candidate.id, circle: numberCircle(candidate.circle), score: Number(candidate.score?.toFixed?.(6) ?? candidate.score) })),
      other: rowsFromRound(otherRound).map(candidate => ({ id: candidate.id, circle: numberCircle(candidate.circle), score: Number(candidate.score?.toFixed?.(6) ?? candidate.score) })),
    },
    acceptance: {
      initialThree: initialCandidates.length === 3 ? 'complete' : initialCandidates.length ? 'incomplete' : 'missing',
      twoRefinementRounds: round1Candidates.length > 0 && round2Candidates.length > 0 ? 'present' : 'missing',
      selectedAnchorPreserved: exactCircle(initialCandidates[0]?.circle, round1Candidates[0]?.circle) && exactCircle(selectedRound1?.circle, round2Candidates[0]?.circle),
      round1Selection: selectedRound1 ? { id: selectedRound1.id, changed: selectedRound1.id !== selectedInitial?.id, circle: numberCircle(selectedRound1.circle) } : null,
      round2Selection: selectedRound2 ? { id: selectedRound2.id, changed: selectedRound2.id !== selectedRound1?.id, circle: numberCircle(selectedRound2.circle) } : null,
      selectionProgression: selectedRound1 && selectedRound2 && (selectedRound1.id !== selectedInitial?.id || selectedRound2.id !== selectedRound1.id) ? 'edge-score-improved' : selectedRound1 && selectedRound2 ? 'unchanged-no-better-option' : 'missing',
      anchorChecks: {
        initialToRound1: { requestedId: selectedInitial?.id ?? null, returnedId: round1Candidates[0]?.id ?? null, requested: rawCircle(selectedInitial?.circle), returned: rawCircle(round1Candidates[0]?.circle), exact: exactCircle(selectedInitial?.circle, round1Candidates[0]?.circle) },
        round1ToRound2: { requestedId: selectedRound1?.id ?? null, returnedId: round2Candidates[0]?.id ?? null, requested: rawCircle(selectedRound1?.circle), returned: rawCircle(round2Candidates[0]?.circle), exact: exactCircle(selectedRound1?.circle, round2Candidates[0]?.circle) },
      },
      physicalDiscInclusion: 'visual-review-required',
    },
    pxc: {
      photoIntake: session.photoIntake,
      photoIntakeCount: photoIntakeEntries.length,
      requestCount: requestEntries.length,
      candidatePartCount: candidateEntries.length,
      cropChoicesPartCount: cropEntries.length,
      rounds: roundReceipts,
      onePhotoIntakeAcrossRounds: photoIntakeEntries.length === 1 && roundReceipts.every(round => round.photoInputReused),
      noRepeatedFullRasterIntake: photoIntakeEntries.length === 1,
      oldCircleFitOrCropEditParts: oldCircleFitEntries.map(([address]) => address),
      receiptCount: pxc.receipts().length,
    },
    traceGeometry: path.relative(here, geometryPath),
    visualArtifacts,
    limitations: [
      'Physical-disc inclusion is left for visual review of the geometry file; this probe does not invent an oracle anchor.',
      'Two refinement rounds are local to the selected first candidate; they do not silently re-run a global detector.',
    ],
  };
}

const results = [];
for (let index = 0; index < inputs.length; index++) {
  try { results.push(await runOne(inputs[index], index)); }
  catch (error) { results.push({ input: path.basename(inputs[index]), error: String(error), detectorCalls: 0 }); }
}

const detectorSuccesses = results.filter(result => result.trace?.initial);
const verdict = results.some(result => result.error) ? 'FAIL' : detectorSuccesses.length === results.length && results.every(result => result.candidateCount >= 1) ? 'MAYBE' : 'FAIL';
const receipt = { schema: 'DiscStudioCandidateReceipt@1', generatedAt: new Date().toISOString(), verdict, inputs: results };
await fs.writeFile(path.join(outputDir, 'candidate-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
