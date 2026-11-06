import {isTrueVampire,vampireState} from './vampire-state.mjs';
import {setVampireForm} from './vampire-lifecycle.mjs';
import {escapeHTML} from './rules-context.mjs';
const ns='foundry-creature-ai';
export async function configureVampire(token,{sunlight=false,sunlightValue,staked=false,destroyed=false,coffin=false}={}){
 if(!isTrueVampire(token?.actor))throw new Error('Select a true vampire');
 const actor=token.actor,state=vampireState(actor),ids=(actor.itemTypes.effect??[]).filter(e=>e.flags?.[ns]?.vampireVulnerability).map(e=>e.id);
 sunlightValue=sunlight?sunlightValue??(state.sunlight?state.sunlightValue:1)??1:0;
 if(ids.length)await actor.deleteEmbeddedDocuments('Item',ids);
 const rules=[...sunlight?[{key:'GrantItem',uuid:'Compendium.pf2e.conditionitems.Item.xYTAsEpcJE1Ccni3',inMemoryOnly:true,alterations:[{mode:'override',property:'badge-value',value:sunlightValue}]}]:[],
  ...staked?[{key:'GrantItem',uuid:'Compendium.pf2e.conditionitems.Item.fBnFDH2MTzgFijKf',inMemoryOnly:true}]:[]];
 if(rules.length)await actor.createEmbeddedDocuments('Item',[{name:'Vampire vulnerabilities',type:'effect',img:'icons/svg/sun.svg',
  system:{slug:'marked-vampire-vulnerabilities',duration:{value:-1,unit:'unlimited',expiry:null,sustained:false},rules},flags:{[ns]:{vampireVulnerability:true}}}]);
 if(staked&&state.form==='mist')await setVampireForm(token,'vampire');
 await actor.setFlag(ns,'vampire',{...vampireState(actor),sunlight,sunlightValue,staked,destroyed,coffin,...staked||destroyed?{escape:false}:{},
  restoreAt:coffin&&!staked&&!destroyed&&actor.hitPoints.value<=0?state.restoreAt??game.time.worldTime+3600:null});
 if(staked||destroyed)await actor.update({'system.attributes.hp.value':0});
}
export async function advanceVampireState(token,phase,{round=game.combat?.round}={}){
 const actor=token?.actor;if(!isTrueVampire(actor))return;const state=vampireState(actor);
 if(phase==='end'&&state.sunlight&&!state.destroyed){
  const stamp=`${game.combat?.id}:${round}`;if(state.sunlightLastEnd===stamp)return;
  const sunlightValue=(state.sunlightValue??1)+1,actions=(actor.system.traits.value.includes('minion')?2:3)+Number(actor.hasCondition('quickened'));
  await configureVampire(token,{...state,sunlightValue,destroyed:sunlightValue>=actions});
  await actor.setFlag(ns,'vampire',{...vampireState(actor),sunlightLastEnd:stamp});return;
 }
 if(phase==='time'&&state.coffin&&!state.staked&&!state.destroyed&&state.restoreAt!=null&&game.time.worldTime>=state.restoreAt){
  await setVampireForm(token,'vampire');
  await actor.setFlag(ns,'vampire',{...vampireState(actor),escapeTriggered:false,restoreAt:null});
  await actor.update({'system.attributes.hp.value':1});
 }
}
export function installVampireControls({reactions,onError}){
 for(const phase of ['start','end'])Hooks.on(`pf2e.${phase}Turn`,(c,combat)=>{if(game.users.activeGM?.id===game.user.id)
  void reactions.resolve(()=>advanceVampireState(canvas.tokens.get(c.tokenId),phase,{round:phase==='end'?c.getFlag?.('pf2e','roundOfLastTurnEnd')??combat.round:combat.round})).catch(onError);});
 Hooks.on('updateWorldTime',()=>{if(game.users.activeGM?.id===game.user.id)void reactions.resolve(async()=>{
  for(const token of canvas.tokens.placeables)await advanceVampireState(token,'time');}).catch(onError);});
}
export async function openVampireControls(token=canvas.tokens.controlled[0]){
 if(!game.user.isGM||!isTrueVampire(token?.actor))throw new Error('Select a true vampire as GM');
 const s=vampireState(token.actor),answer=await foundry.applications.api.DialogV2.wait({window:{title:`Vampire — ${token.name}`},
  content:`<p>Mark actual states explicitly. Scene lighting does not imply direct sunlight. Sunlight Slows 1 immediately, increasing at every exposed turn end; losing all actions destroys the vampire.</p>
   ${[['sunlight','Direct sunlight'],['staked','Staked through the heart (unconscious; no healing)'],['destroyed','Fully destroyed (ends its Dominate effects)'],['coffin','Actually resting in its coffin (one-hour restoration)']].map(([key,label])=>`<label><input type="checkbox" name="${key}" ${s[key]?'checked':''}> ${escapeHTML(label)}</label>`).join('')}
   <p>Changing form costs one action in manual play. Mist Escape happens at 0 HP and seeks a scene border; reaching that border does not imply arrival at the coffin.</p>`,
  buttons:[{action:'save',label:'Save states',callback:(_e,b)=>Object.fromEntries(['sunlight','staked','destroyed','coffin'].map(k=>[k,b.form.elements[k].checked]))},
   {action:'vampire',label:'Vampire form'},{action:'bat',label:'Giant bat'},{action:'mist',label:'Turn to Mist'}],rejectClose:false});
 if(!answer)return;
 const runtime=game.modules.get('pf2e-tactical-core').api.runtime;
 return runtime.reactions.resolve(()=>typeof answer==='string'?setVampireForm(token,answer):configureVampire(token,answer));
}
