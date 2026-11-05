import { ogreCapabilities, rangedPreparationScore } from './ogre-boss.mjs';

export const OGRE_SOURCE = 'Compendium.pf2e.pfs-season-1-bestiary.Actor.DsEg9sT7jCcsuEDI';
export const ogreProfile = { id: 'ogre', label: 'Ogre', roles: ['bruiser'],
  capabilities: ['recovery', 'perception', 'strikes', 'ogre-equipment', 'movement'] };

ogreCapabilities.registerCapability('ogre-equipment', state => {
  if (state.actionsRemaining < 1 || state.retreatComplete || state.self.unable || state.self.restrained || state.morale?.broken) return [];
  if (!state.hookReady && state.meleeHasItem) return [{ id: 'draw-axe', kind: 'drawMelee', actionCost: 1,
    legal: true, provokes: true, assessment: { value: state.self.averageDamage },
    scoringTerms: [{ label: 'Draw the linked melee weapon', contribution: state.self.averageDamage }] }];
  if (state.javelinHeld || state.refuseHeld ||
    state.enemies.some(enemy => enemy.strikes?.[state.hookId]?.usable)) return [];
  return state.strikes.filter(strike => strike.ranged && (strike.id === state.refuseId ? state.refuseCount > 0 : state.javelins > 0)).flatMap(strike => {
    const targets = state.enemies.filter(enemy => enemy.strikes?.[strike.id]?.inReach && enemy.lineOfEffect);
    if (!targets.length) return [];
    const preparingNextTurn=state.actionsRemaining===1;
    const value = Math.max(...targets.map(enemy => rangedPreparationScore(preparingNextTurn?{...state,attacksMade:0}:state,strike,enemy))) * (preparingNextTurn?0.4:1);
    const show = strike.id === state.refuseId && state.style?.enabled && !state.shownAbilities.refuse ? state.style.showcaseBonus ?? 4 : 0;
    return [{ id: `prepare:${strike.id}`, kind: strike.id === state.refuseId ? 'drawRefuse' : 'drawJavelin',
      actionCost: 1, legal: true, provokes: true, assessment: { value: value + show },
      scoringTerms: [{ label: 'Prepare a ranged attack with ammunition available', contribution: value },
        { label: 'Show the Refuse attack', contribution: show }] }];
  });
}).registerProfile(ogreProfile);
