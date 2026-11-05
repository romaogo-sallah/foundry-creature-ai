import { readFile } from 'node:fs/promises';
import { decide, resolveProfile } from '../src/decision-engine.mjs';

const profiles = JSON.parse(await readFile(new URL('../profiles/creatures.json', import.meta.url)));
// Synthetic observations, not a live Foundry snapshot or extracted game encounter.
const snapshot = {
  actionsRemaining: 3,
  self: { prone: false },
  candidates: [
    { id: 'strike-nearest', kind: 'strike', target: 'fighter', legal: true, actionCost: 1,
      features: { expectedDamage: 9, targetsNearestEnemy: 1 } },
    { id: 'strike-with-pack', kind: 'strike', target: 'rogue', legal: true, actionCost: 1,
      features: { expectedDamage: 8, allyReachValue: 1 } },
    { id: 'breath-group', kind: 'breath', legal: true, actionCost: 2,
      features: { expectedDamage: 7, enemyCount: 2, allyCount: 0 } },
    { id: 'end', kind: 'endTurn', legal: true, actionCost: 0, fallback: true, features: {} }
  ]
};

for (const id of ['standard', 'mindless', 'pack', 'dragon-example']) {
  const decision = decide(snapshot, resolveProfile(profiles, id));
  console.log(`${id}: ${decision.chosen?.id ?? 'none'} (${decision.reason})`);
}
