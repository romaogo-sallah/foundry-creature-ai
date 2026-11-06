import {readFile} from 'node:fs/promises';
import {fixture as baseFixture} from './ogre-fixture.mjs';
import {PF2eDeroMagisterAdapter} from '../../src/foundry/dero-magister-adapter.mjs';
import {installSpellRegionFixture} from './spell-regions.mjs';
export const deroData=JSON.parse(await readFile(new URL('../fixtures/dero-magister-mechanics.json',import.meta.url)));
export function fixture({saveDegree=1,size=14}={}){
 const f=baseFixture({npcData:deroData,Adapter:PF2eDeroMagisterAdapter,footprint:1,size});f.saveDegree=saveDegree;let sequence=0;
 globalThis.foundry={utils:{randomID:()=>`test${++sequence}`}};
 globalThis.ui={notifications:{warn:()=>{},info:()=>{},error:()=>{}}};game.time={worldTime:0};game.modules=new Map();
 const hooks=new Map();globalThis.Hooks={on:(name,fn)=>hooks.set(name,[...hooks.get(name)??[],fn]),
  off:(name,fn)=>hooks.set(name,(hooks.get(name)??[]).filter(callback=>callback!==fn)),
  callAll:(name,...args)=>{for(const fn of hooks.get(name)??[])fn(...args);}};f.hooks=hooks;
 f.player.actor.level=5;
 class DamageRoll{
  constructor(formula){this.formula=formula;this.total=10;this.instances=[{type:'void',total:10}];}
  async evaluate(){return this;}
  alter(n){const r=new DamageRoll(this.formula);r.total=this.total*n;r.instances[0].total=r.total;return r;}
  async toMessage(data){f.calls.push(['spell-damage-message',this.total,data]);}
 }
 globalThis.CONFIG={Dice:{rolls:[DamageRoll]}};
 installSpellRegionFixture(canvas.tokens.placeables);
 globalThis.Roll=class {async evaluate(){return {total:20,toMessage:async data=>f.calls.push(['flat-message',data])};}};
 for(const actor of [f.actor,f.player.actor]){
  actor.hitPoints.temp=0;
  const nativeDamage=actor.applyDamage;
  actor.applyDamage=async options=>{
   const amount=f.damageAfterIWR??Math.floor(options.damage.total);
   await nativeDamage({...options,damage:{...options.damage,total:amount}});
   Hooks.callAll('updateActor',actor,{}, {damageTaken:amount});
  };
  actor.flags={pf2e:{}};const values=new Map(),previous=new Set(),create=actor.createEmbeddedDocuments,remove=actor.deleteEmbeddedDocuments,getCondition=actor.getCondition;
  const rebuild=()=>{
   for(const slug of previous)actor.conditionsSet.delete(slug);previous.clear();values.clear();actor.flags.pf2e={};actor.flags['foundry-creature-ai']={};
   for(const effect of actor.itemTypes.effect)for(const rule of effect.system.rules??[]){
    if(rule.key==='ActiveEffectLike'){const [,namespace,key]=rule.path.split('.');(actor.flags[namespace]??={})[key]=rule.value;}
    if(rule.key!=='GrantItem')continue;
    const names={xYTAsEpcJE1Ccni3:'slowed',e1XGnhKNSQIm5IXg:'stupefied',XgEqL1kFApUbl5Z2:'blinded',MIRkyAjyBeXivMa7:'enfeebled',TkIyaNPgTZFBCCuh:'dazzled',yblD8fOR1J8rDwEQ:'confused'};
    const slug=names[rule.uuid.split('.').at(-1)];if(slug){actor.conditionsSet.add(slug);previous.add(slug);values.set(slug,Math.max(values.get(slug)??0,rule.alterations?.[0]?.value??1));}
   }
  };
  actor.getCondition=(slug,options)=>{const c=getCondition(slug,options);if(!values.has(slug))return c;
   return options?.all?c.map(e=>({...e,value:values.get(slug),inMemoryOnly:true})):{...c,value:values.get(slug),inMemoryOnly:true};};
  actor.createEmbeddedDocuments=async(...args)=>{const effects=await create(...args);
   for(const effect of effects){const update=effect.update;effect.update=async changes=>{await update(changes);rebuild();};}
   for(const effect of effects)for(const rule of effect.system.rules??[])if(rule.key==='TempHP'&&rule.value>actor.hitPoints.temp){
    actor.hitPoints.temp=rule.value;actor.system.attributes.hp.tempSource=effect.id;}
   rebuild();return effects;};
  actor.deleteEmbeddedDocuments=async(...args)=>{if(args[1].includes(actor.system.attributes.hp.tempSource)){
   actor.hitPoints.temp=0;delete actor.system.attributes.hp.tempSource;}
   await remove(...args);rebuild();};
  const get=actor.getStatistic;actor.getStatistic=slug=>{const stat=get(slug);
   if(['will','fortitude','reflex'].includes(slug))stat.check.roll=async options=>{
    f.calls.push(['spell-save',actor.id,slug,options]);return {degreeOfSuccess:f.saveDegree};};
   return stat;};
 }
 for(const type of ['spell','spellcastingEntry'])Object.defineProperty(f.actor.itemTypes,type,{get:()=>[...f.actor.items.values()].filter(i=>i.type===type)});
 for(const entry of f.actor.itemTypes.spellcastingEntry){entry.statistic={check:{mod:16},dc:{value:24}};
  entry.consume=async(spell,rank)=>{f.calls.push(['consume-spell',spell.slug,rank]);if(spell.isCantrip)return true;
   const slot=entry.system.slots[`slot${rank}`];if(!slot||slot.value<1)return false;slot.value--;return true;};}
 for(const item of f.actor.items.values()){
  item.uuid=`${f.actor.uuid}.Item.${item.id}`;
  if(item.type!=='spell')continue;
  item.isCantrip=item.traits.has('cantrip');item.rank=item.isCantrip?3:item.system.location.heightenedLevel??item.system.level.value;
  item.getOriginData=()=>({uuid:item.uuid});
  item.toMessage=async()=>({flags:{pf2e:{context:{options:[]}}},updateSource(){},toObject:()=>({flags:{pf2e:{}},content:item.name})});
  item.getDamage=async()=>({template:{damage:{roll:new DamageRoll('4d4[void]')}},context:{options:[]}});
 }
 f.flags.get('token-boss:foundry-creature-ai:config').entertaining=false;
 return f;
}
