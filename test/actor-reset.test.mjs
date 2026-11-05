import test from 'node:test';
import assert from 'node:assert/strict';
import { resetActorsToPrototype } from '../src/foundry/actor-reset.mjs';
import {quillSupply} from '../src/foundry/spike-supply.mjs';

const ns = 'foundry-creature-ai';
function fixture() {
  const flags = { config: { enabled: true, autoAdvance: true, targetIds: ['other'], refuseCount: 0, crossbowLoaded: false },
    ledger: { done: true, actionsRemaining: 0 }, scoutGear: { loaded: false }, scoutMotion: { entries: [1] },
    casterTargets: { combatId: 'combat', entries: { other: { role: 'melee' } } },
    pyroActions: { turn:'old',hideAttempted:true,holdTurns:2 },
    manticoreHunts:{combatId:'combat',hits:{other:3}},quillShown:{combatId:'combat'},
    behaviorState: {planId:'avoiding'},behaviorActions:{turn:'old'},behaviors:{preferredPlan:'defensive'},
    retreated: { combatId: 'combat' }, escapeSources: { restraint: { dc: 20 } } };
  const prototype = { name: 'Scout prototype', system: { attributes: { hp: { value: 12, max: 16, temp: 0 } },
    resources: { focus: { value: 2 } } }, items: [
    { _id: 'bolts', type: 'ammo', system: { quantity: 20 } },
    { _id: 'bow', type: 'weapon', system: { equipped: { carryType: 'held', handsHeld: 2 } } },
    { _id: 'spells', type: 'spellcastingEntry', system: { slots: { slot1: { value: 3, prepared: [{ expended: false }] } } } },
  ], flags: { [ns]: {} } };
  const base = structuredClone(prototype);
  base.prototypeToken = { getFlag: () => ({ refuseCount: 7, crossbowLoaded: true }) };
  const calls = [];
  let actor = { system: { attributes: { hp: { value: 0 } } }, items: [{ _id: 'bow', system: { equipped: { handsHeld: 0 } } }],
    getFlag: () => ({ spent: true }) };
  const document = { id: 'scout', parent: { id: 'scene' }, actorLink: false, baseActor: base,
    x: 315, y: 490, elevation: 10, name: 'Scout 4', texture: { src: 'custom.webp' },
    get actor() { return actor; }, getFlag: (namespace, key) => flags[key],
    async update(changes) {
      calls.push(['tokenUpdate', changes]);
      for (const [path, value] of Object.entries(changes)) {
        const keys = path.split('.').slice(2);
        if (keys[0].startsWith('-=')) delete flags[keys[0].slice(2)];
        else if (keys.length === 2) flags[keys[0]][keys[1]] = value;
      }
    },
    delta: { async restore() {
      calls.push(['restore']); actor = structuredClone(prototype);
      actor.isDead = false;
      actor.getFlag = (namespace, key) => actor.flags[namespace]?.[key];
      actor.unsetFlag = async (namespace, key) => { delete actor.flags[namespace][key]; };
      return actor;
    } },
  };
  const token = { id: 'scout', name: 'Scout 4', document, get actor() { return document.actor; } };
  const combat = { id: 'combat', scene: { id: 'scene' }, combatants: [{ id: 'c1', tokenId: 'scout', sceneId: 'scene', defeated: true },
    { id: 'foreign', tokenId: 'scout', sceneId: 'elsewhere', defeated: true }],
    getFlag: () => ({ brokenPack: { members: [{ id: 'scout' }], broken: true }, otherPack: { members: [{ id: 'other' }] } }),
    async updateEmbeddedDocuments(type, updates) {
      calls.push(['combatants', updates]);
      for (const update of updates) Object.assign(this.combatants.find(c => c.id === update._id), update);
    },
    async update(changes) { calls.push(['combatUpdate', changes]); },
  };
  globalThis.game = { user: { id: 'gm', isGM: true }, users: { activeGM: { id: 'gm' } }, combats: [combat] };
  globalThis.canvas = { ready: true, scene: { id: 'scene' }, tokens: { controlled: [token], placeables: [token] } };
  return { token, document, flags, prototype, base, calls, combat };
}

test('prototype reset recovers deleted ammunition, HP, spell slots and equipment without editing base or placement', async () => {
  const f = fixture(), originalBase = structuredClone(f.prototype);
  const report = await resetActorsToPrototype();
  assert.equal(report.restored.length, 1); assert.deepEqual(report.errors, []);
  assert.equal(f.token.actor.system.attributes.hp.value, 12, 'saved prototype HP rather than maximum');
  assert.equal(f.token.actor.system.resources.focus.value, 2);
  assert.equal(f.token.actor.items.find(i => i._id === 'bolts').system.quantity, 20);
  assert.equal(f.token.actor.items.find(i => i._id === 'bow').system.equipped.handsHeld, 2);
  assert.equal(f.token.actor.items.find(i => i._id === 'spells').system.slots.slot1.prepared[0].expended, false);
  assert.deepEqual(f.base.system, originalBase.system); assert.deepEqual(f.base.items, originalBase.items);
  assert.deepEqual([f.document.x, f.document.y, f.document.elevation, f.document.name, f.document.texture.src],
    [315, 490, 10, 'Scout 4', 'custom.webp']);
  assert.deepEqual(f.flags.config, { enabled: true, autoAdvance: true, targetIds: ['other'], refuseCount: 7, crossbowLoaded: true });
  assert.equal(f.flags.ledger, undefined); assert.equal(f.flags.scoutGear, undefined); assert.equal(f.flags.scoutMotion, undefined);
  assert.equal(f.flags.casterTargets, undefined);
  assert.equal(f.flags.pyroActions, undefined);
  assert.equal(f.flags.manticoreHunts,undefined);
  assert.equal(f.flags.quillShown,undefined);
  assert.equal(f.flags.behaviorState,undefined);assert.equal(f.flags.behaviorActions,undefined);
  assert.deepEqual(f.flags.behaviors,{preferredPlan:'defensive'});
  assert.equal(f.flags.retreated, undefined); assert.deepEqual(f.flags.escapeSources, { restraint: { dc: 20 } });
  assert.equal(f.combat.combatants[0].defeated, false); assert.equal(f.combat.combatants[1].defeated, true);
  assert.deepEqual(f.calls.find(c => c[0] === 'combatUpdate')[1], { [`flags.${ns}.packs.-=brokenPack`]: null });
});

test('reset prunes other observers memories only for the restored actors', async () => {
  const f = fixture(), memory = { targetMemory: { entries: [{ id: 'scout' }, { id: 'unrelated' }] },
    perception: { entries: [{ subjectId: 'scout' }, { subjectId: 'unrelated' }] },
    stealth: { entries: [{ observerId: 'scout' }, { observerId: 'unrelated' }] },
    stealthBelief: { entries: [{ observerId: 'scout' }, { observerId: 'unrelated' }] }, scoutFocus: { targetId: 'scout' },
    casterTargets: { combatId: 'combat', entries: { scout: { role: 'ranged' }, unrelated: { role: 'melee' } } },
    manticoreHunts:{combatId:'combat',hits:{scout:2,unrelated:1}} };
  canvas.tokens.placeables.push({ id: 'observer', document: { getFlag: (namespace, key) => memory[key],
    setFlag: async (namespace, key, value) => { memory[key] = value; }, unsetFlag: async (namespace, key) => { delete memory[key]; } } });
  await resetActorsToPrototype();
  assert.deepEqual(memory.targetMemory.entries, [{ id: 'unrelated' }]);
  assert.deepEqual(memory.perception.entries, [{ subjectId: 'unrelated' }]);
  assert.deepEqual(memory.stealth.entries, [{ observerId: 'unrelated' }]);
  assert.deepEqual(memory.stealthBelief.entries, [{ observerId: 'unrelated' }]);
  assert.equal(memory.scoutFocus, undefined);
  assert.deepEqual(memory.casterTargets, { combatId: 'combat', entries: { unrelated: { role: 'melee' } } });
  assert.deepEqual(memory.manticoreHunts,{combatId:'combat',hits:{unrelated:1}});
});

test('linked actors and missing prototypes are skipped before any reset or AI pause', async () => {
  const f = fixture(); f.document.actorLink = true;
  let pauses = 0;
  let report = await resetActorsToPrototype({ beforeReset: async () => { pauses++; } });
  assert.match(report.skipped[0].reason, /linked actor/); assert.equal(pauses, 0); assert.deepEqual(f.calls, []);
  f.document.actorLink = false; f.document.baseActor = null;
  report = await resetActorsToPrototype(); assert.match(report.skipped[0].reason, /missing/);
});

test('only the active GM can reset selected scene actors', async () => {
  const f = fixture(); game.user.isGM = false;
  await assert.rejects(resetActorsToPrototype(), /active GM/);
  game.user.isGM = true; game.users.activeGM.id = 'another-gm';
  await assert.rejects(resetActorsToPrototype(), /active GM/);
  game.users.activeGM.id = 'gm'; canvas.tokens.controlled = [];
  await assert.rejects(resetActorsToPrototype(), /Select the tokens/);
  canvas.tokens.controlled = [f.token]; canvas.ready = false;
  await assert.rejects(resetActorsToPrototype(), /View the scene/); assert.deepEqual(f.calls, []);
});

test('batch reset deduplicates selected tokens, reports failures and always finishes lifecycle cleanup', async () => {
  const f = fixture(), bad = { ...f.token, id: 'broken', name: 'Broken', document: { ...f.document,
    delta: { restore: async () => { throw new Error('write rejected'); } } } };
  let paused = false, cleaned = false;
  const report = await resetActorsToPrototype({ tokens: [bad, f.token, f.token],
    beforeReset: async () => { paused = true; }, afterReset: async () => { cleaned = true; } });
  assert.equal(paused, true); assert.equal(cleaned, true);
  assert.equal(report.restored.length, 1); assert.equal(report.errors.length, 1);
  assert.match(report.errors[0].reason, /write rejected/); assert.equal(f.calls.filter(c => c[0] === 'restore').length, 1);
});

test('baseline conditions and resource values replace temporary combat effects and reset can be repeated', async () => {
  const f = fixture();
  f.prototype.items.push({ _id: 'baseline-condition', type: 'condition', system: { slug: 'clumsy' } });
  f.prototype.flags[ns].reaction = { spent: true };
  f.token.actor.items.push({ _id: 'combat-condition', type: 'condition', system: { slug: 'dying' } });
  await resetActorsToPrototype();
  assert.ok(f.token.actor.items.some(i => i._id === 'baseline-condition'));
  assert.ok(!f.token.actor.items.some(i => i._id === 'combat-condition'));
  assert.equal(f.token.actor.getFlag(ns, 'reaction'), undefined);
  assert.equal(f.prototype.flags[ns].reaction.spent, true, 'baseline reaction flag itself is untouched');
  f.token.actor.items.find(i => i._id === 'bolts').system.quantity = 1;
  const report = await resetActorsToPrototype();
  assert.equal(report.restored.length, 1);
  assert.equal(f.token.actor.items.find(i => i._id === 'bolts').system.quantity, 20);
});

test('prototype reset restores the saved quill supply along with the actor delta',async()=>{
 const f=fixture();f.prototype.flags[ns].quills={spent:[{time:0,count:4}]};
 await resetActorsToPrototype();assert.equal(quillSupply(f.token.actor).remaining,8);
 f.token.actor.flags[ns].quills={spent:[{time:0,count:12}]};
 await resetActorsToPrototype();assert.equal(quillSupply(f.token.actor).remaining,8);
});
