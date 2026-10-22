/** View gestures only: engines and raster preparation never call this module. */
export const refinementPrecisionGain = .35;
export const refinementDirections = Object.freeze([
  ['top', 0,-1],['top-right',Math.SQRT1_2,-Math.SQRT1_2],['right',1,0],['bottom-right',Math.SQRT1_2,Math.SQRT1_2],
  ['bottom',0,1],['bottom-left',-Math.SQRT1_2,Math.SQRT1_2],['left',-1,0],['top-left',-Math.SQRT1_2,-Math.SQRT1_2],
].map(([name,x,y])=>Object.freeze({name,x,y})));
export function supportPoint(ellipse, direction) {
  const c=Math.cos(ellipse.axisAngle),s=Math.sin(ellipse.axisAngle),a=ellipse.radiusX**2,b=ellipse.radiusY**2;
  const xx=a*c*c+b*s*s,yy=a*s*s+b*c*c,xy=(a-b)*s*c;
  const h=Math.sqrt(direction.x**2*xx+2*direction.x*direction.y*xy+direction.y**2*yy);
  return {x:ellipse.centerX+(xx*direction.x+xy*direction.y)/h,y:ellipse.centerY+(xy*direction.x+yy*direction.y)/h};
}
export function boundaryHandles(ellipse) {return refinementDirections.map((direction,index)=>({index,name:direction.name,direction,point:supportPoint(ellipse,direction)}));}
/** Solve an ellipse with its axis angle unchanged and opposite support fixed.
 * In an axis-aligned singular direction, discard the impossible tangent delta.
 * Circle mode retains a circle; its tangent delta is likewise discarded. */
export function anchoredDrag(ellipse, index, delta, {circle=false}={}) {
  const n=refinementDirections[index];if(!n)throw Error('Unknown boundary dot');
  const active=supportPoint(ellipse,n),anchor={x:2*ellipse.centerX-active.x,y:2*ellipse.centerY-active.y};
  const c=Math.cos(ellipse.axisAngle),s=Math.sin(ellipse.axisAngle),u={x:c,y:s},w={x:-s,y:c};
  let v={x:(active.x-anchor.x+delta.x)/2,y:(active.y-anchor.y+delta.y)/2};
  const nu=n.x*u.x+n.y*u.y,nw=n.x*w.x+n.y*w.y;
  if(circle){const radius=ellipse.radiusX+(delta.x*n.x+delta.y*n.y)/2; if(radius<=0)return null;v={x:n.x*radius,y:n.y*radius};return {...ellipse,centerX:anchor.x+v.x,centerY:anchor.y+v.y,radiusX:radius,radiusY:radius};}
  if(Math.abs(nu)<1e-8){const component=v.x*w.x+v.y*w.y;v={x:w.x*component,y:w.y*component};}
  if(Math.abs(nw)<1e-8){const component=v.x*u.x+v.y*u.y;v={x:u.x*component,y:u.y*component};}
  const h=n.x*v.x+n.y*v.y;if(h<=0)return null;
  const a=Math.abs(nu)<1e-8?ellipse.radiusX**2:(v.x*u.x+v.y*u.y)*h/nu;
  const b=Math.abs(nw)<1e-8?ellipse.radiusY**2:(v.x*w.x+v.y*w.y)*h/nw;
  if(!Number.isFinite(a)||!Number.isFinite(b)||a<=0||b<=0)return null;
  return {...ellipse,centerX:anchor.x+v.x,centerY:anchor.y+v.y,radiusX:Math.sqrt(a),radiusY:Math.sqrt(b)};
}
export function boundedAnchoredDrag(ellipse,index,delta,options,isValid) {
  const raw=anchoredDrag(ellipse,index,delta,options);if(raw&&isValid(raw))return raw;
  let low=0,high=1,best=ellipse;
  for(let i=0;i<48;i++){const mid=(low+high)/2,next=anchoredDrag(ellipse,index,{x:delta.x*mid,y:delta.y*mid},options);if(next&&isValid(next)){low=mid;best=next;}else high=mid;}
  return best;
}
