// Table policy: the strongest active compulsion directs the turn. Conditions
// remain present for their other effects (notably Confused reaction denial).
export const DIRECTIVE_PRECEDENCE=Object.freeze(['fleeing','confused','controlled']);
export function conditionDirective(actor){return DIRECTIVE_PRECEDENCE.find(slug=>actor?.hasCondition?.(slug))??null;}
export const directiveOverrides=(actor,slug)=>{
  const selected=conditionDirective(actor);
  return selected!==null&&selected!==slug&&DIRECTIVE_PRECEDENCE.includes(slug);
};
