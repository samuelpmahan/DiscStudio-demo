import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { prepareCirclePhoto, prepareEllipsePhoto, retainedSourceBounds, validateRefitSource } from './photo-refit.ts';
import { sourceToCircularPixel, unitDiskToSource } from './experimental/ellipse-fit-fix/ellipse-crop.mjs';
import { openExperience } from './persistent-experience.ts';
import { initialDraft } from './model.ts';
import { sessionKeyPrefix } from './session-storage.ts';
const canvasFactory = () => createCanvas(1, 1) as any;
function storage() { const values = new Map<string, string>(); let fail = false; return { values, get length() { return values.size; }, key: (n: number) => [...values.keys()][n] ?? null, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { if (fail) throw Error('fixture storage failed'); values.set(key, value); }, fail: () => { fail = true; } }; }
function source() { const canvas = createCanvas(240, 180), ctx = canvas.getContext('2d'); ctx.fillStyle = '#202020'; ctx.fillRect(0,0,240,180); ctx.fillStyle = '#00ff00'; ctx.fillRect(147,87,7,7); ctx.fillStyle = '#ff0000'; ctx.fillRect(117,87,7,7); return canvas; }
const crop = { centerX: 100/240, centerY: 90/180, radiusX: 40/240, radiusY: 40/180, rotation: 0 };
function nearPixel(actual: number[], expected: number[]) { actual.forEach((value,i) => assert.ok(Math.abs(value-expected[i]) <= (i === 3 ? 0 : 12), `pixel ${actual} expected near ${expected}`)); }
async function pixels(src: string) { const image = await loadImage(src); const canvas = createCanvas(image.width,image.height); canvas.getContext('2d').drawImage(image,0,0); return { width: image.width, height: image.height, at: (x: number,y: number) => [...canvas.getContext('2d').getImageData(x,y,1,1).data] }; }
test('save→reload→re-fit uses actual surrounding source pixels and preserves physical identity/details', async () => {
  const photo = prepareCirclePhoto(source() as any,240,180,crop,'fixture',canvasFactory), store = storage();
  assert.equal(photo.refit!.version,1);
  assert.equal(photo.refit.width,120); assert.equal(photo.refit.height,120);
  assert.deepEqual((await pixels(photo.src)).at(0,0),[0,0,0,0]);
  nearPixel((await pixels(photo.refit.src)).at(110,60),[0,255,0,255]);
  const first = await openExperience(store, () => {}); const before = await first.save({ ...initialDraft(), nickname:'Keep me', plastic:'ESP', weight:174 },photo);
  const original = first.pxc.get(before).value;
  const reloaded = await openExperience(store, () => {}), retained = reloaded.depictionSources(before).photo!.refit!;
  assert.equal(retained.version,1);
  const decoded = await loadImage(retained.src);
  const nextPhoto = prepareCirclePhoto(decoded as any,retained.width,retained.height,{ centerX:retained.centerX/retained.width,centerY:retained.centerY/retained.height,radiusX:55/retained.width,radiusY:55/retained.height,rotation:0 },'fixture',canvasFactory,retained);
  const candidate = await reloaded.updateDepiction(before,{photo:nextPhoto,choice:'photo'}); await reloaded.keepDisc(before,candidate);
  const third = await openExperience(store, () => {}), result = third.bag()[0];
  assert.equal(result.disc.id,original.id); assert.equal(result.disc.nickname,'Keep me'); assert.equal(result.disc.weight,174); assert.equal(result.disc.plastic,'ESP'); assert.equal(third.bag().length,1);
  assert.equal(result.address,candidate); assert.equal(result.disc.depiction.refit!.src,photo.refit.src);
  const enlarged = await pixels(result.disc.depiction.src); assert.equal(enlarged.width,110); nearPixel(enlarged.at(105,55),[0,255,0,255]);
});
test('accepted orientation survives diameter preparation, save and reload', async () => {
  const photo = prepareCirclePhoto(source() as any,240,180,{...crop,rotation:Math.PI/2},'rotated',canvasFactory);
  const raster = await pixels(photo.src); assert.equal(raster.width,80); nearPixel(raster.at(40,60),[255,0,0,255]); assert.notDeepEqual(raster.at(60,40),[255,0,0,255]);
  const store = storage(), first = await openExperience(store, () => {}); await first.save(initialDraft(),photo);
  const next = await openExperience(store, () => {}); assert.equal(next.bag()[0].disc.depiction.refit!.rotation,Math.PI/2); nearPixel((await pixels(next.bag()[0].disc.depiction.src)).at(40,60),[255,0,0,255]);
});
test('portrait, fractional diameter and source edge preserve available bounds', async () => {
  const portrait = createCanvas(180,240), prepared = prepareCirclePhoto(portrait as any,180,240,{ centerX:41/180,centerY:60/240,radiusX:40.75/180,radiusY:40.75/240,rotation:-.7 },'portrait',canvasFactory);
  assert.equal((await pixels(prepared.src)).width,81); assert.equal((await pixels(prepared.src)).height,81); assert.equal(prepared.refit.width,103); assert.equal(prepared.refit.centerX,41); assert.equal(prepared.refit.rotation,-.7);
  assert.equal(retainedSourceBounds(180,240,{centerX:40/180,centerY:60/240,radiusX:40/180,radiusY:40/240,rotation:0}).x,0);
  assert.throws(() => validateRefitSource({...prepared.refit,radius:100}),/geometry/);
});
test('canceled/failed candidate replacement keeps current saved photo and durable archive intact', async () => {
  const store = storage(), first = await openExperience(store, () => {}), original = prepareCirclePhoto(source() as any,240,180,crop,'fixture',canvasFactory);
  const before = await first.save(initialDraft(),original), key = [...store.values.keys()].find(key => key.startsWith(sessionKeyPrefix))!, bytes = store.values.get(key);
  const replacement = prepareCirclePhoto(source() as any,240,180,{...crop,rotation:1},'replacement',canvasFactory);
  await first.updateDepiction(before,{photo:replacement}); // abandoned before Keep
  assert.equal(first.bag()[0].address,before); assert.equal(store.values.get(key),bytes);
  assert.throws(() => prepareCirclePhoto(source() as any,240,180,crop,'broken',() => { throw Error('fixture canvas failed'); }),/canvas failed/);
  assert.equal(first.bag()[0].disc.depiction.src,original.src);
  const candidate = await first.updateDepiction(before,{photo:replacement}); store.fail(); await assert.rejects(first.keepDisc(before,candidate),/storage failed/);
  assert.equal(first.bag()[0].address,before); assert.equal(store.values.get(key),bytes);
  const reopened = await openExperience(store, () => {}); assert.equal(reopened.bag()[0].disc.depiction.src,original.src);
});
test('existing archive without optional re-fit material stays readable', async () => {
  const store = storage(), first = await openExperience(store, () => {}); const photo = prepareCirclePhoto(source() as any,240,180,crop,'old',canvasFactory); const {refit,...oldPhoto} = photo;
  const before = await first.save(initialDraft(),oldPhoto), second = await openExperience(store, () => {});
  assert.equal(second.bag()[0].address,before); assert.equal(second.depictionSources(before).photo!.refit,undefined); assert.equal(second.bag()[0].disc.depiction.src,oldPhoto.src);
});

test('saved re-fit geometry is a snapshot of caller material', async () => {
  const encoded = prepareCirclePhoto(source() as any,240,180,crop,'fixture',canvasFactory), mutable = { ...encoded, refit: { ...encoded.refit } };
  const store = storage(), app = await openExperience(store, () => {}); const before = await app.save(initialDraft(),mutable);
  mutable.refit.rotation = 2; mutable.refit.radius = 1;
  assert.equal(app.bag()[0].disc.depiction.refit!.rotation,0); assert.equal(app.depictionSources(before).photo!.refit!.radius,40);
  assert.equal((await openExperience(store, () => {})).bag()[0].disc.depiction.refit!.radius,40);
});

test('ellipse preparation circularizes the rim while keeping source orientation and independent stamp rotation', async () => {
  const ellipse = { centerX:120, centerY:90, radiusX:50, radiusY:38, axisAngle:.35, rotation:0 };
  const prepared = prepareEllipsePhoto(source() as any,240,180,ellipse,'ellipse',canvasFactory);
  assert.equal(prepared.refit!.version,2); assert.equal(prepared.refit!.kind,'ellipse');
  assert.ok(Math.abs(prepared.refit!.axisAngle-.35)<1e-12); assert.equal(prepared.refit!.rotation,0);
  const raster = await pixels(prepared.src); assert.equal(raster.width,100); assert.equal(raster.height,100);
  assert.deepEqual(raster.at(0,0),[0,0,0,0]);
  const majorSourcePoint = unitDiskToSource({x:1,y:0},ellipse);
  const defaultPoint = sourceToCircularPixel(majorSourcePoint,ellipse,100,0);
  const rotatedPoint = sourceToCircularPixel(majorSourcePoint,ellipse,100,Math.PI/2);
  assert.ok(Math.abs(defaultPoint.x-(50+50*Math.cos(.35)))<1e-8);
  assert.ok(Math.abs(defaultPoint.y-(50+50*Math.sin(.35)))<1e-8);
  assert.ok(Math.abs(rotatedPoint.x-50+(defaultPoint.y-50))<1e-8);
  assert.ok(Math.abs(rotatedPoint.y-50-(defaultPoint.x-50))<1e-8);
});

test('v2 ellipse source survives save, reload, correction, and deliberate conversion to circle v1', async () => {
  const store = storage(), first = await openExperience(store, () => {});
  const originalPhoto = prepareEllipsePhoto(source() as any,240,180,{centerX:120,centerY:90,radiusX:50,radiusY:38,axisAngle:.35,rotation:.2},'ellipse',canvasFactory);
  const originalAddress = await first.save({ ...initialDraft(), nickname:'Ellipse source' },originalPhoto);
  const retained = (await openExperience(store, () => {})).depictionSources(originalAddress).photo!.refit!;
  assert.equal(retained.version,2); assert.equal(retained.kind,'ellipse');
  const decoded = await loadImage(retained.src);
  const corrected = prepareEllipsePhoto(decoded as any,retained.width,retained.height,{centerX:retained.centerX,centerY:retained.centerY,radiusX:45,radiusY:34,axisAngle:retained.axisAngle+.04,rotation:.5},'ellipse',canvasFactory,retained);
  assert.equal(corrected.refit!.src,retained.src); assert.equal(corrected.refit!.width,retained.width); assert.equal(corrected.refit!.height,retained.height);
  assert.equal(corrected.refit!.version,2); assert.equal(corrected.refit!.rotation,.5);
  const reloaded = await openExperience(store, () => {}), candidate = await reloaded.updateDepiction(originalAddress,{photo:corrected,choice:'photo'});
  const kept = await reloaded.keepDisc(originalAddress,candidate);
  const afterKeep = await openExperience(store, () => {}), current = afterKeep.bag()[0];
  assert.equal(current.disc.id,first.bag()[0].disc.id);
  assert.equal(current.disc.nickname,'Ellipse source');
  assert.equal(current.disc.depiction.refit!.version,2); assert.equal(current.disc.depiction.refit!.src,retained.src);
  const ellipseState = current.disc.depiction.refit!;
  assert.throws(() => validateRefitSource({...ellipseState,axisAngle:Number.NaN}),/geometry/);
  assert.throws(() => validateRefitSource({...ellipseState,centerX:0}),/geometry/);
  assert.throws(() => validateRefitSource({...ellipseState,radiusX:20,radiusY:25}),/geometry/);
  assert.throws(() => validateRefitSource({...ellipseState,rotation:Number.NaN}),/geometry/);
  const circle = prepareCirclePhoto(decoded as any,retained.width,retained.height,{centerX:retained.centerX/retained.width,centerY:retained.centerY/retained.height,radiusX:30/retained.width,radiusY:30/retained.height,rotation:-.3},'circle',canvasFactory,retained);
  assert.equal(circle.refit!.version,1); assert.equal(circle.refit!.src,retained.src);
  assert.throws(() => validateRefitSource({...circle.refit!,kind:'ellipse',radiusX:30,radiusY:20,axisAngle:0}),/source/);
  assert.equal(kept,candidate);
});
