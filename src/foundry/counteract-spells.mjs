import {detectionFor} from './stealth-awareness.mjs';
import {clearSightPath,clearAttackPath} from './attack-path.mjs';
import {escapingMist} from './vampire-state.mjs';
const ns='foundry-creature-ai';
export function liveDispelTarget(adapter,id,effectUuid){
 const token=canvas.tokens.get(id);
 if(!token?.actor||token.document.hidden||escapingMist(token.actor)||token.actor.hitPoints?.value<=0||
   detectionFor(adapter.token,token).state!=='observed'||!clearSightPath(adapter.token,token)||!clearAttackPath(adapter.token,token))return null;
 return (token.actor.itemTypes.effect??[]).some(e=>e.uuid===effectUuid)?token:null;
}
// Only effects with an explicit, taught magical source are offered. Their
// actual rank/DC is resolved after commitment, never supplied to AI scoring.
export function visibleDispelTargets(adapter){
 return canvas.tokens.placeables.filter(t=>t.actor&&!t.document.hidden&&!escapingMist(t.actor)&&t.actor.hitPoints?.value>0&&detectionFor(adapter.token,t).state==='observed'&&clearSightPath(adapter.token,t)&&clearAttackPath(adapter.token,t)).flatMap(token=>
  (token.actor.itemTypes.effect??[]).filter(e=>e.system.context?.origin?.item&&(e.flags?.[ns]?.supportSpell||e.flags?.[ns]?.domination||e.flags?.[ns]?.definedSpell)&&
   (adapter.actor.isEnemyOf(token.actor)&&e.flags?.[ns]?.supportSpell||!adapter.actor.isEnemyOf(token.actor)&&!e.flags?.[ns]?.supportSpell||e.flags?.[ns]?.domination)).map(effect=>({
    id:effect.id,uuid:effect.uuid,targetId:token.id,distance:adapter.targetAt(adapter.originCell(),token,[],adapter.actualWaypoint()).distance,
    value:effect.flags?.[ns]?.domination?18:effect.flags?.[ns]?.supportSpell?.slug==='haste'?11:8})));
}
export async function executeCounteract(adapter,spell,entry,choice){
 const effect=await fromUuid(choice.effectUuid);if(!effect?.actor||effect.type!=='effect')return {resolved:true,note:'The selected magical effect ended before Dispel Magic resolved.'};
 const original=await fromUuid(effect.system.context?.origin?.item),dc=original?.spellcasting?.statistic?.dc?.value;
 if(!Number.isFinite(dc)||!entry.counteraction?.check?.roll)throw new Error('A native counteract statistic and spell source DC are required');
 const roll=await entry.counteraction.check.roll({skipDialog:true,dc:{value:dc},item:spell,token:adapter.token.document,
  label:`Dispel Magic: ${effect.name}`,extraRollOptions:[`${ns}:managed`,'skip-handling-message']});
 if(!Number.isInteger(roll?.degreeOfSuccess))throw new Error('Counteract check was unresolved');
 const rank=effect.level??effect.system.level.value,maxRank=[-1,spell.rank-1,spell.rank+1,spell.rank+3][roll.degreeOfSuccess];
 if(rank<=maxRank)await effect.actor.deleteEmbeddedDocuments('Item',[effect.id]);
 return {resolved:true,lastAction:{kind:'castSpell',spellId:spell.id},note:rank<=maxRank?'Dispel Magic counteracted the taught source effect.':'Dispel Magic did not counteract this source.'};
}
