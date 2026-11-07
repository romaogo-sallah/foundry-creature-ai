import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './helpers/modular-caster-fixture.mjs';
import {PF2eVampireAdapter} from '../src/foundry/vampire-adapter.mjs';
import {markKilled} from '../src/foundry/death-status.mjs';
import {executeSpell} from '../src/foundry/spellcasting.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {vampireGrab} from '../src/foundry/vampire-blood.mjs';
const data=JSON.parse(await readFile(new URL('./fixtures/vampire-mastermind-mechanics.json',import.meta.url)));
test('death uses native status creation and is idempotent after native damage already marked death',async()=>{
 const f=fixture();f.player.actor.increaseCondition=()=>{throw new Error('Dead has no native PF2e condition');};
 await markKilled(f.player);await markKilled(f.player);assert.equal(f.player.actor.statuses.has('dead'),true);
 assert.equal(f.calls.filter(c=>c[0]==='status').length,1);assert.equal(f.player.actor.hasCondition('dead'),false);
});
test('lethal Vision of Death completes the reserved action and reports battle victory',async()=>{
 const f=fixture({npcData:data,Adapter:PF2eVampireAdapter}),a=f.adapter;f.player.document.x=300;f.player.actor.modeOfBeing='living';f.player.actor.hitPoints.value=5;
 f.player.actor.increaseCondition=slug=>{throw new Error('Unexpected corpse condition: '+slug);};
 const l=await a.readLedger(a.turnKey()),s=await a.snapshot(l,{movement:false}),spell=s.spells.find(p=>p.slug==='vision-of-death');
 const choice={id:'vision-test',kind:'castSpell',spellId:spell.id,spellSlug:spell.slug,bindingId:spell.bindingId,entryId:spell.entryId,castRank:spell.castRank,slotId:spell.slotId,actionCost:2,targetId:f.player.id,legal:true,assessment:{value:10}};
 a.snapshot=async()=>s;a.decide=()=>({chosen:choice,diagnostics:{}});a.revalidate=async()=>{};a.prepareTurn=async()=>true;
 a.execute=async(c,ledger,context)=>executeSpell(a,c,ledger,context);
 const ended=await new TurnRunner(a).run();assert.equal(ended.uncertain,false);assert.equal(ended.completionReason,'battle-over');
 assert.equal(f.player.actor.statuses.has('dead'),true);assert.equal(f.player.actor.itemTypes.condition.some(c=>c.slug==='frightened'),false);
 assert.equal(f.calls.filter(c=>c[0]==='consume-spell').length,1);assert.ok(f.calls.some(c=>c[0]==='chat'));
});
test('nonlethal Vision still applies its ordinary fear outcome',async()=>{
 const f=fixture({npcData:data,Adapter:PF2eVampireAdapter}),a=f.adapter;f.player.document.x=300;f.player.actor.modeOfBeing='living';
 const l=await a.readLedger(a.turnKey()),s=await a.snapshot(l,{movement:false}),spell=s.spells.find(p=>p.slug==='vision-of-death');
 await executeSpell(a,{kind:'castSpell',spellId:spell.id,spellSlug:spell.slug,bindingId:spell.bindingId,entryId:spell.entryId,castRank:spell.castRank,slotId:spell.slotId,actionCost:2,targetId:f.player.id},{...l,actionsRemaining:1});
 assert.equal(f.player.actor.getCondition('frightened')?.value,2);assert.equal(f.player.actor.statuses.has('dead'),false);
});
test('failed Grab reports failure explicitly rather than implying a held target',async()=>{
 const f=fixture({npcData:data,Adapter:PF2eVampireAdapter}),a=f.adapter,claw=a.parts().native.find(s=>s.item.name==='Claw');
 f.actor.getStatistic=()=>({dc:{value:30},check:{roll:async()=>({degreeOfSuccess:1})}});
 const result=await vampireGrab(a,f.player,{lastAction:{hit:true,targetId:f.player.id,strikeId:claw.item.id}});
 assert.match(result.note,/Grab failed/);assert.equal(f.player.actor.hasCondition('grabbed'),false);assert.equal(f.player.actor.hasCondition('restrained'),false);
});
