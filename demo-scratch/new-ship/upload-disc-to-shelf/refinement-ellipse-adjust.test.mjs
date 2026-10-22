import test from 'node:test';
import assert from 'node:assert/strict';
import { refinementDirections, supportPoint } from './refinement-drag.mjs';
import { ellipseCovariance, makeEllipsePin, anchorForEllipseDrag, solvePinnedEllipse, boundedEllipseAdjustment } from './refinement-ellipse-adjust.mjs';
const options={width:800,height:640,isValid:g=>{
 const c=Math.cos(g.axisAngle),s=Math.sin(g.axisAngle),hx=Math.hypot(g.radiusX*c,g.radiusY*s),hy=Math.hypot(g.radiusX*s,g.radiusY*c);
 return g.radiusX>=g.radiusY&&g.radiusY>=20&&g.radiusX<=400&&g.radiusY<=320&&g.centerX>=hx&&g.centerY>=hy&&g.centerX+hx<=800&&g.centerY+hy<=640;
}};
function geometry(center,Q){const delta=Math.hypot(Q.xx-Q.yy,2*Q.xy);return{centerX:center.x,centerY:center.y,radiusX:Math.sqrt((Q.xx+Q.yy+delta)/2),radiusY:Math.sqrt((Q.xx+Q.yy-delta)/2),axisAngle:delta<1e-12?0:.5*Math.atan2(2*Q.xy,Q.xx-Q.yy)};}
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const supportQ=(Q,n)=>{const h=Math.sqrt(Q.xx*n.x*n.x+2*Q.xy*n.x*n.y+Q.yy*n.y*n.y);return{x:(Q.xx*n.x+Q.xy*n.y)/h,y:(Q.xy*n.x+Q.yy*n.y)/h};};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
test('112 distinct ordered pairs from circle and rotated unequal ellipse preserve exact pin and target',()=>{
 let count=0;for(const prior of [{centerX:400,centerY:320,radiusX:120,radiusY:120,axisAngle:0},{centerX:400,centerY:320,radiusX:150,radiusY:95,axisAngle:.37}]){
  const Q=ellipseCovariance(prior);for(let i=0;i<8;i++)for(let j=0;j<8;j++){if(i===j)continue;const anchor=makeEllipsePin(prior,i),n=refinementDirections[j],factor=Math.sin(i*17+j*7+1);
   const knownQ={xx:Q.xx+factor*40,xy:Q.xy+Math.cos(i+j+1)*30,yy:Q.yy-factor*20},u=refinementDirections[i],offset=supportQ(knownQ,u),center={x:anchor.point.x-offset.x,y:anchor.point.y-offset.y},v=supportQ(knownQ,n),target={x:center.x+v.x,y:center.y+v.y};
   const result=solvePinnedEllipse(prior,j,target,anchor,options);assert.ok(result,`pair ${i}/${j}`);assert.ok(options.isValid(result.geometry));assert.ok(distance(supportPoint(result.geometry,u),anchor.point)<1e-7);assert.ok(distance(supportPoint(result.geometry,n),target)<1e-7);assert.ok(result.receipt.condition<4);count++;
  }
 }assert.equal(count,112);
});
test('circle becomes a valid independently sized ellipse and TL then TR preserves placed TL support',()=>{
 const circle={centerX:400,centerY:320,radiusX:120,radiusY:120,axisAngle:0},firstAnchor=anchorForEllipseDrag(circle,7,null),first=boundedEllipseAdjustment(circle,7,{x:-5,y:-3},firstAnchor,options);assert.ok(first.geometry.radiusX>first.geometry.radiusY);
 const pin=makeEllipsePin(first.geometry,7,firstAnchor),second=boundedEllipseAdjustment(first.geometry,1,{x:4,y:-5},pin,options);
 assert.ok(options.isValid(second.geometry));assert.ok(distance(supportPoint(second.geometry,refinementDirections[7]),pin.point)<1e-7);assert.equal(second.receipt.constrained,false);assert.ok(second.receipt.targetResidual<1e-7);
});
test('same handle continues with its other contact and does not accumulate nested pin chains',()=>{
 const e={centerX:400,centerY:320,radiusX:150,radiusY:95,axisAngle:.37};let pin=null,current=e;
 for(let i=0;i<12;i++){const index=i%2?1:7,anchor=anchorForEllipseDrag(current,index,pin),result=boundedEllipseAdjustment(current,index,{x:1,y:-.5},anchor,options);current=result.geometry;pin=makeEllipsePin(current,index,anchor);assert.equal(pin.continuationAnchor.continuationAnchor,undefined);const same=anchorForEllipseDrag(current,index,pin);assert.notEqual(same.index,index);assert.ok(distance(supportPoint(current,same.normal),same.point)<1e-7);}
});
test('opposite contact pair, zero delta and source-bound constrained motion remain valid',()=>{
 const e={centerX:400,centerY:320,radiusX:150,radiusY:95,axisAngle:.37},anchor=makeEllipsePin(e,6);
 assert.deepEqual(boundedEllipseAdjustment(e,2,{x:0,y:0},anchor,options).geometry,e);
 const next=boundedEllipseAdjustment(e,2,{x:15,y:3},anchor,options);assert.ok(options.isValid(next.geometry));assert.ok(distance(supportPoint(next.geometry,refinementDirections[6]),anchor.point)<1e-7);
 const blocked=boundedEllipseAdjustment(e,2,{x:1500,y:1300},anchor,options);assert.ok(options.isValid(blocked.geometry));assert.equal(blocked.receipt.constrained,true);assert.ok(distance(supportPoint(blocked.geometry,refinementDirections[6]),anchor.point)<1e-7);
});
test('fixed-angle preference never incurs more than one percent normalized objective penalty',()=>{
 const e={centerX:400,centerY:320,radiusX:150,radiusY:95,axisAngle:0},anchor=makeEllipsePin(e,6),result=boundedEllipseAdjustment(e,2,{x:5,y:0},anchor,options);assert.ok(result);assert.ok(Math.abs(result.geometry.axisAngle)<1e-9);assert.equal(result.receipt.angleChanged,false);
});
