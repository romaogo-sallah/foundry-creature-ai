// Apparent combat roles inform estimates; actual enemy save modifiers and
// hidden check outcomes never enter this calculation.
export function estimatedSpellSave(state,spell,enemy){
 const role=enemy.tactics?.role,save=spell.save;
 const adjustment=role==='melee'?(save==='fortitude'?2:save==='will'?-1:0):
  role==='ranged'?(save==='reflex'?2:save==='fortitude'?-1:0):role==='caster'?(save==='will'?2:save==='fortitude'?-1:0):0;
 return state.self.referenceAC-10+adjustment;
}
