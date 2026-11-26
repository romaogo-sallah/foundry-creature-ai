const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const slug=value=>String(value??'unknown').replace(/[^a-zA-Z0-9_-]/g,'-');

const ARCHETYPES={
  aggressive:{intent:'damage',delivery:['melee','ranged','spell'],posture:'exploit'},
  desperate:{intent:'damage',delivery:['melee','ranged','spell'],posture:'desperate'},
  charge:{intent:'damage',delivery:['melee'],posture:'setup'},
  ranged:{intent:'damage',delivery:['ranged'],posture:'position'},
  defensive:{intent:'survive',delivery:['melee','ranged','spell'],posture:'hold'},
  avoiding:{intent:'survive',delivery:['movement'],posture:'disengage'},
  kiting:{intent:'damage',delivery:['ranged','movement'],posture:'disengage'},
  hiding:{intent:'survive',delivery:['stealth'],posture:'setup'},
  'lay-low':{intent:'survive',delivery:['stealth'],posture:'hold'},
  swarming:{intent:'control',delivery:['melee'],posture:'setup'},
  supporting:{intent:'support',delivery:['support'],posture:'setup'},
  'spell-control':{intent:'control',delivery:['spell'],posture:'exploit'},
  'spell-damage':{intent:'damage',delivery:['spell'],posture:'exploit'},
  'spell-drain':{intent:'damage',delivery:['spell','melee'],posture:'exploit'},
  'spell-support':{intent:'support',delivery:['spell'],posture:'exploit'},
  'aerial-hunt':{intent:'damage',delivery:['flight','melee'],posture:'setup'},
  'aerial-engage':{intent:'damage',delivery:['flight','melee','ranged'],posture:'exploit'},
  'aerial-disengage':{intent:'survive',delivery:['flight'],posture:'disengage'},
};

const ACTION_INTENTS={
  stand:'recover',escape:'recover',retch:'recover',seek:'investigate',endTurn:'hold',
  strike:'damage',eagleDive:'damage',spikeVolley:'damage',castSpell:'spell',sustainSpell:'support',
  trip:'control',knockdown:'control',sweepingHook:'control',gaze:'control',grab:'control',bellow:'support',
  hide:'survive',sneak:'survive',step:'position',stride:'position',crawl:'position',escapeStride:'survive',fly:'position',
};

export function planArchetype(id,plan={}){
  const known=ARCHETYPES[id]??{};
  return {intent:plan.intent??known.intent??'damage',delivery:[...new Set(plan.delivery??known.delivery??['melee'])],
    posture:plan.posture??known.posture??'exploit'};
}

function componentAttached(configuration,id){return configuration.components?.includes(id);}
export function doctrineProfile(state){
  const context=state.behavior?.context??{},configuration=state.behavior?.configuration??{};
  const health=finite(context.health,1),forceRatio=finite(context.forceRatio,1);
  const contribution={
    damage:clamp((context.melee||context.ranged?0.55:0)+(context.immediateAttack?0.2:0)+(componentAttached(configuration,'strikes')?0.2:0)+(componentAttached(configuration,'spell-damage')?0.15:0),0,1),
    control:clamp((componentAttached(configuration,'control')?0.45:0)+(componentAttached(configuration,'spell-control')?0.45:0)+(context.pack?0.1:0),0,1),
    support:clamp((componentAttached(configuration,'leadership')?0.45:0)+(componentAttached(configuration,'spell-support')?0.45:0)+(context.supportRecipients?0.2:0),0,1),
    defense:clamp((componentAttached(configuration,'protection')?0.45:0)+(context.caster?0.2:0)+(health<0.5?0.25:0),0,1),
    scouting:clamp((componentAttached(configuration,'stealth')?0.55:0)+(context.skulk?0.3:0),0,1),
    leadership:clamp(componentAttached(configuration,'leadership')?0.75:0,0,1),
  };
  const delivery={melee:context.melee?0.9:componentAttached(configuration,'strikes')?0.4:0,
    ranged:context.ranged?0.9:context.rangedAttackAvailable?0.7:0,spell:context.caster||componentAttached(configuration,'spellcasting')?0.9:0,
    stealth:componentAttached(configuration,'stealth')?0.8:0,flight:componentAttached(configuration,'flight')||state.flight?.canFly?0.9:0,
    movement:componentAttached(configuration,'movement')?0.7:0};
  return {contribution,delivery,risk:{aggression:clamp(0.65+(forceRatio-1)*0.2-(1-health)*0.45,0,1),
    preservation:clamp((1-health)*0.65+(forceRatio<0.7?0.25:0)+(context.caster?0.1:0),0,1)},
    resources:{actions:state.actionsRemaining??0,bonusMovement:state.bonusMovementActions??0}};
}

function fact(id,label,value,detail={}){return {id:`fact-${slug(id)}`,label,value,detail};}
function engagementFor(state,enemy){
  const context=state.behavior?.context??{},speed=finite(state.self?.speed,25),reach=finite(state.self?.reachSquares,1)*5;
  const distance=finite(enemy.distance,Infinity),inReach=Boolean(enemy.inReach)||distance<=reach;
  const enemyReach=finite(enemy.tactics?.reach,5),enemySpeed=finite(enemy.tactics?.speed,25);
  return {id:`engagement-${slug(enemy.id)}`,targetId:enemy.id,targetName:enemy.name??enemy.id,distance,
    canAffectNow:inReach||Boolean(context.immediateAttack&&enemy.lineOfEffect!==false),
    actionsToAffect:inReach?0:Math.max(1,Math.ceil(Math.max(0,distance-reach)/Math.max(5,speed))),
    targetCanAffectNow:Boolean(enemy.inReach)||distance<=enemyReach,
    targetActionsToAffect:distance<=enemyReach?0:Math.max(1,Math.ceil(Math.max(0,distance-enemyReach)/Math.max(5,enemySpeed))),
    rangePenalty:finite(enemy.rangePenalty,0),cover:finite(enemy.coverBonus,0),concealmentDC:enemy.concealmentDC??null,
    visibility:enemy.awareness?.state??(enemy.lineOfSight===false?'remembered':'observed'),
    lineOfSight:enemy.lineOfSight!==false,lineOfEffect:enemy.lineOfEffect!==false};
}

/** Build the slow-changing doctrine, shared battlefield facts, engagement relations and top-K abstract hypotheses. */
export function analyzeDecisionHierarchy(state,evaluations,plans,{maxHypotheses=4,scoreBand=4}={}){
  const context=state.behavior?.context??{},doctrine=doctrineProfile(state),engagements=(state.enemies??[]).map(enemy=>engagementFor(state,enemy));
  const facts=[fact('health','Own health',context.health??1,{fraction:context.health??1}),
    fact('actions','Remaining actions',state.actionsRemaining??0),fact('known-enemies','Known enemies',context.knownEnemies??state.enemies?.length??0),
    fact('visible-enemies','Visible enemies',context.visibleEnemies??0),fact('force-ratio','Local force ratio',context.forceRatio??1),
    fact('attack-now','Useful immediate attack',Boolean(context.immediateAttack))];
  const applicable=evaluations.filter(e=>e.applicable).sort((a,b)=>b.value-a.value||a.id.localeCompare(b.id)),best=applicable[0]?.value??0;
  // A declared withdrawal is a safety directive once the actor is both badly
  // wounded and locally outmatched. Letting a high-value equipment action from
  // another intent outbid an available escape recreates the old flat-score bug.
  const preservationDirective=context.emergency||finite(context.health,1)<0.4&&finite(context.forceRatio,1)<0.6;
  const mandatory=preservationDirective&&applicable.some(e=>e.id==='avoiding');
  const survivors=applicable.filter((entry,index)=>mandatory?entry.id==='avoiding':index<maxHypotheses&&entry.value>=best-scoreBand);
  if(!survivors.length&&applicable[0])survivors.push(applicable[0]);
  const survivorIds=new Set(survivors.map(entry=>entry.id));
  const hypotheses=applicable.map((entry,index)=>{const archetype=planArchetype(entry.id,plans.get(entry.id));return {
    id:`intent-${slug(entry.id)}`,planId:entry.id,label:entry.label,intent:archetype.intent,delivery:archetype.delivery,posture:archetype.posture,
    score:entry.value,reason:entry.reason,status:survivorIds.has(entry.id)?index===0?'selected':'survived':'pruned',
    pruneReason:survivorIds.has(entry.id)?null:mandatory?'Emergency directive suppresses ordinary tactics':index>=maxHypotheses?'Outside hypothesis beam':'Below abstract score band'};});
  return {schema:'foundry-creature-ai/hierarchy-analysis@1',doctrine,facts,engagements,hypotheses,
    survivingPlanIds:survivors.map(entry=>entry.id),limits:{maxHypotheses,scoreBand},mandatoryDirective:mandatory?'survive':null};
}

function turnPlan(candidate){const plan=candidate.features?.turnPlan;if(Array.isArray(plan))return plan;
  return Array.isArray(plan?.steps)?plan.steps:[];}
export function classifyCandidate(candidate,state,selection){
  const kind=candidate.kind,features=candidate.features??{},plan=turnPlan(candidate),movement=Boolean(candidate.assessment?.movement)||['step','stride','crawl','escapeStride','fly','sneak'].includes(kind);
  let timing=features.avoidance||features.flightRetreat?'disengage':kind==='endTurn'?'hold':
    movement&&(features.goodAttacksLeft||plan.length>1||features.rangedFollowUp)?'setup-this-turn':
    movement||['hide','sneak','reload','regrip','drawMelee','drawJavelin','drawRefuse','drawSword','stow','stowSword','gripBow'].includes(kind)?'setup-next-turn':'exploit-now';
  if(['stand','escape','retch'].includes(kind))timing='mandatory-recovery';
  const contribution=features.support?'support':features.conditionSpell||['trip','knockdown','sweepingHook','gaze','grab'].includes(kind)?'control':
    ACTION_INTENTS[kind]??selection?.planning?.archetype?.intent??'damage';
  const delivery=features.spell||kind==='castSpell'||kind==='sustainSpell'?'spell':features.ranged||features.volley?'ranged':
    features.flight||['fly','eagleDive'].includes(kind)?'flight':movement?'movement':['hide','sneak'].includes(kind)?'stealth':'melee';
  return {contribution,delivery,timing,method:`${selection?.planId??'directive'}:${timing}:${delivery}`,plan,
    targetId:candidate.targetId??selection?.goal?.targetId??null};
}

function hierarchyTerms(candidate,state,selection,analysis){
  if(candidate.kind==='endTurn'&&['hiding','lay-low','avoiding'].includes(selection.planId)){
    const retained=selection.planId==='hiding'&&state.behavior?.context?.hiddenBelief?3:selection.planId==='lay-low'?0.25:1.25;
    return retained?[{label:`Retain the ${selection.label.toLowerCase()} end-state instead of abandoning it`,contribution:retained}]:[];
  }
  if(!Number.isFinite(candidate.assessment?.value)||candidate.assessment.value<0||candidate.assessment.value>=5000||
    ['stand','escape','retch','seek','endTurn'].includes(candidate.kind))return [];
  const terms=[],classification=classifyCandidate(candidate,state,selection),evaluation=selection.evaluations?.find(e=>e.id===selection.planId),top=selection.scores?.[0]?.value??evaluation?.value??0;
  const planPrior=analysis.survivingPlanIds.length>1?
    clamp((finite(evaluation?.value)-finite(top))*0.18+(selection.planId===analysis.survivingPlanIds[0]?0.35:0.1),-1,0.35):0;
  if(planPrior)terms.push({label:`Intent support: ${selection.label}`,contribution:planPrior});
  const rangePenalty=finite(candidate.features?.rangePenalty,0);
  if(candidate.features?.ranged&&rangePenalty>0){
    const base=Math.max(0.05,candidate.assessment.value),desired=Math.max(2.25,base*0.35)*(rangePenalty/2)+(candidate.features?.rangeClosingAvailable?0.75:0);
    terms.push({label:`Avoid firing with a -${rangePenalty} range penalty`,contribution:-Math.min(Math.max(0,base-0.05),desired)});
  }
  if(candidate.features?.rangeApproach||candidate.features?.rangedFollowUp){
    const penalty=finite(state.behavior?.context?.bestRangePenalty,0),gain=1.25+Math.min(3,penalty*0.5);
    terms.push({label:'Move toward an effective ranged engagement',contribution:gain});
  }
  if(classification.timing==='setup-this-turn'&&classification.plan.length>1)terms.push({label:'Setup is tied to an affordable same-turn payoff',contribution:0.5});
  if(classification.timing==='setup-next-turn'&&candidate.assessment?.goodAttacksLeft===false&&state.behavior?.context?.immediateAttack)
    terms.push({label:'Delay a currently useful attack without a documented payoff',contribution:-1});
  if(classification.targetId&&classification.targetId===selection.goal?.targetId)terms.push({label:'Advance the selected engagement hypothesis',contribution:0.35});
  return terms;
}

export function weightHierarchicalCandidate(candidate,state,selection,analysis){
  const classification=classifyCandidate(candidate,state,selection),terms=hierarchyTerms(candidate,state,selection,analysis);
  if(!Number.isFinite(candidate.assessment?.value))return {...candidate,features:{...candidate.features,planning:{planId:selection.planId,
    intent:selection.planning?.archetype?.intent??classification.contribution,engagementId:classification.targetId?`engagement-${slug(classification.targetId)}`:null,...classification}}};
  const contribution=terms.reduce((sum,term)=>sum+term.contribution,0);
  return {...candidate,features:{...candidate.features,planning:{planId:selection.planId,intent:selection.planning?.archetype?.intent??classification.contribution,
    engagementId:classification.targetId?`engagement-${slug(classification.targetId)}`:null,...classification}},
    assessment:{...candidate.assessment,value:candidate.assessment.value+contribution},scoringTerms:[...(candidate.scoringTerms??[]),...terms]};
}

export function mergePortfolioCandidates(runs){
  const merged=new Map(),rejected=[];
  for(const run of runs){rejected.push(...run.rejected);for(const candidate of run.candidates){const prior=merged.get(candidate.id),value=candidate.assessment?.value,priorValue=prior?.assessment?.value;
    if(!prior||Number.isFinite(value)&&(!Number.isFinite(priorValue)||value>priorValue)){const alternatives=[...(prior?.features?.planning?.alternativePlans??[]),
      ...prior?[prior.features?.planning?.planId].filter(Boolean):[]];merged.set(candidate.id,{...candidate,features:{...candidate.features,
        planning:{...candidate.features?.planning,alternativePlans:[...new Set(alternatives)]}}});}
    else prior.features.planning.alternativePlans=[...new Set([...(prior.features.planning.alternativePlans??[]),candidate.features?.planning?.planId].filter(Boolean))];
  }}
  return {candidates:[...merged.values()],rejected};
}

function timeline(candidate){const steps=turnPlan(candidate);return (steps.length?steps:[candidate]).map((step,index)=>({index,kind:step.kind,
  actionCost:step.actionCost??(index?null:candidate.actionCost),targetId:step.targetId??null,spellSlug:step.spellSlug??null,destination:step.destination??null}));}

function candidateLabel(candidate,value){
  const target=candidate.targetId?` -> ${candidate.targetId}`:'',destination=candidate.destination?
    `\nto ${candidate.destination.x}, ${candidate.destination.y}${candidate.destination.elevation!=null?`, ${candidate.destination.elevation} ft`:''}`:'';
  return `${candidate.kind}${target}${destination}\nscore ${finite(value).toFixed(2)}`;
}

/**
 * A bounded causal trace of the decisions that produced the final action.
 *
 * This is deliberately not a dump of every derived fact or every candidate
 * generated under every intent. Facts which are not instrumented as inputs to
 * a plan score stay in node details, and portfolio candidates are shown once
 * after the same ID has been merged. An AND node is emitted only when it
 * decomposes a real multi-step activity.
 */
export function planningTrace(state,analysis,runs,decision,usedSelection){
  const nodes=[],edges=[],nodeIds=new Set();let edge=0;
  const add=(id,kind,layer,label,status='considered',detail={})=>{id=slug(id);if(nodeIds.has(id)){
      if(status==='selected')nodes.find(node=>node.id===id).status='selected';return id;}
    nodeIds.add(id);nodes.push({id,kind,layer,label,status,detail});return id;};
  const connect=(source,target,relation)=>edges.push({id:`trace-edge-${edge++}`,source:slug(source),target:slug(target),relation});
  const ranked=[...(decision.ranked??[])],displayed=[...ranked.slice(0,8)];
  const chosenEntry=ranked.find(entry=>entry.candidate.id===decision.chosen?.id);
  if(chosenEntry&&!displayed.includes(chosenEntry))displayed.push(chosenEntry);
  const chosenPlan=decision.chosen?.features?.planning?.planId??usedSelection.planId;
  const displayedPlanIds=new Set(displayed.map(entry=>entry.candidate.features?.planning?.planId).filter(Boolean));
  const pool=new Map((decision.selection?.candidates??[]).map(entry=>[entry.id,entry]));
  const uniqueGrounded=new Set(runs.flatMap(run=>run.candidates.map(candidate=>candidate.id)));
  const root=add('planning-root','situation',0,'Combat decision','selected',{
    actionsRemaining:state.actionsRemaining,observations:analysis.facts,doctrine:analysis.doctrine,
    engagements:analysis.engagements.map(({targetId,targetName,distance,visibility,lineOfSight,lineOfEffect})=>
      ({targetId,targetName,distance,visibility,lineOfSight,lineOfEffect})),
  });
  const directive=add('directive-legality','constraint',1,analysis.mandatoryDirective?'Emergency survival directive':'PF2e legality and action budget','selected',{
    mandatory:analysis.mandatoryDirective,actionsRemaining:state.actionsRemaining,bonusMovementActions:state.bonusMovementActions??0,
  });connect(root,directive,'constrains');
  const goalNodes=new Map(),timingNodes=new Map();
  for(const hypothesis of analysis.hypotheses){
    const selected=hypothesis.planId===chosenPlan,hasFinalist=displayedPlanIds.has(hypothesis.planId);
    const status=selected?'selected':hypothesis.status==='pruned'||!hasFinalist?'pruned':'survived';
    const intent=add(hypothesis.id,'or',2,`${hypothesis.label}\n${hypothesis.intent} | ${hypothesis.posture}\nscore ${hypothesis.score.toFixed(2)}`,status,{
      ...hypothesis,pruneReason:hypothesis.status==='pruned'?hypothesis.pruneReason:!hasFinalist?'No distinct candidate reached the displayed final set':null,
    });
    connect(directive,intent,status==='pruned'?'pruned':'compares');
    if(status==='pruned')continue;
    const run=runs.find(entry=>entry.selection.planId===hypothesis.planId),goal=run?.selection.goal??{};
    const relation=analysis.engagements.find(entry=>entry.targetId===goal.targetId);
    const goalNode=add(`hypothesis-${hypothesis.planId}`,'hypothesis',3,goal.label??hypothesis.label,status,{
      ...goal,delivery:hypothesis.delivery,engagement:relation??null,
    });
    goalNodes.set(hypothesis.planId,goalNode);connect(intent,goalNode,'pursues');
  }
  const choice=add('competitive-choice','or',7,decision.selection?.mode==='weighted'?'Weighted choice among close scores':
    decision.selection?.mode==='uniform-tie'?'Random choice among exact ties':'Highest-ranked legal action','selected',{
      reason:decision.reason,selection:decision.selection,tiedIds:decision.tiedIds??[],randomizedIds:decision.randomizedIds??[],
    });
  let selectedPrimitiveId=null;
  for(const [rankIndex,entry] of displayed.entries()){
    const candidate=entry.candidate,planId=candidate.features?.planning?.planId??chosenPlan;
    if(!goalNodes.has(planId))continue;
    const run=runs.find(item=>item.selection.planId===planId),info=candidate.features?.planning??classifyCandidate(candidate,state,run?.selection??usedSelection),
      selected=candidate.id===decision.chosen?.id,inPool=pool.has(candidate.id),status=selected?'selected':inPool?'survived':'considered',
      timingKey=`timing-${planId}-${info.timing}`;
    if(!timingNodes.has(timingKey)){const timing=add(timingKey,'or',4,info.timing,selected?'selected':'survived',{planId,timing:info.timing});
      timingNodes.set(timingKey,timing);connect(goalNodes.get(planId),timing,'commits');}
    else if(selected)add(timingKey,'or',4,info.timing,'selected',{planId,timing:info.timing});
    const steps=timeline(candidate),detail={candidateId:candidate.id,planId,alternativePlans:candidate.features?.planning?.alternativePlans??[],
      targetId:candidate.targetId??null,value:entry.utility,layer:entry.layer,actionCost:candidate.actionCost,terms:entry.terms??candidate.scoringTerms??[],
      timeline:steps,rank:rankIndex+1,selectionProbability:pool.get(candidate.id)?.probability??null,exactTie:(decision.tiedIds??[]).includes(candidate.id)};
    let terminal;
    if(steps.length>1){
      const method=add(`method-${candidate.id}`,'and',5,`${candidate.kind} activity\n${steps.map(step=>step.kind).join(' -> ')}\nscore ${finite(entry.utility).toFixed(2)}`,status,detail);
      connect(timingNodes.get(timingKey),method,'alternative-method');let prior=method;
      for(const step of steps){const primitive=add(`primitive-${candidate.id}-${step.index}`,'primitive',6,`${step.index+1}. ${step.kind}${step.targetId?` -> ${step.targetId}`:''}`,
          status,{candidateId:candidate.id,...step});connect(prior,primitive,step.index?'then':'decomposes');prior=primitive;if(selected&&step.index===0)selectedPrimitiveId=primitive;}
      terminal=prior;
    }else{
      const primitive=add(`primitive-${candidate.id}`,'primitive',5,candidateLabel(candidate,entry.utility),status,detail);
      connect(timingNodes.get(timingKey),primitive,'alternative-action');terminal=primitive;if(selected)selectedPrimitiveId=primitive;
    }
    const probability=pool.get(candidate.id)?.probability,relation=selected?'selected':probability!=null?`weighted ${Math.round(probability*1000)/10}%`:`rank ${rankIndex+1}`;
    connect(terminal,choice,relation);
  }
  const rejected=decision.rejected??[],rejectedLimit=24;
  for(const [index,entry]of rejected.slice(0,rejectedLimit).entries()){const id=add(`rejected-${entry.id}-${index}`,'outcome',2,`${entry.id}\n${entry.reason}`,'pruned',entry);connect(directive,id,'forbids');}
  if(rejected.length>rejectedLimit){const omitted=add('rejected-omitted','outcome',2,`${rejected.length-rejectedLimit} more rejected options`,'pruned',{count:rejected.length-rejectedLimit});connect(directive,omitted,'forbids');}
  const result=add('selected-outcome','outcome',8,decision.chosen?`Execute ${decision.chosen.kind}`:'No legal action','selected',{chosenId:decision.chosen?.id??null,reason:decision.reason});
  connect(choice,result,'executes');
  return {schema:'foundry-creature-ai/planning-trace@2',nodes,edges,selectedPlanId:chosenPlan,selectedPrimitiveId:selectedPrimitiveId?slug(selectedPrimitiveId):null,
    timelines:(decision.ranked??[]).slice(0,6).map(entry=>({planId:entry.candidate.features?.planning?.planId??null,candidateId:entry.candidate.id,
      selected:entry.candidate.id===decision.chosen?.id,score:entry.utility,steps:timeline(entry.candidate)})),
    budget:{hypotheses:analysis.hypotheses.length,survivingHypotheses:runs.length,generatedCandidates:runs.reduce((sum,run)=>sum+run.candidates.length,0),
      uniqueGroundedCandidates:uniqueGrounded.size,displayedFinalists:displayed.length}};
}
