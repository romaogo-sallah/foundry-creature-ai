import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/pyro-fixture.mjs';
import {castingCandidates} from '../src/framework/spell-evaluation.mjs';
import {prepareGreaseMove,greaseExtraCost,refreshSpellZones,expireSpellZones,inGrease,installGreaseTerrain,withGreaseMode} from '../src/foundry/spell-zones.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {escapeOptions} from '../src/foundry/escape.mjs';
import {PF2eGoblinPyroAdapter} from '../src/foundry/goblin-pyro-adapter.mjs';
import {GoblinScuttle} from '../src/foundry/goblin-scuttle.mjs';
import {ManualMovement} from '../src/foundry/manual-movement.mjs';
import {combatStamp} from '../src/foundry/reaction-prompts.mjs';

const ns='foundry-creature-ai';
async function putGrease(f){
  f.player.document.x=500;f.player.document.y=200;f.addEnemy('second',500,300);
  const l=await f.adapter.readLedger(f.adapter.turnKey()),s=await f.adapter.snapshot(l);
  const choice=castingCandidates(s).find(c=>c.spellSlug==='grease'&&c.area.enemies.length===2&&!c.area.bystanders.length);
  assert.ok(choice);
  await f.adapter.execute(choice,{...l,actionsRemaining:1},{canContinue:()=>true});
  return canvas.scene.regions.contents[0];
}

test('Grease saves standing creatures once, persists as an owned region and applies only its own off-guard effect',async()=>{
  const f=fixture();const region=await putGrease(f);
  assert.equal(f.adapter.parts().entry.system.slots.slot1.value,2);
  assert.equal(region.flags[ns].spellZone.expiresAt,60);
  assert.equal(region.flags['pf2e-toolbelt'].targetHelper.skip,true);
  assert.equal(f.calls.find(call=>call[0]==='create-region')[2].renderSheet,false);
  assert.equal(f.player.actor.hasCondition('prone'),true);
  assert.equal(f.calls.filter(call=>call[0]==='spell-save').length,2);
  assert.equal(inGrease(f.player).length,1);
  assert.equal(f.player.actor.itemTypes.effect.filter(e=>e.flags[ns]?.greaseOffGuard).length,1);
  await refreshSpellZones();assert.equal(f.player.actor.itemTypes.effect.filter(e=>e.flags[ns]?.greaseOffGuard).length,1);
  f.player.document.x=1000;await refreshSpellZones();assert.equal(f.player.actor.itemTypes.effect.filter(e=>e.flags[ns]?.greaseOffGuard).length,0);
});

test('Grease Balance uses one check per move, preserves actions on failure, and distinguishes Step/Crawl',async()=>{
  const f=fixture();await putGrease(f);f.player.actor.conditionsSet.delete('prone');
  const path=[{x:400,y:200},{x:500,y:200},{x:600,y:200},{x:700,y:200}];
  const before=f.calls.filter(call=>call[0]==='spell-save').length;
  assert.equal(greaseExtraCost(f.player,path,'step'),0);assert.equal(greaseExtraCost(f.player,path,'crawl'),0);
  await prepareGreaseMove(f.player,path,{kind:'step'});await prepareGreaseMove(f.player,path,{kind:'crawl'});
  assert.equal(f.calls.filter(call=>call[0]==='spell-save').length,before);
  const fail=await prepareGreaseMove(f.player,path,{kind:'stride',baseCost:p=>(p.length-1)*5,speed:25});
  assert.equal(fail.blocked,true);assert.equal(fail.forfeitActions,false);assert.equal(f.player.actor.hasCondition('prone'),false);
  assert.equal(f.calls.filter(call=>call[0]==='spell-save').length,before+1);
  f.saveDegree=0;
  const critical=await prepareGreaseMove(f.player,path,{kind:'stride',baseCost:p=>(p.length-1)*5,speed:25});
  assert.equal(critical.forfeitActions,true);assert.equal(critical.fallOnArrival,true);
  assert.equal(f.player.actor.hasCondition('prone'),false,'Prone is deferred until the entry square is reached');
  assert.ok(inGrease(f.player,critical.path.at(-1)).length);
});

test('successful Balance respects difficult ground and a critical success does not halve movement',async()=>{
  const f=fixture();await putGrease(f);f.saveDegree=2;
  const path=[{x:400,y:200},{x:500,y:200},{x:600,y:200},{x:700,y:200}];
  const options={kind:'stride',baseCost:p=>(p.length-1)*5,speed:15};
  const success=await prepareGreaseMove(f.player,path,options);assert.ok(success.path.length<path.length);
  f.saveDegree=3;const critical=await prepareGreaseMove(f.player,path,options);assert.equal(critical.path.length,path.length);
});

test('Grease expires by time or caster reset and clears associated indicators',async()=>{
  const f=fixture();await putGrease(f);game.time.worldTime=60;game.combat.started=false;await expireSpellZones();
  assert.equal(canvas.scene.regions.contents.length,0);assert.equal(f.player.actor.itemTypes.effect.filter(e=>e.flags[ns]?.greaseOffGuard).length,0);
  const next=fixture();await putGrease(next);await expireSpellZones({tokenIds:[next.boss.id]});assert.equal(canvas.scene.regions.contents.length,0);
});

test('Tangle Vine provides an automatic Escape DC even after its caster leaves the scene',async()=>{
  const f=fixture({degree:3}),other=f.addPyro('victim',600,200);
  const spell=f.adapter.parts().spells.find(item=>item.slug==='tangle-vine');
  const {applyTangleVine}=await import('../src/foundry/spell-zones.mjs');
  await applyTangleVine(f.adapter,other,spell,3);
  const adapter=new PF2eGoblinPyroAdapter(other,null,{reactions:f.reactions});
  const option=escapeOptions(adapter)[0];assert.ok(option);assert.equal(option.dc,16);assert.equal(option.recordedSource,true);
});

test('Goblin Scuttle spends the shared reaction, makes one safe Step and spends no ordinary actions',async()=>{
  const f=fixture();f.player.document.x=500;
  const ally=f.addPyro('ally',200,300);game.combat.combatants.push({id:'c-ally',tokenId:ally.id,sceneId:'scene',actor:ally.actor});
  const before=f.boss.document.x,beforeY=f.boss.document.y;
  const scuttle=new GoblinScuttle(f.reactions);
  await scuttle.afterMove(ally);
  assert.ok(f.boss.document.x!==before||f.boss.document.y!==beforeY);
  assert.equal(f.actor.getFlag(ns,'reaction').kind,'goblin-scuttle');assert.equal(f.actor.getFlag(ns,'reaction').spent,true);
  assert.equal(f.boss.document.getFlag(ns,'ledger'),undefined);
  const count=f.calls.filter(call=>call[0]==='move'&&call[1]===f.boss.id).length;
  await scuttle.afterMove(ally);assert.equal(f.calls.filter(call=>call[0]==='move'&&call[1]===f.boss.id).length,count);
});

test('the runner invokes movement reactions once after a complete move, not for each grid square',async()=>{
  const f=fixture();f.player.document.x=1400;
  let count=0;f.reactions.afterMoveAction=async()=>{count++;};
  await new TurnRunner(f.adapter).run({oneAction:true});
  assert.equal(count,1);assert.equal(f.calls.filter(call=>call[0]==='move').length,1);
});

test('Grease native cost wrapper is installed once and exempts only its own Step/Crawl/critical Balance terrain',async()=>{
  const f=fixture();let wrapper,count=0;
  CONFIG.RegionBehavior={dataModels:{modifyMovementCost:class {}}};
  globalThis.libWrapper={register:(id,path,fn)=>{count++;wrapper=fn;}};
  installGreaseTerrain();installGreaseTerrain();assert.equal(count,1);
  const owned={behavior:{flags:{[ns]:{greaseMovement:true}}}},other={behavior:{flags:{}}};
  let chained=0;const native=()=>{chained++;return [{name:'difficulty',difficulty:2}];};
  const segment={action:'walk'},options={preview:true};
  const forward=(document,path,settings)=>{
    assert.equal(document,f.boss.document);assert.equal(path,segment);assert.equal(settings,options);
    return native();
  };
  assert.deepEqual(wrapper.call(owned,forward,f.boss.document,segment,options),native(),'native drag previews pass TokenDocument directly');
  const before=chained;
  assert.deepEqual(withGreaseMode(f.boss,'step',()=>wrapper.call(owned,forward,f.boss.document,segment,options)),[]);
  assert.equal(chained,before+1,'the terrain WRAPPER still chains when excluding Grease difficulty');
  assert.deepEqual(withGreaseMode(f.boss.document,'criticalSuccess',()=>wrapper.call(owned,native,f.boss,{})),[]);
  assert.deepEqual(withGreaseMode(f.boss,'crawl',()=>wrapper.call(owned,native,f.boss.document,{})),[]);
  assert.deepEqual(withGreaseMode(f.boss,'step',()=>wrapper.call(other,native,f.boss,{})),native(),'ordinary difficult terrain still applies');
  await assert.rejects(withGreaseMode(f.boss,'step',async()=>{throw new Error('test failure');}),/test failure/);
  assert.deepEqual(wrapper.call(owned,native,f.boss,{}),native(),'temporary exemptions are removed after errors');
  assert.deepEqual(wrapper.call(other,native,{},{}),native(),'unrelated difficult terrain does not require a placeable');
  assert.deepEqual(wrapper.call(owned,native,{},{}),native(),'an unidentified preview retains native terrain');
  assert.deepEqual(withGreaseMode({},'step',()=>wrapper.call(owned,native,{},{})),native(),'missing IDs cannot share an exemption');
  assert.deepEqual(withGreaseMode(f.boss,'step',()=>wrapper.call(owned,native,{uuid:'Scene.other.Token.other'},{})),native(),
    'an exemption never applies to a different token');
});

test('critical Balance failure ends an automated turn, advances when enabled and never records the unreached destination',async()=>{
  const f=fixture();await putGrease(f);f.saveDegree=0;
  f.flags.set(`token-boss:${ns}:config`,{...f.adapter.config,autoAdvance:true});
  f.adapter.decide=s=>{
    const choice=f.adapter.candidates(s).find(c=>c.kind==='stride'&&c.destination.x===4&&c.destination.y===2);
    assert.ok(choice);return {chosen:choice,diagnostics:s.diagnostics};
  };
  const ledger=await new TurnRunner(f.adapter).run();
  assert.equal(ledger.actionsRemaining,0);assert.equal(ledger.uncertain,false);assert.equal(ledger.advanced,true);
  assert.equal(f.actor.hasCondition('prone'),true);assert.ok(f.boss.document.x>200);
  assert.ok(inGrease(f.boss).length,'the fall lands on Grease');
  assert.ok(ledger.visited.includes(`${f.boss.document.x/100},${f.boss.document.y/100}`));
  assert.equal(f.calls.filter(call=>call[0]==='next-turn').length,1);
});

test('manual Step out of Grease works with generic movement reactions disabled and does not roll Balance',async()=>{
  const f=fixture();await putGrease(f);f.player.actor.conditionsSet.delete('prone');
  game.user.active=true;game.users.activeGM=game.user;
  game.combat.turn=1;game.combat.combatant=game.combat.combatants[1];
  f.player.actor.system.attributes.speed={total:25};f.player.document.getCompleteMovementPath=points=>points;
  f.reactions.prompts.ask=async request=>request.kind==='movement'?'step':'pass';
  const movement=new ManualMovement(f.reactions,{enabled:()=>false});
  const start={x:500,y:200,elevation:0,level:'ground',action:'walk'},end={...start,x:600};
  const count=f.calls.filter(call=>call[0]==='spell-save').length;
  const result=await movement.receive({sceneId:'scene',tokenId:f.player.id,origin:start,path:[start,end],stamp:combatStamp(),expires:Date.now()+120000},game.user);
  assert.equal(result,true);assert.equal(f.player.document.x,600);
  assert.equal(f.calls.filter(call=>call[0]==='spell-save').length,count);
});

test('combat Grease lasts until its caster turn ten rounds later, rather than expiring at the round boundary',async()=>{
  const f=fixture();const region=await putGrease(f);
  region.flags[ns].spellZone.casterCombatantId='c-fighter';
  game.combat.round=11;game.combat.turn=0;game.time.worldTime=60;
  await expireSpellZones();assert.equal(canvas.scene.regions.contents.length,1);
  game.combat.turn=1;await expireSpellZones();assert.equal(canvas.scene.regions.contents.length,0);
});
