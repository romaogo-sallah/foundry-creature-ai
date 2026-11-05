import {actionRestriction} from './action-restrictions.mjs';
import {valuedStunned} from './action-economy.mjs';
import {combatStamp} from './combat-stamp.mjs';
const ns='foundry-creature-ai',query=`${ns}.conditionAction`;
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let resolver;
export function retchSource(actor){
  const condition=actor.getCondition?.('sickened');if(!condition)return null;
  const dc=condition.getFlag?.(ns,'dc')??condition.getFlag?.('pf2e-automations','dc');
  return {id:condition.id,value:condition.value,dc,bonus:actor.getStatistic?.('fortitude')?.check?.mod,
    available:Number.isFinite(dc)&&dc>0&&Number.isFinite(actor.getStatistic?.('fortitude')?.check?.mod)&&!condition.isLocked&&!condition.readonly&&!condition.inMemoryOnly&&condition.getFlag?.(ns,'noRetch')!==true};
}
export async function executeRetch(token,{valid=()=>true}={}){
  const actor=token.actor,source=retchSource(actor),denied=actionRestriction(actor);
  if(denied)throw new Error(denied.reason);
  if(!source?.available)throw new Error('Retch needs an unlocked Sickened condition and its source DC in Condition actions.');
  const roll=await actor.getStatistic('fortitude').check.roll({skipDialog:true,token:token.document,action:'retch',
    dc:{value:source.dc},label:'Retch: recover from Sickened',extraRollOptions:[`${ns}:managed`,'action:retch','skip-handling-message']});
  if(!Number.isInteger(roll?.degreeOfSuccess))throw new Error('Retch was cancelled or unresolved; its action remains spent.');
  if(!valid()||retchSource(actor)?.id!==source.id)throw new Error('The Sickened source or turn changed during Retch.');
  const amount=roll.degreeOfSuccess===3?2:roll.degreeOfSuccess===2?1:0;
  for(let i=0;i<amount&&actor.getCondition('sickened')?.id===source.id;i++)await actor.decreaseCondition(actor.getCondition('sickened'));
  return {resolved:true,lastAction:{kind:'retch'},note:amount?`Retch reduces Sickened by ${amount}.`:'Retch failed; the action remains spent.'};
}
export async function payManualStunned(actor,remaining){
  if(!Number.isInteger(remaining)||remaining<0||remaining>4)throw new Error('Enter 0–4 remaining actions, including any restricted extra action.');
  const condition=valuedStunned(actor);
  if(!condition||condition.isLocked||condition.readonly||condition.inMemoryOnly)throw new Error('This Stunned source needs manual adjudication.');
  const lost=Math.min(remaining,condition.value);
  for(let i=0;i<lost;i++)await actor.decreaseCondition(actor.getCondition('stunned'));
  ui.notifications.info(`${actor.name}: ${lost} actions lost to Stunned; ${remaining-lost} remain. Lose restricted extra actions first if useful.`);
  return {lost,remaining:remaining-lost};
}
async function receive(data,user){
  if(game.users.activeGM?.id!==game.user.id||canvas.scene?.id!==data.sceneId||combatStamp()!==data.stamp)throw new Error('The scene or combat turn changed.');
  const token=canvas.tokens.get(data.tokenId),actor=token?.actor;
  if(!actor||!user?.active||!user.isGM&&!actor.testUserPermission(user,'OWNER'))throw new Error('You do not own this creature.');
  if(data.action==='configure'){
    if(!user.isGM)throw new Error('Only the GM can set condition sources or DCs.');
    const source=actor.getCondition('sickened');
    if(source&&data.dc!==null){if(!Number.isFinite(data.dc)||data.dc<=0||data.dc>100)throw new Error('Enter a valid source DC.');await source.setFlag(ns,'dc',data.dc);}
    if(data.subjectId&&!canvas.tokens.get(data.subjectId))throw new Error('The fascination subject is unavailable.');
    await actor.setFlag(ns,'conditionContext',{fascinationSubjects:data.subjectId?[data.subjectId]:[]});return;
  }
  if(game.combat?.started&&game.combat.combatant?.tokenId!==token.id)throw new Error('Use this action on your creature’s turn.');
  if(data.action==='retch')return executeRetch(token,{valid:()=>combatStamp()===data.stamp&&canvas.tokens.get(token.id)===token});
  if(data.action==='stunned')return payManualStunned(actor,data.remaining);
  throw new Error('Unknown condition action.');
}
export function installConditionActions({reactions}){
  CONFIG.queries??={};resolver=(data,user)=>reactions.resolve(()=>receive(data,user));CONFIG.queries[query]=resolver;
}
export async function openConditionActions(token=canvas.tokens.controlled[0]){
  if(!token?.actor||!game.user.isGM&&!token.actor.testUserPermission(game.user,'OWNER'))throw new Error('Select a creature you own.');
  const actor=token.actor,source=retchSource(actor),subject=actor.getFlag(ns,'conditionContext')?.fascinationSubjects?.[0];
  const stamp=combatStamp(),sceneId=canvas.scene.id;
  const answer=await foundry.applications.api.DialogV2.wait({window:{title:`Condition actions — ${token.name}`},
    content:`<p>Retch costs one action and uses your Fortitude save. Stunned resolution uses the actions left after your current activity finishes. Manual action counts remain yours to track.</p>
    ${game.user.isGM?`<label>Sickened source DC <input name="dc" type="number" min="1" max="100" value="${Number.isFinite(source?.dc)?source.dc:''}"></label>
    <label>Subject of fascination <select name="subject"><option value="">Unknown / adjudicate</option>${canvas.tokens.placeables.filter(t=>t!==token&&t.actor).map(t=>`<option value="${t.id}" ${t.id===subject?'selected':''}>${escape(t.name)}</option>`).join('')}</select></label>`:`<p>Sickened source DC: ${source?.dc??'ask the GM to configure it'}.</p>`}
    <label>Remaining actions for Stunned <input name="remaining" type="number" min="0" max="4" value="3"></label>`,
    buttons:[...game.user.isGM?[{action:'configure',label:'Save source / DC',callback:(_event,button)=>({action:'configure',dc:button.form.elements.dc.value?button.form.elements.dc.valueAsNumber:null,subjectId:button.form.elements.subject.value})}]:[],
      {action:'retch',label:'Retch',disabled:!source?.available},{action:'stunned',label:'Resolve Stunned',disabled:!valuedStunned(actor),callback:(_event,button)=>({action:'stunned',remaining:button.form.elements.remaining.valueAsNumber})}],rejectClose:false});
  if(!answer)return;const data={...typeof answer==='string'?{action:answer}:answer,tokenId:token.id,sceneId,stamp};
  const gm=game.users.activeGM;if(!gm)throw new Error('An active GM is required.');
  return gm.id===game.user.id?resolver(data,game.user):gm.query(query,data);
}
