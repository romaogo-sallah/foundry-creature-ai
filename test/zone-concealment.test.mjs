import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/ogre-fixture.mjs';
import { ZoneConcealment, syncZoneConcealment, hasUnmanagedConcealment, isZoneConcealment, occupantConcealment } from '../src/foundry/zone-concealment.mjs';
import { environmentBetween } from '../src/foundry/environment-zones.mjs';
import { environmentBehavior } from '../src/foundry/terrain-contract.mjs';
import { concealmentCheck } from '../src/foundry/environment-rolls.mjs';

const ns = 'foundry-creature-ai';
function setup() {
  const f = fixture({ footprint: 1 });
  game.pf2e.ConditionManager = { getCondition: slug => ({ toObject: () => ({ _id: 'template', name: 'Concealed', type: 'condition',
    img: 'concealed.webp', system: { slug, rules: [] }, flags: { pf2e: {} } }) }) };
  for (const token of canvas.tokens.placeables) {
    const actor = token.actor, has = actor.hasCondition;
    actor.conditions = { bySlug: slug => [...actor.items.values()].filter(item => item.type === 'condition' && item.slug === slug) };
    actor.hasCondition = (...slugs) => has(...slugs) || slugs.some(slug => actor.conditions.bySlug(slug).length);
  }
  const region = { id: 'foliage', hidden: false, levels: new Set(['ground']), parent: canvas.scene,
    behaviors: { contents: [environmentBehavior({ enabled: true, cover: 'none', coverMode: 'occupants', concealment: 'occupants' })] },
    testPoint: point => point.x >= 500 && point.x <= 650 && point.y >= 200 && point.y <= 300 && point.elevation >= 0 && point.elevation < 10 };
  canvas.scene.regions.contents.push(region);
  return { ...f, region, owned: actor => actor.conditions.bySlug('concealed').filter(isZoneConcealment),
    manual: async actor => (await actor.createEmbeddedDocuments('Item', [game.pf2e.ConditionManager.getCondition('concealed').toObject()]))[0] };
}

test('zone entry creates one native Concealed item and exit deletes only that tagged source', async () => {
  const f = setup();
  assert.equal((await syncZoneConcealment(canvas.scene)).created, 1);
  const item = f.owned(f.player.actor)[0];
  assert.equal(item.type, 'condition'); assert.equal(item.slug, 'concealed'); assert.notEqual(item.id, 'template');
  assert.deepEqual(item.flags[ns].zoneConcealment.tokenIds, ['fighter']);
  assert.equal(f.player.actor.hasCondition('concealed'), true);
  assert.deepEqual(await syncZoneConcealment(canvas.scene), { created: 0, removed: 0, updated: 0, sharedActorSkipped: 0 });
  f.player.document.x = 700;
  assert.equal((await syncZoneConcealment(canvas.scene)).removed, 1);
  assert.equal(f.player.actor.hasCondition('concealed'), false);
});

test('overlapping zones keep one condition until the final enabled source disappears', async () => {
  const f = setup(), second = { ...f.region, id: 'second', behaviors: { contents: [structuredClone(f.region.behaviors.contents[0])] } };
  canvas.scene.regions.contents.push(second);
  await syncZoneConcealment(canvas.scene);
  assert.deepEqual(f.owned(f.player.actor)[0].flags[ns].zoneConcealment.regionIds, ['foliage', 'second']);
  f.region.behaviors.contents[0].disabled = true;
  assert.equal((await syncZoneConcealment(canvas.scene)).updated, 1);
  assert.equal(f.owned(f.player.actor).length, 1);
  canvas.scene.regions.contents.splice(1, 1);
  assert.equal((await syncZoneConcealment(canvas.scene)).removed, 1);
});

test('manual and granted concealment are preserved without adding a duplicate condition', async () => {
  const f = setup(), manual = await f.manual(f.player.actor);
  manual.isLocked = true;
  assert.equal((await syncZoneConcealment(canvas.scene)).created, 0);
  assert.equal(hasUnmanagedConcealment(f.player.actor), true);
  f.player.document.x = 700;
  await syncZoneConcealment(canvas.scene);
  assert.equal(f.player.actor.items.has(manual.id), true);
});

test('manual concealment added inside takes over; removing it restores the zone source', async () => {
  const f = setup(); await syncZoneConcealment(canvas.scene);
  const manual = await f.manual(f.player.actor);
  assert.equal((await syncZoneConcealment(canvas.scene)).removed, 1);
  assert.equal(f.player.actor.items.has(manual.id), true); assert.equal(f.owned(f.player.actor).length, 0);
  await f.player.actor.deleteEmbeddedDocuments('Item', [manual.id]);
  assert.equal((await syncZoneConcealment(canvas.scene)).created, 1);
  assert.equal(hasUnmanagedConcealment(f.player.actor), false);
});

test('condition membership uses native sight height, level, holes and completed source position', () => {
  const f = setup(), document = f.player.document;
  document._source = { x: 500, y: 200, width: 1, height: 1, depth: 1, elevation: 0, level: 'ground' };
  document.x = 900; // Rendered animation must not determine condition membership.
  document.getVisionOrigin = source => ({ x: source.x + 50, y: source.y + 50, elevation: source.elevation + 2.5 });
  assert.deepEqual(occupantConcealment(document), ['foliage']);
  document._source.elevation = 20; assert.deepEqual(occupantConcealment(document), []);
  document._source.elevation = 0; document._source.level = 'upstairs'; assert.deepEqual(occupantConcealment(document), []);
  document._source.level = 'ground'; f.region.testPoint = () => false; assert.deepEqual(occupantConcealment(document), []);
});

test('fog crossing a sight line does not put a global condition on tokens outside it', async () => {
  const f = setup(); f.region.behaviors.contents[0].flags[ns].environment.concealment = 'through';
  f.region.testPoint = point => point.x >= 400 && point.x <= 410;
  f.region.segmentizeMovementPath = () => [{ from: { x: 400, y: 250 }, to: { x: 410, y: 250 } }];
  assert.equal((await syncZoneConcealment(canvas.scene)).created, 0);
  assert.equal(environmentBetween(f.boss, f.player).concealed, true);
});

test('only the active GM changes native condition documents', async () => {
  const f = setup(); game.user.id = 'other';
  assert.equal((await syncZoneConcealment(canvas.scene)).created, 0); assert.equal(f.owned(f.player.actor).length, 0);
});

test('shared linked actors do not impose an inside token condition on an outside duplicate', async () => {
  const f = setup(); f.player.document.actorLink = true;
  const duplicate = f.token('linked-copy', f.player.actor, 700, 200); duplicate.document.actorLink = true;
  const first = await syncZoneConcealment(canvas.scene);
  assert.equal(first.sharedActorSkipped, 1); assert.equal(first.created, 0);
  duplicate.document.x = 500;
  assert.equal((await syncZoneConcealment(canvas.scene)).created, 1);
  assert.deepEqual(f.owned(f.player.actor)[0].flags[ns].zoneConcealment.tokenIds, ['fighter', 'linked-copy']);
});

test('queued refreshes serialize condition writes and reconcile movement during an awaited creation', async () => {
  const f = setup(), controller = new ZoneConcealment(), actor = f.player.actor, create = actor.createEmbeddedDocuments;
  let release; const gate = new Promise(resolve => release = resolve);
  actor.createEmbeddedDocuments = async (...args) => { await gate; return create(...args); };
  const first = controller.refresh();
  await Promise.resolve(); await Promise.resolve();
  f.player.document.x = 700; const second = controller.refresh();
  assert.equal(first, second); release(); await first;
  assert.equal(f.owned(actor).length, 0);
  assert.equal(f.calls.filter(call => call[0] === 'create-effects' && call[1] === actor.id).length, 1);
});

test('refresh recovers stale sources after a scene change or a reload', async () => {
  const f = setup(); await syncZoneConcealment(canvas.scene);
  const previous = canvas.scene;
  canvas.scene = { id: 'other', tokens: { contents: [] }, regions: { contents: [] } };
  game.scenes.contents.push(canvas.scene);
  await new ZoneConcealment().refresh();
  assert.equal(f.owned(f.player.actor).length, 0);
  canvas.scene = previous; f.region.hidden = true;
  await new ZoneConcealment().refresh(); assert.equal(f.owned(f.player.actor).length, 0);
});

test('zone Concealed remains an observed AI target, allows reactions and rolls exactly one flat check', async () => {
  const f = setup(); await syncZoneConcealment(canvas.scene);
  assert.equal(f.player.actor.hasCondition('concealed'), true);
  assert.equal(hasUnmanagedConcealment(f.player.actor), false);
  assert.equal(f.adapter.assessTarget(f.player.id).target, f.player);
  const state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.enemies[0].awareness.state, 'observed'); assert.equal(state.enemies[0].concealmentDC, 5);
  assert.equal(f.reactions.meleeStrikes(f.boss, f.player).length, 0, 'target initially out of reach');
  f.boss.document.x = 400;
  assert.ok(f.reactions.meleeStrikes(f.boss, f.player).length > 0);
  let rolls = 0;
  globalThis.Roll = class { async evaluate() { rolls++; this.total = 5; return this; } async toMessage() {} };
  assert.equal(await concealmentCheck(f.boss, f.player), true); assert.equal(rolls, 1);
});
