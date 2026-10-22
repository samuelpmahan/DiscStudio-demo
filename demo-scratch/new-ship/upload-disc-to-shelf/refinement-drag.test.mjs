import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { boundaryHandles, supportPoint, anchoredDrag, boundedAnchoredDrag, refinementDirections } from './refinement-drag.mjs';
import { createRefinementRenderer } from './refinement-view.mjs';
const e=Object.freeze({centerX:400,centerY:320,radiusX:220,radiusY:120,axisAngle:.37});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const valid=g=>g.radiusX>=g.radiusY&&g.radiusY>=10&&g.radiusX<=300&&g.radiusY<=250&&boundaryHandles(g).every(h=>h.point.x>=0&&h.point.x<=800&&h.point.y>=0&&h.point.y<=640);
test('all eight support points are on ellipse and cardinal points are true extrema',()=>{
 const c=Math.cos(e.axisAngle),s=Math.sin(e.axisAngle),handles=boundaryHandles(e);assert.equal(handles.length,8);
 for(const h of handles){const x=h.point.x-e.centerX,y=h.point.y-e.centerY;assert.ok(Math.abs(((x*c+y*s)/e.radiusX)**2+((-x*s+y*c)/e.radiusY)**2-1)<1e-12);const tangent={x:-h.direction.y,y:h.direction.x};const Qnormal={x:(x*c+y*s)*c/e.radiusX**2-(-x*s+y*c)*s/e.radiusY**2,y:(x*c+y*s)*s/e.radiusX**2+(-x*s+y*c)*c/e.radiusY**2};assert.ok(Math.abs(Qnormal.x*tangent.x+Qnormal.y*tangent.y)<1e-12);}
});
test('all eight nonsingular drags keep actual opposite support steady and move selected point by exact delta',()=>{
 for(let index=0;index<8;index++){const delta={x:3,y:-2},n=refinementDirections[index],before=supportPoint(e,n),opposite=supportPoint(e,refinementDirections[(index+4)%8]),next=anchoredDrag(e,index,delta);assert.ok(next);assert.ok(distance(supportPoint(next,refinementDirections[(index+4)%8]),opposite)<1e-10);assert.ok(distance(supportPoint(next,n),{x:before.x+delta.x,y:before.y+delta.y})<1e-10);assert.equal(next.axisAngle,e.axisAngle);}
});
test('diagonal drag adjusts both radii; zero delta is exact within floating tolerance; input immutable',()=>{
 const serialized=JSON.stringify(e),next=anchoredDrag(e,3,{x:5,y:5});assert.notEqual(next.radiusX,e.radiusX);assert.notEqual(next.radiusY,e.radiusY);const zero=anchoredDrag(e,3,{x:0,y:0});for(const key of Object.keys(e))assert.ok(Math.abs(zero[key]-e[key])<1e-10);assert.equal(JSON.stringify(e),serialized);
});
test('axis-aligned tangent movement is ignored and circle mode remains circle',()=>{
 const circle={centerX:400,centerY:320,radiusX:120,radiusY:120,axisAngle:0};
 const sideways=anchoredDrag(circle,0,{x:50,y:0},{circle:true});assert.deepEqual(sideways,circle);
 const next=anchoredDrag(circle,2,{x:12,y:10},{circle:true});assert.equal(next.radiusX,126);assert.equal(next.radiusY,126);assert.equal(next.centerX,406);assert.equal(next.centerY,320);
 const aligned={...e,axisAngle:0};const top=anchoredDrag(aligned,0,{x:10,y:-8});assert.equal(top.centerX,aligned.centerX);assert.equal(top.radiusX,aligned.radiusX);assert.equal(top.radiusY,aligned.radiusY+4);
});
test('bounded drag cannot cross source or canonical radii bounds and keeps anchor',()=>{
 for(let i=0;i<8;i++){const opposite=supportPoint(e,refinementDirections[(i+4)%8]);const next=boundedAnchoredDrag(e,i,{x:1800,y:-1900},{},valid);assert.ok(valid(next));assert.ok(distance(supportPoint(next,refinementDirections[(i+4)%8]),opposite)<1e-8);}
});
test('any number of anchored cardinal drags can exactly correct an aligned near ellipse into a circle',()=>{
 const target={centerX:400,centerY:320,radiusX:220,radiusY:220,axisAngle:0};let current={centerX:405,centerY:313,radiusX:211,radiusY:193,axisAngle:0};
 // First correct left then right supports (major axis), then top/bottom (minor).
 for(const index of [6,2,0,4]){const before=supportPoint(current,refinementDirections[index]),want=supportPoint(target,refinementDirections[index]);current=boundedAnchoredDrag(current,index,{x:want.x-before.x,y:want.y-before.y},{},valid);}
 for(const key of Object.keys(target))assert.ok(Math.abs(current[key]-target[key])<1e-8);
});
test('session-frozen view reuses photo raster across geometry changes and repeated seeks',()=>{
 const source={identity:'drag-fixture',image:createCanvas(800,640),width:800,height:640},viewport={width:390,height:390,dpr:1},view={padding:24,projection:'uniform',frozenProjection:{scale:.7,dx:-80,dy:-40}},r=createRefinementRenderer({createCanvas,drawDots:false}),canvas=createCanvas(390,390),ctx=canvas.getContext('2d');
 const snapshot={source,viewport,view,ellipse:e};r.seek(ctx,snapshot,0);const next={...snapshot,ellipse:anchoredDrag(e,2,{x:3,y:2})},receipt=r.seek(ctx,next,1).receipt;assert.deepEqual(receipt.reused,['refinement-photo']);assert.deepEqual(receipt.rasterized,['refinement-boundary']);assert.equal(r.seek(ctx,next,0).receipt.rasterized.length,0);
});
