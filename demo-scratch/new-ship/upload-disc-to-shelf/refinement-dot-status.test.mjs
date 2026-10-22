import test from 'node:test';
import assert from 'node:assert/strict';
import { anchoredDrag, supportPoint, refinementDirections } from './refinement-drag.mjs';
import { classifyDotMovement, dotMovementDescription } from './refinement-dot-status.mjs';
const before=Object.freeze({centerX:400,centerY:320,radiusX:220,radiusY:120,axisAngle:.37});
test('all eight actual source points classified; selected direct and actual opposite stationary',()=>{
 for(let index=0;index<8;index++){const after=anchoredDrag(before,index,{x:3,y:-2}),statuses=classifyDotMovement(before,after,index);assert.equal(statuses.length,8);assert.equal(statuses[index].kind,'direct');assert.equal(statuses[(index+4)%8].kind,'stationary');for(const status of statuses){assert.deepEqual(status.before,supportPoint(before,refinementDirections[status.index]));assert.deepEqual(status.after,supportPoint(after,refinementDirections[status.index]));if(status.index!==index&&status.distance>status.threshold)assert.equal(status.kind,'indirect');}}
});
test('TL and BR are measured from actual support displacement rather than assumed fixed or selected',()=>{
 const after=anchoredDrag(before,6,{x:-10,y:0}),statuses=classifyDotMovement(before,after,6);
 for(const index of [7,3]){assert.equal(statuses[index].kind,'indirect');const direction=refinementDirections[index],previous=supportPoint(before,direction),current=supportPoint(after,direction);const radial=(current.x-previous.x)*direction.x+(current.y-previous.y)*direction.y;assert.equal(statuses[index].direction,radial>0?'outward':'inward');assert.ok(statuses[index].distance>0);}
});
test('stationary threshold and selected blocked/no-op movement do not claim direct motion',()=>{
 const statuses=classifyDotMovement(before,{...before,centerX:before.centerX+1e-8},3);assert.ok(statuses.every(status=>status.kind==='stationary'));assert.ok(classifyDotMovement(before,before,3).every(status=>status.direction==='stationary'));
});
test('radial sign uses starting outward direction; purely tangent is sideways and mixed is labeled',()=>{
 const shifted={...before,centerX:before.centerX+3,centerY:before.centerY-2},statuses=classifyDotMovement(before,shifted,0);
 assert.equal(statuses[0].direction,'outward');assert.equal(statuses[0].mixed,true);assert.match(dotMovementDescription(statuses[0]),/outward and sideways manually/);
 const tangent=classifyDotMovement(before,{...before,centerX:before.centerX+3},0);assert.equal(tangent[0].direction,'sideways');assert.match(dotMovementDescription(tangent[0]),/sideways manually/);assert.equal(tangent[2].direction,'outward');assert.equal(tangent[6].direction,'inward');
});
test('classification is immutable, latest-adjustment only, and does not mutate geometry',()=>{
 const first=anchoredDrag(before,2,{x:5,y:0}),second=anchoredDrag(first,0,{x:0,y:-2}),serialized=JSON.stringify([before,first,second]);const statuses=classifyDotMovement(first,second,0);assert.ok(Object.isFrozen(statuses));assert.ok(Object.isFrozen(statuses[0].before));assert.deepEqual(statuses[2].before,supportPoint(first,refinementDirections[2]));assert.equal(JSON.stringify([before,first,second]),serialized);
});
