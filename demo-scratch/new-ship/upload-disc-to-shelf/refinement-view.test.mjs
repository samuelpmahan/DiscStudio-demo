import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { ellipseExtrema, projectRefinement, createRefinementRenderer } from './refinement-view.mjs';
const ellipse = Object.freeze({ centerX: 410, centerY: 300, radiusX: 210, radiusY: 103, axisAngle: .61 });
test('oblique nonsquare extrema lie on boundary with zero cardinal derivative', () => {
 const ext=ellipseExtrema(ellipse), c=Math.cos(ellipse.axisAngle), s=Math.sin(ellipse.axisAngle);
 for(const p of ext.points){const x=p.x-ellipse.centerX,y=p.y-ellipse.centerY,u=x*c+y*s,v=-x*s+y*c;
 assert.ok(Math.abs((u/ellipse.radiusX)**2+(v/ellipse.radiusY)**2-1)<1e-12);
 const gx=u*c/ellipse.radiusX**2-v*s/ellipse.radiusY**2,gy=u*s/ellipse.radiusX**2+v*c/ellipse.radiusY**2;
 assert.ok(Math.abs(['top','bottom'].includes(p.name)?gx:gy)<1e-12);}
 assert.ok(ext.points[1].y>ellipse.centerY);assert.ok(ext.points[2].x>ellipse.centerX);
});
test('circle extrema stay cardinal independent of axis angle',()=>{
 const ext=ellipseExtrema({centerX:100,centerY:100,radiusX:40,radiusY:40,axisAngle:1.2});
 assert.deepEqual(ext.points,[{name:'top',x:100,y:60},{name:'right',x:140,y:100},{name:'bottom',x:100,y:140},{name:'left',x:60,y:100}]);
});
test('explicit seek repeats pixels and reuses layers without source mutations',()=>{
 const image=createCanvas(820,600),ctx=image.getContext('2d');ctx.fillStyle='#ddd';ctx.fillRect(0,0,820,600);ctx.fillStyle='#176';ctx.fillRect(200,200,200,100);
 const snapshot=Object.freeze({source:Object.freeze({identity:'fixture-original',image,width:820,height:600}),ellipse,viewport:Object.freeze({width:390,height:390,dpr:2}),view:Object.freeze({padding:16,zoom:1,projection:'uniform'})});
 const saved=JSON.stringify(ellipse),canvas=createCanvas(780,780),r=createRefinementRenderer({createCanvas}),pixels=()=>Buffer.from(canvas.getContext('2d').getImageData(0,0,780,780).data);
 r.seek(canvas.getContext('2d'),snapshot,0);const first=pixels();
 for(const t of [9,1,0]){const result=r.seek(canvas.getContext('2d'),snapshot,t);assert.equal(result.receipt.rasterized.length,0);assert.equal(result.receipt.reused.length,2);assert.deepEqual(pixels(),first);}
 assert.equal(JSON.stringify(ellipse),saved);for(const p of projectRefinement(snapshot).points){assert.ok(p.x>=15.99&&p.x<=374.01);assert.ok(p.y>=15.99&&p.y<=374.01);}
});
test('viewport and DPR only change projection; explicit timed snapshots remain deterministic',()=>{
 const source=Object.freeze({identity:'timed-source',image:createCanvas(820,600),width:820,height:600});
 const first=Object.freeze({width:390,height:390,dpr:1}),second=Object.freeze({width:550,height:430,dpr:2});
 const base=Object.freeze({source,ellipse,viewport:first,view:Object.freeze({padding:16,projection:'uniform'})});
 assert.deepEqual(projectRefinement(base).points,projectRefinement({...base,viewport:{...first,dpr:2}}).points);
 assert.notDeepEqual(projectRefinement(base).points,projectRefinement({...base,viewport:second}).points);
 const snapshot=Object.freeze({...base,states:Object.freeze([Object.freeze({t:0}),Object.freeze({t:2,viewport:second})])});
 const r=createRefinementRenderer({createCanvas}),canvas=createCanvas(1100,860),ctx=canvas.getContext('2d');
 const later=r.seek(ctx,snapshot,2).projection;r.seek(ctx,snapshot,0);assert.deepEqual(r.seek(ctx,snapshot,2).projection,later);
 assert.equal(snapshot.ellipse,ellipse);assert.equal(snapshot.source,source);assert.equal(snapshot.viewport,first);
});
