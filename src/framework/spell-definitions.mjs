// Data-only spell components are shared by caster kits and manual resolvers.
// Native structured fields supply geometry/damage. Prose riders are taught
// explicitly: an unknown spell never becomes safe merely because it has dice.
const definitions=new Map();
const kinds=new Set(['condition-save','damage-attack','control-attack','basic-save','ground-control','save','auto','heal','ward','maneuver','attack','buff','lingering','counteract']);
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
 data.role??=['heal','ward','buff'].includes(data.kind)?'support':['ground-control','control-attack','counteract'].includes(data.kind)?'control':'damage';
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
 {slug:'void-warp',kind:'condition-save',save:'fortitude',range:30,damage:true,living:true},
 {slug:'vampiric-feast',kind:'condition-save',save:'fortitude',range:5,damage:true,drain:true,living:true,role:'drain'},
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
 {slug:'dominate',kind:'save',save:'will',role:'control',domination:true,range:30,duration:86400,
  outcomes:[{damage:0,utility:28,controlled:true},{damage:0,utility:20,controlled:true},{damage:0,conditions:[{slug:'stunned',value:1}]},{damage:0}]},
 {slug:'fireball',kind:'save',save:'reflex',area:{type:'burst',value:20},outcomes:basic},
 {slug:'lightning-bolt',kind:'save',save:'reflex',area:{type:'line',value:120},outcomes:basic},
 {slug:'vision-of-death',kind:'save',save:'will',deathAtZero:true,living:true,outcomes:[
  {damage:2,conditions:[{slug:'frightened',value:4},{slug:'fleeing'}]},{damage:1,conditions:[{slug:'frightened',value:2}]},{damage:0.5,conditions:[{slug:'frightened',value:1}]},{damage:0}],endOnRecovery:'frightened'},
 {slug:'enfeeble',kind:'save',save:'fortitude',role:'control',duration:60,outcomes:[
  {damage:0,conditions:[{slug:'enfeebled',value:3}]},{damage:0,conditions:[{slug:'enfeebled',value:2}]},{damage:0,conditions:[{slug:'enfeebled'}],until:'caster-start',duration:6},{damage:0}]},
 {slug:'frostbite',kind:'save',save:'fortitude',outcomes:basic,weakness:{degree:0,type:'bludgeoning',perRank:1,until:'caster-start'}},
 {slug:'dizzying-colors',kind:'save',save:'will',role:'control',area:{type:'cone',value:15},outcomes:[
  {damage:0,conditions:[{slug:'blinded'}],duration:60,noActions:true,noActionsDuration:6},
  {damage:0,conditions:[{slug:'stunned'},{slug:'blinded'},{slug:'dazzled'}],duration:60,conditionDurations:{blinded:6}},
  {damage:0,conditions:[{slug:'dazzled'}],duration:6,until:'caster-start'},{damage:0}]},
 {slug:'haste',kind:'buff',role:'support',duration:60,effectId:'ElkXovNrHB0Doi6O'},
 {slug:'blur',kind:'buff',role:'support',duration:60,condition:'concealed',hideAllowed:false},
 {slug:'invisibility',kind:'buff',role:'support',duration:600,condition:'invisible'},
 {slug:'fleet-step',kind:'buff',duration:60,selfOnly:true,effectId:'ThFug45WHkQQXcoF'},
 {slug:'fire-shield',kind:'buff',duration:60,selfOnly:true,effectId:'1RsScTvNdGD9zGWe'},
 {slug:'floating-flame',kind:'lingering',save:'reflex',range:30,duration:60,sustained:true,outcomes:basic},
 {slug:'wall-of-fire',kind:'lingering',range:120,duration:60,wall:true},
 {slug:'dispel-magic',kind:'counteract',range:120},
 {slug:'chain-lightning',kind:'save',save:'reflex',chain:true,maxTargets:12,outcomes:basic},
 {slug:'vampiric-exsanguination',kind:'save',save:'fortitude',living:true,deathAtZero:true,drain:true,role:'drain',area:{type:'cone',value:30},outcomes:basic},
 {slug:'howling-blizzard',kind:'save',save:'reflex',actionCosts:[2,3],area:{type:'cone',value:60},outcomes:basic,blizzard:true},
 {slug:'toxic-cloud',kind:'lingering',save:'fortitude',duration:60,cloud:true,actionCosts:[3],outcomes:basic},
 {slug:'mist',kind:'lingering',duration:60,cloud:true,role:'support'},
 {slug:'wall-of-ice',kind:'lingering',duration:60,wall:true,ice:true,actionCosts:[3]},
 {slug:'fear',kind:'save',save:'will',role:'control',outcomes:[{conditions:[{slug:'frightened',value:3},{slug:'fleeing'}],conditionDurations:{fleeing:6}},
  {conditions:[{slug:'frightened',value:2}]},{conditions:[{slug:'frightened',value:1}]},{}]},
 {slug:'revealing-light',kind:'save',save:'reflex',role:'control',reveal:true,outcomes:[{conditions:[{slug:'dazzled'}],duration:600},{conditions:[{slug:'dazzled'}],duration:60},{conditions:[{slug:'dazzled'}],duration:12},{}]},
 {slug:'mountain-resilience',kind:'buff',duration:1200,effectId:'JHpYudY14g0H4VWU'},
 {slug:'fly',kind:'buff',duration:300,effectId:'MuRBCiZn5IKeaoxi'},
 {slug:'false-vitality',kind:'buff',selfOnly:true,duration:28800,effectId:'PANUWN5xXC20WBg2'},
 {slug:'resist-energy',kind:'buff',duration:600,energyWard:true},
 {slug:'see-the-unseen',kind:'buff',selfOnly:true,duration:600,effectId:'T5bk6UH7yuYog1Fp'},
 {slug:'sure-strike',kind:'buff',selfOnly:true,duration:6,actionCosts:[1],effectId:'fpGDAz2v5PG0zUSl'},
 {slug:'shield',kind:'buff',selfOnly:true,duration:6,actionCosts:[1],effectId:'Jemq5UknGdMO7b73'},
 {slug:'translocate',kind:'buff',selfOnly:true,teleport:true},
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
