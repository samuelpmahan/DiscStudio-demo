import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { alphaBounds, createStickerSizer, stickerOrigin, cardRasterIdentity } from './sticker-raster.mjs';
import { createFrameRenderer, imageLayer } from './frame-seek.mjs';
const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
function fixture(){const c=createCanvas(120,180),x=c.getContext('2d');x.fillStyle='white';x.fillRect(5,48,46,69);x.fillStyle='#2468ac';x.fillRect(6,49,11,21);return c;}
function setup(){const frames=createFrameRenderer({createCanvas}),sizer=createStickerSizer({createCanvas,frameRenderer:frames}),image=fixture();return {frames,sizer,args:{image,nativeWidth:120,nativeHeight:180,nativeBounds:alphaBounds(pixels(image),120,180),identity:cardRasterIdentity({id:'held'},'vertical','u04'),scale:1}};}
test('stickers crop every nonzero alpha pixel and scale uniformly before the final tight crop',()=>{
  const {sizer,args}=setup(),before=Buffer.from(pixels(args.image));
  for(const scale of [.5,1,1.25,1.5]){
    const s=sizer.size({...args,scale});assert.deepEqual(alphaBounds(pixels(s.canvas),s.width,s.height),[0,0,s.width,s.height]);
    assert.ok(Math.abs(s.width-46*scale)<=2);assert.ok(Math.abs(s.height-69*scale)<=2);
  }
  assert.deepEqual(Buffer.from(pixels(args.image)),before,'native pixels remain unchanged');
  assert.deepEqual([sizer.size(args).width,sizer.size(args).height],[46,69]);
});
test('resize creates one sized raster; composition/drag/background reuse it with exact pixel agreement',()=>{
  const {sizer,args}=setup(),s=sizer.size({...args,scale:1.25});assert.equal(sizer.metrics().rasterBuilds,1);
  const composer=createFrameRenderer({createCanvas}),frame=createCanvas(120,180);
  const states=[{scale:1.25,dx:.14,dy:-.12},{scale:1.25,dx:-.7,dy:.6},{scale:1.25,dx:.21,dy:0}].map(placement=>{
    const held=sizer.size({...args,scale:placement.scale});assert.equal(held,s);
    const origin=stickerOrigin({width:120,height:180,nativeBounds:args.nativeBounds,placement,sticker:held});
    assert.ok(Number.isInteger(origin.x)&&Number.isInteger(origin.y));
    return {width:120,height:180,layers:[{...imageLayer('card',held.identity,held.canvas,held.width,held.height),...origin}],origin};
  });
  const ordered=states.map((state,i)=>{composer.seek(frame.getContext('2d'),state,i);const crop=frame.getContext('2d').getImageData(state.origin.x,state.origin.y,s.width,s.height).data;assert.deepEqual(crop,pixels(s.canvas));return Buffer.from(pixels(frame));});
  for(const i of [2,0,1,0]){composer.seek(frame.getContext('2d'),states[i],i);assert.deepEqual(Buffer.from(pixels(frame)),ordered[i]);}
  assert.equal(sizer.metrics().rasterBuilds,1);assert.equal(composer.metrics().rasterized,1);
  sizer.size({...args,scale:1.5});assert.equal(sizer.metrics().rasterBuilds,2);
  assert.throws(()=>stickerOrigin({width:10,height:10,nativeBounds:args.nativeBounds,placement:states[0],sticker:s}),/cannot fit/);
});
test('sized identity includes held card facts and scale, excludes scene placement and background',()=>{
  const {sizer,args}=setup(),one=sizer.size(args);
  assert.equal(sizer.size({...args,placement:{dx:.5,dy:.1},background:'changed'}),one);
  assert.notEqual(sizer.size({...args,identity:cardRasterIdentity({id:'held',name:'changed'},'vertical','u04')}),one);
  assert.notEqual(sizer.size({...args,scale:1.25}),one);
});
