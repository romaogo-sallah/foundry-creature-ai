import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePyroAction, pyroCandidates } from '../src/profiles/goblin-pyro.mjs';
import { castingCandidates } from '../src/framework/spell-evaluation.mjs';
import { fixture } from './helpers/pyro-fixture.mjs';
import { TurnRunner } from '../src/framework/turn-runner.mjs';
import { detectionFor } from '../src/foundry/stealth-awareness.mjs';
import { stealthBelief } from '../src/foundry/stealth-belief.mjs';

const ns='foundry-creature-ai';
const ignition={id:'ignition',slug:'ignition',name:'Ignition',kind:'damage-attack',range:30,actionCost:2,cantrip:true,available:true,bonus:6,damage:5,meleeDamage:7};
function state() {
  return {self:{cell:{x:2,y:2},referenceAC:17,reachSquares:1,averageDamage:3.5,attackBonus:7,mapPenalties:[0,-5,-10]},
    actionsRemaining:3,attacksMade:0,spellSlots:0,torchReady:false,moves:[],nearestEnemy:9,diagnostics:{},spells:[ignition],
    casterDefense:{enabled:true,engagementRange:30,canHide:true},
    enemies:[{id:'ogre',distance:45,inReach:false,lineOfSight:true,lineOfEffect:true,awareness:{state:'observed'},
      tactics:{role:'melee',reach:10,speed:25},incoming:{coverBonus:0,concealed:false,canHide:false},stealthChance:0,hideChance:0,freshHideChance:0}]};
}
function setup({shelter=true,slots=0,total=7,die=1}={}) {
  const f=fixture(); f.player.document.x=1000;
  f.player.actor.system.actions=[{type:'strike',item:{isMelee:true,reach:10}}];
  f.adapter.parts().entry.system.slots.slot1.value=slots;
  const statistic=f.actor.getStatistic;
  f.actor.getStatistic=slug=>{
    const result=statistic(slug);
    if(slug==='stealth')result.check.roll=async options=>{
      f.calls.push(['stealth-roll',options]);return {total,dice:[{faces:20,total:die}]};
    };
    return result;
  };
  if(shelter)canvas.scene.regions.contents.push(new f.Region({id:'foliage',name:'Foliage',
    shapes:[{type:'rectangle',x:200,y:200,width:100,height:100}],levels:['ground'],
    flags:{[ns]:{environment:{enabled:true,cover:'none',coverMode:'occupants',concealment:'occupants',firingRadius:0}}}}, {parent:canvas.scene}));
  return f;
}
const snapshot=async f=>f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));

test('short-range casters hold for visible melee enemies instead of approaching merely to unlock a cantrip',()=>{
  const s=state();s.moves=[{x:5,y:2,kind:'stride',cost:15,path:[],nearestEnemy:6,spells:[ignition],
    targets:{ogre:{distance:30,inReach:false,lineOfSight:true,lineOfEffect:true}}}];
  const decision=choosePyroAction(s);
  assert.equal(decision.chosen.kind,'endTurn');assert.equal(decision.diagnostics.holdForApproach,true);assert.equal(decision.diagnostics.turnComplete,true);
  s.enemies[0].tactics.role='ranged';
  assert.equal(choosePyroAction(s).chosen.kind,'stride','a distant archer need not come into our range');
});

test('a nearby concealed position followed by Hide is a useful setup without moving into casting range',()=>{
  const s=state();s.moves=[{x:2,y:3,kind:'stride',cost:5,path:[],nearestEnemy:9,spells:[ignition],
    targets:{ogre:{distance:45,inReach:false,lineOfSight:true,lineOfEffect:true,
      incoming:{coverBonus:0,concealed:true,canHide:true},hideChance:0.5,freshHideChance:0.5}}}];
  const choice=choosePyroAction(s).chosen;
  assert.equal(choice.kind,'stride');assert.equal(choice.features.defensiveSetup,true);
  assert.deepEqual(choice.features.turnPlan.map(action=>action.kind),['stride','hide']);
});

test('moving to shelter does not consume the two actions needed for an available spell',()=>{
  const s=state();s.actionsRemaining=2;s.enemies[0].distance=20;
  s.moves=[{x:2,y:3,kind:'stride',cost:5,path:[],nearestEnemy:4,spells:[ignition],targets:{ogre:{distance:20,
    incoming:{coverBonus:0,concealed:true,canHide:true},hideChance:0.5,freshHideChance:0.5}}}];
  assert.equal(choosePyroAction(s).chosen.spellSlug,'ignition');
});

test('caster does not Hide again when relying on its previous secret check',()=>{
  const s=state();Object.assign(s.enemies[0],{incoming:{concealed:true,canHide:true},stealthChance:0.5,hideChance:0.5,freshHideChance:0.5});
  assert.equal(pyroCandidates(s).some(choice=>choice.kind==='hide'),false);
  assert.equal(choosePyroAction(s).chosen.kind,'endTurn');
});

test('a spell followed by Hide scores better than wasting Hide before a revealing spell',()=>{
  const s=state();s.enemies[0].distance=20;
  Object.assign(s.enemies[0],{incoming:{concealed:true,canHide:true},hideChance:0.5,freshHideChance:0.5});
  const choice=choosePyroAction(s).chosen;
  assert.equal(choice.kind,'castSpell');assert.deepEqual(choice.features.turnPlan.map(action=>action.kind),['castSpell','hide']);
});

test('native Hide is automatic and secret; failed and successful results leave identical decision beliefs',async()=>{
  const observed=[];
  for(const [total,die] of [[7,1],[26,20]]) {
    const f=setup({total,die});
    await new TurnRunner(f.adapter).run({oneAction:true});
    const call=f.calls.find(call=>call[0]==='stealth-roll');assert.ok(call);
    assert.equal(call[1].skipDialog,true);assert.ok(call[1].traits.includes('secret'));
    const s=await snapshot(f),decision=f.adapter.decide(s);
    observed.push({belief:stealthBelief(f.boss),kind:decision.chosen.kind,hold:decision.diagnostics.holdForApproach});
    assert.equal(detectionFor(f.player,f.boss).state,total===7?'observed':'hidden');
    f.combat.round++;
    assert.equal(f.adapter.decide(await snapshot(f)).chosen.kind,'endTurn','do not use secret failure to reroll next turn');
    assert.equal(f.calls.filter(call=>call[0]==='stealth-roll').length,1);
  }
  assert.deepEqual(observed[0],observed[1]);
});

test('a caster can move into native concealment and Hide without starting an offensive approach',async()=>{
  const f=setup();f.boss.document.y=300;
  const ledger=await new TurnRunner(f.adapter).run();
  assert.equal(f.boss.document.x,200);assert.equal(f.boss.document.y,200);
  assert.equal(f.calls.filter(call=>call[0]==='stealth-roll').length,1);
  assert.equal(f.calls.some(call=>call[0]==='spell-attack'),false);
  assert.equal(ledger.done,true);assert.ok(ledger.actionsRemaining>0);
});

test('an empty approach lane can receive Grease before an enemy arrives, with a real slot and no initial saves',async()=>{
  const f=setup({shelter:false,slots:3});
  const s=await snapshot(f),choice=f.adapter.decide(s).chosen;
  assert.equal(choice.spellSlug,'grease');assert.equal(choice.area.enemies.length,0);assert.ok(choice.area.approaches.length);
  await new TurnRunner(f.adapter).run({oneAction:true});
  assert.equal(f.adapter.parts().entry.system.slots.slot1.value,2);
  assert.equal(f.calls.some(call=>call[0]==='spell-save'),false);
  assert.equal(canvas.scene.regions.contents.filter(region=>region.flags?.[ns]?.spellZone).length,1);
  const ledger=await new TurnRunner(f.adapter).run();
  assert.equal(ledger.done,true);assert.equal(f.adapter.parts().entry.system.slots.slot1.value,2);
  f.combat.round++;
  const next=f.adapter.decide(await snapshot(f));
  assert.equal(next.chosen.kind,'endTurn','do not spend another slot coating more empty ground');
});

test('preparatory Grease respects the approaching foe native footprint constraints',async()=>{
  const f=setup({shelter:false,slots:3});let checks=0;
  f.player.constrainMovementPath=path=>{checks++;return [path,true];};
  const s=await snapshot(f);
  assert.ok(checks>0);
  assert.equal(castingCandidates(s).some(choice=>choice.features.preparation),false);
});

test('preparatory Grease does not use an unobserved enemy current position or ranged role',async()=>{
  const f=setup({shelter:false,slots:3});f.player.actor.system.actions=[{type:'strike',item:{isRanged:true}}];
  assert.equal(castingCandidates(await snapshot(f)).some(choice=>choice.features.preparation),false);
  f.player.actor.system.actions=[{type:'strike',item:{isMelee:true,reach:10}}];f.player.actor.conditionsSet.add('hidden');
  assert.equal(castingCandidates(await snapshot(f)).some(choice=>choice.features.preparation),false);
});

test('holding a prepared casting position passes the turn when automatic advancement is enabled',async()=>{
  const f=setup();f.flags.set(`token-boss:${ns}:config`,{...f.adapter.config,autoAdvance:true});
  const ledger=await new TurnRunner(f.adapter).run();
  assert.equal(ledger.done,true);assert.equal(ledger.advanced,true);
  assert.equal(f.calls.filter(call=>call[0]==='next-turn').length,1);
});

test('two quiet setup turns do not become an endless caster standoff',async()=>{
  const f=setup({shelter:false});
  for(let round=1;round<=2;round++) {
    f.combat.round=round;const ledger=await new TurnRunner(f.adapter).run();
    assert.equal(ledger.done,true);assert.equal(f.calls.some(call=>call[0]==='move'),false);
  }
  f.combat.round=3;
  await new TurnRunner(f.adapter).run({oneAction:true});
  assert.equal(f.calls.some(call=>call[0]==='move'),true);
});

test('casting reveals the caster before casting reactions are considered',async()=>{
  const f=setup({total:26,die:20});await new TurnRunner(f.adapter).run({oneAction:true});
  assert.equal(detectionFor(f.player,f.boss).state,'hidden');
  f.player.document.x=600;const s=await snapshot(f),choice=castingCandidates(s).find(choice=>choice.spellSlug==='ignition');
  let reacted=false;f.reactions.action=async()=>{reacted=true;assert.equal(detectionFor(f.player,f.boss).state,'observed');return {};};
  const ledger=await f.adapter.readLedger(f.adapter.turnKey());
  await f.adapter.execute(choice,{...ledger,actionsRemaining:0,attacksMade:1},{canContinue:()=>true});
  assert.equal(reacted,true);assert.deepEqual(stealthBelief(f.boss),[]);
});

test('Step out of cover ends hiding and returning to cover does not revive the old result or belief',async()=>{
  const f=setup({total:26,die:20});await new TurnRunner(f.adapter).run({oneAction:true});
  const ledger=await f.adapter.readLedger(f.adapter.turnKey());
  const step=async(from,to)=>f.adapter.execute({kind:'step',path:[from,to],destination:to},
    {...ledger,actionsRemaining:0},{canContinue:()=>true});
  await step({x:2,y:2},{x:2,y:3});
  assert.equal(detectionFor(f.player,f.boss).state,'observed');assert.equal(stealthBelief(f.boss)[0].unseenChance,0);
  await step({x:2,y:3},{x:2,y:2});
  assert.equal(detectionFor(f.player,f.boss).state,'observed');assert.equal(stealthBelief(f.boss)[0].unseenChance,0);
  f.combat.round++;
  assert.equal(f.adapter.decide(await snapshot(f)).chosen.kind,'hide');
});
