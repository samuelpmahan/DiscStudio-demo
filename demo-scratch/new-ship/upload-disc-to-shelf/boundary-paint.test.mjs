import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { boundaryPaintStyle, paintBoundary } from './boundary-paint.mjs';
const args={width:240,height:240,centerX:120,centerY:120,radiusX:70,radiusY:55,axisAngle:.37};
const pixel=(canvas,x,y)=>[...canvas.getContext('2d').getImageData(x,y,1,1).data];
test('outside mask is translucent while inner ellipse remains completely transparent',()=>{
 const canvas=createCanvas(240,240);paintBoundary(canvas.getContext('2d'),args);
 assert.deepEqual(pixel(canvas,120,120),[0,0,0,0]);assert.deepEqual(pixel(canvas,120,150),[0,0,0,0]);
 const outside=pixel(canvas,5,5);assert.ok(outside[3]>=88&&outside[3]<=90);assert.ok(outside[0]<30&&outside[1]<50&&outside[2]<40);
});
test('paint restores caller state and preserves matching dual-contrast dashed strokes with CSS-pixel units',()=>{
 const calls=[];const context={save(){calls.push(['save'])},restore(){calls.push(['restore'])},beginPath(){},rect(){},moveTo(){},ellipse(){},fill(rule){calls.push(['fill',rule,this.fillStyle])},setLineDash(dash){calls.push(['dash',dash])},stroke(){calls.push(['stroke',this.strokeStyle,this.lineWidth,this.lineCap])}};
 paintBoundary(context,{...args,cssPixelScale:320/326});
 assert.deepEqual(calls.filter(c=>c[0]==='stroke'),[['stroke','#173a30',3*320/326,'round'],['stroke','#fff',320/326,'round']]);assert.deepEqual(calls.find(c=>c[0]==='dash')[1],[6*320/326,5*320/326]);assert.equal(calls.find(c=>c[0]==='fill')[1],'evenodd');assert.equal(calls[0][0],'save');assert.equal(calls.at(-1)[0],'restore');
});
test('DPR1 and DPR2 share CSS-scale dash pattern and outside alpha; no continuous dark border exists',()=>{
 const render=dpr=>{const canvas=createCanvas(240*dpr,240*dpr),ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);paintBoundary(ctx,args);return canvas;};
 const one=render(1),two=render(2);assert.deepEqual(pixel(one,5,5),pixel(two,10,10));assert.deepEqual(pixel(one,120,120),pixel(two,240,240));
 assert.deepEqual(boundaryPaintStyle.dash,[6,5]);assert.equal(boundaryPaintStyle.lineWidth,1);assert.equal(boundaryPaintStyle.backingWidth,3);assert.equal(boundaryPaintStyle.stroke,'#fff');
 // The ellipse inner side away from its dashed strokes has no continuous dark ring.
 const c=Math.cos(args.axisAngle),s=Math.sin(args.axisAngle);
 for(let t=0;t<Math.PI*2;t+=.13){const x=(args.radiusX-4)*Math.cos(t),y=(args.radiusY-4)*Math.sin(t);assert.equal(pixel(one,Math.round(args.centerX+x*c-y*s),Math.round(args.centerY+x*s+y*c))[3],0);}
});
test('gap on boundary inner side stays clear instead of a continuous dark backing ring',()=>{
 const canvas=createCanvas(240,240);paintBoundary(canvas.getContext('2d'),{width:240,height:240,centerX:120,centerY:120,radiusX:60,radiusY:60});
 // Rightmost path starts at t0: 8.5px around the perimeter is between [6,5] dashes.
 assert.equal(pixel(canvas,178,128)[3],0);
});
