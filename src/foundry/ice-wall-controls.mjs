import {hazardBehavior} from './terrain-contract.mjs';
import {iceBlocksMovement} from './ice-wall-geometry.mjs';
import {tokenHeight} from './vertical-geometry.mjs';
const ns='foundry-creature-ai',query=`${ns}.iceWallAttack`;
export async function damageIceSection(region,index,total,type){
 const wall=region.flags?.[ns]?.iceWall,section=wall?.segments[index];if(!section||section.hp<=0)throw new Error('The ice section no longer exists');
 const damage=type==='cold'?0:Math.max(0,total+(type==='fire'?15:0)-10),segments=structuredClone(wall.segments);segments[index].hp=Math.max(0,section.hp-damage);
 await region.setFlag(ns,'iceWall',{...wall,segments});
 if(!segments[index].hp&&type!=='fire')await region.parent.createEmbeddedDocuments('Region',[{name:'Shattered ice: difficult and cold',shapes:[{type:'rectangle',x:section.x,y:section.y,width:section.width,height:section.height}],
  elevation:{bottom:section.bottom,top:section.top},levels:[...region.levels??[]],behaviors:[{type:'modifyMovementCost',system:{difficulties:{walk:2}}},hazardBehavior({formula:`${2+Math.floor((wall.rank-5)/2)}d6`,damageType:'cold',frequency:'crossing'})],
  flags:{[ns]:{weather:{expiresAt:wall.expiresAt,sourceTokenId:wall.sourceTokenId}}}}],{renderSheet:false});
 return {damage,hp:segments[index].hp};
}
export function installIceWalls({reactions,onError}){
 CONFIG.queries??={};CONFIG.queries[query]=async(data,{user})=>{
  const source=canvas.tokens.get(data.tokenId),region=canvas.scene.regions.get(data.regionId),section=region?.flags?.[ns]?.iceWall?.segments[data.index];
  if(!source||!section||!user.isGM&&!source.actor.testUserPermission(user,'OWNER'))throw new Error('You do not own the ice wall attack');
  const strike=source.actor.system.actions.find(s=>s.item?.id===data.strikeId);if(!strike)throw new Error('Strike no longer available');
  const size=canvas.grid.size,p={x:section.x+section.width/2,y:section.y+section.height/2},range=strike.item.isRanged?strike.item.system.range?.max??strike.item.system.range?.increment*6:source.actor.getReach({action:'attack',weapon:strike.item});
  if(Math.hypot(p.x-source.center.x,p.y-source.center.y)/size*5>range+Math.max(source.document.width,source.document.height)*2.5)throw new Error('Ice wall section is out of Strike range');
  return reactions.resolve(async()=>{const roll=await strike.variants[Math.max(0,Math.min(2,data.map??0))].roll({dc:{value:10},options:[`${ns}:managed`,'skip-handling-message'],event:{shiftKey:false}});
   if(!Number.isInteger(roll?.degreeOfSuccess))throw new Error('Ice wall attack unresolved');if(roll.degreeOfSuccess<2)return {hit:false};
   // Ice is immune to critical hits and precision. Use ordinary native damage.
   const damage=await strike.damage({options:[`${ns}:managed`,'skip-handling-message'],event:{shiftKey:false}});
   let effective=0,fire=false;for(const part of damage.instances??[]){if(part.persistent||part.category==='precision'||part.type==='cold')continue;effective+=Math.max(0,part.total-(part.componentTotal?.('precision')??0));if(part.type==='fire')fire=true;}
   return damageIceSection(region,data.index,effective,fire?'fire':'physical');});
 };
 Hooks.on('preMoveToken',(document,movement,options)=>{
  if(options.isUndo||options.isPaste||options[`${ns}:ignore-ice-walls`])return;
  const points=[movement.origin,...movement.passed.waypoints,...movement.pending.waypoints];
  for(let i=1;i<points.length;i++){
   if(iceBlocksMovement(document.object??{document},points[i-1],points[i],tokenHeight(document.object??{document}))){ui.notifications.warn('Wall of Ice blocks this movement. Break a section or move over/around it.');return false;}
  }
 });
}
export async function openIceWalls(){
 const token=canvas.tokens.controlled[0],walls=canvas.scene?.regions.contents.filter(r=>r.flags?.[ns]?.iceWall);
 if(!token?.actor||!walls?.length)throw new Error('Select an attacker in a scene containing Wall of Ice');
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const entries=walls.flatMap(r=>r.flags[ns].iceWall.segments.map((s,i)=>({region:r,index:i,hp:s.hp}))).filter(s=>s.hp>0),strikes=token.actor.system.actions.filter(s=>s.type==='strike');
 const answer=await foundry.applications.api.DialogV2.wait({window:{title:'Attack Wall of Ice'},content:`<p>Sections have AC 10, Hardness 10, cold/critical/precision immunity and fire weakness 15. Count your Strike action normally.</p><select name="section">${entries.map((e,i)=>`<option value="${i}">${escape(e.region.name)}: section ${e.index+1} (${e.hp} HP)</option>`).join('')}</select><select name="strike">${strikes.map(s=>`<option value="${s.item.id}">${escape(s.item.name)}</option>`).join('')}</select><select name="map"><option value="0">First attack</option><option value="1">Second attack</option><option value="2">Third attack</option></select>`,buttons:[{action:'attack',label:'Strike',callback:(_event,button)=>({section:Number(button.form.elements.section.value),strikeId:button.form.elements.strike.value,map:Number(button.form.elements.map.value)})}],rejectClose:false});
 if(!answer)return;const e=entries[answer.section],data={tokenId:token.id,regionId:e.region.id,index:e.index,strikeId:answer.strikeId,map:answer.map},gm=game.users.activeGM;
 if(!gm)throw new Error('An active GM is required');return gm.id===game.user.id?CONFIG.queries[query](data,{user:game.user}):gm.query(query,data);
}
