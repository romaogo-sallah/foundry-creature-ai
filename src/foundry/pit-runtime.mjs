import {pitAt,pitConfig,PIT_BEHAVIOR_TYPE} from './pit-geometry.mjs';
import {pitActionChoices,executePitAction,pitHeldHands} from './pit-actions.mjs';
import {resolveFlightFall} from './flight-falling.mjs';
import {MANAGED_MOVEMENT} from './movement-options.mjs';
const ns='foundry-creature-ai',query=`${ns}.pitAction`;
export function installPits(runtime){
 const falling=new Set(),pending=new Set();
 runtime.rules.pits={choices:pitActionChoices,execute:executePitAction,open:openPitActions,install:()=>installStadiumPits({manual:true}),
  onMove(event,region){
   const document=event.data.token,source=document._source??document,pit=pitConfig(region),action=event.data.movement.passed.waypoints.at(-1)?.action??document.movementAction;
   if(event.user?.id!==game.user.id||!pit||!document.actor?.isOfType?.('creature')||['fly','jump','climb','burrow'].includes(action)||falling.has(document.uuid)||source.elevation<pit.rim-0.1)return;
   if(game.users.activeGM?.id!==game.user.id){
    document.pauseMovement?.();falling.add(document.uuid);
    return (async()=>{try{await (event.data.movement.animation?.ended??document.object?.movementAnimationPromise);await document.stopMovement?.();
     const gm=game.users.activeGM;if(!gm)throw new Error('An active GM is required to resolve the pit fall');
     return await gm.query(`${ns}.pitFall`,{sceneId:document.parent.id,tokenId:document.id,regionId:region.id,origin:{x:document.x,y:document.y,elevation:document.elevation}});
    }finally{falling.delete(document.uuid);}})();
   }
   const resume=document.pauseMovement?.();
   return runtime.reactions.resolve(async()=>{
    try{
     falling.add(document.uuid);await (event.data.movement.animation?.ended??document.object?.movementAnimationPromise);await document.stopMovement?.();
     const token=document.object??canvas.tokens.get(document.id);if(!token)return;
     const snapped=document.getSnappedPosition(document),points=[snapped,...[-1,0,1].flatMap(dx=>[-1,0,1].map(dy=>({x:snapped.x+dx*canvas.grid.size,y:snapped.y+dy*canvas.grid.size})))];
     const landing=points.find(p=>pitAt(document,{...source,...p})?.region.id===region.id);if(!landing)throw new Error('No supported grid landing exists inside this pit');
     if(document.x!==landing.x||document.y!==landing.y)await document.move([{...landing,elevation:pit.rim,level:document.level,action:'displace',snapped:true}],{[MANAGED_MOVEMENT]:true,showRuler:false});
     if(runtime.reactions.available(token)&&!token.actor.hasCondition('restrained')){
      const answer=token.actor.type==='npc'&&document.getFlag(ns,'config')?.enabled?'grab':await runtime.reactions.prompts.ask({token,title:'Grab an Edge',description:`Catch the pit rim before falling? Acrobatics or Reflex against Climb DC ${pit.climbDC}; an ordinary success needs one free hand.`,choices:[{id:'grab',label:'Grab an Edge'}],valid:()=>canvas.tokens.get(token.id)===token});
      if(answer==='pause')throw new Error('Pit fall paused for Grab an Edge; resolve the fall before continuing');
      if(answer==='grab'){
       const reserved=await runtime.reactions.reserve(token,'grab-an-edge',()=>canvas.tokens.get(token.id)===token),acro=token.actor.getStatistic('acrobatics'),ref=token.actor.getStatistic('reflex'),stat=(acro?.mod??acro?.check?.mod??0)>(ref?.mod??ref?.check?.mod??0)?acro:ref;
       const roll=await stat.check.roll({skipDialog:true,token:document,dc:{value:pit.climbDC},action:'grab-an-edge',extraRollOptions:[`${ns}:managed`,'skip-handling-message']});
       if(!Number.isInteger(roll?.degreeOfSuccess))throw new Error('Grab an Edge check unresolved');await runtime.reactions.confirm(token,reserved);
       const hands=pitHeldHands(token.actor);
       if(roll.degreeOfSuccess===3||roll.degreeOfSuccess===2&&hands<2){
        await document.move([{...landing,elevation:pit.rim-5,level:document.level,action:'displace',snapped:true}],{[MANAGED_MOVEMENT]:true,showRuler:false});
        await token.actor.createEmbeddedDocuments('Item',[{name:'Hanging from pit rim: off-guard',type:'effect',system:{slug:'pit-climbing',duration:{value:-1,unit:'unlimited',expiry:null,sustained:false},rules:[{key:'GrantItem',uuid:'Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg',inMemoryOnly:true}]},flags:{[ns]:{pitClimb:true}}}]);return;
       }
      }
     }
     await resolveFlightFall(token,{force:true,reactions:runtime.reactions});
    }finally{falling.delete(document.uuid);void resume;}
   });
  }};
 CONFIG.queries??={};CONFIG.queries[query]=async(data,{user})=>{
  const token=canvas.scene?.id===data.sceneId?canvas.tokens.get(data.tokenId):null;
  if(game.users.activeGM?.id!==game.user.id||!token||!user.isGM&&!token.actor.testUserPermission(user,'OWNER'))throw new Error('You do not own this pit movement');
  if(['x','y','elevation'].some(k=>token.document[k]!==data.origin[k]))throw new Error('Token moved before the pit action was resolved');
  const choice=pitActionChoices(token).find(c=>c.id===data.choiceId);if(!choice)throw new Error('The pit action is no longer legal');
  return runtime.reactions.resolve(()=>executePitAction(token,choice,{reactions:runtime.reactions}));
 };
 CONFIG.queries[`${ns}.pitFall`]=(data,{user})=>{
  const token=canvas.scene?.id===data.sceneId?canvas.tokens.get(data.tokenId):null,region=canvas.scene?.regions.get(data.regionId);
  if(game.users.activeGM?.id!==game.user.id||!token||!pitConfig(region??{})||!user.isGM&&!token.actor.testUserPermission(user,'OWNER')||['x','y','elevation'].some(k=>token.document[k]!==data.origin[k]))throw new Error('Cannot validate the requested pit fall');
  const point=token.document.getSnappedPosition(token.document),near=[point,...[-1,0,1].flatMap(dx=>[-1,0,1].map(dy=>({...point,x:point.x+dx*canvas.grid.size,y:point.y+dy*canvas.grid.size})))];
  if(!near.some(p=>pitAt(token.document,{...data.origin,...p})?.region.id===region.id))throw new Error('The creature is not at this pit');
  return runtime.rules.pits.onMove({name:'tokenMoveIn',user:game.user,data:{token:token.document,movement:{passed:{waypoints:[{action:'walk'}]}}}},region);
 };
 runtime.rules.pits.request=async(token,choice)=>{
  const data={sceneId:canvas.scene.id,tokenId:token.id,choiceId:choice.id,origin:{x:token.document.x,y:token.document.y,elevation:token.document.elevation}},gm=game.users.activeGM;
  if(!gm)throw new Error('An active GM is required for pit movement');
  return gm.id===game.user.id?CONFIG.queries[query](data,{user:game.user}):gm.query(query,data);
 };
 Hooks.on('preMoveToken',(document,movement,options)=>{
  if(options[MANAGED_MOVEMENT]||pending.has(document.id)||!['jump','climb'].includes(document.movementAction))return;
  const token=document.object,mode=document.movementAction,choices=pitActionChoices(token).filter(c=>c.kind===mode||mode==='climb'&&c.kind==='pitStow');if(!choices.length)return;
  const end=movement.pending.waypoints.at(-1)??movement.passed.waypoints.at(-1),choice=choices.sort((a,b)=>Math.hypot((a.destination?.x??document.x)-end.x,(a.destination?.y??document.y)-end.y)-Math.hypot((b.destination?.x??document.x)-end.x,(b.destination?.y??document.y)-end.y))[0];
  pending.add(document.id);setTimeout(()=>runtime.rules.pits.request(token,choice).catch(runtime.onError).finally(()=>pending.delete(document.id)),0);return false;
 });
 Hooks.on('canvasReady',()=>{if(game.users.activeGM?.id===game.user.id)void installStadiumPits().catch(runtime.onError);});
 void installStadiumPits().catch(runtime.onError);
}
export async function openPitActions(){
 const token=canvas.tokens.controlled[0];if(!token?.actor)throw new Error('Select a creature next to or inside a pit');
 const choices=pitActionChoices(token);if(!choices.length){ui.notifications.info('No pit Climb or crossing Jump is available here.');return;}
 const answer=await foundry.applications.api.DialogV2.wait({window:{title:'Pit: Climb / Jump'},content:'<p>Choose one action or activity. Manual action counting remains with the player. Climb needs free hands; Jump keeps native walls and reactions.</p>',
  buttons:choices.slice(0,16).map((c,i)=>({action:String(i),label:`${c.kind==='pitStow'?'Stow weapon for Climb':c.kind==='climb'?'Climb':c.actionCost===2?'Long Jump':'Leap'} (${c.actionCost} action${c.actionCost===1?'':'s'})${c.destination?` to ${Math.round(c.destination.x/canvas.grid.size)},${Math.round(c.destination.y/canvas.grid.size)}`:''}`})),rejectClose:false});
 if(answer!=null&&choices[Number(answer)])await game.modules.get('pf2e-tactical-core').api.rules.pits.request(token,choices[Number(answer)]);
}
export async function installStadiumPits({manual=false}={}){
 if(!globalThis.canvas?.ready||game.world?.id!=='arena'||!(manual?game.user.isGM:game.users.activeGM?.id===game.user.id)||canvas.scene?.id!=='OTt3o0SfJZTLAc3r')return {created:0};
 const scene=canvas.scene,plans=[{note:'kw3GPMeepPUPD7rI',noteX:1820,noteY:1400,x:1750,y:1330},{note:'vRFyJsKwYdaGgdyN',noteX:2590,noteY:2030,x:2520,y:1960}],pending=[];
 for(const p of plans){const note=scene.notes.get(p.note);if(!note||note.x!==p.noteX||note.y!==p.noteY||note.text?.trim()!=='-10 ft'||scene.regions.contents.some(r=>r.flags?.[ns]?.pitAnnotation===p.note))continue;
  pending.push({name:'Pit (-10 ft)',shapes:[{type:'rectangle',x:p.x,y:p.y,width:140,height:140}],elevation:{bottom:-10,top:1},levels:[],color:'#6b5035',
   behaviors:[{type:PIT_BEHAVIOR_TYPE,name:'10-foot pit; rocky walls DC 20',system:{rim:0,depth:10,climbDC:20}}],flags:{[ns]:{pitAnnotation:p.note}}});
 }
 const created=pending.length?await scene.createEmbeddedDocuments('Region',pending,{renderSheet:false}):[];
 if(created.length!==pending.length)throw new Error('Foundry did not create the Pit Regions. Restart the server to load the new Pit behavior type, then reload clients and retry.');
 return {created:created.length};
}
