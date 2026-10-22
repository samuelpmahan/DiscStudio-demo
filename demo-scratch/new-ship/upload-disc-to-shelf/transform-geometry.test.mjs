import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampTransform, identityTransform, transformedBounds, validateTransform } from './transform-geometry.mjs';

test('identity transform preserves alpha bounds exactly', () => {
  const alphaBounds=[100,200,980,1700];
  assert.deepEqual(transformedBounds({width:1080,height:1920,alphaBounds,...identityTransform}),{left:100,top:200,right:980,bottom:1700});
  assert.deepEqual(validateTransform({width:1080,height:1920,alphaBounds,...identityTransform}),{left:100,top:200,right:980,bottom:1700});
});

test('uniform scaling is centered and normalized offsets use canvas dimensions', () => {
  assert.deepEqual(transformedBounds({width:100,height:200,alphaBounds:[20,40,80,160],scale:0.5,dx:0.1,dy:-0.1}),{left:45,top:50,right:75,bottom:110});
});

test('clamp keeps transformed visible pixels inside, validator rejects clipping', () => {
  const frame={width:100,height:200,alphaBounds:[10,20,90,180],scale:1,dx:2,dy:-2};
  const placement=clampTransform(frame);
  assert.deepEqual(placement,{scale:1,dx:0.1,dy:-0.1});
  assert.doesNotThrow(()=>validateTransform({...frame,...placement}));
  assert.throws(()=>validateTransform({...frame,dx:0.11}),/clip/);
});

test('invalid scale and non-finite normalized offsets are rejected', () => {
  const frame={width:100,height:200,alphaBounds:[0,0,100,200]};
  assert.throws(()=>clampTransform({...frame,scale:1.51}),/Invalid card transform/);
  assert.throws(()=>validateTransform({...frame,dx:NaN}),/finite/);
});

test('visible-center resizing permits compact cards at 150% and clamps only at frame boundaries',async()=>{
 const { maxCardScale,resizeCardTransform,transformedBounds }=await import('./transform-geometry.mjs');
 const frame={width:1080,height:1920,alphaBounds:[48,410,508,1060]},current=Object.freeze({scale:1,dx:.2,dy:.08});
 assert.equal(maxCardScale(frame),1.5);
 const before=transformedBounds({...frame,...current}),resized=resizeCardTransform({...frame,current,requestedScale:1.5}),after=transformedBounds({...frame,...resized});
 assert.equal((after.left+after.right)/2,(before.left+before.right)/2);assert.equal((after.top+after.bottom)/2,(before.top+before.bottom)/2);assert.equal(resized.scale,1.5);assert.deepEqual(current,{scale:1,dx:.2,dy:.08});
 const atEdge=resizeCardTransform({...frame,current:{scale:1,dx:0,dy:0},requestedScale:1.5});assert.equal(transformedBounds({...frame,...atEdge}).left,0);
});
