import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/dero-fixture.mjs';
import {createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {conditionCastingCandidates} from '../src/framework/condition-spells.mjs';
import {casterScenarios} from '../src/framework/caster-scenarios.mjs';
import {advanceOngoingSpells} from '../src/foundry/ongoing-spells.mjs';

const ns='foundry-creature-ai';
function setup(options){const f=fixture(options);f.player.document.x=300;
 f.adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});return f;}
const snapshot=async f=>f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
const buffs=f=>f.actor.itemTypes.effect.filter(e=>e.system.slug==='creature-ai-vampiric-feast');

for(const [degree,multiplier]of [[0,2],[1,1],[2,0.5],[3,0]])test(`Vampiric Feast save degree ${degree} spends two actions and one native slot, without MAP`,async()=>{
 const f=setup({saveDegree:degree}),slots=f.adapter.parts().entry.system.slots.slot3.value;
 const ledger=await new TurnRunner(f.adapter).run({oneAction:true});
 assert.equal(f.calls.find(c=>c[0]==='consume-spell')[1],'vampiric-feast');
 assert.equal(ledger.actionsRemaining,1);assert.equal(ledger.attacksMade,0);
 assert.equal(f.adapter.parts().entry.system.slots.slot3.value,slots-1);
 const damage=f.calls.find(c=>c[0]==='damage-applied');
 if(multiplier){assert.equal(damage[2].damage.total,10*multiplier);assert.equal(f.actor.hitPoints.temp,Math.floor(10*multiplier/2));}
 else{assert.equal(damage,undefined);assert.equal(buffs(f).length,0);}
 assert.equal(f.hooks.get('updateActor')?.length??0,0,'damage capture listener is removed');
});

test('temporary HP use post-resistance damage, including overkill rather than lost HP',async()=>{
 const f=setup();f.player.actor.hitPoints.value=1;f.damageAfterIWR=6;
 await new TurnRunner(f.adapter).run({oneAction:true});
 assert.equal(f.actor.hitPoints.temp,3);assert.equal(buffs(f)[0].system.rules[0].value,3);
});

test('higher unrelated temporary HP are preserved rather than replaced or stacked',async()=>{
 const f=setup();f.actor.hitPoints.temp=25;f.actor.system.attributes.hp.tempSource='unrelated-ward';
 await new TurnRunner(f.adapter).run({oneAction:true});
 assert.equal(f.actor.hitPoints.temp,25);assert.equal(f.actor.system.attributes.hp.tempSource,'unrelated-ward');assert.equal(buffs(f).length,0);
});

test('the life-drain source expires after a minute and does not remove another temporary HP source',async()=>{
 const f=setup();await new TurnRunner(f.adapter).run({oneAction:true});assert.equal(f.actor.hitPoints.temp,5);
 game.time.worldTime=61;await advanceOngoingSpells();assert.equal(f.actor.hitPoints.temp,0);assert.equal(buffs(f).length,0);
 const g=setup();await new TurnRunner(g.adapter).run({oneAction:true});
 g.actor.hitPoints.temp=30;g.actor.system.attributes.hp.tempSource='new-ward';
 game.time.worldTime=61;await advanceOngoingSpells();assert.equal(g.actor.hitPoints.temp,30);assert.equal(buffs(g).length,0);
});

test('manual damage mode pauses without inventing a temporary HP award',async()=>{
 const f=setup();await f.boss.document.setFlag(ns,'config',{...f.adapter.config,applyDamage:false});
 const ledger=await new TurnRunner(f.adapter).run();
 assert.equal(ledger.actionsRemaining,1);assert.equal(buffs(f).length,0);assert.equal(f.calls.some(c=>c[0]==='damage-applied'),false);
});

test('a target leaving touch range before commitment costs no slot; displacement during the reaction spends it but rolls no save',async()=>{
 const f=setup(),state=await snapshot(f),choice=conditionCastingCandidates(state).find(c=>c.spellSlug==='vampiric-feast');
 const ledger=await f.adapter.readLedger(f.adapter.turnKey());f.player.document.x=600;
 assert.equal((await f.adapter.execute(choice,ledger,{})).skipped,true);assert.equal(f.calls.some(c=>c[0]==='consume-spell'),false);
 f.player.document.x=300;f.reactions.action=async()=>{f.player.document.x=600;return {};};
 const result=await f.adapter.execute(choice,ledger,{});assert.match(result.note,/left touch range/);
 assert.equal(f.calls.filter(c=>c[0]==='consume-spell').length,1);assert.equal(f.calls.some(c=>c[0]==='spell-save'),false);
});

test('immune and nonliving targets yield neither damage nor temporary HP',async()=>{
 for(const immune of [true,false]){const f=setup();if(immune)f.player.actor.isImmuneTo=()=>true;else f.player.actor.modeOfBeing='undead';
  await new TurnRunner(f.adapter).run({oneAction:true});assert.equal(buffs(f).length,0);assert.equal(f.calls.some(c=>c[0]==='damage-applied'),false);}
});

test('control attempts do not suppress repeat damage cantrips or life-drain spells',async()=>{
 const f=setup(),s=await snapshot(f);s.spellAttempts=['void-warp','vampiric-feast','blindness'].map(slug=>({slug,targetId:f.player.id,untilRound:10}));
 const choices=conditionCastingCandidates(s);assert.ok(choices.some(c=>c.spellSlug==='void-warp'));assert.ok(choices.some(c=>c.spellSlug==='vampiric-feast'));
 assert.equal(choices.some(c=>c.spellSlug==='blindness'),false);
});

test('caster plans switch between distant control and an affordable touch-damage opening',async()=>{
 const f=setup();let s=await snapshot(f);assert.equal(f.adapter.decide(s).diagnostics.tactic.planId,'spell-drain');
 f.player.document.x=900;s=await snapshot(f);assert.notEqual(f.adapter.decide(s).diagnostics.tactic.planId,'spell-drain');
 f.player.document.x=300;f.adapter.parts().entry.system.slots.slot3.value=0;s=await snapshot(f);
 assert.notEqual(f.adapter.decide(s).diagnostics.tactic.planId,'spell-drain');
});

test('a touch setup forecast includes the known casting reaction risk at its destination',async()=>{
 const f=setup();f.player.document.x=500;const s=await snapshot(f);
 assert.ok(casterScenarios(s).drain?.movement);
 for(const move of s.moves){move.destinationThreatened=true;move.destinationReactionRisk=100;}
 assert.equal(casterScenarios(s).drain,undefined);
});
