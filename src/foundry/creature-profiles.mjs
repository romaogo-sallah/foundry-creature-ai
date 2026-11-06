import { PF2eWolfAdapter } from './pf2e-adapter.mjs';
import { PF2eOgreAdapter } from './ogre-adapter.mjs';
import { PF2eOgreBruteAdapter } from './ogre-brute-adapter.mjs';
import { OGRE_SOURCE } from '../profiles/ogre.mjs';
import { PF2eKoboldScoutAdapter } from './kobold-scout-adapter.mjs';
import { SCOUT_SOURCE } from '../profiles/kobold-scout.mjs';
import { PF2eGoblinPyroAdapter } from './goblin-pyro-adapter.mjs';
import { PYRO_SOURCE } from '../profiles/goblin-pyro.mjs';
import { attachBehaviorSystem } from './behavior-runtime.mjs';
import { PF2eBasicNPCAdapter, basicMeleeStrikes } from './basic-npc-adapter.mjs';
import { PF2eEagleAdapter, EAGLE_SOURCE } from './eagle-adapter.mjs';
import { attachFlightSystem } from './flight-runtime.mjs';
import {PF2eManticoreAdapter,MANTICORE_SCORPION_SOURCE} from './manticore-adapter.mjs';
import {PF2eManticoreQuillAdapter,MANTICORE_QUILL_SOURCE} from './manticore-quill-adapter.mjs';
import {PF2eDeroMagisterAdapter,DERO_SOURCE} from './dero-magister-adapter.mjs';
import {attachConfusionSystem} from './confused-adapter.mjs';

const profiles = [];
export function registerCreatureProfile(profile) {
  if (!profile.id || profile.id==='basic-npc' || !profile.label || !Array.isArray(profile.roles) || typeof profile.matches !== 'function' || typeof profile.Adapter !== 'function' || profiles.some(entry => entry.id === profile.id)) {
    throw new Error('Invalid or duplicate adapter profile');
  }
  profiles.push(Object.freeze(profile));
}
registerCreatureProfile({ id: 'wolf', label: 'Wolf', roles: ['skirmisher', 'pack hunter'], Adapter: PF2eWolfAdapter,
  matches: actor => actor?.type === 'npc' && actor.system?.traits?.value?.includes('animal') &&
    actor.itemTypes?.action?.some(item => item.slug === 'knockdown') &&
    actor.itemTypes.action.some(item => item.system.rules?.some(rule => rule.key === 'RollOption' && rule.option === 'pack-attack')) });
registerCreatureProfile({ id: 'ogre-boss', label: 'Ogre Boss', roles: ['bruiser', 'leader'], Adapter: PF2eOgreAdapter,
  matches: actor => actor?.type === 'npc' && ((actor.sourceId ?? actor._stats?.compendiumSource)?.endsWith('oopxVowT2jnUQJiS') ||
    actor.system?.traits?.value?.includes('giant') && actor.itemTypes?.action?.some(item => item.id === 'KxNiF9bYl6kA6FRd' || (item.slug ?? item.name.toLowerCase().replaceAll(' ', '-')) === 'bellowing-command')) });
registerCreatureProfile({ id: 'ogre', label: 'Ogre', roles: ['bruiser'], Adapter: PF2eOgreBruteAdapter,
  matches: actor => actor?.type === 'npc' && [actor.sourceId, actor._stats?.compendiumSource, actor._stats?.duplicateSource, actor.flags?.core?.sourceId]
    .some(source => source === OGRE_SOURCE || source === OGRE_SOURCE.replace('.Actor.', '.')) });
registerCreatureProfile({ id: 'kobold-scout', label: 'Kobold Scout', roles: ['skulk', 'ranged skirmisher'], Adapter: PF2eKoboldScoutAdapter,
  matches: actor => actor?.type === 'npc' && [actor.sourceId, actor._stats?.compendiumSource, actor._stats?.duplicateSource, actor.flags?.core?.sourceId]
    .some(source => source === SCOUT_SOURCE || source === SCOUT_SOURCE.replace('.Actor.', '.')) });
registerCreatureProfile({ id: 'goblin-pyro', label: 'Goblin Pyro', roles: ['caster', 'area damage', 'controller'], Adapter: PF2eGoblinPyroAdapter,
  matches: actor => actor?.type === 'npc' && [actor.sourceId, actor._stats?.compendiumSource, actor._stats?.duplicateSource, actor.flags?.core?.sourceId]
    .some(source => source === PYRO_SOURCE || source === PYRO_SOURCE.replace('.Actor.', '.')) });
registerCreatureProfile({id:'eagle',label:'Eagle',roles:['flying skirmisher','diving predator'],Adapter:PF2eEagleAdapter,
  matches:actor=>actor?.type==='npc'&&[actor.sourceId,actor._stats?.compendiumSource,actor._stats?.duplicateSource,actor.flags?.core?.sourceId]
    .some(source=>source===EAGLE_SOURCE||source===EAGLE_SOURCE.replace('.Actor.','.'))});
registerCreatureProfile({id:'manticore-scorpion',label:'Manticore (Scorpion Tail)',roles:['flying skirmisher','venom predator'],Adapter:PF2eManticoreAdapter,
  matches:actor=>actor?.type==='npc'&&[actor.sourceId,actor._stats?.compendiumSource,actor._stats?.duplicateSource,actor.flags?.core?.sourceId]
    .some(source=>source===MANTICORE_SCORPION_SOURCE||source===MANTICORE_SCORPION_SOURCE.replace('.Actor.','.'))&&
    actor.system.actions?.some(s=>(s.item?.attackEffects??s.item?.system.attackEffects?.value??[]).includes('manticore-venom'))});
registerCreatureProfile({id:'manticore-quill',label:'Manticore (Quill Tail)',roles:['flying skirmisher','ranged controller'],Adapter:PF2eManticoreQuillAdapter,
  matches:actor=>actor?.type==='npc'&&[actor.sourceId,actor._stats?.compendiumSource,actor._stats?.duplicateSource,actor.flags?.core?.sourceId]
    .some(source=>source===MANTICORE_QUILL_SOURCE||source===MANTICORE_QUILL_SOURCE.replace('.Actor.','.'))});
registerCreatureProfile({id:'dero-magister',label:'Dero Magister',roles:['debuffer','controller','sustained caster'],Adapter:PF2eDeroMagisterAdapter,
  matches:actor=>actor?.type==='npc'&&[actor.sourceId,actor._stats?.compendiumSource,actor._stats?.duplicateSource,actor.flags?.core?.sourceId]
    .some(source=>source===DERO_SOURCE||source===DERO_SOURCE.replace('.Actor.','.'))});
export function creatureProfile(actor) {
  const profile = profiles.find(profile => profile.matches(actor)) ?? (actor?.type==='npc'&&basicMeleeStrikes(actor).length?
    {id:'basic-npc',label:'Basic NPC',roles:['combatant'],Adapter:PF2eBasicNPCAdapter}:null);
  if (!profile) throw new Error(`No taught creature profile matches this NPC. Supported profiles: ${profiles.map(profile => profile.label).join(', ')}.`);
  return profile;
}
export function createCreatureAdapter(token, wolfProfile, options) {
  const profile = creatureProfile(token.actor);
  return attachConfusionSystem(attachBehaviorSystem(attachFlightSystem(new profile.Adapter(token, wolfProfile, options))));
}
export function supportedProfiles() { return [...profiles.map(({ id, label, roles }) => ({ id, label, roles })),
  {id:'basic-npc',label:'Basic NPC (prepared melee Strikes)',roles:['combatant']}]; }
