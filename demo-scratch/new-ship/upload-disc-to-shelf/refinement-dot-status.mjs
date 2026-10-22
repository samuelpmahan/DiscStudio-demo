import { boundaryHandles } from './refinement-drag.mjs';
/** Source-space observations of the latest adjustment; never geometry inputs. */
export const dotStationaryThreshold = 1e-6;
export function classifyDotMovement(beforeEllipse, afterEllipse, selectedIndex = null, threshold = dotStationaryThreshold) {
  if (!Number.isFinite(threshold) || threshold < 0) throw Error('Finite nonnegative movement threshold required');
  const before=boundaryHandles(beforeEllipse),after=boundaryHandles(afterEllipse);
  return Object.freeze(before.map((handle,index)=>{
    const previous=handle.point,current=after[index].point,dx=current.x-previous.x,dy=current.y-previous.y;
    const distance=Math.hypot(dx,dy),outward=dx*handle.direction.x+dy*handle.direction.y;
    const sideways=-dx*handle.direction.y+dy*handle.direction.x;
    const moved=distance>threshold,radial=Math.abs(outward)>threshold,transverse=Math.abs(sideways)>threshold;
    const kind=!moved?'stationary':index===selectedIndex?'direct':'indirect';
    const direction=!moved?'stationary':!radial?'sideways':outward>0?'outward':'inward';
    const mixed=moved&&radial&&transverse;
    return Object.freeze({index,name:handle.name,kind,direction,mixed,before:Object.freeze({...previous}),after:Object.freeze({...current}),delta:Object.freeze({x:dx,y:dy}),distance,outward,sideways,threshold});
  }));
}
export function dotMovementDescription(status) {
  if(!status||status.kind==='stationary')return 'stayed in place';
  const motion=status.direction==='sideways'?'moved sideways':`moved ${status.direction}${status.mixed?' and sideways':''}`;
  return `${motion} ${status.kind==='direct'?'manually':'because another dot moved'}`;
}
