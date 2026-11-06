import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ogreData} from './helpers/ogre-fixture.mjs';
import {fixture as pyroFixture} from './helpers/pyro-fixture.mjs';
import {fixture as eagleFixture} from './helpers/eagle-fixture.mjs';
import {readFile} from 'node:fs/promises';
import {PF2eKoboldScoutAdapter} from '../src/foundry/kobold-scout-adapter.mjs';
import {attachConfusionSystem,PF2eConfusedAdapter} from '../src/foundry/confused-adapter.mjs';
import {chooseConfusedAction,confusedCandidates} from '../src/framework/confused-policy.mjs';
import {targetRoster,canAssignTarget,targetingMode} from '../src/foundry/targeting.mjs';
import {encounterOutcome} from '../src/foundry/combat-state.mjs';
import {reactionRestriction} from '../src/foundry/action-restrictions.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
const ns='foundry-creature-ai';
const scoutData=JSON.parse(await readFile(new URL('./fixtures/kobold-scout-mechanics.json',import.meta.url)));
function confuse(f,{random=()=>0}={}){f.actor.conditionsSet.add('confused');attachConfusionSystem(f.adapter,{random});return f;}
async function state(f,options){let ledger=await f.adapter.readLedger(f.adapter.turnKey());await f.adapter.prepareTurn({ledger});return {ledger,state:await f.adapter.snapshot(ledger,options)};}
test('Confused includes allies and neutrals in combat without changing their alliance or adding bystanders',()=>{
 const f=confuse(fixture()),ally=f.addOgre('ally',600,200),neutral=f.addOgre('neutral',800,200);neutral.actor.alliance=null;
 f.token('bystander',f.makeActor('bystander',ogreData),1100,100);
 assert.equal(targetingMode(f.actor,{targetMode:'manual'}),'confused');
 assert.ok(canAssignTarget(f.actor,ally.actor));assert.ok(canAssignTarget(f.actor,neutral.actor));assert.equal(canAssignTarget(f.actor,f.actor),false);
 assert.deepEqual(targetRoster(f.boss,{targetMode:'manual',targetIds:[]}),['fighter','ally','neutral']);
 assert.equal(ally.actor.alliance,'opposition');assert.equal(reactionRestriction(f.actor).kind,'confused');
});
test('a surviving Confused combatant prevents victory while an erstwhile ally is still alive',()=>{
 const f=confuse(fixture());f.player.actor.hitPoints.value=0;f.addOgre('ally');assert.equal(encounterOutcome(),null);
 f.actor.conditionsSet.delete('confused');assert.equal(encounterOutcome().reason,'victory');
});
test('random target persists across approach, previews and revalidation, then rerolls after an attack',async()=>{
 let rolls=0;const f=confuse(fixture(),{random:()=>{rolls++;return 0.99;}});const ally=f.addOgre('ally',800,200);
 const first=await state(f);assert.equal(first.state.confusion.targetId,ally.id);assert.equal(rolls,1);
 await f.adapter.snapshot(first.ledger);await f.adapter.snapshot(first.ledger);assert.equal(rolls,1);
 const choice=f.adapter.decide(first.state).chosen;await f.adapter.revalidate(choice,first.ledger);assert.equal(rolls,1);
 await f.adapter.recordOutcome({kind:'strike'},first.ledger,{resolved:true});await f.adapter.prepareTurn({ledger:first.ledger});assert.equal(rolls,2);
});
test('Confused closes up and attacks an ally with Strikes while excluding command, Trip and reactions',async()=>{
 const f=confuse(fixture(),{random:()=>0.99});f.adapter.parts().javelin.system.quantity=0;const ally=f.addOgre('ally',700,200);const ledger=await new TurnRunner(f.adapter).run();
 assert.equal(ledger.actionsRemaining,0);assert.ok(f.calls.some(c=>c[0]==='move'));
 const attacks=f.calls.filter(c=>c[0]==='attack');assert.ok(attacks.length);assert.ok(attacks.every(c=>c.at(-1).target.id===ally.id));
 assert.equal(f.calls.some(c=>['trip','command'].includes(c[0])),false);assert.equal(f.prompts.some(p=>p.reactorId===f.boss.id),false);
});
test('available Confused attacks outrank moving, equipment and special candidates cannot leak into the policy',()=>{
 const base={actionsRemaining:3,bonusMovementActions:0,conditionRules:{},confusion:{stamp:'turn',targetId:'ally'},diagnostics:{}};
 const options=['hide','sneak','eagleDive','spikeVolley','bellow','trip','sustainSpell','gaze'].map(kind=>({id:kind,kind,legal:true,actionCost:1,assessment:{value:9999}}));
 options.push({id:'slot',kind:'castSpell',legal:true,actionCost:2,features:{cantrip:false},assessment:{value:9999}},
  {id:'strike',kind:'strike',legal:true,actionCost:1,assessment:{value:4}},{id:'move',kind:'stride',legal:true,actionCost:1,assessment:{value:1000}});
 assert.deepEqual(confusedCandidates({...base,confusedOptions:options}).map(c=>c.id),['strike']);
});
test('Confused caster uses only supported offensive cantrips and never consumes a spell slot',async()=>{
 const f=confuse(pyroFixture());f.player.document.x=500;f.player.document.y=200;const slots=f.actor.itemTypes.spellcastingEntry[0].system.slots.slot1.value;
 const ledger=await new TurnRunner(f.adapter).run();assert.equal(ledger.actionsRemaining,0);
 assert.ok(f.calls.some(c=>c[0]==='spell-attack'));
 const consumed=f.calls.filter(c=>c[0]==='consume-spell');assert.ok(consumed.length);assert.ok(consumed.every(c=>['ignition','tangle-vine'].includes(c[1])));
 assert.equal(f.calls.some(c=>c[0]==='create-region'),false);assert.equal(f.actor.itemTypes.spellcastingEntry[0].system.slots.slot1.value,slots);
});
test('Confused flyers generate only direct Fly/Strike actions, with no dive or hunting plans',async()=>{
 const f=confuse(eagleFixture({altitude:10,size:10}));const {state:s}=await state(f);
 const options=f.adapter.candidates(s);assert.ok(options.some(c=>c.kind==='fly'||c.kind==='strike'));
 assert.ok(options.every(c=>['fly','strike','hover'].includes(c.kind)));assert.equal(s.flight?.hunt,undefined);assert.equal(s.behavior,undefined);
});
test('ending Confused before execution skips the queued action, restores alliance filtering and ordinary strategy',async()=>{
 const f=confuse(fixture());const {state:s,ledger}=await state(f);const choice=f.adapter.decide(s).chosen;
 f.actor.conditionsSet.delete('confused');const result=await f.adapter.execute(choice,ledger,{});assert.equal(result.skipped,true);
 assert.equal(targetingMode(f.actor),'alliance');assert.equal(reactionRestriction(f.actor),null);
});

test('Confused draws a ranged weapon and spends its ammunition normally',async()=>{
 const f=confuse(fixture());f.player.document.x=1000;const quantity=f.adapter.parts().javelin.system.quantity;
 const ledger=await new TurnRunner(f.adapter).run();assert.equal(ledger.actionsRemaining,0);
 assert.ok(f.calls.some(c=>c[0]==='item-update'&&c[2]['system.equipped.carryType']==='held'));
 assert.ok(f.adapter.parts().javelin.system.quantity<quantity);assert.ok(f.calls.some(c=>c[0]==='attack'));
});
test('Confused scouts reload and shoot without Hide, Sneak or Scamper',async()=>{
 const f=confuse(fixture({npcData:scoutData,Adapter:PF2eKoboldScoutAdapter,footprint:1}));
 await f.boss.document.setFlag(ns,'scoutGear',{loaded:false});const parts=f.adapter.parts(),quantity=parts.bolts.system.quantity;
 const ledger=await new TurnRunner(f.adapter).run();assert.equal(ledger.actionsRemaining,0);
 assert.ok(f.calls.some(c=>c[0]==='attack'));assert.equal(f.adapter.parts().bolts.system.quantity,quantity-1);
 assert.equal(f.calls.some(c=>c[0]==='stealth'),false);assert.equal(f.boss.document.getFlag(ns,'scampering'),undefined);
});
test('Confused scouts with no bolts close up, draw a sword and use melee',async()=>{
 const f=confuse(fixture({npcData:scoutData,Adapter:PF2eKoboldScoutAdapter,footprint:1}));const parts=f.adapter.parts();parts.bolts.system.quantity=0;
 const ledger=await new TurnRunner(f.adapter).run();assert.equal(ledger.actionsRemaining,0);
 assert.ok(f.calls.some(c=>c[0]==='move'));const attacks=f.calls.filter(c=>c[0]==='attack');assert.ok(attacks.length);assert.ok(attacks.every(c=>c[2]===parts.strike.item.id));
});
test('a killed random target is replaced before execution without spending an action or MAP',async()=>{
 const f=confuse(fixture(),{random:()=>0.99});const ally=f.addOgre('ally',500,500);let changed=false;
 const runner=new TurnRunner(f.adapter,{presentation:{beforeAction:async()=>{if(!changed){ally.actor.hitPoints.value=0;changed=true;}return true;}}});
 const ledger=await runner.run();assert.equal(ledger.actionsRemaining,0);assert.ok(f.calls.filter(c=>c[0]==='attack').every(c=>c.at(-1).target.id===f.player.id));
 assert.ok(ledger.attacksMade<=3);
});
test('Confused ending in the presentation pause resumes normal tactics with the unused budget',async()=>{
 const f=confuse(fixture());let changed=false;
 const runner=new TurnRunner(f.adapter,{presentation:{beforeAction:async()=>{if(!changed){f.actor.conditionsSet.delete('confused');changed=true;}return true;}}});
 const ledger=await runner.run();assert.equal(ledger.actionsRemaining,0);assert.ok(f.calls.some(c=>c[0]==='attack'));
});
test('Confused preview does not persist a random target or spend resources',async()=>{
 const f=confuse(fixture());const ledger=await f.adapter.readLedger(f.adapter.turnKey());await f.adapter.snapshot(ledger);
 assert.equal(f.boss.document.getFlag(ns,'confusedIntent'),undefined);assert.equal(f.calls.some(c=>['move','attack','item-update'].includes(c[0])),false);
});

test('the production adapter factory enables Confused while plain untaught condition handling stays guarded',async()=>{
 const f=fixture();f.actor.conditionsSet.add('confused');await assert.rejects(f.adapter.assertReady(),/confused/);
 f.adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});await f.adapter.assertReady();
 const {state:s}=await state(f);assert.equal(s.diagnostics.policy,'confused-simple');assert.equal(s.behavior,undefined);
});
test('Confused ground creatures Stand only when needed to approach, and still honor restraints',async()=>{
 const f=confuse(fixture());f.adapter.parts().javelin.system.quantity=0;f.player.document.x=900;f.actor.conditionsSet.add('prone');
 const {state:s}=await state(f);assert.equal(f.adapter.decide(s).chosen.kind,'stand');
 f.actor.conditionsSet.add('immobilized');const current=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
 assert.equal(f.adapter.candidates(current).some(c=>['stand','stride','fly'].includes(c.kind)),false);
});
test('Confused cannot locate explicitly undetected creatures by reading their live positions',async()=>{
 const f=confuse(fixture());f.player.actor.conditionsSet.add('undetected');f.player.document.hidden=true;
 const {state:s}=await state(f);assert.equal(s.confusion.targetId,null);assert.equal(f.adapter.decide(s).chosen.kind,'endTurn');
 assert.equal(f.adapter.decide(s).diagnostics.turnComplete,false);
});
test('Confused eagles approach and attack without Eagle Dive or climbing back to safety',async()=>{
 const f=confuse(eagleFixture({altitude:10,size:10}));const ledger=await new TurnRunner(f.adapter).run();
 assert.equal(ledger.actionsRemaining,0);assert.ok(f.calls.some(c=>c[0]==='attack'));
 const decisions=f.calls.filter(c=>c[0]==='chat').map(c=>c[1].flags?.[ns]?.choiceId??'');
 assert.equal(decisions.some(id=>id.includes('eagle-dive')),false);assert.ok(f.boss.document.elevation<=10);
});
