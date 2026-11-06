// Data-only spell components are shared by caster kits and manual resolvers.
// Native structured fields supply geometry/damage. Prose riders are taught
// explicitly: an unknown spell never becomes safe merely because it has dice.
const definitions=new Map();
const kinds=new Set(['condition-save','damage-attack','control-attack','basic-save','ground-control','save','auto','heal','ward','maneuver','attack']);
const saves=new Set(['fortitude','reflex','will']);
export function defineSpell(input){
 const data=structuredClone(input);
 if(!/^[a-z0-9][a-z0-9-]*$/.test(data.slug??'')||!kinds.has(data.kind))throw new Error('Spell definition needs a slug and supported kind');
 data.actionCosts??=[2];if(!Array.isArray(data.actionCosts)||!data.actionCosts.length||data.actionCosts.some(n=>!Number.isInteger(n)||n<1||n>3))throw new Error('Spell action costs must be 1, 2 or 3');
 if(data.sustained)data.sustainCost=1;
 if(data.save&&!saves.has(data.save))throw new Error('Spell save must be Fortitude, Reflex or Will');
 if(data.kind==='save'&&!data.save)throw new Error('Save spell needs a defense');
 if(data.kind==='save'&&!data.outcomes)throw new Error('Save spell needs an explicit outcome table');
 if(data.kind==='attack'&&!data.outcomes)data.outcomes=[{damage:0},{damage:0},{damage:1},{damage:2}];
 if(data.maxTargets!=null&&(!Number.isInteger(data.maxTargets)||data.maxTargets<1||data.maxTargets>12))throw new Error('Target count must be 1..12');
 if(data.outcomes){if(!Array.isArray(data.outcomes)||data.outcomes.length!==4)throw new Error('Spell outcomes must list critical failure through critical success');
  for(const outcome of data.outcomes){if(!Number.isFinite(outcome.damage??0)||(outcome.damage??0)<0||(outcome.damage??0)>4)throw new Error('Invalid damage multiplier');
   if(outcome.until&&!['caster-start','caster-end','target-start','target-end'].includes(outcome.until))throw new Error('Unsupported spell expiry phase');
   if(outcome.utility!=null&&(!Number.isFinite(outcome.utility)||outcome.utility<0||outcome.utility>30))throw new Error('Invalid outcome utility');
   for(const c of outcome.conditions??[])if(!/^[a-z][a-z-]*$/.test(c.slug??'')||!Number.isInteger(c.value??1)||(c.value??1)<1||(c.value??1)>10)throw new Error('Invalid spell condition');}}
 if(data.duration!=null&&(!Number.isFinite(data.duration)||data.duration<0||data.duration>86400))throw new Error('Spell duration must be 0..86400 seconds');
 if(data.range!=null&&(!Number.isFinite(data.range)||data.range<0||data.range>30000))throw new Error('Invalid spell range');
 if(data.area&&(!['cone','line','burst'].includes(data.area.type)||!Number.isFinite(data.area.value)||data.area.value<=0||data.area.value>500))throw new Error('Unsupported spell area');
 if(data.persistent&&(!/^[\d\sd@rank()+*\-\/]+$/.test(data.persistent.formula??'')||!Array.isArray(data.persistent.degrees)||data.persistent.degrees.some(n=>!Number.isInteger(n)||n<0||n>3)))throw new Error('Invalid persistent damage formula or outcomes');
 if(data.persistent&&!['mental','bleed','fire','acid','poison','cold','electricity','void','vitality','sonic','force','spirit'].includes(data.persistent.type))throw new Error('Unsupported persistent damage type');
 data.role??=['heal','ward'].includes(data.kind)?'support':data.kind==='ground-control'||data.kind==='control-attack'?'control':'damage';
 if(!['control','damage','drain','support'].includes(data.role))throw new Error('Unknown spell role');
 data.resolver??=data.kind==='condition-save'?'legacy-condition':['damage-attack','control-attack'].includes(data.kind)?'legacy-attack':data.kind==='ground-control'?'grease':data.kind==='basic-save'?'legacy-area':'outcomes';
 if(!['legacy-condition','legacy-attack','grease','legacy-area','outcomes'].includes(data.resolver))throw new Error('Unknown spell resolver');
 return Object.freeze(data);
}
export function registerSpellDefinition(input){const data=defineSpell(input);definitions.set(data.slug,data);return data;}
export const spellDefinition=spell=>definitions.get(typeof spell==='string'?spell:spell?.slug??spell?.system?.slug)??null;
export const spellDefinitions=()=>[...definitions.values()].map(d=>structuredClone(d));
export const spellChoiceFields=spell=>({entryId:spell.entryId,castRank:spell.castRank,slotId:spell.slotId,bindingId:spell.bindingId,
 poolId:spell.poolId,resourceRemaining:spell.resourceRemaining,resourceCost:spell.resourceCost,traits:spell.traits});
export function replaceCustomSpellDefinitions(entries=[]){
 definitions.clear();for(const [key,value]of builtinDefinitions)definitions.set(key,value);
 for(const entry of entries)registerSpellDefinition({...entry,custom:true});
}
const basic=[{damage:2},{damage:1},{damage:0.5},{damage:0}];
for(const data of [
 {slug:'laughing-fit',kind:'condition-save',save:'will',range:30,sustained:true,role:'control'},
 {slug:'stupefy',kind:'condition-save',save:'will',range:30,role:'control'},
 {slug:'blindness',kind:'condition-save',save:'fortitude',range:30,role:'control'},
 {slug:'void-warp',kind:'condition-save',save:'fortitude',range:30,damage:true},
 {slug:'vampiric-feast',kind:'condition-save',save:'fortitude',range:5,damage:true,drain:true,role:'drain'},
 {slug:'ignition',kind:'damage-attack'}, {slug:'tangle-vine',kind:'control-attack'},
 {slug:'breathe-fire',kind:'basic-save',area:{type:'cone',value:15}}, {slug:'grease',kind:'ground-control',range:30},
 {slug:'daze',kind:'save',save:'will',outcomes:[{damage:2,conditions:[{slug:'stunned',value:1}]},...basic.slice(1)]},
 {slug:'force-barrage',kind:'auto',actionCosts:[1,2,3],perAction:true,shards:true},
 {slug:'grim-tendrils',kind:'save',save:'fortitude',living:true,area:{type:'line',value:30},outcomes:basic,
  persistent:{type:'bleed',formula:'@rank',degrees:[0,1],criticalDouble:true}},
 {slug:'phantom-pain',kind:'save',save:'will',duration:60,
  outcomes:[{damage:1,conditions:[{slug:'sickened',value:2}]},{damage:1,conditions:[{slug:'sickened',value:1}]},{damage:1},{damage:0}],
  persistent:{type:'mental',formula:'@rankd4',degrees:[0,1]},endOnRecovery:'sickened'},
 {slug:'soothe',kind:'heal',role:'support',duration:60,mentalDefense:2},
 {slug:'forbidding-ward',kind:'ward',role:'support',sustained:true,duration:60,wardBonus:1},
 {slug:'telekinetic-maneuver',kind:'maneuver',role:'control',maneuver:'trip'},
 {slug:'paranoia',kind:'save',save:'will',role:'control',duration:60,groupOnly:true,outcomes:[
  {damage:0,noAllies:true,hostileReactions:true,utility:9},{damage:0,noAllies:true,utility:6},{damage:0,noAllies:true,utility:3,duration:6,until:'caster-start'},{damage:0}]},
])registerSpellDefinition(data);
const builtinDefinitions=new Map(definitions);

export function constructSpellDefinition(spell,{kind,...overrides}={}){
 const native=spell.system??{},save=native.defense?.save?.statistic;
 const taught=spellDefinition(spell);kind??=taught?.kind??(save?'save':spell.isAttack?'attack':Object.values(native.damage??{}).some(d=>d.kinds?.includes('healing'))?'heal':'auto');
 const text=native.duration?.value??'',match=text.match(/^(\d+)\s*(round|minute|hour)s?$/),duration=match?Number(match[1])*({round:6,minute:60,hour:3600}[match[2]]):null;
 const range=native.range?.value==='touch'?5:Number.parseFloat(native.range?.value??'');
 return defineSpell({...taught,slug:spell.slug??native.slug,kind,actionCosts:taught?.actionCosts??(/^[123]$/.test(native.time?.value)?[Number(native.time.value)]:[2]),
  ...Number.isFinite(range)?{range}:{},...native.area?{area:native.area}:{},...duration?{duration}:{},...native.duration?.sustained?{sustained:true}:{},
  ...save?{save}:{},...native.defense?.save?.basic?{outcomes:basic}:{},...overrides});
}
