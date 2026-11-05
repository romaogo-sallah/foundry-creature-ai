import { stealthBelief, projectStealth } from './stealth-belief.mjs';
import { hidingFrom } from './stealth-awareness.mjs';
import { coverAlongPath } from './environment-zones.mjs';

export function casterStealthKnowledge(adapter, state) {
  const saved = stealthBelief(adapter.token), bonus = adapter.actor.getStatistic('stealth')?.check?.mod ?? 0;
  const observers = state.enemies.map(enemy => {
    const observer = adapter.perceivedSpellTarget(enemy);
    if (observer.memoryView) observer.checkCollision = canvas.tokens.get(enemy.id).checkCollision.bind(canvas.tokens.get(enemy.id));
    return observer;
  });
  const priors = observers.map(observer => {
    const prior = saved.find(entry => entry.observerId === observer.id) ?? { observerId: observer.id, unseenChance: 0, undetectedChance: 0 };
    return hidingFrom(observer, adapter.token).canHide ? prior : { ...prior, unseenChance: 0, undetectedChance: 0 };
  });
  const project = (destination, fresh = false) => observers.map(observer => {
    const environment = hidingFrom(observer, adapter.token, destination);
    const prior = fresh ? { observerId: observer.id, unseenChance: 0, undetectedChance: 0 } : priors.find(entry => entry.observerId === observer.id);
    return projectStealth('hide', prior, { bonus, referenceDC: state.self.referenceAC, canHide: environment.canHide, coverBonus: environment.stealthBonus });
  });
  const at = destination => {
    const estimated = project(destination), fresh = project(destination, true);
    return Object.fromEntries(observers.map(observer => {
      const environment = hidingFrom(observer, adapter.token, destination);
      return [observer.id, {
        incoming: environment,
        stealthChance: environment.blocked ? 1 : priors.find(entry => entry.observerId === observer.id).unseenChance,
        hideChance: estimated.find(entry => entry.observerId === observer.id).unseenChance,
        freshHideChance: fresh.find(entry => entry.observerId === observer.id).unseenChance,
      }];
    }));
  };
  const projectSneak=(destination,path)=>observers.map(observer=>{
    const environment=hidingFrom(observer,adapter.token,destination),prior=priors.find(entry=>entry.observerId===observer.id);
    const cover=coverAlongPath(observer,adapter.token,path.map(cell=>({x:cell.x*canvas.grid.size+adapter.token.w/2,y:cell.y*canvas.grid.size+adapter.token.h/2})));
    return projectStealth('sneak',prior,{bonus,referenceDC:state.self.referenceAC,canHide:environment.canHide,coverBonus:cover});
  });
  return { project, projectSneak, at, priors };
}
