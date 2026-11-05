import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/pyro-fixture.mjs';
import {creatureProfile,createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {castingCandidates} from '../src/framework/spell-evaluation.mjs';
import {readFile} from 'node:fs/promises';

const ns='foundry-creature-ai';
async function snapshot(f,actions=3){return f.adapter.snapshot({...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:actions});}
const cast=(s,slug)=>castingCandidates(s).find(choice=>choice.spellSlug===slug);

test('supplied Goblin Pyro is recognized by provenance and validates its actual spell entry',async()=>{
  const f=fixture();assert.equal(creatureProfile(f.actor).id,'goblin-pyro');
  assert.equal(createCreatureAdapter(f.boss).profileId,'goblin-pyro');
  const parts=f.adapter.parts();assert.equal(parts.spells.length,4);assert.equal(parts.entry.system.slots.slot1.value,3);
  const s=await snapshot(f);assert.equal(s.spells.length,4);assert.equal(s.self.reachSquares,1);
});

test('a two-action cantrip is executed through the runner with one MAP increase and no slot cost',async()=>{
  const f=fixture();f.player.document.x=700;
  await new TurnRunner(f.adapter).run({oneAction:true});
  const ledger=await f.adapter.readLedger(f.adapter.turnKey());
  assert.equal(ledger.actionsRemaining,1);assert.equal(ledger.attacksMade,1);assert.equal(ledger.uncertain,false);
  const attack=f.calls.find(call=>call[0]==='spell-attack');assert.ok(attack);
  assert.equal(attack[2],1);assert.equal(attack[3].target,f.player.actor);
  assert.equal(f.adapter.parts().entry.system.slots.slot1.value,3);
});

test('empty rank-1 slots remove slotted spells while retaining both combat cantrips',async()=>{
  const f=fixture();f.adapter.parts().entry.system.slots.slot1.value=0;
  const s=await snapshot(f);const casts=castingCandidates(s);
  assert.ok(casts.some(c=>c.spellSlug==='ignition'));
  assert.ok(casts.every(c=>!['breathe-fire','grease'].includes(c.spellSlug)));
  assert.equal(castingCandidates({...s,actionsRemaining:1}).length,0);
});

test('Breathe Fire uses one native slot, one shared damage roll, basic saves and no attack MAP',async()=>{
  const f=fixture();f.player.document.x=400;f.player.document.y=200;f.addEnemy('second',400,300);
  const s=await snapshot(f),choice=cast(s,'breathe-fire');assert.ok(choice);
  const ledger={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1};
  const before=f.player.actor.hitPoints.value;
  const result=await f.adapter.execute(choice,ledger,{canContinue:()=>true});
  assert.equal(result.resolved,true);assert.equal(choice.mapIncreases,0);
  assert.equal(f.adapter.parts().entry.system.slots.slot1.value,2);
  assert.equal(f.player.actor.hitPoints.value,before-7);
  assert.equal(f.calls.filter(call=>call[0]==='spell-damage-message').length,1);
  assert.equal(f.calls.some(call=>call[0]==='flat-message'),false,'areas do not make concealment targeting checks');
  const region=f.calls.find(call=>call[0]==='create-region');
  assert.equal(region[1][0].flags['pf2e-toolbelt'].targetHelper.skip,true,'AI areas bypass Toolbelt targeting prompts');
  assert.equal(region[2].renderSheet,false,'AI placement does not open the Region sheet');
});

test('cone scoring avoids allies and planning has no slot, condition, region or roll mutations',async()=>{
  const f=fixture();f.player.document.x=400;f.player.document.y=200;f.addEnemy('second',400,300);
  const s=await snapshot(f),fire=cast(s,'breathe-fire');assert.ok(fire);
  const spell=s.spells.find(spell=>spell.slug==='breathe-fire'),area=fire.area;
  const dangerous={...s,spells:[{...spell,areas:[{...area,bystanders:[{}, {}, {}]}]}]};
  assert.equal(castingCandidates(dangerous).length,0);
  assert.equal(f.calls.length,0);assert.equal(canvas.scene.regions.contents.length,0);
});

test('native melee Ignition uses its d6 overlay and advances spell attack MAP exactly once',async()=>{
  const f=fixture();f.player.document.x=300;const s=await snapshot(f),choice=cast(s,'ignition');assert.ok(choice.melee);
  const ledger={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1,attacksMade:2};
  const before=f.player.actor.hitPoints.value;
  await f.adapter.execute(choice,ledger,{canContinue:()=>true});
  assert.equal(before-f.player.actor.hitPoints.value,7);
  assert.equal(f.calls.find(call=>call[0]==='spell-attack')[2],2);
});

test('Tangle Vine applies the native effect without a degree prompt and avoids redundant control',async()=>{
  const f=fixture({degree:3});f.player.document.x=600;const s=await snapshot(f),choice=cast(s,'tangle-vine');assert.ok(choice);
  await f.adapter.execute(choice,{...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1,attacksMade:1},{canContinue:()=>true});
  const created=f.calls.find(call=>call[0]==='create-effects'&&call[1]===f.player.actor.id)[2][0];
  assert.equal(created.system.rules[0].selection,'critical-success');assert.equal(created.flags[ns].escapeDC,16);
  const after=await snapshot(f);assert.equal(castingCandidates(after).some(c=>c.spellSlug==='tangle-vine'),false);
});

test('critical Reactive Strike disruption spends the committed spell slot and prevents all spell effects',async()=>{
  const f=fixture();f.player.document.x=400;f.addEnemy('second',400,300);
  const choice=cast(await snapshot(f),'breathe-fire');assert.ok(choice);
  f.reactions.action=async()=>({disrupted:true});
  const result=await f.adapter.execute(choice,{...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1},{canContinue:()=>true});
  assert.match(result.note,/disrupted/);assert.equal(f.adapter.parts().entry.system.slots.slot1.value,2);
  assert.equal(f.calls.some(call=>call[0]==='spell-save'||call[0]==='spell-damage-message'),false);
});

test('basic Reflex degrees apply zero, half, full and double of a shared native damage roll',async()=>{
  for(const [saveDegree,multiplier]of [[3,0],[2,0.5],[1,1],[0,2]]){
    const f=fixture({saveDegree});f.player.document.x=400;f.addEnemy('second',400,300);
    const choice=cast(await snapshot(f),'breathe-fire');assert.ok(choice);
    const before=f.player.actor.hitPoints.value;
    await f.adapter.execute(choice,{...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1},{canContinue:()=>true});
    assert.equal(before-f.player.actor.hitPoints.value,7*multiplier);
    assert.equal(f.calls.filter(call=>call[0]==='spell-damage-message').length,1);
  }
});

test('rolls-only mode leaves damage buttons available, applies no HP changes and pauses',async()=>{
  const f=fixture();f.flags.set(`token-boss:${ns}:config`,{...f.adapter.config,applyDamage:false});
  const s=await snapshot(f),choice=cast(s,'ignition'),before=f.player.actor.hitPoints.value;
  const result=await f.adapter.execute(choice,{...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1,attacksMade:1},{canContinue:()=>true});
  assert.equal(result.pause,true);assert.equal(f.player.actor.hitPoints.value,before);
  const message=f.calls.find(call=>call[0]==='spell-damage-message');assert.equal(message[2].flags.pf2e.suppressDamageButtons,false);
});

test('failed grabbed and stupefied casting checks keep committed actions but prevent spell effects',async()=>{
  for(const condition of ['grabbed','stupefied']){
    const f=fixture();f.actor.conditionsSet.add(condition);f.flatTotal=1;
    const choice=cast(await snapshot(f),'ignition');assert.ok(choice);
    const result=await f.adapter.execute(choice,{...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1,attacksMade:1},{canContinue:()=>true});
    assert.match(result.note,/flat check failed/);
    assert.equal(f.calls.some(call=>call[0]==='spell-attack'),false);
  }
});

test('caster holds range after casting instead of using its last action to approach melee',async()=>{
  const f=fixture();f.player.document.x=700;
  const l=await new TurnRunner(f.adapter).run();
  assert.equal(f.calls.filter(call=>call[0]==='spell-attack').length,1);
  assert.equal(f.calls.some(call=>call[0]==='move'),false);assert.equal(l.done,true);
  assert.equal(l.completionReason,'no-useful-actions');assert.equal(l.actionsRemaining,1);
});

test('a safely completed caster turn can auto-advance with an unused action',async()=>{
  const f=fixture();f.player.document.x=700;
  f.flags.set(`token-boss:${ns}:config`,{...f.adapter.config,autoAdvance:true});
  const l=await new TurnRunner(f.adapter).run();assert.equal(l.advanced,true);
  assert.equal(f.calls.filter(call=>call[0]==='next-turn').length,1);
});

test('a targeted failed flat check spends the spell attack MAP without rolling an attack',async()=>{
  const f=fixture();f.player.actor.conditionsSet.add('hidden');f.flatTotal=1;
  const choice=cast(await snapshot(f),'ignition');assert.ok(choice);
  const result=await f.adapter.execute(choice,{...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1,attacksMade:1},{canContinue:()=>true});
  assert.match(result.note,/targeting flat check failed/);assert.equal(choice.mapIncreases,1);
  assert.equal(f.calls.some(call=>call[0]==='spell-attack'),false);
});

test('Alt+W recognizes the supplied caster, saves its settings and runs its native spell turn',async()=>{
  const f=fixture(),hooks=new Map();f.player.document.x=700;
  globalThis.libWrapper={register:()=>{}};
  globalThis.Hooks={once:(name,fn)=>hooks.set(name,fn),on:(name,fn)=>hooks.set(name,fn)};
  game.modules.set(ns,{});
  const profiles=JSON.parse(await readFile(new URL('../profiles/creatures.json',import.meta.url)));
  globalThis.fetch=async()=>({ok:true,json:async()=>profiles});
  globalThis.foundry={applications:{api:{DialogV2:{wait:async dialog=>{
    assert.match(dialog.content,/Goblin Pyro/);assert.match(dialog.content,/Breathe Fire/);assert.match(dialog.content,/Use Goblin Scuttle automatically/);
    return dialog.buttons.find(button=>button.action==='run').callback({}, {form:{elements:{targetMode:{value:'alliance'},
      autoRun:{checked:false},autoAdvance:{checked:false},applyDamage:{checked:true},pauseForReactions:{checked:true},autoReactions:{checked:true}}}});
  }}}}};
  const main=await import('../src/foundry/main.mjs?pyro-controls');await hooks.get('ready')();
  const ledger=await main.openControls(f.boss);
  assert.equal(typeof game.modules.get(ns).api.behaviors.configure,'function');
  assert.equal(ledger.attacksMade,1);assert.equal(ledger.done,true);assert.equal(f.adapter.config.packMorale,false);
  assert.equal(game.modules.get(ns).api.version,'0.33.0');
});
