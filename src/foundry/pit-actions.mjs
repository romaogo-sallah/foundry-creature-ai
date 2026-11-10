import {pitAt,pitConfig,pitWalkable,PIT_BEHAVIOR_TYPE} from './pit-geometry.mjs';
import {resolveFlightFall} from './flight-falling.mjs';
import {MANAGED_MOVEMENT} from './movement-options.mjs';
import {rulesAPI} from './rules-api.mjs';
import {occupiesMovementSpace} from './combat-state.mjs';
import {flySpeed} from './flight-costs.mjs';
const ns='foundry-creature-ai';
const settled=async token=>{await (token.movementAnimationPromise??token.document.movement?.animation?.ended);return token.document._source??token.document;};
export const pitHeldItems=actor=>[...actor.itemTypes.weapon??[],...actor.itemTypes.shield??[]].filter(w=>!w.flags?.[ns]?.fireShield&&w.system.equipped?.carryType==='held'&&w.system.equipped.handsHeld>0);
export const pitHeldHands=actor=>pitHeldItems(actor).reduce((n,w)=>n+(w.system.equipped.handsHeld??1),0);
const directions=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
const distance=(a,b)=>{const dx=Math.abs(a.x-b.x)/canvas.grid.size,dy=Math.abs(a.y-b.y)/canvas.grid.size;return (Math.max(dx,dy)+Math.floor(Math.min(dx,dy)/2))*5;};
export function pitActionChoices(token,{actionsRemaining=3}={}){
 if(!(token.document.parent?.regions?.contents??[]).some(pitConfig))return [];
 if(actionsRemaining<1||token.actor.hasCondition('immobilized','grabbed','restrained','prone','unconscious','paralyzed'))return [];
 const document=token.document,origin={x:document.x,y:document.y,elevation:document.elevation,level:document.level},size=canvas.grid.size,pit=pitAt(document),
  speed=token.actor.system.movement?.speeds.land?.value??token.actor.system.attributes.speed.total??token.actor.system.attributes.speed.value,
  leap=speed>=30?15:speed>=15?10:0,result=[];
 if(pit&&origin.elevation<pit.rim-0.1&&flySpeed(token.actor)&&!token.actor.hasCondition('prone','unconscious','paralyzed','petrified'))return [];
 if(pit&&origin.elevation<pit.rim-0.1&&!token.actor.system.movement?.speeds.climb?.value){
  const held=pitHeldItems(token.actor)[0];
  if(held)return [{id:`pit:stow:${held.id}`,kind:'pitStow',weaponId:held.id,actionCost:1,legal:true,traits:['manipulate'],assessment:{value:35},scoringTerms:[{label:'Free hands before climbing from the pit',contribution:35}]}];
 }
 const safe=p=>{
  const rect=canvas.dimensions.sceneRect;if(!rect.contains(p.x,p.y)||!rect.contains(p.x+token.w-1,p.y+token.h-1))return false;
  return !canvas.tokens.placeables.some(t=>t!==token&&occupiesMovementSpace(t)&&t.document.elevation===p.elevation&&p.x<t.document.x+t.w&&p.x+token.w>t.document.x&&p.y<t.document.y+t.h&&p.y+token.h>t.document.y);
 };
 for(const [dx,dy]of directions){
  if(pit&&origin.elevation<pit.rim-0.1){const bank={...origin,x:origin.x+dx*size,y:origin.y+dy*size,elevation:pit.rim};
   if(!pitAt(document,bank)&&safe(bank))result.push({id:`pit:climb:${dx},${dy}`,kind:'climb',pitId:pit.region.id,destination:bank,actionCost:1,legal:true,traits:['move'],dc:pit.climbDC,assessment:{value:30},scoringTerms:[{label:'Climb toward the pit rim',contribution:30}]});
   continue;
  }
  let crossed=false,lastSafe=origin,runup=[];
  for(let step=1;step<=Math.floor(speed/5)+3;step++){
   const p={...origin,x:origin.x+dx*size*step,y:origin.y+dy*size*step},voidAt=pitAt(document,p);
   if(!crossed&&!voidAt){lastSafe=p;runup.push(p);continue;}
   if(voidAt&&Math.abs(p.elevation-voidAt.rim)<0.1){crossed=true;continue;}
   if(crossed&&!voidAt&&safe(p)){
    const from=runup.length>=2?lastSafe:origin,jumpDistance=distance(from,p),strideDistance=distance(origin,from),ordinary=distance(origin,p)<=leap,
     cost=ordinary?1:2;
    if(!ordinary&&(actionsRemaining<2||strideDistance<10||strideDistance>speed||jumpDistance>speed))break;
    if(token.constrainMovementPath([origin,{...p,action:'jump'}],{ignoreWalls:false,ignoreCost:true})[1])break;
    result.push({id:`pit:jump:${dx},${dy}:${step}`,kind:'jump',destination:p,runup:ordinary?[]:runup,jumpDistance:ordinary?distance(origin,p):jumpDistance,leapDistance:leap,
     actionCost:cost,legal:true,traits:['move',...(cost===2?['skill']:[])],assessment:{value:8},scoringTerms:[{label:cost===1?'Leap across an open pit':'Run up and Long Jump across an open pit',contribution:8}]});break;
   }
  }
 }
 return result;
}
export async function executePitAction(token,choice,{valid=()=>true,reactions=rulesAPI()?.reactions}={}){
 const current=pitActionChoices(token).find(c=>c.id===choice.id);if(!current)return {skipped:true,skipReason:'Pit movement is no longer legal'};
 if(!valid())return {skipped:true};
 if(choice.kind==='pitStow'){const r=await reactions?.action({mover:token,kind:'manipulate',valid,applyDamage:true});if(r?.pause||r?.endTurn)return r;
  if(!r?.disrupted&&valid())await token.actor.items.get(choice.weaponId).update({'system.equipped.carryType':'worn','system.equipped.handsHeld':0});return {resolved:true,note:'Stowed a held weapon to free the hands for Climb.'};}
 const origin={x:token.document.x,y:token.document.y,elevation:token.document.elevation,level:token.document.level};
 const provoke=async()=>{const r=await reactions?.action({mover:token,kind:'move',valid,applyDamage:true});return r?.pause||r?.endTurn?r:null;};
 if(choice.kind==='climb'){
  const climbSpeed=token.actor.system.movement?.speeds.climb?.value??token.actor.system.attributes.speed.otherSpeeds?.find(s=>s.type==='climb')?.value;
  const held=pitHeldHands(token.actor);
  if(held&&!climbSpeed)throw new Error('Climb requires two free hands; release or stow held equipment first');
  const r=await provoke();if(r)return r;if(!valid())return {resolved:true};
  const roll=climbSpeed?null:await token.actor.getStatistic('athletics').check.roll({skipDialog:true,token:token.document,dc:{value:current.dc},action:'climb',extraRollOptions:[`${ns}:managed`,'action:climb','skip-handling-message']});
  if(!climbSpeed&&!Number.isInteger(roll?.degreeOfSuccess))throw new Error('Climb check was not resolved');
  const degree=climbSpeed?2:roll.degreeOfSuccess;
  if(degree===0){await resolveFlightFall(token,{force:true,reactions});if(!token.actor.hasCondition('prone'))await token.actor.increaseCondition('prone');return {resolved:true,note:'Climb critically failed; the creature fell.'};}
  if(degree===1)return {resolved:true,note:'Climb failed; no height gained.'};
  const pit=pitAt(token.document),speed=token.actor.system.movement?.speeds.land?.value??token.actor.system.attributes.speed.value,
   gain=climbSpeed??5+Math.max(0,Math.floor((speed-20)/20))*5+(degree===3?5:0),z=Math.min(pit.rim,origin.elevation+gain),to=z>=pit.rim?current.destination:{...origin,elevation:z};
  await token.document.move([{...to,action:'climb',snapped:true}],{[MANAGED_MOVEMENT]:true,showRuler:true});
  if(Math.abs((await settled(token)).elevation-to.elevation)>0.1)return {resolved:true,note:'Foundry stopped the Climb. Its action remains spent; reassessing the actual position.'};
  if(!climbSpeed&&!token.actor.itemTypes.effect.some(e=>e.flags?.[ns]?.pitClimb))await token.actor.createEmbeddedDocuments('Item',[{name:'Climbing: off-guard',type:'effect',img:'icons/svg/anchor.svg',system:{slug:'pit-climbing',duration:{value:-1,unit:'unlimited',expiry:null,sustained:false},rules:[{key:'GrantItem',uuid:'Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg',inMemoryOnly:true}]},flags:{[ns]:{pitClimb:true}}}]);
  if(z>=pit.rim){const ids=token.actor.itemTypes.effect.filter(e=>e.flags?.[ns]?.pitClimb).map(e=>e.id);if(ids.length)await token.actor.deleteEmbeddedDocuments('Item',ids);}
  return {resolved:true,note:`Climbed ${z-origin.elevation} feet${z>=pit.rim?' and reached the bank':''}.`};
 }
 // The run-up is part of the two-action activity and still triggers movement
 // reactions. The jump is not a teleport and cannot cross solid walls.
 if(current.runup.length){await token.document.move(current.runup.map(p=>({...p,action:'walk',snapped:true})),{[MANAGED_MOVEMENT]:true,showRuler:true});const actual=await settled(token);if(!valid())return {resolved:true};
  const end=current.runup.at(-1);if(Math.abs(actual.x-end.x)>1||Math.abs(actual.y-end.y)>1||Math.abs(actual.elevation-end.elevation)>0.1||token.actor.hasCondition('prone','immobilized','grabbed','restrained'))return {resolved:true,note:'The run-up stopped; Long Jump actions remain spent, and no jump was made.'};}
 const interrupted=await provoke();if(interrupted)return interrupted;
 const actual=token.document._source??token.document,from={x:actual.x,y:actual.y,elevation:actual.elevation,level:actual.level};
 const check=choice.actionCost===2?await token.actor.getStatistic('athletics').check.roll({skipDialog:true,token:token.document,dc:{value:15},action:'long-jump',extraRollOptions:[`${ns}:managed`,'action:long-jump','skip-handling-message']}):null;
 if(choice.actionCost===2&&!Number.isInteger(check?.degreeOfSuccess))throw new Error('Long Jump check was not resolved');
 const speed=token.actor.system.movement?.speeds.land?.value??token.actor.system.attributes.speed.value,
  limit=check?.degreeOfSuccess>=2?Math.min(speed,Math.floor(check.total/5)*5):current.leapDistance,
  fraction=Math.min(1,limit/current.jumpDistance),to={...current.destination,x:from.x+(current.destination.x-from.x)*fraction,y:from.y+(current.destination.y-from.y)*fraction};
 await token.document.move([{...to,action:'jump',snapped:true}],{[MANAGED_MOVEMENT]:true,showRuler:true,constrainOptions:{ignoreWalls:false,ignoreCost:true}});
 await settled(token);
 if(check?.degreeOfSuccess===0&&!token.actor.hasCondition('prone'))await token.actor.increaseCondition('prone');
 if(pitAt(token.document))await resolveFlightFall(token,{force:true,reactions});
 return {resolved:true,note:pitAt(token.document)?'The jump fell short and ended in the pit.':'Jumped to the opposite bank.'};
}
export function registerPitBehavior(){
 const Base=globalThis.foundry?.data?.regionBehaviors?.RegionBehaviorType,F=globalThis.foundry?.data?.fields;if(!Base||!F)return false;
 class Pit extends Base{
  static defineSchema(){return {rim:new F.NumberField({required:true,nullable:false,initial:0,label:'Rim elevation'}),depth:new F.NumberField({required:true,nullable:false,min:5,initial:10,label:'Depth (feet)'}),climbDC:new F.NumberField({required:true,nullable:false,min:0,initial:20,label:'Climb DC'})};}
  static events={tokenMoveIn(event){return rulesAPI()?.pits?.onMove(event,this.region);},tokenMoveWithin(event){return rulesAPI()?.pits?.onMove(event,this.region);}};
 }
 CONFIG.RegionBehavior.dataModels[PIT_BEHAVIOR_TYPE]=Pit;
 (CONFIG.RegionBehavior.typeLabels??={})[PIT_BEHAVIOR_TYPE]='Pit / climbable drop';(CONFIG.RegionBehavior.typeIcons??={})[PIT_BEHAVIOR_TYPE]='fa-solid fa-person-falling';
}
