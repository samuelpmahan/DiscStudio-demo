import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createExperience, initialDraft } from './model.ts';
import { cloneCard } from './export-ui.ts';
import { renderCard } from './card-renderer.ts';
import { exportZip } from './export-queue.ts';
import { paintedDiscsEnabled } from './kompozition.ts';
import { circleCropExportMapping } from './upload-ui.ts';
import { drawRotatedCrop } from './crop-geometry.ts';

assert.equal(paintedDiscsEnabled, false, 'Run the photo-first base materialization.');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const derived = process.argv.includes('--derived-contact-sheet');
const contactSheetBytes = derived ? fs.readFileSync(new URL('./evidence/derived-contact-sheet-input.png', import.meta.url)) : null;
const contactSheet = derived ? await loadImage(contactSheetBytes) : null;
const contactRegions = [{ x: 60, y: 441, width: 220, height: 222 }, { x: 371, y: 441, width: 220, height: 222 }];
if (derived) { assert.equal(contactSheet.width, 960); assert.equal(contactSheet.height, 730); assert.equal(sha(contactSheetBytes), 'd751819a1276be73f11d26bbcf2d8489c006fe60a5838264061ab3fc7ff7f0d6'); }
const prefix = derived ? 'derived-contact-two-card' : 'photo-two-card';
const photo = (color, label, index) => {
  const source = createCanvas(512, 512), ctx = source.getContext('2d');
  if (derived) { const r = contactRegions[index]; ctx.drawImage(contactSheet, r.x, r.y, r.width, r.height, 0, 0, 512, 512); }
  else {
    ctx.fillStyle = '#ebece4'; ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(256, 256, 220, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 150px Arial'; ctx.textAlign = 'center'; ctx.fillText(label, 256, 312);
  }
  const radius = derived ? 250 : 220;
  const mapping = circleCropExportMapping(512, 512, 512, { centerX: .5, centerY: .5, radiusX: radius / 512, radiusY: radius / 512, rotation: 0 });
  const prepared = createCanvas(512, 512), cropContext = prepared.getContext('2d');
  cropContext.save(); cropContext.beginPath(); cropContext.ellipse(256, 256, 256, 256, 0, 0, Math.PI * 2); cropContext.clip();
  drawRotatedCrop(cropContext, source, mapping); cropContext.restore();
  return prepared.toDataURL('image/webp', .86);
};
const app = createExperience(() => {});
const hydrated = await app.hydrateSeed(initialDraft().mold);
const originalAddresses = [];
for (const [index, [name, color, symbol]] of (derived ? [['White/asphalt contact specimen', '', 'W'], ['Green/wood contact specimen', '', 'G']] : [['Coral specimen', '#d9554e', 'A'], ['Teal specimen', '#25837f', 'B']]).entries()) {
  const depiction = { kind: 'photo', name: `${symbol}.webp`, src: photo(color, symbol, index) };
  await app.addDraftPhoto(depiction);
  originalAddresses.push(await app.save({ ...initialDraft(), mold: hydrated.address, nickname: name, plastic: 'ESP', weight: 177 }, depiction));
}
const retainedBagAddress = app.bagAddress;
const firstEdit = await app.updateDisc(originalAddresses[0], { speed: 11 });
await app.keepDisc(originalAddresses[0], firstEdit);
assert.equal(app.pxc.get(retainedBagAddress).value[0], originalAddresses[0]);
assert.equal(app.bag()[0].address, firstEdit);
assert.equal(app.bag()[0].disc.speed, 11);
const cards = app.bag().map(row => cloneCard(row, 'vertical', 'u02'));
assert.equal(cards.length, 2);
assert.deepEqual(cards.map(card => card.disc.renderer.flights), [[5, 4, -1, 1], [5, 4, -1, 1]]);
assert.equal(cards[0].disc.speed, 11);
const photoIds = app.bag().map(row => sha(Buffer.from(row.art)));
assert.deepEqual(cards.map(card => sha(Buffer.from(card.disc.depiction.src))), photoIds);
const previews = await Promise.all(cards.map(card => renderCard(card.disc, card.orientation, card.cardDesign)));
await app.enqueueOutput(cards);
const approval = app.latestOutputApproval;
assert.equal(approval.count, 2);
const queue = app.outputQueue();
assert.equal(queue.length, 2);
assert.deepEqual(queue.map(card => card.disc.nickname), derived ? ['White/asphalt contact specimen', 'Green/wood contact specimen'] : ['Coral specimen', 'Teal specimen']);
const secondEdit = await app.updateDisc(firstEdit, { speed: 12 });
await app.keepDisc(firstEdit, secondEdit);
assert.equal(app.bag()[0].address, secondEdit);
assert.equal(app.bag()[0].disc.speed, 12);
assert.equal(queue[0].disc.speed, 11);
assert.equal(app.latestOutputApproval.approvalSnapshotId, approval.approvalSnapshotId);
assert.deepEqual(app.bag().map(row => sha(Buffer.from(row.art))), photoIds);
const zip = await exportZip(queue, { renderCard: card => renderCard(card.disc, card.orientation, card.cardDesign) });
const opened = await JSZip.loadAsync(zip);
const manifestText = await opened.file('manifest.json').async('string');
const manifest = JSON.parse(manifestText);
assert.equal(manifest.cardCount, 2);
assert.deepEqual(manifest.cards.map(card => card.filename), ['buzzz-u02-vertical.png', 'buzzz-u02-vertical-2.png']);
assert.deepEqual(manifest.cards.map(card => card.flight.speed), [11, 5]);
for (const [index, card] of manifest.cards.entries()) {
  const png = await opened.file(card.filename).async('nodebuffer');
  assert.equal(card.width, 1080); assert.equal(card.height, 1920);
  assert.equal(card.byteLength, png.length); assert.equal(card.sha256, sha(png));
  assert.deepEqual(png, previews[index]);
}
const exported = await app.recordOutputExport({ manifest, manifestId: `sha256:${sha(Buffer.from(manifestText))}`, zipId: `sha256:${sha(zip)}`, expectedOutputQueueSnapshotId: approval.outputQueueSnapshotId, downloadRequested: false });
assert.equal(exported.approvalSnapshotId, approval.approvalSnapshotId);
const out = new URL('./evidence/', import.meta.url);
previews.forEach((png, index) => fs.writeFileSync(new URL(`${prefix}-${index + 1}.png`, out), png));
const inspection = createCanvas(2160, 1920), inspectionContext = inspection.getContext('2d');
inspectionContext.fillStyle = '#17212a'; inspectionContext.fillRect(0, 0, 2160, 1920);
for (const [index, png] of previews.entries()) inspectionContext.drawImage(await loadImage(png), index * 1080, 0);
fs.writeFileSync(new URL(`${prefix}-dark-inspection.png`, out), inspection.toBuffer('image/png'));
fs.writeFileSync(new URL(`${prefix}.zip`, out), zip);
fs.writeFileSync(new URL(`${prefix}.receipt.json`, out), JSON.stringify({ kind: 'discstudio.two-card-export/v3', fixture: derived ? 'DERIVED_CONTACT_SHEET_INPUT; actual prior photo-disc render pixels, not original camera bytes' : 'generated source graphics through existing crop geometry and draw path', contactSheet: derived ? { source: 'Library libfile_7c30deff87188191b2a3a5ba46a1f188; prior three-more-disc-crops contact sheet', sha256: sha(contactSheetBytes), dimensions: [960, 730], exactRegions: contactRegions, notes: 'lower rendered-crop row; contact-sheet RGB checkerboard backdrop is baked into pixels' } : null, crop: '512px circular aperture clipped to a webp prepared photo with shared circleCropExportMapping and drawRotatedCrop', originalAddresses, retainedBagAddress, firstEdit, secondEdit, bagAddresses: app.bag().map(row => row.address), photoIds, approval, export: exported, previewPngSha256: previews.map(sha), zipSha256: sha(zip), zipBytes: zip.length, packagedMatchesPreview: true, approvedSnapshotStableAfterKeptEdit: true }, null, 2) + '\n');
