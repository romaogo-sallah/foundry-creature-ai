import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/modular-caster-fixture.mjs';
import {executeSpell} from '../src/foundry/spellcasting.mjs';
import {genericCastingCandidates} from '../src/framework/generic-casting.mjs';
import {conditionCastingCandidates,conditionSpellValue} from '../src/framework/condition-spells.mjs';
import {observeSpellCast,observeSustain,witnessedSpellCasts,observePublicAttack,witnessedThreat} from '../src/foundry/spell-observations.mjs';
import {spellSaveProbabilities} from '../src/framework/spell-knowledge.mjs';
import {applyConditionSpell} from '../src/foundry/ongoing-spells.mjs';
import {tacticalBehaviors,chooseTacticalAction} from '../src/framework/tactical-behaviors.mjs';
import {installSpellRegionFixture} from './helpers/spell-regions.mjs';
const ns='foundry-creature-ai',spell=(f,slug)=>f.actor.itemTypes.spell.find(s=>s.slug===slug);
const source=f=>({actor:f.actor,token:f.boss});
async function state(f){const ledger=await f.adapter.readLedger(f.adapter.turnKey());return {ledger,state:await f.adapter.snapshot(ledger,{movement:false})};}

test('Soothe calls native healing with negative damage, item context and no unsupported multiplier',async()=>{
 const f=fixture();f.actor.hitPoints.value=30;const {ledger,state:s}=await state(f),choice=genericCastingCandidates(s).find(c=>c.spellSlug==='soothe');
 await executeSpell(f.adapter,choice,ledger);assert.equal(f.actor.hitPoints.value,40);
 const call=f.calls.find(c=>c[0]==='healing-applied')[3];assert.equal(call.damage,-10);assert.equal(call.item,spell(f,'soothe'));
 assert.equal('multiplier' in call,false);assert.equal(f.calls.some(c=>c[0]==='damage-applied'),false);
});
test('observed allied Blindness establishes immunity without learning the secret save result',async()=>{
 const f=fixture(),observer=f.addOgre('ally',400,400),blindObserver=f.addOgre('blind-ally',500,400);
 installSpellRegionFixture(canvas.tokens.placeables);
 blindObserver.actor.conditionsSet.add('blinded');
 await observeSpellCast({source:source(f),target:f.player,spell:spell(f,'blindness'),dc:24});
 const entries=witnessedSpellCasts(observer);assert.equal(entries.length,1);assert.equal(entries[0].immunity,true);
 assert.equal('degree' in entries[0],false);assert.equal(witnessedSpellCasts(blindObserver).length,0);
 const {state:s}=await state(f);s.spellAttempts=[];s.witnessedCasts=entries;
 assert.equal(conditionCastingCandidates(s).some(c=>c.spellSlug==='blindness'),false);
 f.player.actor.getStatistic=()=>{throw new Error('Hidden defenses must not be queried');};
 assert.equal(conditionCastingCandidates(s).some(c=>c.spellSlug==='blindness'),false);
 game.time.worldTime=60;assert.equal(witnessedSpellCasts(observer).length,0);
});
test('a stale choice with witnessed immunity spends neither casting resource nor save',async()=>{
 const f=fixture(),{ledger,state:s}=await state(f),choice=conditionCastingCandidates(s).find(c=>c.spellSlug==='blindness');
 await observeSpellCast({source:source(f),target:f.player,spell:spell(f,'blindness'),dc:24});
 const result=await executeSpell(f.adapter,choice,ledger);assert.equal(result.skipped,true);
 assert.equal(f.calls.some(c=>c[0]==='consume-spell'||c[0]==='spell-save'),false);
});
test('unwitnessed actual immunity resolves after commitment without another save or false success note',async()=>{
 const f=fixture(),blindness=spell(f,'blindness');await applyConditionSpell({source:source(f),target:f.player,spell:blindness,degree:3});
 const {ledger,state:s}=await state(f),choice=conditionCastingCandidates(s).find(c=>c.spellSlug==='blindness');
 const result=await executeSpell(f.adapter,choice,ledger);assert.match(result.note,/immunity prevented/i);
 assert.equal(f.calls.filter(c=>c[0]==='consume-spell').length,1);assert.equal(f.calls.some(c=>c[0]==='spell-save'),false);
 const refreshed=await state(f);assert.equal(conditionCastingCandidates(refreshed.state).some(c=>c.spellSlug==='blindness'),false);
});
test('allied Laughing Fit reduces expected duplicate control value without suppressing damage',async()=>{
 const f=fixture(),{state:s}=await state(f),descriptor=s.spells.find(s=>s.slug==='laughing-fit'),enemy=s.enemies[0];
 const before=conditionSpellValue(s,descriptor,enemy);
 await observeSpellCast({source:source(f),target:f.player,spell:spell(f,'laughing-fit'),dc:24,castId:'cast'});
 s.witnessedCasts=witnessedSpellCasts(f.boss);
 const after=conditionSpellValue(s,descriptor,enemy);assert.ok(after<before*0.4);assert.ok(after>=0);
 const warp=s.spells.find(s=>s.slug==='void-warp'),damage=conditionSpellValue({...s,witnessedCasts:[]},warp,enemy);
 assert.equal(conditionSpellValue(s,warp,enemy),damage);
});
test('Sustain extends witnessed control belief, which expires after the next caster turn if not maintained',async()=>{
 const f=fixture(),observer=f.addOgre('ally',400,400);
 await observeSpellCast({source:source(f),target:f.player,spell:spell(f,'laughing-fit'),dc:24,castId:'cast'});
 game.combat.round=2;game.combat.turn=0;await observeSustain(f.boss,{id:'cast'});
 game.combat.round=3;assert.equal(witnessedSpellCasts(observer).length,1);
 game.combat.turn=1;assert.equal(witnessedSpellCasts(observer).length,0);
});
test('spell observations expire across combat changes and do not share between opposing alliances',async()=>{
 const f=fixture(),enemy=f.addOgre('opponent',400,400);enemy.actor.alliance='party';
 await observeSpellCast({source:source(f),target:f.player,spell:spell(f,'blindness'),dc:24});
 assert.equal(witnessedSpellCasts(enemy).length,0);assert.equal(witnessedSpellCasts(f.boss).length,1);
 game.combat.id='new-combat';assert.equal(witnessedSpellCasts(f.boss).length,0);
});
test('only witnessed public Strikes supply uncertain strength estimates',async()=>{
 const f=fixture(),message={speaker:{scene:canvas.scene.id,token:f.player.id},flags:{pf2e:{context:{type:'attack-roll',action:'strike'}}},rolls:[{options:{totalModifier:19}}]};
 await observePublicAttack({...message,blind:true});await observePublicAttack({...message,whisper:['gm']});
 await observePublicAttack({...message,flags:{pf2e:{context:{type:'saving-throw'}}}});
 assert.equal(witnessedThreat(f.boss,f.player.id),undefined);
 f.actor.conditionsSet.add('blinded');await observePublicAttack(message);assert.equal(witnessedThreat(f.boss,f.player.id),undefined);
 f.actor.conditionsSet.delete('blinded');await observePublicAttack(message);
 const evidence=witnessedThreat(f.boss,f.player.id);assert.equal(evidence.estimatedLevel,9);assert.equal(evidence.levelUncertainty,2);
 f.player.actor.level=99;assert.equal(witnessedThreat(f.boss,f.player.id).estimatedLevel,9);
});
test('Incapacitation shifts estimated outcomes for strong opponents and never changes non-Incapacitation saves',()=>{
 const s={self:{referenceAC:23,level:5}},enemy={tactics:{estimatedLevel:7,levelUncertainty:0}},base={dc:24,save:'fortitude',castRank:3,traits:[]};
 const normal=spellSaveProbabilities(s,base,enemy),incap=spellSaveProbabilities(s,{...base,traits:['incapacitation']},enemy);
 assert.equal(incap.criticalFailure,0);assert.equal(incap.failure,normal.criticalFailure);
 assert.equal(incap.success,normal.failure);assert.equal(incap.criticalSuccess,normal.success+normal.criticalSuccess);
 assert.deepEqual(spellSaveProbabilities(s,base,{tactics:{estimatedLevel:50}}),normal);
 assert.deepEqual(spellSaveProbabilities(s,{...base,traits:['incapacitation'],castRank:4},enemy),normal);
 const uncertain=spellSaveProbabilities(s,{...base,traits:['incapacitation']},{tactics:{estimatedLevel:7,levelUncertainty:2}});
 assert.ok(uncertain.failure>=incap.failure);assert.ok(uncertain.criticalSuccess<incap.criticalSuccess);
});
test('brief Blindness is worth less when no allies act before the target next starts',async()=>{
 const f=fixture(),{state:s}=await state(f),blindness=s.spells.find(s=>s.slug==='blindness'),enemy=s.enemies[0];
 s.actionsRemaining=2;const short=conditionSpellValue(s,blindness,{...enemy,alliedTurnsBeforeNextStart:0});
 const useful=conditionSpellValue(s,blindness,{...enemy,alliedTurnsBeforeNextStart:3});assert.ok(short<useful);
});
test('real caster adapter applies each tactical adjustment once and rescoring preserves that result',async()=>{
 const f=fixture(),{state:s}=await state(f),choice=f.adapter.decide(s).chosen;
 const policy=choice.scoringTerms.filter(t=>t.label.startsWith(s.behavior.selection.label+':'));
 assert.equal(new Set(policy.map(t=>t.label)).size,policy.length);
 const once=tacticalBehaviors.candidates(s,[choice],s.behavior.selection).candidates.find(c=>c.id===choice.id);
 const twice=chooseTacticalAction([once],s).chosen;
 assert.equal(twice.assessment.value,once.assessment.value);assert.deepEqual(twice.scoringTerms,once.scoringTerms);
 const defensive={...s.behavior.selection,planId:'defensive',label:'Defensive',activeComponents:s.behavior.selection.activeComponents.filter(id=>!['pressure','spell-control','spell-damage','spell-drain','spell-support'].includes(id))};
 const rescored=tacticalBehaviors.candidates(s,[choice],defensive).candidates.find(c=>c.id===choice.id);
 assert.equal(rescored.scoringTerms.some(t=>t.label.startsWith(s.behavior.selection.label+':')),false);
});
