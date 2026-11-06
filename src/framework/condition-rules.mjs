// Pure action rules: both AI candidates and manual Foundry adapters consume
// these facts. Numeric modifiers, immunities and effect durations stay native.
const movement=new Set(['stride','step','sneak','crawl','stand','escapeStride','fly','eagleDive','scamper','climb','swim','burrow','jump']);
const attacks=new Set(['strike','trip','knockdown','sweepingHook','spikeVolley','eagleDive','escape','force-open']);
const handling=new Set(['reload','regrip','drawMelee','drawJavelin','drawRefuse','drawSword','stow','stowSword','gripBow']);
export function ruleAction(action){
  const traits=new Set(action.traits??[]);
  if(movement.has(action.kind))traits.add('move');
  if(attacks.has(action.kind))traits.add('attack');
  if(handling.has(action.kind))traits.add('manipulate');
  if(['sustainSpell','seek'].includes(action.kind)||action.kind==='castSpell'&&!action.traits)traits.add('concentrate');
  if(action.kind==='castSpell'&&!action.traits)traits.add('manipulate');
  if(action.kind==='bellow')traits.add('auditory');
  return {...action,traits:[...traits]};
}
export function conditionViolation(facts={},input){
  const action=ruleAction(input),has=trait=>action.traits.includes(trait);
  if(action.kind==='endTurn')return null;
  if(facts.fleeing&&!action.reaction&&!has('move')&&!['escape','force-open','forceOpen','interact','open','open-a-door'].includes(action.kind))return 'Fleeing: use actions to escape the source.';
  if(facts.restrained&&(has('attack')||has('manipulate'))&&!['escape','force-open','forceOpen'].includes(action.kind))return 'Restrained: only Escape or Force Open can use attack/manipulate actions.';
  if(facts.immobilized&&has('move'))return 'Immobilized: cannot use move actions.';
  if(facts.prone&&has('move')&&!['crawl','stand'].includes(action.kind))return 'Prone: only Crawl and Stand are allowed move actions.';
  if(facts.fascinated&&has('concentrate')&&!action.relatedToFascination&&
    !(action.targetIds??[action.targetId]).some(id=>id&&(facts.fascinationSubjects??[]).includes(id)))return 'Fascinated: concentrate actions must relate to the subject of fascination.';
  if(facts.sickened&&action.ingest)return 'Sickened: cannot willingly ingest food, potions or elixirs.';
  return null;
}
export function conditionFlatChecks(facts={},input){
  const action=ruleAction(input),checks=[];
  if(facts.grabbed&&action.traits.includes('manipulate'))checks.push({condition:'grabbed',dc:5});
  if(facts.deafened&&action.traits.includes('auditory'))checks.push({condition:'deafened',dc:5});
  if(facts.stupefied&&action.kind==='castSpell')checks.push({condition:'stupefied',dc:5+facts.stupefied});
  if(facts.synesthesia&&action.traits.includes('concentrate'))checks.push({condition:'synesthesia',dc:5});
  return checks;
}
export function filterConditionActions(candidates,facts){
  return candidates.map(candidate=>{
    const action={...candidate,traits:candidate.traits??facts?.actionTraits?.[candidate.spellId??candidate.strikeId]};
    const violation=conditionViolation(facts,action);
    if(violation)return {...candidate,legal:false,reason:violation};
    const checks=conditionFlatChecks(facts,action);
    const chance=checks.reduce((value,check)=>value*(21-check.dc)/20,1);
    if(chance===1||!Number.isFinite(candidate.assessment?.value)||candidate.assessment.value>=5000)return candidate;
    return {...candidate,assessment:{...candidate.assessment,value:candidate.assessment.value*chance},
      scoringTerms:[...(candidate.scoringTerms??[]),{label:'Risk of losing this action to condition flat checks',contribution:candidate.assessment.value*(chance-1)}]};
  });
}
