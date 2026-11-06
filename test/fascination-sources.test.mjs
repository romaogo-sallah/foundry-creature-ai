import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceFascination,installFascinationSources} from '../src/foundry/fascination-sources.mjs';
const ns='foundry-creature-ai',uuid='Compendium.pf2e.conditionitems.Item.fascinated-id';
function setup(){
 const items=new Map(),flags=new Map(),calls=[],hooks=new Map();
 const actor={items,getFlag:(_ns,key)=>flags.get(key),setFlag:async(_ns,key,value)=>flags.set(key,structuredClone(value)),
  deleteEmbeddedDocuments:async(_type,ids)=>{for(const id of ids){calls.push(['delete',id]);items.delete(id);}},
  conditions:{bySlug:()=>[...items.values()].flatMap(item=>item.type==='condition'?[item]:
   item.system.rules.some(rule=>rule.uuid===uuid&&!rule.ignored)?[{id:`virtual-${item.id}`,slug:'fascinated',type:'condition',actor,appliedBy:item}]:[])},
 };
 const tokens=[{id:'old-caster',document:{uuid:'Scene.scene.Token.old-caster'},actor:{uuid:'Actor.old-caster'}},
  {id:'new-caster',document:{uuid:'Scene.scene.Token.new-caster'},actor:{uuid:'Actor.new-caster'}}];
 globalThis.canvas={tokens:{placeables:tokens,get:id=>tokens.find(t=>t.id===id)}};
 globalThis.game={pf2e:{ConditionManager:{getCondition:()=>({sourceId:uuid})}},user:{id:'gm'},users:{activeGM:{id:'gm'}}};
 globalThis.Hooks={on:(name,fn)=>{hooks.set(name,fn);}};
 function item(id,{condition=false,origin=null,extra=true}={}){
  const result={id,actor,type:condition?'condition':'effect',slug:condition?'fascinated':id,flags:{},
   system:{rules:condition?[]:[{key:'GrantItem',uuid,inMemoryOnly:true},...extra?[{key:'FlatModifier',selector:'ac',value:1}]:[]],context:{origin:origin?{token:`Scene.scene.Token.${origin}`}:{}}},
   update:async changes=>{calls.push(['update',id,changes]);for(const [path,value]of Object.entries(changes)){
    const keys=path.split('.');let target=result;for(const key of keys.slice(0,-1))target=target[key]??={};
    const last=keys.at(-1);if(last.startsWith('-='))delete target[last.slice(2)];else target[last]=value;
   }},
  };items.set(id,result);return result;
 }
 return {actor,items,flags,calls,hooks,item};
}
test('new fascination replaces an older ordinary condition and records its new subject',async()=>{
 const f=setup();f.item('old',{condition:true});const latest=f.item('latest',{origin:'new-caster'});
 f.flags.set('conditionContext',{fascinationSubjects:['old-caster'],fleeingSourceId:'threat'});
 await replaceFascination(f.actor,latest);
 assert.equal(f.items.has('old'),false);assert.deepEqual(f.flags.get('conditionContext'),{fascinationSourceId:'latest',fascinationSubjects:['new-caster'],fleeingSourceId:'threat'});
});
test('replacing a granted fascination disables only that grant and preserves the parent spell and other rules',async()=>{
 const f=setup(),old=f.item('old',{origin:'old-caster'}),latest=f.item('latest',{origin:'new-caster'});
 await replaceFascination(f.actor,latest);
 assert.equal(f.items.get(old.id),old);assert.equal(old.system.rules[0].ignored,true);
 assert.deepEqual(old.system.rules[1],{key:'FlatModifier',selector:'ac',value:1});
 f.items.delete(latest.id);assert.equal(f.actor.conditions.bySlug().length,0,'expired new fascination never revives the superseded source');
});
test('serialized simultaneous sources finish with the newest event, and repeated events do not clear a configured subject',async()=>{
 const f=setup(),first=f.item('first'),second=f.item('second',{origin:'new-caster'});
 await Promise.all([replaceFascination(f.actor,first),replaceFascination(f.actor,second)]);
 // Both sources already exist in this synthetic batch, just as native batch
 // creation prepares all documents before issuing its individual hooks.
 assert.equal(f.flags.get('conditionContext').fascinationSourceId,'second');
 f.flags.get('conditionContext').fascinationSubjects=['old-caster'];
 await replaceFascination(f.actor,second);assert.deepEqual(f.flags.get('conditionContext').fascinationSubjects,['old-caster']);
});
test('the first native batch create event cannot disable a later prepared source before its own create event',async()=>{
 const f=setup(),first=f.item('first'),second=f.item('second');
 await replaceFascination(f.actor,first,{created:true});assert.notEqual(second.system.rules[0].ignored,true);
 await replaceFascination(f.actor,second,{created:true});
 assert.equal(first.system.rules[0].ignored,true);assert.equal(f.flags.get('conditionContext').fascinationSourceId,'second');
});
test('an unknown new fascination subject clears the old subject instead of inheriting it',async()=>{
 const f=setup();f.flags.set('conditionContext',{fascinationSubjects:['old-caster']});
 await replaceFascination(f.actor,f.item('unknown',{condition:true}));
 assert.deepEqual(f.flags.get('conditionContext').fascinationSubjects,[]);
});
test('an effect whose conditional Fascinated grant did not apply cannot replace existing fascination',async()=>{
 const f=setup(),old=f.item('old',{condition:true}),conditional=f.item('conditional');
 f.actor.conditions.bySlug=()=>[old];
 assert.equal(await replaceFascination(f.actor,conditional),null);
 assert.equal(f.items.has(old.id),true);assert.equal(f.flags.get('conditionContext'),undefined);
});
test('persisted granted Fascinated detaches its own native links without deleting its parent or unrelated grants',async()=>{
 const f=setup(),old=f.item('old'),child=f.item('granted',{condition:true}),latest=f.item('latest');
 child.appliedBy=old;child.flags.pf2e={grantedBy:{id:'old',onDelete:'cascade'}};
 old.flags.pf2e={itemGrants:{fascinated:{id:'granted',onDelete:'restrict'},other:{id:'other',onDelete:'cascade'}}};
 await replaceFascination(f.actor,latest);
 assert.equal(f.items.has(child.id),false);assert.equal(f.items.has(old.id),true);
 assert.equal(old.flags.pf2e.itemGrants.fascinated,undefined);assert.ok(old.flags.pf2e.itemGrants.other);
 assert.equal(child.flags.pf2e.grantedBy,undefined);
});
test('native creation hooks send source replacement through the shared reaction barrier',async()=>{
 const f=setup(),pending=[];installFascinationSources({reactions:{resolve:fn=>{const task=fn();pending.push(task);return task;}},onError:error=>{throw error;}});
 const old=f.item('old',{condition:true}),latest=f.item('latest',{origin:'new-caster'});
 f.hooks.get('createItem')(latest);await Promise.all(pending);
 assert.equal(f.items.has(old.id),false);assert.equal(f.flags.get('conditionContext').fascinationSourceId,latest.id);
});
