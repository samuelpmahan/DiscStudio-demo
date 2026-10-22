import test from 'node:test';
import assert from 'node:assert/strict';
import { coverSourceRect, framedCoverSourceRect, effectiveCoverFraming, drawBackgroundCover } from './background-cover.mjs';

test('cover crop keeps a portrait upload proportional in a landscape frame', () => {
  assert.deepEqual(coverSourceRect(1080, 1920, 1920, 1080), { x: 0, y: 656.25, width: 1080, height: 607.5 });
});

test('cover crop keeps a landscape upload proportional in a portrait frame', () => {
  assert.deepEqual(coverSourceRect(1920, 1080, 1080, 1920), { x: 656.25, y: 0, width: 607.5, height: 1080 });
});

test('preview and combined compositions draw the same centered source rectangle', () => {
  const calls = [], context = { drawImage: (...args) => calls.push(args) }, image = { naturalWidth: 4000, naturalHeight: 3000, width: 400, height: 300 };
  drawBackgroundCover(context, image, 1920, 1080);
  drawBackgroundCover(context, image, 1920, 1080);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0], [image, 0, 375, 4000, 2250, 0, 0, 1920, 1080]);
  assert.deepEqual(coverSourceRect(1920, 1080, 1920, 1080), { x: 0, y: 0, width: 1920, height: 1080 });
  assert.throws(() => coverSourceRect(0, 1, 2, 3), /positive/);
});

test('framing pans and zooms the source while preserving a filled native frame', () => {
  const center = framedCoverSourceRect(1080, 1920, 1920, 1080);
  assert.deepEqual(center, coverSourceRect(1080, 1920, 1920, 1080));
  const top = framedCoverSourceRect(1080, 1920, 1920, 1080, { x: .5, y: 0, zoom: 1 });
  assert.deepEqual(top, { x: 0, y: 0, width: 1080, height: 607.5 });
  const enlarged = framedCoverSourceRect(1080, 1920, 1920, 1080, { x: 1, y: 1, zoom: 1.5 });
  assert.equal(enlarged.width, 720);
  assert.equal(enlarged.height, 405);
  assert.equal(enlarged.x + enlarged.width, 1080);
  assert.equal(enlarged.y + enlarged.height, 1920);
  const calls = [], context = { drawImage: (...args) => calls.push(args) }, image = { naturalWidth: 1080, naturalHeight: 1920 };
  drawBackgroundCover(context, image, 1920, 1080, { x: .5, y: .1, zoom: 1.25 });
  drawBackgroundCover(context, image, 1920, 1080, { x: .5, y: .1, zoom: 1.25 });
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0][0], image);
  assert.deepEqual(calls[0].slice(-4), [0, 0, 1920, 1080]);
});

test('no-room pan normalizes to effective center before zoom changes', () => {
  const initial=effectiveCoverFraming(1080,1920,1080,1920,{x:0,y:0,zoom:1});
  assert.deepEqual(initial,{x:.5,y:.5,zoom:1});
  const enlarged=framedCoverSourceRect(1080,1920,1080,1920,{...initial,zoom:1.2});
  assert.equal(enlarged.x,(1080-enlarged.width)/2);
  assert.equal(enlarged.y,(1920-enlarged.height)/2);
  const edge=effectiveCoverFraming(1080,1920,1080,1920,{x:0,y:0,zoom:1.2});
  assert.equal(edge.x,enlarged.width/(2*1080));
  assert.equal(edge.y,enlarged.height/(2*1920));
});
