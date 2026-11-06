import {rampConfig} from './ramp-geometry.mjs';
const ns='foundry-creature-ai';
const epsilon=0.01;
const heightTolerance=0.15; // Native wall/Region adjustments can move a checkpoint by one pixel.
const fields=['x','y','elevation','level','width','height','depth','shape'];
const source=document=>document._source??document;
const equal=(a,b)=>Math.abs(a.x-b.x)<epsilon&&Math.abs(a.y-b.y)<epsilon&&Math.abs(a.elevation-b.elevation)<epsilon;
const regions=document=>(document.parent?.regions?.contents??[]).filter(region=>!region.hidden&&
  (!region.includedInLevel||region.includedInLevel(source(document).level)));
const flags=region=>region.flags?.[ns]??{};
const center=(document,point)=>document.getMovementOrigin?.(point)??{
  x:point.x+(point.width??document.width)*document.parent.grid.size/2,
  y:point.y+(point.height??document.height)*document.parent.grid.size/2};
function inside(region,point){
  const bottom=region.elevation?.bottom??0,top=region.elevation?.top??bottom;
  return region.testPoint({...point,elevation:Number.isFinite(bottom)?bottom+(Number.isFinite(top)?(top-bottom)/2:0):0});
}
function fraction(ramp,point){
  const dx=ramp.to.x-ramp.from.x,dy=ramp.to.y-ramp.from.y;
  return ((point.x-ramp.from.x)*dx+(point.y-ramp.from.y)*dy)/(dx*dx+dy*dy);
}
const height=(ramp,point)=>ramp.from.elevation+Math.max(0,Math.min(1,fraction(ramp,point)))*(ramp.to.elevation-ramp.from.elevation);
export {inside as surfaceContains,height as rampElevation};
export function platformElevations(region){
  const surfaces=(region.behaviors?.contents??[]).filter(behavior=>behavior.type==='defineSurface');
  if(!surfaces.length){const elevation=flags(region).platform?.elevation;return Number.isFinite(elevation)?[elevation]:[];}
  return surfaces.filter(behavior=>!behavior.disabled&&behavior.system.move).flatMap(behavior=>{
    const elevations=[];
    if(behavior.system.placement!=='top')elevations.push(region.elevation?.bottom);
    if(behavior.system.placement!=='bottom')elevations.push(region.elevation?.top);
    return elevations.filter(Number.isFinite);
  });
}

// Owned ramps describe WALK connections within one native scene level. They
// do not create free climbs at arbitrary platform edges or alter flying paths.
export function surfaceMovementPath(document,waypoints,options={}){
  if(options.isUndo||options.isPaste||options.teleport||options.planned||['hud','config','undo','paste'].includes(options.method)||
    !document.actor?.isOfType?.('creature')||!document.getCompleteMovementPath||!waypoints?.length)return null;
  const all=regions(document),configs=new Map(all.map(region=>[region,rampConfig(region)])),ramps=all.filter(r=>configs.get(r)),platforms=all.filter(r=>platformElevations(r).length);
  if(!ramps.length&&!platforms.length)return null;
  const origin={...Object.fromEntries(fields.filter(key=>source(document)[key]!==undefined).map(key=>[key,source(document)[key]])),
    action:document.movementAction??'walk',snapped:false};
  let prior=origin;
  const requested=waypoints.map(point=>{
    const full={...prior,...point};prior=full;return full;
  });
  if(requested.some(point=>!['walk','step','sneak'].includes(point.action)||point.level!==origin.level||
    ['width','height','depth','shape'].some(key=>point[key]!==undefined&&origin[key]!==undefined&&point[key]!==origin[key])))return null;
  // Resolve horizontal traversal first; ramp geometry, rather than a straight
  // interpolation between distant elevations, supplies the vertical profile.
  const complete=document.getCompleteMovementPath([origin,...requested.map(p=>({...p,elevation:origin.elevation}))]);
  if(complete.length>1024)throw new Error('Split this ramp movement into shorter paths.');
  const expanded=[origin];
  for(const raw of complete.slice(1)){
    const from=expanded.at(-1),one=center(document,from),two=center(document,raw),cuts=[];
    // Insert exact ramp ends before native floor collision testing. Otherwise a
    // diagonal from a ramp midpoint to a deck would pass through its floor.
    for(const region of ramps){
      const ramp=configs.get(region),a=fraction(ramp,one),b=fraction(ramp,two);
      if(Math.abs(b-a)<epsilon)continue;
      for(const edge of [0,1]){
        const t=(edge-a)/(b-a);
        if(t<=epsilon||t>=1-epsilon)continue;
        const p={...raw,x:from.x+(raw.x-from.x)*t,y:from.y+(raw.y-from.y)*t,
          intermediate:true,explicit:false,snapped:false};
        // Test slightly within the ramp, since polygon edges are half-open.
        const c=center(document,p),inward=edge===0?0.001:-0.001;
        if(inside(region,{x:c.x+(ramp.to.x-ramp.from.x)*inward,y:c.y+(ramp.to.y-ramp.from.y)*inward}))cuts.push({t,p});
      }
    }
    for(const {p}of cuts.sort((a,b)=>a.t-b.t))if(!equal(expanded.at(-1),p))expanded.push(p);
    if(!equal(expanded.at(-1),raw))expanded.push(raw);
  }
  const supports=(p,elevation)=>platforms.some(r=>platformElevations(r).some(height=>Math.abs(height-elevation)<epsilon)&&inside(r,p));
  const result=[origin];let lastRamp=ramps.find(r=>inside(r,center(document,origin))&&
    Math.abs(height(configs.get(r),center(document,origin))-origin.elevation)<heightTolerance)??null,changed=false;
  for(const raw of expanded.slice(1)){
    const previous=result.at(-1),a=center(document,previous),b=center(document,raw);
    let elevation=previous.elevation;
    const entered=ramps.find(r=>inside(r,b)&&Math.abs(height(configs.get(r),a)-previous.elevation)<heightTolerance);
    if(entered){lastRamp=entered;elevation=height(configs.get(entered),b);}
    else if(lastRamp){
      const ramp=configs.get(lastRamp),t=fraction(ramp,b),end=height(ramp,b);
      if((t<=0||t>=1)&&(Math.abs(end)<epsilon||supports(b,end)))elevation=end;
      else if(!inside(lastRamp,b)&&!supports(b,elevation))throw new Error('Use a ramp to leave this platform. Resolve jumping, climbing or falling separately.');
      if(!inside(lastRamp,b))lastRamp=null;
    }
    else if(elevation>epsilon&&supports(a,elevation)&&!supports(b,elevation))
      throw new Error('Use a ramp to leave this platform. Resolve jumping, climbing or falling separately.');
    changed ||= Math.abs(elevation-origin.elevation)>epsilon;
    result.push({...raw,elevation});
  }
  return changed?result:null;
}

export function sameSurfaceElevation(document,waypoints){
  const path=surfaceMovementPath(document,waypoints);
  return !path||path.every(p=>Math.abs(p.elevation-source(document).elevation)<epsilon);
}
