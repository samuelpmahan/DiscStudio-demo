import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createFrameRenderer, imageLayer } from './frame-seek.mjs';
import { cardFrameSnapshot, drawCard } from './card-renderer-core.ts';
import { renderCard } from './card-renderer.ts';
const photo=createCanvas(640,640),pc=photo.getContext('2d');pc.fillStyle='#fff';pc.fillRect(0,0,640,640);pc.fillStyle='#171717';pc.font='bold 84px sans-serif';pc.fillText('RIGHT →',70,320);
const source=photo.toDataURL('image/png');
const disc={mold:'ds.px.seed.buzzz',plastic:'ESP',weight:null,depiction:{kind:'photo',src:source},renderer:{moldName:'Buzzz',manufacturer:'Discraft',flights:[6.5,5,-3,1]}};
const env={createCanvas,loadImage};
const pixels = c => Buffer.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);
for(const preset of ['u03-front','u03-behind','u03-front-mirror','u03-behind-mirror','u04']) {
 test(`${preset}: deterministic static frame and adapter pixels`,async()=>{
  const scene=await cardFrameSnapshot(disc,preset,env), renderer=createFrameRenderer({createCanvas}),canvas=createCanvas(1080,1920),seek=renderer.bind(canvas.getContext('2d'),scene);
  const first=seek(0); const expected=pixels(canvas);seek(4);seek(1);seek(0);assert.deepEqual(pixels(canvas),expected);assert.equal(first.rasterized.length,3);
  const fromAdapter=await loadImage(await renderCard(disc,'vertical',preset)),adapter=createCanvas(1080,1920);adapter.getContext('2d').drawImage(fromAdapter,0,0);assert.deepEqual(pixels(adapter),expected);
  const alpha=canvas.getContext('2d').getImageData(0,0,1080,1920).data;assert.equal(alpha[3],0);assert.equal(alpha[(1919*1080+1079)*4+3],0);
 });
}
test('text changes rerasterize label only; mirror/order/placement retain photo raster',async()=>{
 const r=createFrameRenderer({createCanvas}),c=createCanvas(1080,1920),ctx=c.getContext('2d'),scene=await cardFrameSnapshot(disc,'u03-front',env);
 assert.deepEqual(r.seek(ctx,scene,0).rasterized,['card-surface','card-label','disc-photo']);
 const changed=await cardFrameSnapshot({...disc,renderer:{...disc.renderer,moldName:'Rhythm'}},'u03-front',env);
 const textReceipt=r.seek(ctx,changed,1);assert.deepEqual(textReceipt.rasterized,['card-label']);assert.deepEqual(textReceipt.reused,['card-surface','disc-photo']);
 const moved={...changed,layers:changed.layers.map(l=>({...l,transform:{scale:.8,dx:.1,dy:.02}}))};
 assert.equal(r.seek(ctx,moved,2).rasterized.length,0);
 const mirror=await cardFrameSnapshot(disc,'u03-front-mirror',env);assert.ok(r.seek(ctx,mirror,3).reused.includes('disc-photo'));
});
test('explicit timed placement interaction is independent of previous seek order and retains background + card',()=>{
 const r=createFrameRenderer({createCanvas}),c=createCanvas(100,200),ctx=c.getContext('2d'),image=createCanvas(20,20);image.getContext('2d').fillRect(0,0,20,20);
 const bg={id:'preview-background',identity:'grey-v1',draw:x=>{x.fillStyle='#888';x.fillRect(0,0,100,200);}};
 const card={...imageLayer('preview-card','card-v1',image,20,20),x:25,y:80};
 const scene={width:100,height:200,states:[{t:0,layers:[bg,card]},{t:1,layers:[bg,{...card,transform:{scale:1,dx:.2,dy:.05}}]},{t:2,layers:[bg,{...card,transform:{scale:.7,dx:0,dy:0}}]}]};
 const seek=r.bind(ctx,scene),expected=[];for(const t of [0,1,2]){seek(t);expected[t]=pixels(c);}for(const t of [2,0,1,2,0]){const receipt=seek(t);assert.deepEqual(pixels(c),expected[t]);assert.equal(receipt.rasterized.length,0);assert.equal(receipt.reused.length,2);}assert.equal(r.metrics().rasterized,2);
});
test('U4 photo above fade; white disc center retains its pixels',async()=>{
 const scene=await cardFrameSnapshot(disc,'u04',env);assert.deepEqual(scene.layers.map(l=>l.id),['card-surface','card-label','disc-photo']);
 const c=createCanvas(1080,1920),r=createFrameRenderer({createCanvas});r.seek(c.getContext('2d'),scene,0);assert.deepEqual([...c.getContext('2d').getImageData(278,950,1,1).data],[255,255,255,255]);
});
test('held snapshots ignore later source fact mutations and reject invalid seeks',async()=>{
 const held={...disc,renderer:{...disc.renderer,flights:[6.5,5,-3,1]}},scene=await cardFrameSnapshot(held,'u03-front',env),c=createCanvas(1080,1920),r=createFrameRenderer({createCanvas});r.seek(c.getContext('2d'),scene,0);const before=pixels(c);held.renderer.flights[0]=14;r.clear();r.seek(c.getContext('2d'),scene,0);assert.deepEqual(pixels(c),before);assert.throws(()=>r.seek(c.getContext('2d'),scene,-1));
});
test('landscape preview background agrees with combined PNG composition and stays retained',()=>{
 const bg=createCanvas(600,200),b=bg.getContext('2d');b.fillStyle='#5b86ad';b.fillRect(0,0,600,200);b.fillStyle='#406428';b.fillRect(0,100,600,100);
 const card=createCanvas(1080,1920);card.getContext('2d').fillRect(48,600,200,300);
 const actual=createCanvas(1080,1920),r=createFrameRenderer({createCanvas}),layers=[imageLayer('preview-background','landscape-fixture',bg,1080,1920),imageLayer('preview-card','fixture-card',card,1080,1920)];r.seek(actual.getContext('2d'),{width:1080,height:1920,layers},0);
 const combined=createCanvas(1080,1920),ctx=combined.getContext('2d');ctx.drawImage(bg,0,0,1080,1920);ctx.drawImage(card,0,0);assert.deepEqual(pixels(actual),pixels(combined));assert.deepEqual(r.seek(actual.getContext('2d'),{width:1080,height:1920,layers},1).reused,['preview-background','preview-card']);
});
test('derived resize states seek out of order with unchanged raster layers',async()=>{
 const {resizeCardTransform}=await import('./transform-geometry.mjs');
 const scene=await cardFrameSnapshot(disc,'u04',env),frame={width:1080,height:1920,alphaBounds:[48,530,508,1222]},current={scale:1,dx:.2,dy:0};
 const transforms=[current,resizeCardTransform({...frame,current,requestedScale:1.5}),resizeCardTransform({...frame,current,requestedScale:.7})];
 const states=transforms.map((transform,t)=>({t,layers:scene.layers.map(layer=>({...layer,transform}))})),held={...scene,states};
 const c=createCanvas(1080,1920),r=createFrameRenderer({createCanvas}),seek=r.bind(c.getContext('2d'),held),expected=[];
 for(const t of [0,1,2]){const receipt=seek(t);expected[t]=pixels(c);if(t)assert.equal(receipt.rasterized.length,0);}
 for(const t of [2,0,1,2,1]){assert.equal(seek(t).rasterized.length,0);assert.deepEqual(pixels(c),expected[t]);}
 assert.equal(r.metrics().rasterized,3);
});
