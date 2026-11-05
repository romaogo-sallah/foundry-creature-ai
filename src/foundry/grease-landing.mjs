import { inGrease } from './spell-zones.mjs';
import { occupiesMovementSpace, incapacitationReason } from './combat-state.mjs';
import { MANAGED_MOVEMENT, inheritManagedMovement } from './movement-options.mjs';

const ns='foundry-creature-ai',locks=new Map();
export const GREASE_SNAP=`${ns}:grease-snap`;
const position=token=>Object.fromEntries(['x','y','elevation','level'].map(key=>[key,(token.document._source??token.document)[key]]));
const same=(a,b)=>['x','y','elevation','level'].every(key=>key==='x'||key==='y'?Math.abs(a[key]-b[key])<=1:a[key]===b[key]);

function safeLanding(token,point,current){
  const size=canvas.grid.size,document=token.document;
  if(point.elevation!==current.elevation||point.level!==current.level||!inGrease(token,point).length)return false;
  const rect=canvas.dimensions.sceneRect,width=token.w??document.width*size,height=token.h??document.height*size;
  if(point.x<rect.x||point.y<rect.y||point.x+width>rect.x+rect.width||point.y+height>rect.y+rect.height)return false;
  if((canvas.tokens.placeables??[]).some(other=>other!==token&&occupiesMovementSpace(other)&&
    other.document.elevation===point.elevation&&other.document.level===point.level&&
    point.x<other.document.x+other.w&&point.x+width>other.document.x&&point.y<other.document.y+other.h&&point.y+height>other.document.y))return false;
  return !token.constrainMovementPath([{...current,action:'walk'},{...point,action:'walk'}],{ignoreWalls:false,ignoreCost:true})[1];
}

// A correction completes only the interrupted grid placement. It is not a new
// action, another Stride, a new hazard step, or an additional reaction trigger.
export async function settleGreaseSlip(token,{path=[],fall=false,valid=()=>true}={}){
  const key=token.document.uuid??token.id;
  if(locks.has(key))return locks.get(key);
  const task=(async()=>{
    if(!canvas.ready||game.paused||canvas.tokens.get(token.id)!==token||token.document.parent.id!==canvas.scene.id||
      game.users.activeGM?.id!==game.user.id||!valid()||incapacitationReason(token)||
      (!fall&&!token.actor.hasCondition('prone'))||typeof token.document.getSnappedPosition!=='function')return {settled:false};
    const current=position(token),snapped={...current,...token.document.getSnappedPosition(current)};
    const onSurface=inGrease(token,current).length>0;
    if(!fall&&!onSurface&&!path.some(point=>inGrease(token,{...current,...point}).length))return {settled:false};
    if(same(current,snapped)&&onSurface)return {settled:true,position:current,corrected:false};
    const size=canvas.grid.size,candidates=new Map();
    const add=point=>{
      const full={...current,...point};
      const grid={...full,...token.document.getSnappedPosition(full)};
      if(Math.hypot(grid.x-current.x,grid.y-current.y)>size*Math.SQRT2+1)return;
      if(!safeLanding(token,grid,current))return;
      candidates.set(`${grid.x},${grid.y}`,grid);
    };
    // Requested grid waypoints win ties: choose the cell ON the grease, not
    // the geometrically nearest cell just before its boundary.
    path.forEach(add);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)add({...snapped,x:snapped.x+dx*size,y:snapped.y+dy*size});
    const target=[...candidates.values()].sort((a,b)=>Math.hypot(a.x-current.x,a.y-current.y)-Math.hypot(b.x-current.x,b.y-current.y))[0];
    if(!target||!valid()||!same(position(token),current))return {settled:false};
    const completed=await token.document.move([{...target,action:'displace',snapped:true}],{
      [MANAGED_MOVEMENT]:true,[GREASE_SNAP]:true,animate:false,showRuler:false,autoRotate:false});
    await (token.movementAnimationPromise??token.document.movement?.animation?.ended);
    if(!completed||!valid()||incapacitationReason(token)||!same(position(token),target)||!inGrease(token).length)return {settled:false};
    return {settled:true,position:position(token),corrected:true};
  })();
  locks.set(key,task);
  try{return await task;}finally{locks.delete(key);}
}

export async function finishGreaseFall(token,{valid=()=>true}={}){
  if(!valid()||incapacitationReason(token)||!inGrease(token).length)return false;
  if(!token.actor.hasCondition('prone'))await token.actor.increaseCondition('prone');
  return true;
}

let installed=false;
export function installGreaseLandingHooks({onError=error=>console.error(`${ns}: Grease landing`,error)}={}){
  if(installed)return;
  installed=true;
  Hooks.on('stopToken',document=>{
    const movement=document.movement;
    // Managed AI/manual replays repair through their caller's cancellation and
    // combat-turn guard. A detached hook must not bypass that guard.
    if(inheritManagedMovement(document,movement,{...movement?.updateOptions})||movement?.updateOptions?.[GREASE_SNAP]||
      movement?.passed?.waypoints?.at(-1)?.action==='displace')return;
    const token=document.object??canvas.tokens?.get(document.id);
    if(!token?.actor)return;
    // stopToken is synchronous inside Foundry's movement workflow. Defer the
    // repair until its stop/animation has finished; never wait inside a Region.
    void Promise.resolve().then(async()=>{
      await (token.movementAnimationPromise??document.movement?.animation?.ended);
      await settleGreaseSlip(token,{path:movement?.passed?.waypoints??[]});
    }).catch(onError);
  });
}
