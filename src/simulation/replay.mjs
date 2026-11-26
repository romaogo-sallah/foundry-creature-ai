const copy=value=>structuredClone(value);

/** Convert a completed report into immutable browser-friendly playback frames. */
export function combatFrames(scenario,report){
  const actors=scenario.actors.map(actor=>({...copy(actor),maxHp:actor.maxHp??actor.hp,alive:true}));
  const frames=[{label:'Starting position',round:0,actors:copy(actors),decision:null}];
  const nameOf=id=>scenario.actors.find(actor=>actor.id===id)?.name??id;
  for(const round of report.rounds)for(const turn of round.turns)for(const [action,decision]of turn.decisions.entries()){
    const acting=actors.find(actor=>actor.id===decision.actorId),effect=decision.effect??{};
    if(effect.destination&&acting)acting.position=copy(effect.destination);
    if(effect.targetId&&effect.damage){const target=actors.find(actor=>actor.id===effect.targetId);if(target){target.hp=Math.max(0,target.hp-effect.damage);target.alive=target.hp>0;}}
    if(effect.hazardDamage&&acting){acting.hp=Math.max(0,acting.hp-effect.hazardDamage);acting.alive=acting.hp>0;}
    frames.push({label:`Round ${round.round} · ${nameOf(decision.actorId)} · decision ${action+1}`,round:round.round,actors:copy(actors),decision});
  }
  return frames;
}
