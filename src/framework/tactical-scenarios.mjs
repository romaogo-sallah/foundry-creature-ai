const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:0));

function scenario(id,label,category,when,{objective,methods=[],urgency=0.5,value=0.5}={}){
  return {id,label,category,when,objective,methods,urgency,value};
}

/**
 * Scenario definitions interpret battlefield facts. They never generate an
 * action directly: the team coordinator may assign work and actor plans may
 * use the listed methods to satisfy the objective.
 */
export const tacticalScenarioCatalog=Object.freeze([
  scenario('establish-contact','Establish contact','information',m=>m.knownEnemies>0&&m.visibleEnemies===0?0.85:0,
    {objective:'Locate a known opponent without exposing the whole group',methods:['defensive','hiding','aggressive'],urgency:0.55,value:0.7}),
  scenario('opening-ambush','Opening ambush','information',m=>m.openingAmbush?m.hiddenBelief?1:0.9:0,
    {objective:'Prepare or exploit the first protected attack before pressure arrives',methods:['hiding','ranged'],urgency:0.65,value:0.85}),
  scenario('distant-melee-approach','Distant melee approach','engagement',m=>m.meleePrimary&&m.enemyFar&&!m.immediateAttack?clamp(0.65+m.distancePressure*0.35):0,
    {objective:'Close rapidly through useful approach lanes',methods:['charge','aggressive'],urgency:0.7,value:0.8}),
  scenario('enemy-outside-effective-range','Enemy outside effective range','engagement',m=>m.rangedPrimary&&m.bestRangePenalty>0&&m.canCloseRange?
    clamp(0.55+m.bestRangePenalty/12):0,{objective:'Reach an effective range band before committing attacks',methods:['ranged'],urgency:0.55,value:0.75}),
  scenario('protected-firing-line','Protected firing line','engagement',m=>m.rangedPrimary&&m.immediateAttack&&!m.enemyPressure&&m.nearbyProtection?
    clamp(0.65+(m.firstIncrementAttack?0.2:0)+(m.escapeCapacity>0.4?0.1:0)):0,
    {objective:'Hold useful range, protection, and firing lanes',methods:['ranged','hiding','defensive'],urgency:0.35,value:0.8}),
  scenario('ranged-line-under-approach','Ranged line under approach','engagement',m=>m.rangedPrimary&&m.enemyPressure?
    clamp(0.7+(m.kiteLane?0.15:0)+(m.deadEndRisk>0.5?0.1:0)):0,
    {objective:'Trade space before contact while preserving attacks',methods:['kiting','ranged','defensive'],urgency:0.9,value:0.9}),
  scenario('focus-isolated-enemy','Focus isolated enemy','coordination',m=>m.isolatedEnemyCount>0&&m.immediateAttack?
    clamp(0.55+m.isolationOpportunity*0.4):0,{objective:'Commit enough effect to defeat an unsupported opponent without overkill',methods:['aggressive','swarming','ranged'],urgency:0.7,value:0.8}),
  scenario('swarm-solitary-target','Swarm solitary target','coordination',m=>m.swarmOpportunity&&m.meleePrimary?
    clamp(0.65+m.distinctEngagementCapacity*0.25):0,{objective:'Reserve distinct engagement cells and create flank or cutoff pressure',methods:['swarming','aggressive'],urgency:0.65,value:0.7}),
  scenario('form-up','Form up','coordination',m=>m.formationComponents>1||m.ownSpread?
    clamp(0.55+Math.min(0.35,(m.formationComponents-1)*0.15)+(m.ownSpread?0.1:0)):0,
    {objective:'Restore mutual support while anchors continue useful attacks',methods:['defensive','ranged','aggressive'],urgency:0.5,value:0.65}),
  scenario('screen-vulnerable-ally','Screen vulnerable ally','coordination',m=>m.backlineExposure>0?clamp(0.55+m.backlineExposure*0.45):0,
    {objective:'Intercept or punish routes to a vulnerable ally',methods:['supporting','swarming','defensive'],urgency:0.85,value:0.85}),
  scenario('enemy-area-opportunity','Enemy area opportunity','area',m=>m.enemyAoeClustered?clamp(0.55+m.enemyAoeClusterSize*0.1):0,
    {objective:'Exploit a safe, efficient area before the cluster disperses',methods:['spell-damage','spell-control'],urgency:0.7,value:0.85}),
  scenario('friendly-area-vulnerability','Friendly area vulnerability','area',m=>m.ownAoeClustered?clamp(0.5+m.ownAoeClusterSize*0.1):0,
    {objective:'Break dangerous template geometry while retaining mutual support',methods:['defensive','kiting'],urgency:0.65,value:0.65}),
  scenario('hold-choke','Hold choke','terrain',m=>m.holdChoke?0.9:0,
    {objective:'Deny a narrow crossing without abandoning useful attacks',methods:['defensive','ranged','supporting'],urgency:0.75,value:0.85}),
  scenario('breach-choke','Breach defended choke','terrain',m=>m.breachChoke?0.9:0,
    {objective:'Manage reaction risk and establish a foothold beyond the crossing',methods:['charge','spell-control','aggressive'],urgency:0.75,value:0.8}),
  scenario('escape-dead-end','Escape dead end','terrain',m=>m.deadEndRisk>0.65&&m.enemyPressure?clamp(0.65+m.deadEndRisk*0.35):0,
    {objective:'Leave the trap before withdrawal becomes impossible',methods:['kiting','avoiding'],urgency:0.95,value:0.9}),
  scenario('vertical-mismatch','Vertical mismatch','terrain',m=>m.unanswerableAirThreat?1:0,
    {objective:'Use protection and information until the unreachable enemy commits',methods:['lay-low','hiding','defensive'],urgency:0.75,value:0.9}),
  scenario('burst-window','Burst window','resources',m=>m.burstWindow?0.9:0,
    {objective:'Spend appropriate resources before the temporary opening closes',methods:['spell-damage','spell-control','aggressive'],urgency:0.95,value:0.9}),
  scenario('resource-conservation','Resource conservation','resources',m=>m.resourceConservation?0.7:0,
    {objective:'Preserve scarce resources while inexpensive actions remain sufficient',methods:['ranged','aggressive','defensive'],urgency:0.25,value:0.55}),
  scenario('press-advantage','Press advantage','morale',m=>m.forceRatio>=1.35&&!m.ownLosses?clamp(0.55+(m.forceRatio-1.35)*0.2):0,
    {objective:'Advance in bounds, deny exits, and avoid redundant overkill',methods:['aggressive','charge','swarming'],urgency:0.6,value:0.7}),
  scenario('fighting-withdrawal','Fighting withdrawal','morale',m=>m.forceRatio<0.7||m.ownLosses&&m.forceRatio<0.9?
    clamp(0.65+(0.9-m.forceRatio)*0.35):0,{objective:'Retreat in waves while preserving a viable rear guard',methods:['avoiding','kiting','defensive'],urgency:0.9,value:0.9}),
]);

function continuityFor(id,prior){
  const match=prior?.activeScenarios?.find(entry=>entry.id===id);
  return match?.status==='active'?0.12:0;
}

export function recognizeTacticalScenarios(model,{prior=null,teamScenarios=[]}={}){
  const local=tacticalScenarioCatalog.map(definition=>{
    const confidence=clamp(definition.when(model.metrics,model));
    const old=prior?.activeScenarios?.find(entry=>entry.id===definition.id),entryThreshold=0.55,exitThreshold=0.4;
    const active=confidence>=(old?exitThreshold:entryThreshold);
    const continuity=active?continuityFor(definition.id,prior):0;
    const priority=active?clamp(confidence*definition.value*Math.max(definition.urgency,0.35)+continuity,0,1):0;
    const firstRecognizedAt=active?(old?.firstRecognizedAt??old?.recognizedAt??model.revision):null;
    const age=active&&Number.isFinite(model.revision)&&Number.isFinite(firstRecognizedAt)?Math.max(0,model.revision-firstRecognizedAt):active&&old?(old.age??0)+1:0;
    return {id:definition.id,label:definition.label,category:definition.category,status:active?'active':'contradicted',confidence,
      urgency:definition.urgency,strategicValue:definition.value,priority,continuity,objective:definition.objective,
      candidateMethods:[...definition.methods],evidence:model.evidence.filter(entry=>entry.scenarios?.includes(definition.id)).map(entry=>entry.id),
      entryThreshold,exitThreshold,recognizedAt:model.revision,firstRecognizedAt,age,provenance:{kind:'actor-model',revision:model.revision}};
  });
  const merged=new Map(local.map(entry=>[entry.id,entry]));
  for(const team of teamScenarios??[]){
    const priorEntry=merged.get(team.id),entry={...priorEntry,...team,status:team.status??'active',confidence:clamp(team.confidence??1),
      priority:clamp(Math.max(team.priority??0,priorEntry?.priority??0)),candidateMethods:[...new Set([...(team.candidateMethods??[]),...(priorEntry?.candidateMethods??[])])],
      evidence:[...new Set([...(team.evidence??[]),...(priorEntry?.evidence??[])])]};
    merged.set(entry.id,entry);
  }
  const all=[...merged.values()].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
  return {schema:'foundry-creature-ai/scenario-board@1',activeScenarios:all.filter(entry=>entry.status==='active'),contradicted:all.filter(entry=>entry.status!=='active')};
}

export function scenarioPlanInfluence(scenarioBoard,planId,assignment=null){
  if(assignment?.preferredPlans?.includes(planId)){const strength=clamp(assignment.coordinationStrength??1);
    return {value:strength?6+strength*2+(assignment.priority??0)*2:0.25,
    reasons:[`Assigned ${assignment.role??'team role'} for ${assignment.objectiveLabel??assignment.objectiveId??'the team objective'}`]};
  }
  if(assignment?.fallbackPlans?.includes(planId))return {value:(assignment.coordinationStrength??1)>0?2.5:0.15,reasons:['This method is a supported fallback for the current assignment']};
  const supporting=(scenarioBoard?.activeScenarios??[]).filter(entry=>entry.candidateMethods?.includes(planId));
  return {value:supporting.reduce((sum,entry)=>sum+entry.priority*0.45,0),reasons:supporting.map(entry=>`${entry.label}: ${entry.objective}`)};
}

