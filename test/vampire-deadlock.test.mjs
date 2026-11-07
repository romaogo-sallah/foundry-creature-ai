import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './helpers/modular-caster-fixture.mjs';
import {PF2eVampireAdapter} from '../src/foundry/vampire-adapter.mjs';
import {attachFlightSystem} from '../src/foundry/flight-runtime.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
const count=JSON.parse(await readFile(new URL('./fixtures/vampire-count-mechanics.json',import.meta.url))),ns='foundry-creature-ai';
async function setup({autoAdvance=true,immobile=false}={}){
 const f=fixture({npcData:count,Adapter:PF2eVampireAdapter}),adapter=new PF2eVampireAdapter(f.boss,null,{reactions:f.reactions});
 f.flags.get(`token-boss:${ns}:config`).autoAdvance=autoAdvance;
 const ledger={...await adapter.readLedger(adapter.turnKey()),actionsRemaining:1};await adapter.saveLedger(ledger);
 const state={...ledger,self:{cell:{x:2,y:2},threatened:false,immobile,restrained:false},enemies:[],moves:[],diagnostics:{movementBlocked:immobile?'Immobilized':null}};
 adapter.snapshot=async()=>state;adapter.candidates=()=>[{id:'end',kind:'endTurn',legal:true,actionCost:0,assessment:{value:0}}];adapter.prepareTurn=async()=>true;
 adapter.report=async()=>{};attachFlightSystem(adapter);return {...f,adapter,state};
}
test('grounded Count preserves caster completion through its dormant flight component',async()=>{
 const f=await setup();assert.equal(f.adapter.decide(f.state).diagnostics.turnComplete,true);
 const ledger=await new TurnRunner(f.adapter).run();assert.equal(ledger.done,true);assert.equal(ledger.completionReason,'no-useful-actions');
 assert.equal(ledger.actionsRemaining,1,'passing does not manufacture or spend an action');assert.equal(f.calls.filter(c=>c[0]==='next-turn').length,1);
});
test('grounded Count completion respects disabled automatic turn passing',async()=>{
 const f=await setup({autoAdvance:false}),ledger=await new TurnRunner(f.adapter).run();assert.equal(ledger.done,true);assert.equal(ledger.actionsRemaining,1);
 assert.equal(f.calls.some(c=>c[0]==='next-turn'),false);
});
test('grounded flight delegation retains the caster pause for an unresolved immobilization',async()=>{
 const f=await setup({immobile:true}),ledger=await new TurnRunner(f.adapter).run();assert.equal(ledger.done,false);assert.equal(ledger.actionsRemaining,1);
 assert.equal(f.calls.some(c=>c[0]==='next-turn'),false);
});
