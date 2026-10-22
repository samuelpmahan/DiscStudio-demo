/**
 * Browser-native translation of the frozen RimFit v3 recovery method.
 * It keeps the v3 stages: channel-balanced radial edge consensus, robust
 * ellipse refinement, Lab normal-contour assessment and fixed abstention gates.
 * All inputs are image pixels supplied by the caller; no case/manifest data is
 * consulted at runtime.
 */
import { TAU, clamp, percentile, median, mean, gaussianBlur, gradient, sample, solveLinearSystem } from './numeric.mjs';
import { boundedPowell } from './powell.mjs';

const SOURCE_SHA256 = '6356b02505f40873e9281f4cf9a892f59bb8da6f53688cd741281e65de7f8fcb';
// The worker client imports this resolved native module URL from a Blob module.
// Do not derive a worker URL relative to a Blob: the build intentionally keeps
// this module graph URL-free and self-contained for local demo loading.
export const RIMFIT_V3_MODULE_URL = import.meta.url;
const EPS = 1e-6;
const finite = value => Number.isFinite(value);
const roundEven = value => { const low=Math.floor(value),fraction=value-low; return fraction>.5?low+1:fraction<.5?low:(low%2===0?low:low+1); };
const sorted = values => [...values].sort((a, b) => a - b);
const trimmed = values => { const s=sorted(values); return s.slice(12,Math.max(12,s.length-12)); };
const angleDistance = (a,b) => { let d=((a-b+Math.PI/2)%Math.PI+Math.PI)%Math.PI-Math.PI/2;return Math.abs(d); };

function requireImage(image) {
  const {width,height,data}=image??{};
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||!data||data.length!==width*height*4) throw Error('RimFit v3 needs finite RGBA image pixels.');
  return {width,height,data};
}
function rgbChannels({width,height,data}) {
  const size=width*height, out=[new Float64Array(size),new Float64Array(size),new Float64Array(size)];
  for(let i=0;i<size;i++){out[0][i]=data[i*4];out[1][i]=data[i*4+1];out[2][i]=data[i*4+2];}
  return out;
}
function rgbToLab(channels) {
  const n=channels[0].length, lab=[new Float64Array(n),new Float64Array(n),new Float64Array(n)];
  for(let i=0;i<n;i++) {
    const linear=channels.map(c=>{const q=c[i]/255;return q<=.04045?q/12.92:((q+.055)/1.055)**2.4;});
    const x=.4124564*linear[0]+.3575761*linear[1]+.1804375*linear[2], y=.2126729*linear[0]+.7151522*linear[1]+.072175*linear[2], z=.0193339*linear[0]+.119192*linear[1]+.9503041*linear[2];
    const f=v=>v>.008856?Math.cbrt(v):7.787*v+16/116, fx=f(x/.95047),fy=f(y),fz=f(z/1.08883);
    lab[0][i]=116*fy-16;lab[1][i]=500*(fx-fy);lab[2][i]=200*(fy-fz);
  }
  return lab;
}
function featureMaps(image) {
  const {width,height}=image, rgb=rgbChannels(image), smooth=rgb.map(c=>gaussianBlur(c,width,height,1.05));
  const gx=smooth.map(c=>gradient(c,width,height,1)),gy=smooth.map(c=>gradient(c,width,height,0));
  const scales=gx.map((x,k)=>Math.max(3,percentile([...x,...gy[k]].map(Math.abs),90)));
  const edge=new Float64Array(width*height);
  for(let i=0;i<edge.length;i++)edge[i]=Math.hypot(gx[0][i]/scales[0],gx[1][i]/scales[1],gx[2][i]/scales[2],gy[0][i]/scales[0],gy[1][i]/scales[1],gy[2][i]/scales[2]);
  return {smooth,edge,scales};
}
function labFields(image) {
  const {width,height}=image, lab=rgbToLab(rgbChannels(image));
  return [0.75,1.35,2.15].map(sigma=>{
    const smoothed=lab.map(c=>gaussianBlur(c,width,height,sigma));
    const gx=smoothed.map(c=>gradient(c,width,height,1)),gy=smoothed.map(c=>gradient(c,width,height,0));
    const magnitudes=[];for(let i=0;i<width*height;i++)magnitudes.push(Math.hypot(gx[0][i],gx[1][i],gx[2][i],gy[0][i],gy[1][i],gy[2][i]));
    return {smoothed,gx,gy,scale:Math.max(percentile(magnitudes,90),1e-3)};
  });
}
function ellipsePoint(p,theta) {
  const [cx,cy,rx,ry,a]=p,ca=Math.cos(a),sa=Math.sin(a),c=Math.cos(theta),s=Math.sin(theta);
  const x=cx+ca*rx*c-sa*ry*s,y=cy+sa*rx*c+ca*ry*s;
  const nx=ca*c/Math.max(rx,EPS)-sa*s/Math.max(ry,EPS),ny=sa*c/Math.max(rx,EPS)+ca*s/Math.max(ry,EPS),norm=Math.hypot(nx,ny)||1;
  return {x,y,nx:nx/norm,ny:ny/norm};
}
function rayLimit(cx,cy,ux,uy,w,h) {
  const tx=ux>1e-8?(w-1-cx)/ux:ux<-1e-8?-cx/ux:Infinity,ty=uy>1e-8?(h-1-cy)/uy:uy<-1e-8?-cy/uy:Infinity;
  return Math.min(tx,ty);
}
function sampleRgb(channels,width,height,y,x) { return [sample(channels[0],width,height,y,x),sample(channels[1],width,height,y,x),sample(channels[2],width,height,y,x)]; }
function dist3(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);}
function centerAnchor(smooth,w,h,cx,cy) {
  const vals=[[],[],[]],ax=roundEven(clamp(cx,0,w-1)),ay=roundEven(clamp(cy,0,h-1));
  for(let y=Math.max(0,ay-2);y<=Math.min(h-1,ay+2);y++)for(let x=Math.max(0,ax-2);x<=Math.min(w-1,ax+2);x++)for(let k=0;k<3;k++)vals[k].push(smooth[k][y*w+x]);
  return vals.map(median);
}
function radialEdgePoints(features,width,height,center,minDim,anchor) {
  const thetaCount=128,nrad=clamp(roundEven(Math.max(width,height)*1.25),120,300),points=[],confidence=[];
  const [cx,cy]=center, anchored=anchor??centerAnchor(features.smooth,width,height,cx,cy);
  const colors=[];for(let i=0;i<width*height;i++)colors.push(Math.hypot(features.smooth[0][i]-anchored[0],features.smooth[1][i]-anchored[1],features.smooth[2][i]-anchored[2]));
  const imageColorScale=Math.max(18,percentile(colors,65));
  const rays=Array.from({length:thetaCount},(_,i)=>{const t=i*TAU/thetaCount,ux=Math.cos(t),uy=Math.sin(t);return {ux,uy,limit:rayLimit(cx,cy,ux,uy,width,height)};}),commonHi=1.04*Math.max(...rays.map(ray=>ray.limit));
  for(let i=0;i<thetaCount;i++) {
    const {ux,uy,limit}=rays[i];if(limit<=.34*minDim)continue;
    const hi=commonHi,lo=.05*minDim, vals=[], grid=[];
    for(let j=0;j<nrad;j++){const r=lo+(hi-lo)*j/(nrad-1);if(r<limit-1){grid.push(r);vals.push(sample(features.edge,width,height,cy+r*uy,cx+r*ux));}}
    if(vals.length<24)continue;
    const smoothed=gaussian1d(vals,1), scores=[];
    for(let j=0;j<grid.length;j++){
      const r=grid[j],d=2.3,inside=sampleRgb(features.smooth,width,height,cy+(r-d)*uy,cx+(r-d)*ux),outside=sampleRgb(features.smooth,width,height,cy+(r+d)*uy,cx+(r+d)*ux);
      const jump=dist3(inside,outside)/(Math.sqrt(3)*255),consistency=Math.exp(-.5*(dist3(inside,anchored)/imageColorScale)**2);
      scores.push(.56*smoothed[j]+.32*clamp(jump*4,0,3)+.12*consistency);
    }
    const eligible=scores.map((_,j)=>grid[j]>=.34*minDim), es=scores.filter((_,j)=>eligible[j]);if(!es.length)continue;
    const q=percentile(es,68), max=Math.max(...es), local=[];
    for(let j=0;j<scores.length;j++)if(eligible[j]&&[0,1,2,3,4,5,6].every(offset=>{const k=j+offset-3;return k<0||k>=scores.length||!eligible[k]||scores[j]>=scores[k]-1e-10;}))local.push(j);
    const candidates=local.filter(j=>scores[j]>=Math.max(q,.18*max)), choices=candidates.length?candidates:local;if(!choices.length)continue;
    let pick=choices[0],best=-Infinity;for(const j of choices){const rank=scores[j]+.06*clamp(grid[j]/Math.max(limit,EPS),0,1);if(rank>best){best=rank;pick=j;}}
    points.push([cx+grid[pick]*ux,cy+grid[pick]*uy]);confidence.push(scores[pick]);
  }
  return {points,confidence,anchor:anchored};
}
function gaussian1d(values,sigma) { const radius=4,out=[];for(let i=0;i<values.length;i++){let n=0,d=0;for(let k=-radius;k<=radius;k++){const weight=Math.exp(-k*k/(2*sigma*sigma)),v=values[clamp(i+k,0,values.length-1)];n+=v*weight;d+=weight;}out.push(n/d);}return out; }
function ellipseResidual(point,p) {const [cx,cy,rx,ry,a]=p,ca=Math.cos(a),sa=Math.sin(a),dx=point[0]-cx,dy=point[1]-cy,u=ca*dx+sa*dy,v=-sa*dx+ca*dy;return Math.hypot(u/Math.max(rx,1e-4),v/Math.max(ry,1e-4))-1;}
function boundsFor(w,h) {return [[-.42*w,1.42*w],[-.42*h,1.42*h],[.24*Math.min(w,h),1.1*w],[.24*Math.min(w,h),1.1*h],[-Math.PI/2,Math.PI/2]];}
function bound(p,bounds){return p.map((v,i)=>clamp(v,bounds[i][0]+1e-3,bounds[i][1]-1e-3));}
/** IRLS Levenberg-Marquardt approximation of scipy least_squares(loss=soft_l1). */
function fitEllipse(points,weights,width,height,seed) {
  if(points.length<16)return {p:[...seed],rms:Infinity,evaluations:0};const bounds=boundsFor(width,height),medianWeight=Math.max(median(weights),1e-5);let p=bound([...seed],bounds),evaluations=0,lambda=1e-3;
  const costFor=q=>points.reduce((sum,point,i)=>{const raw=ellipseResidual(point,q)*Math.sqrt(clamp(weights[i]/medianWeight,.25,4));return sum+2*(Math.sqrt(1+(raw/.025)**2)-1);},0);
  let cost=costFor(p);
  for(let it=0;it<180;it++){
    const a=Array.from({length:5},()=>Array(5).fill(0)),b=Array(5).fill(0);
    for(let i=0;i<points.length;i++){
      const raw=ellipseResidual(points[i],p),base=Math.sqrt(clamp(weights[i]/medianWeight,.25,4));
      // scipy least_squares(loss='soft_l1') applies sqrt(rho'(z)) to the
      // residual already weighted by confidence. rho'(z)=1/sqrt(1+z), so
      // this is a fourth-root attenuation, not a second-root attenuation.
      const lossWeight=base/(1+((raw*base/.025)**2))**.25;
      // Analytic Jacobian of the radial ellipse residual. SciPy's default
      // finite difference is close to this local derivative; the previous
      // coarse 0.12px probing could push the robust seed onto a different
      // contour before the bounded exact refinement began.
      const [cx,cy,rx,ry,angle]=p,ca=Math.cos(angle),sa=Math.sin(angle),dx=points[i][0]-cx,dy=points[i][1]-cy;
      const u=ca*dx+sa*dy,v=-sa*dx+ca*dy,rx2=rx*rx,ry2=ry*ry,radial=Math.max(raw+1,EPS);
      const jac=[
        (u*(-ca/rx2)+v*(sa/ry2))/radial,
        (u*(-sa/rx2)-v*(ca/ry2))/radial,
        -u*u/(rx2*rx*radial),
        -v*v/(ry2*ry*radial),
        u*v*(1/rx2-1/ry2)/radial,
      ].map(value=>value*lossWeight);
      const r=raw*lossWeight;for(let row=0;row<5;row++){b[row]-=jac[row]*r;for(let col=0;col<5;col++)a[row][col]+=jac[row]*jac[col];}
    }
    for(let k=0;k<5;k++)a[k][k]+=lambda;const delta=solveLinearSystem(a,b);if(!delta)break;const next=bound(p.map((v,k)=>v+delta[k]),bounds),nextCost=costFor(next);evaluations+=1;
    if(nextCost<cost){p=next;if(Math.max(...delta.map(Math.abs))<1e-4)break;cost=nextCost;lambda=Math.max(1e-6,lambda*.45);}else lambda=Math.min(1e5,lambda*4);
  }
  const residuals=points.map(point=>ellipseResidual(point,p));return {p,rms:Math.sqrt(mean(residuals.map(x=>x*x))),evaluations};
}
function exactMetrics(fields,width,height,p,{thetaCount=112,details=true}={}) {
  const exact=[],nearby=[],displacements=[],contrast=[],finite=[];
  for(let i=0;i<thetaCount;i++){
    const q=ellipsePoint(p,i*TAU/thetaCount);finite[i]=q.x>=-1&&q.x<=width&&q.y>=-1&&q.y<=height;let bestExact=0,bestNear=-Infinity,bestDisp=0,bestContrast=0;
    for(const field of fields){
      const exactChannels=[],totalChannels=[];
      for(let k=0;k<3;k++){const gx=sample(field.gx[k],width,height,q.y,q.x),gy=sample(field.gy[k],width,height,q.y,q.x);exactChannels.push(gx*q.nx+gy*q.ny);totalChannels.push(gx,gy);}
      const projection=Math.hypot(...exactChannels),total=Math.hypot(...totalChannels),score=projection/field.scale*(projection/(total+EPS));bestExact=Math.max(bestExact,score);
      let fieldNear=-Infinity,fieldDisp=0;
      for(let d=-3;d<=3;d++){const channels=[],sum=[];for(let k=0;k<3;k++){const gx=sample(field.gx[k],width,height,q.y+d*q.ny,q.x+d*q.nx),gy=sample(field.gy[k],width,height,q.y+d*q.ny,q.x+d*q.nx);channels.push(gx*q.nx+gy*q.ny);sum.push(gx,gy);}const pr=Math.hypot(...channels),tot=Math.hypot(...sum),candidate=pr/(field.scale+EPS)*(pr/(tot+EPS));if(candidate>fieldNear){fieldNear=candidate;fieldDisp=d;}}
      if(fieldNear>bestNear){bestNear=fieldNear;bestDisp=fieldDisp;}
      const inside=[],outside=[];for(let k=0;k<3;k++){inside.push(sample(field.smoothed[k],width,height,q.y-1.5*q.ny,q.x-1.5*q.nx));outside.push(sample(field.smoothed[k],width,height,q.y+1.5*q.ny,q.x+1.5*q.nx));}bestContrast=Math.max(bestContrast,dist3(inside,outside)/(field.scale*3+EPS));
    }
    exact[i]=bestExact;nearby[i]=bestNear;displacements[i]=bestDisp;contrast[i]=bestContrast;
  }
  const precise=exact.map((v,i)=>v*Math.exp(-((Math.abs(displacements[i])/.8)**2))),silhouette=precise.map((v,i)=>Math.min(v,contrast[i]));
  const inner=trimmed(silhouette),support=precise.map((v,i)=>finite[i]&&v>=.18&&contrast[i]>=.18&&Math.abs(displacements[i])<=1);
  const octants=Array.from({length:8},(_,o)=>mean(support.slice(o*Math.floor(thetaCount/8),(o+1)*Math.floor(thetaCount/8)).map(Number)));
  const f=finite.map(Boolean),at=xs=>xs.filter((_,i)=>f[i]);
  return {thetaSamples:thetaCount,supportFraction:mean(support.map(Number)),supportedOctants:octants.filter(v=>v>=.25).length,octantSupportFractions:octants,
    medianExactScore:median(at(exact)),medianNearbyScore:median(at(nearby)),medianSilhouetteScore:median(at(silhouette)),medianDisplacementPx:median(at(displacements).map(Math.abs)),p90DisplacementPx:percentile(at(displacements).map(Math.abs),90),exactContourFraction:mean(exact.map((v,i)=>f[i]&&v>=.18?1:0)),contrastContourFraction:mean(contrast.map((v,i)=>f[i]&&v>=.18?1:0)),finiteContourFraction:mean(f.map(Number)),sectorExactScores:details?exact:undefined,sectorDisplacementsPx:details?displacements:undefined,sectorSupport:details?support:undefined,
    _objective:median(inner)+.45*percentile(inner,30)};
}
function refineExact(fields,width,height,radial,edge,exactPrior) {
  const bounds=[[.24*width,.76*width],[.18*height,.8*height],[.30*width,.62*width],[.24*height,.62*height],[-Math.PI/2,Math.PI/2]],norm=[.28*width,.28*height,.24*width,.24*height,.8];
  const seeds=[radial,edge,exactPrior,[exactPrior[0],exactPrior[1],.4*width,.38*height,0]];for(const scale of [.68,.78,.88,1])seeds.push([radial[0],radial[1],radial[2]*scale,radial[3]*scale,radial[4]]);
  let best=null,runs=[];
  for(const initial of seeds.slice(0,8)){
    const p=initial.map((value,i)=>clamp(value,bounds[i][0]+1e-3,bounds[i][1]-1e-3));
    const objective=q=>{const score=exactMetrics(fields,width,height,q,{thetaCount:96,details:false})._objective,tie=.009*q.reduce((s,v,i)=>s+((v-exactPrior[i])/norm[i])**2,0);return -score+tie;};
    // Direct translation of scipy.optimize.minimize(... method='Powell',
    // bounds=bounds, options={maxiter:48, xtol:2e-3, ftol:2e-3}).
    const opt=boundedPowell(objective,p,bounds,{maxiter:48,xtol:2e-3,ftol:2e-3});
    const run={objective:objective(opt.x),parameters:opt.x,evaluations:opt.nfev,success:opt.success};runs.push(run);if(!best||run.objective<best.objective)best=run;
  }
  return {best,runs};
}
function acceptance(quality,p,width,height) {
  const ratio=Math.min(p[2],p[3])/Math.max(Math.min(width,height),EPS),area=Math.PI*Math.max(0,p[2])*Math.max(0,p[3])/(width*height);
  Object.assign(quality,{radiiToShortSide:ratio,ellipseAreaFraction:area});
  const checks=[['contour_clipped_or_outside_crop',quality.finiteContourFraction>=.66],['low_exact_outer_rim_support',quality.supportFraction>=.36],['low_octant_coverage',quality.supportedOctants>=4],['low_exact_silhouette_score',quality.medianSilhouetteScore>=.075],['nearby_edge_displacement_gt_1px',quality.medianDisplacementPx<=1],['low_exact_contour_fraction',quality.exactContourFraction>=.36],['implausible_radius',ratio>=.22&&ratio<=.95],['small_or_spurious_ellipse',area>=.22]];
  quality.accepted=checks.every(([,ok])=>ok);quality.abstainReasons=checks.filter(([,ok])=>!ok).map(([reason])=>reason);return quality.accepted;
}
/**
 * Recover a RimFit v3 ellipse from browser RGBA samples.
 * `maxRefinementDimension` optionally limits the expensive exact multistart
 * while preserving returned coordinates in the caller's image space.
 */
export function recoverRimEllipseV3(image,options={}) {
  const started=globalThis.performance?.now?.()??Date.now();const native=requireImage(image),cap=Math.max(32,Number(options.maxRefinementDimension??Infinity));
  let working=native,scaleX=1,scaleY=1;
  if(Math.max(native.width,native.height)>cap){const requested=cap/Math.max(native.width,native.height),width=Math.max(8,roundEven(native.width*requested)),height=Math.max(8,roundEven(native.height*requested)),data=new Uint8ClampedArray(width*height*4);scaleX=(width-1)/Math.max(1,native.width-1);scaleY=(height-1)/Math.max(1,native.height-1);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sx=Math.min(native.width-1,roundEven(x*Math.max(1,native.width-1)/Math.max(1,width-1))),sy=Math.min(native.height-1,roundEven(y*Math.max(1,native.height-1)/Math.max(1,height-1))),si=(sy*native.width+sx)*4,di=(y*width+x)*4;data[di]=native.data[si];data[di+1]=native.data[si+1];data[di+2]=native.data[si+2];data[di+3]=native.data[si+3];}working={width,height,data};}
  const {width,height}=working,minDim=Math.min(width,height),features=featureMaps(working),fields=labFields(working),seed=[.5*width,.48*height,.43*width,.4*height,0],theta=[];for(let i=0;i<128;i++)theta.push(i*TAU/128);
  let p=[...seed],allPoints=[],allConf=[],anchor=centerAnchor(features.smooth,width,height,p[0],p[1]),fitRms=Infinity,nfev=0,iterations=[];
  for(let iteration=0;iteration<3;iteration++){const radial=radialEdgePoints(features,width,height,[p[0],p[1]],minDim,anchor);if(radial.points.length<20)break;const cut=percentile(radial.confidence,10),points=radial.points.filter((_,i)=>radial.confidence[i]>=cut),conf=radial.confidence.filter(v=>v>=cut),fit=fitEllipse(points,conf,width,height,p);p=fit.p;fitRms=fit.rms;nfev+=fit.evaluations;allPoints=points;allConf=conf;iterations.push({iteration:iteration+1,rayPoints:points.length,fitRms});}
  let edgeP=[...seed];for(let pass=0;pass<2;pass++){const edgeRadial=radialEdgePoints(features,width,height,[edgeP[0],edgeP[1]],minDim,null);if(edgeRadial.points.length<20)break;const cut=percentile(edgeRadial.confidence,10),points=edgeRadial.points.filter((_,i)=>edgeRadial.confidence[i]>=cut),confidence=edgeRadial.confidence.filter(value=>value>=cut);edgeP=fitEllipse(points,confidence,width,height,edgeP).p;}
  const exactPrior=[.5*width,.5*height,.45*width,.43*height,0],exact=refineExact(fields,width,height,p,edgeP,exactPrior),best=exact.best??{parameters:p,evaluations:0,success:false,objective:Infinity};p=best.parameters;
  const quality=exactMetrics(fields,width,height,p,{thetaCount:112,details:true});quality.radialPointCount=allPoints.length;quality.fitRms=fitRms;quality.fitIterations=iterations;quality.channelGradientScales=features.scales;quality.radialSeedFitRms=fitRms;quality.exactOptimizerRuns=exact.runs.map(run=>({objective:Math.round(run.objective*1e6)/1e6,evaluations:run.evaluations,success:run.success}));quality.exactOptimizerBestEvaluations=best.evaluations;
  const accepted=acceptance(quality,p,width,height),converted=[p[0]/scaleX,p[1]/scaleY,p[2]/scaleX,p[3]/scaleY,p[4]],ellipse={localCrop:{centerPx:[converted[0],converted[1]],radiiPx:[converted[2],converted[3]],rotationRadians:converted[4],rotationDegrees:converted[4]*180/Math.PI}};
  const parameters={smoothSigmaPx:1.05,exactLabScalesPx:[.75,1.35,2.15],exactContour:'per-channel absolute normal projection at rendered ellipse point',nearbySearch:'offsets -3..+3px only for explicit displacement report',displacementPenalty:'exp(-(abs(offset)/0.8)^2) applied to exact score',bilateralSilhouetteContrast:'Lab vector difference at +/-1.5px along fitted normal',radialThetaSamples:128,radialScanSamples:clamp(roundEven(Math.max(width,height)*1.25),120,300),radialStart:'0.34 * short_side for candidate edge peaks',edgeFeature:'channel-balanced RGB gradient magnitude',jumpFeature:'two-sided smoothed RGB vector difference at +/-2.3px',fit:'browser IRLS Levenberg-Marquardt soft_l1 radial ellipse residual',refinement:'bounded SciPy-compatible Powell exact-contour multistart',acceptance:'fixed v3 exact support >=0.36, >=4/8 supported octants, median silhouette >=0.075, median displacement <=1px, exact fraction >=0.36'};
  delete quality._objective;
  return {schema:'RimEllipseRecovery@3-browser',status:accepted?'accepted':'abstained',error:accepted?null:'no coherent outer silhouette under fixed v3 thresholds',input:{cropWidth:native.width,cropHeight:native.height,workingWidth:width,workingHeight:height,workingScaleX:scaleX,workingScaleY:scaleY},algorithm:{method:'radial outer-edge consensus + robust ellipse fit',parameters,quality},ellipse:accepted?ellipse:null,diagnosticFit:ellipse,sourceAlgorithmSchema:'RimEllipseRecovery@3-browser',sourceAlgorithmSha256:SOURCE_SHA256,timing:{totalMs:(globalThis.performance?.now?.()??Date.now())-started}};
}
