export function combatStamp(combat=game.combat){
  return combat?.started?`${combat.id}:${combat.round}:${combat.turn??0}:${combat.combatant?.id}`:null;
}
