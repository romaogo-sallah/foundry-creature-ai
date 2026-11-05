import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/dero-fixture.mjs';
import {enableSelectedFullAuto} from '../src/foundry/bulk-controls.mjs';
const ns='foundry-creature-ai';
test('full auto enables selected NPCs while retaining resources, targets and existing preferences',async()=>{
 const f=fixture(),config={enabled:false,autoRun:false,autoAdvance:false,applyDamage:false,pauseForReactions:true,targetMode:'manual',targetIds:[f.player.id],refuseCount:3};
 await f.boss.document.setFlag(ns,'config',config);
 const beforeItems=[...f.actor.items.keys()],beforeHP=f.actor.hitPoints.value;
 const report=await enableSelectedFullAuto({tokens:[f.boss,f.boss,f.player],reactions:f.reactions});
 assert.equal(report.enabled.length,1);assert.equal(report.skipped.length,1);assert.deepEqual(report.errors,[]);
 assert.deepEqual(f.boss.document.getFlag(ns,'config'),{...config,enabled:true,autoRun:true,autoAdvance:true});
 assert.equal(f.actor.hitPoints.value,beforeHP);assert.deepEqual([...f.actor.items.keys()],beforeItems);
 assert.equal(f.calls.some(c=>c[0]==='move'||c[0]==='spell-save'),false);
});
test('fresh aligned NPCs use default damage application and alliance targeting',async()=>{
 const f=fixture();f.flags.delete('token-boss:foundry-creature-ai:config');
 const report=await enableSelectedFullAuto({tokens:[f.boss]});assert.equal(report.enabled.length,1);
 assert.deepEqual(f.boss.document.getFlag(ns,'config'),{applyDamage:true,enabled:true,autoRun:true,autoAdvance:true});
});
test('neutral NPCs without saved targets and linked NPCs do not get unusable automatic settings',async()=>{
 const f=fixture();f.actor.alliance=null;
 const report=await enableSelectedFullAuto({tokens:[f.boss]});assert.equal(report.errors.length,1);assert.match(report.errors[0].reason,/manual targets/);
 f.boss.document.actorLink=true;
 const linked=await enableSelectedFullAuto({tokens:[f.boss]});assert.equal(linked.skipped.length,1);
});
test('full auto requires selected tokens and the active GM',async()=>{
 const f=fixture();await assert.rejects(enableSelectedFullAuto({tokens:[]}),/Select/);
 game.user.isGM=false;await assert.rejects(enableSelectedFullAuto({tokens:[f.boss]}),/active GM/);
});
