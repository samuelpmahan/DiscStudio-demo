import { refinementDirections, supportPoint } from './refinement-drag.mjs';
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const frob=(a,b)=>a.xx*b.xx+2*a.xy*b.xy+a.yy*b.yy;
const addQ=(a,b,scale=1)=>({xx:a.xx+scale*b.xx,xy:a.xy+scale*b.xy,yy:a.yy+scale*b.yy});
const roots=coeff=>{
  const c=[...coeff];while(c.length>1&&Math.abs(c.at(-1))<1e-12)c.pop();
  if(c.length===1)return [];
  if(c.length===2)return [-c[0]/c[1]];
  if(c.length===3){const [d,b,a]=c,dis=b*b-4*a*d;if(dis<-1e-12)return [];const s=Math.sqrt(Math.max(0,dis)),q=-.5*(b+(b>=0?1:-1)*s);return Math.abs(q)<1e-14?[-b/(2*a)]:[q/a,d/q];}
  const b=c[2]/c[3],cc=c[1]/c[3],d=c[0]/c[3],p=cc-b*b/3,q=2*b*b*b/27-b*cc/3+d,dis=q*q/4+p*p*p/27;
  if(dis>1e-14||p>=0){const s=Math.sqrt(Math.max(0,dis));return [Math.cbrt(-q/2+s)+Math.cbrt(-q/2-s)-b/3];}
  const r=2*Math.sqrt(-p/3),angle=Math.acos(Math.max(-1,Math.min(1,(-q/2)/Math.sqrt(-p*p*p/27))));return [0,1,2].map(k=>r*Math.cos((angle+2*Math.PI*k)/3)-b/3);
};
export function ellipseCovariance(ellipse){const c=Math.cos(ellipse.axisAngle),s=Math.sin(ellipse.axisAngle),a=ellipse.radiusX**2,b=ellipse.radiusY**2;return {xx:a*c*c+b*s*s,xy:(a-b)*s*c,yy:a*s*s+b*c*c};}
function fromQ(center,Q,origin,scale,priorAngle){
  const diff=Math.hypot(Q.xx-Q.yy,2*Q.xy),large=(Q.xx+Q.yy+diff)/2,small=(Q.xx+Q.yy-diff)/2;
  if(!Number.isFinite(large)||small<=0)return null;
  const angle=diff<1e-12?priorAngle:.5*Math.atan2(2*Q.xy,Q.xx-Q.yy);
  return {centerX:origin.x+center.x*scale,centerY:origin.y+center.y*scale,radiusX:Math.sqrt(large)*scale,radiusY:Math.sqrt(small)*scale,axisAngle:angle};
}
/** One previous source support contact, not a collection of accumulated pins. */
export function makeEllipsePin(ellipse,index,continuationAnchor=null){return Object.freeze({index,point:Object.freeze(supportPoint(ellipse,refinementDirections[index])),normal:refinementDirections[index],continuationAnchor:continuationAnchor?Object.freeze({index:continuationAnchor.index,point:continuationAnchor.point,normal:continuationAnchor.normal}):null});}
export function anchorForEllipseDrag(ellipse,index,pin){
  if(pin&&pin.index!==index)return pin;
  if(pin?.continuationAnchor)return pin.continuationAnchor;
  return makeEllipsePin(ellipse,(index+4)%8);
}
/** Exact SPD ellipse through two support contacts. No fit/image/persistence calls.
 * Center and Q are normalized by RMS radius. Choose minimum center²+.25||ΔQ||²,
 * giving the symmetric off-diagonal term its Frobenius weight of two.
 */
export function solvePinnedEllipse(ellipse,index,target,anchor,{width,height,isValid=()=>true}){
  const origin={x:ellipse.centerX,y:ellipse.centerY},scale=Math.hypot(ellipse.radiusX,ellipse.radiusY)/Math.SQRT2;
  const normal=refinementDirections[index],u=anchor.normal,v=normal;
  if(!v||!u||!Number.isFinite(scale)||scale<=0)return null;
  const normalize=p=>({x:(p.x-origin.x)/scale,y:(p.y-origin.y)/scale}),p=normalize(anchor.point),q=normalize(target),d=sub(q,p);
  const physicalQ=ellipseCovariance(ellipse),prior={xx:physicalQ.xx/scale**2,xy:physicalQ.xy/scale**2,yy:physicalQ.yy/scale**2};
  const cost=(center,Q)=>dot(center,center)+.25*frob(addQ(Q,prior,-1),addQ(Q,prior,-1));
  const candidates=[],fixed=[];
  const consider=(center,Q,angleFixed=false)=>{
    if(![Q.xx,Q.xy,Q.yy,center.x,center.y].every(Number.isFinite)||Q.xx<=0||Q.xx*Q.yy-Q.xy*Q.xy<=1e-12)return;
    const geometry=fromQ(center,Q,origin,scale,ellipse.axisAngle);if(!geometry||!isValid(geometry))return;
    const pinResidual=Math.hypot(...Object.values(sub(supportPoint(geometry,u),anchor.point))),targetResidual=Math.hypot(...Object.values(sub(supportPoint(geometry,v),target)));
    if(pinResidual>1e-7||targetResidual>1e-7)return;
    const receipt={parameterCost:cost(center,Q),pinResidual,targetResidual,condition:(geometry.radiusX/geometry.radiusY)**2,angleChanged:Math.abs(Math.sin(geometry.axisAngle-ellipse.axisAngle))>1e-9,anchor:anchor.point,target,normal:v};
    (angleFixed?fixed:candidates).push({geometry,receipt});
  };
  const ac=Math.cos(ellipse.axisAngle),as=Math.sin(ellipse.axisAngle),offdiag=Q=>ac*as*(Q.yy-Q.xx)+(ac*ac-as*as)*Q.xy;
  const determinant=u.x*v.y-u.y*v.x;
  if(Math.abs(determinant)<1e-9){
    if(dot(u,v)>0)return null;
    const center={x:(p.x+q.x)/2,y:(p.y+q.y)/2},half={x:d.x/2,y:d.y/2},h=dot(v,half),m={x:-v.y,y:v.x},g=dot(m,half);
    if(h<=0)return null;
    const base={xx:h*h*v.x*v.x+2*h*g*v.x*m.x,xy:h*h*v.x*v.y+h*g*(v.x*m.y+m.x*v.y),yy:h*h*v.y*v.y+2*h*g*v.y*m.y};
    const transverse={xx:m.x*m.x,xy:m.x*m.y,yy:m.y*m.y},priorK=prior.xx*m.x*m.x+2*prior.xy*m.x*m.y+prior.yy*m.y*m.y;
    consider(center,addQ(base,transverse,Math.max(priorK,g*g+1e-10)));
    if(!candidates.length){const maximum=(Math.max(width,height)/(2*scale))**2;for(let i=1;i<256;i++)consider(center,addQ(base,transverse,g*g+(maximum-g*g)*i/256));}
    const coefficient=offdiag(transverse),constant=offdiag(base);
    if(Math.abs(coefficient)>1e-12)consider(center,addQ(base,transverse,-constant/coefficient),true);
    else if(Math.abs(constant)<1e-10)consider(center,addQ(base,transverse,Math.max(priorK,g*g+1e-10)),true);
  }else{
    const a=dot(u,d),b=dot(v,d),K={x:b*u.x+a*v.x,y:b*u.y+a*v.y},squared=dot(K,K);if(squared<1e-20)return null;
    const norm=Math.sqrt(squared),c0={x:K.x*(dot(K,p)+a*b)/squared,y:K.y*(dot(K,p)+a*b)/squared},t={x:-K.y/norm,y:K.x/norm};
    const at=s=>{
      const center={x:c0.x+s*t.x,y:c0.y+s*t.y},x=sub(p,center),y=sub(q,center),hu=dot(u,x),hv=dot(v,y);
      const xx=(hu*x.x*v.y-hv*y.x*u.y)/determinant,xy=(-hu*x.x*v.x+hv*y.x*u.x)/determinant,yx=(hu*x.y*v.y-hv*y.y*u.y)/determinant,yy=(-hu*x.y*v.x+hv*y.y*u.x)/determinant;
      return {center,Q:{xx,xy:(xy+yx)/2,yy}};
    };
    const Q0=at(0).Q,Qplus=at(1).Q,Qminus=at(-1).Q,Q1={xx:(Qplus.xx-Qminus.xx)/2,xy:(Qplus.xy-Qminus.xy)/2,yy:(Qplus.yy-Qminus.yy)/2},Q2={xx:t.x*t.x,xy:t.x*t.y,yy:t.y*t.y},E=addQ(Q0,prior,-1);
    const stationary=roots([2*dot(c0,t)+.5*frob(E,Q1),2*(1+.25*(frob(Q1,Q1)+2*frob(E,Q2))),1.5*frob(Q1,Q2),frob(Q2,Q2)]);
    let low=-Infinity,high=Infinity,feasible=true;
    const restrict=(constant,slope,minimum=1e-10)=>{if(Math.abs(slope)<1e-12){if(constant<=minimum)feasible=false;}else{const edge=(minimum-constant)/slope;if(slope>0)low=Math.max(low,edge);else high=Math.min(high,edge);}};
    restrict(dot(u,sub(p,c0)),-dot(u,t));restrict(dot(v,sub(q,c0)),-dot(v,t));
    restrict(((p.x-c0.x)*d.y-(p.y-c0.y)*d.x)/determinant,(-t.x*d.y+t.y*d.x)/determinant);
    // A finite source-center box bounds the valid line search before existing
    // full rotated-ellipse bounds are independently checked by isValid.
    restrict(c0.x+origin.x/scale,t.x,0);restrict((width-origin.x)/scale-c0.x,-t.x,0);
    restrict(c0.y+origin.y/scale,t.y,0);restrict((height-origin.y)/scale-c0.y,-t.y,0);
    if(!feasible||low>=high||!Number.isFinite(low)||!Number.isFinite(high))return null;
    const evaluate=(s,angleFixed=false)=>{if(s>low&&s<high){const value=at(s);consider(value.center,value.Q,angleFixed);}};
    stationary.forEach(s=>evaluate(s));
    const angleCoefficients=[offdiag(Q0),offdiag(Q1),offdiag(Q2)];
    if(angleCoefficients.every(value=>Math.abs(value)<1e-10))stationary.forEach(s=>evaluate(s,true));
    else roots(angleCoefficients).forEach(s=>evaluate(s,true));
    // Existing source/radius guards can reject an unconstrained minimum. Search
    // the remaining feasible line before declaring a requested motion limited.
    if(!candidates.length)for(let i=1;i<256;i++)evaluate(low+(high-low)*i/256);
  }
  candidates.sort((a,b)=>a.receipt.parameterCost-b.receipt.parameterCost);fixed.sort((a,b)=>a.receipt.parameterCost-b.receipt.parameterCost);
  const best=candidates[0];if(!best)return fixed[0]??null;
  return fixed[0]&&fixed[0].receipt.parameterCost<=best.receipt.parameterCost*1.01+1e-12?fixed[0]:best;
}
export function boundedEllipseAdjustment(ellipse,index,delta,anchor,options){
  const point=supportPoint(ellipse,refinementDirections[index]);
  if(Math.hypot(delta.x,delta.y)<1e-12)return {geometry:{...ellipse},receipt:{pinResidual:0,targetResidual:0,parameterCost:0,condition:(ellipse.radiusX/ellipse.radiusY)**2,angleChanged:false,constrained:false,anchor:anchor.point,target:point}};
  const run=fraction=>solvePinnedEllipse(ellipse,index,{x:point.x+delta.x*fraction,y:point.y+delta.y*fraction},anchor,options);
  const raw=run(1);if(raw)return {...raw,receipt:{...raw.receipt,constrained:false,fraction:1}};
  let low=0,high=1,best=null;
  for(let i=0;i<40;i++){const mid=(low+high)/2,next=run(mid);if(next){low=mid;best=next;}else high=mid;}
  return best?{...best,receipt:{...best.receipt,constrained:true,fraction:low}}:{geometry:{...ellipse},receipt:{pinResidual:0,targetResidual:0,parameterCost:0,angleChanged:false,constrained:true,fraction:0,anchor:anchor.point,target:point}};
}
