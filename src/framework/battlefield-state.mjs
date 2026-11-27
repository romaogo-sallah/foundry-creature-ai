import {recognizeTacticalScenarios} from './tactical-scenarios.mjs';

const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:0));
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const slug=value=>String(value??'unknown').replace(/[^a-zA-Z0-9_-]/g,'-');

function evidence(id,label,value,{active=Boolean(value),confidence=1,source='actor-snapshot',scope='actor',scenarios=[],thresholds=null}={}){
  return {id:`evidence-${slug(id)}`,label,value,active:Boolean(active),confidence:clamp(confidence),source,scope,scenarios:[...scenarios],thresholds};
}

function evidenceHistory(entries,prior,revision){
  const old=new Map((prior?.evidence??[]).map(entry=>[entry.id,entry])),numeric=Number.isFinite(revision);
  return entries.map(entry=>{const previous=old.get(entry.id),continued=previous?.active===entry.active,
    firstObservedAt=continued?(previous.firstObservedAt??previous.observedAt??revision):revision,
    age=numeric&&Number.isFinite(firstObservedAt)?Math.max(0,revision-firstObservedAt):continued?(previous.age??0)+1:0;
    return {...entry,observedAt:revision,firstObservedAt,age,expiresAt:numeric?revision+1:null,
      provenance:{kind:entry.source,scope:entry.scope,revision}};
  });
}

export function buildEngagementGraph(state){
  const context=state.behavior?.context??{},speed=Math.max(5,finite(state.self?.speed,25)),reach=Math.max(0,finite(state.self?.reachSquares,1)*5);
  return (state.enemies??[]).map(enemy=>{
    const distance=finite(enemy.distance,Infinity),inReach=Boolean(enemy.inReach)||distance<=reach,enemyReach=finite(enemy.tactics?.reach,5),enemySpeed=Math.max(5,finite(enemy.tactics?.speed,25));
    return {id:`engagement-${slug(enemy.id)}`,targetId:enemy.id,targetName:enemy.name??enemy.id,distance,
      canAffectNow:inReach||Boolean(context.immediateAttack&&enemy.lineOfEffect!==false),actionsToAffect:inReach?0:Math.max(1,Math.ceil(Math.max(0,distance-reach)/speed)),
      targetCanAffectNow:Boolean(enemy.inReach)||distance<=enemyReach,targetActionsToAffect:distance<=enemyReach?0:Math.max(1,Math.ceil(Math.max(0,distance-enemyReach)/enemySpeed)),
      rangePenalty:finite(enemy.rangePenalty,0),cover:finite(enemy.coverBonus??enemy.incoming?.coverBonus,0),concealmentDC:enemy.concealmentDC??enemy.incoming?.concealmentDC??null,
      visibility:enemy.awareness?.state??(enemy.lineOfSight===false?'remembered':'observed'),lineOfSight:enemy.lineOfSight!==false,lineOfEffect:enemy.lineOfEffect!==false,
      friendlyPressure:finite(enemy.alliesInReach,0),isolated:finite(enemy.alliesInReach,0)===0};
  });
}

function roleFor(context){return context.meleePrimary?'melee':context.rangedPrimary?'ranged':context.caster?'caster':'hybrid';}

export function buildBattlefieldModel(state,{teamBoard=state.teamBoard??null,prior=state.behavior?.previous?.battlefield??state.battlefield??null}={}){
  const context=state.behavior?.context??{},engagements=buildEngagementGraph(state),nearest=finite(context.nearestEnemyDistance,
    Math.min(Infinity,...engagements.map(entry=>entry.distance))),speed=Math.max(5,finite(state.self?.speed,25)),reach=finite(state.self?.reachSquares,1)*5;
  const role=roleFor(context),knownEnemies=finite(context.knownEnemies,engagements.length),visibleEnemies=finite(context.visibleEnemies,
    engagements.filter(entry=>entry.visibility==='observed'&&entry.lineOfSight).length);
  const forceRatio=Math.max(0,finite(context.effectiveForceRatio,finite(context.forceRatio,1))),enemyFar=Number.isFinite(nearest)&&nearest>speed+reach;
  const isolated=engagements.filter(entry=>entry.isolated),escapeCapacity=finite(context.escapeCapacity,context.kiteRetreatAvailable?0.7:0.3),deadEndRisk=clamp(context.deadEndRisk??(context.kiteRetreatAvailable?0.15:0.55));
  const metrics={role,meleePrimary:role==='melee',rangedPrimary:role==='ranged',caster:role==='caster',health:clamp(context.health??1),
    knownEnemies,visibleEnemies,nearestEnemyDistance:nearest,enemyFar,distancePressure:Number.isFinite(nearest)?clamp((nearest-speed-reach)/Math.max(5,speed*2)):0,
    enemyRangedRatio:clamp(context.enemyRangedRatio),nearbyProtection:Boolean(context.nearbyProtection),ownCount:finite(context.ownCount,finite(context.allies,0)+1),
    enemyCount:finite(context.enemyCount,knownEnemies),forceRatio,ownLosses:finite(context.ownLossFraction,0)>=0.34,enemyLosses:finite(context.enemyLossFraction,0)>=0.34,
    enemyPressure:Boolean(context.enemiesTooClose??context.closingMelee),openingAmbush:Boolean(context.openingAmbush),hiddenBelief:Boolean(context.hiddenBelief),
    kiteLane:Boolean(context.kiteRetreatAvailable),ownSpread:Boolean(context.ownSpread),formationComponents:Math.max(1,finite(context.formationComponents,context.ownSpread?2:1)),
    enemyAoeClustered:Boolean(context.enemyAoeClustered),enemyAoeClusterSize:finite(context.enemyAoeClusterSize,0),ownAoeClustered:Boolean(context.ownAoeClustered),
    ownAoeClusterSize:finite(context.ownAoeClusterSize,0),bestRangePenalty:finite(context.bestRangePenalty,0),canCloseRange:Boolean(context.canCloseRange),
    immediateAttack:Boolean(context.immediateAttack),firstIncrementAttack:Boolean(context.rangedAttackAvailable&&finite(context.bestRangePenalty,0)===0),
    isolatedEnemyCount:isolated.length,isolationOpportunity:isolated.length/Math.max(1,engagements.length),swarmOpportunity:Boolean(context.swarmOpportunity),
    distinctEngagementCapacity:clamp(context.distinctEngagementCapacity??(context.swarmOpportunity?0.7:0)),backlineExposure:clamp(context.backlineExposure),
    escapeCapacity,deadEndRisk,holdChoke:Boolean(context.holdChoke),breachChoke:Boolean(context.breachChoke),unanswerableAirThreat:Boolean(context.unanswerableAirThreat),
    burstWindow:Boolean(context.burstWindow),resourceConservation:Boolean(context.resourceConservation)};
  const rawFacts=[
    evidence('combat-role',`Primary doctrine: ${role}`,role,{scenarios:['distant-melee-approach','protected-firing-line','ranged-line-under-approach']}),
    evidence('enemy-distance',enemyFar?'Opponents are beyond one-move engagement':'Opponents are within one-move engagement',nearest,{active:enemyFar,scenarios:['distant-melee-approach']}),
    evidence('effective-range',metrics.bestRangePenalty?`Best ranged option has -${metrics.bestRangePenalty}`:'A first-increment option is available',metrics.bestRangePenalty,
      {active:metrics.bestRangePenalty>0,scenarios:['enemy-outside-effective-range','protected-firing-line']}),
    evidence('enemy-pressure',metrics.enemyPressure?'Melee pressure can reach the ranged line soon':'No immediate melee pressure on the ranged line',metrics.enemyPressure,
      {scenarios:['ranged-line-under-approach','escape-dead-end']}),
    evidence('protection',metrics.nearbyProtection?'Useful protection is available':'No useful nearby protection is known',metrics.nearbyProtection,
      {scenarios:['opening-ambush','protected-firing-line']}),
    evidence('contact',visibleEnemies?`${visibleEnemies} opponents are observed`:'No known opponent is currently observed',visibleEnemies,{active:visibleEnemies===0,confidence:knownEnemies?1:0.4,scenarios:['establish-contact']}),
    evidence('opening-ambush',metrics.openingAmbush?'An opening ambush remains available':'Opening ambush is unavailable or spent',metrics.openingAmbush,{scenarios:['opening-ambush']}),
    evidence('formation-components',metrics.formationComponents>1?`Formation has ${metrics.formationComponents} disconnected components`:'Formation is mutually connected',metrics.formationComponents,
      {active:metrics.formationComponents>1,scenarios:['form-up'],thresholds:{entry:2,exit:1}}),
    evidence('isolated-enemies',isolated.length?`${isolated.length} opponents lack immediate allied pressure`:'No isolated opponent is known',isolated.length,{active:isolated.length>0,scenarios:['focus-isolated-enemy']}),
    evidence('swarm-capacity',metrics.swarmOpportunity?'Distinct melee pressure is available':'No supported surround is available',metrics.distinctEngagementCapacity,{active:metrics.swarmOpportunity,scenarios:['swarm-solitary-target']}),
    evidence('friendly-area-risk',metrics.ownAoeClustered?`${metrics.ownAoeClusterSize} allies form an area-effect cluster`:'Friendly spacing is outside the coarse area threshold',metrics.ownAoeClusterSize,
      {active:metrics.ownAoeClustered,scenarios:['friendly-area-vulnerability']}),
    evidence('enemy-area-opportunity',metrics.enemyAoeClustered?`${metrics.enemyAoeClusterSize} opponents form an area-effect cluster`:'No coarse hostile cluster is known',metrics.enemyAoeClusterSize,
      {active:metrics.enemyAoeClustered,scenarios:['enemy-area-opportunity']}),
    evidence('force-ratio',`Effective force ratio ${forceRatio.toFixed(2)}`,forceRatio,{active:forceRatio<0.7||forceRatio>=1.35,scenarios:['press-advantage','fighting-withdrawal'],
      thresholds:{entry:{withdraw:0.7,press:1.35},exit:{withdraw:0.8,press:1.25}}}),
    evidence('dead-end-risk',`Withdrawal dead-end risk ${deadEndRisk.toFixed(2)}`,deadEndRisk,{active:deadEndRisk>0.65,scenarios:['escape-dead-end'],thresholds:{entry:0.65,exit:0.5}}),
    evidence('vertical-mismatch',metrics.unanswerableAirThreat?'Known opponent is outside available attack reach':'No unanswerable vertical mismatch',metrics.unanswerableAirThreat,{scenarios:['vertical-mismatch']}),
  ];
  const revision=teamBoard?.revision??state.turn?.round??state.round??0,facts=evidenceHistory(rawFacts,prior,revision);
  const base={schema:'foundry-creature-ai/battlefield-model@1',revision,subjectId:state.self?.id??teamBoard?.subjectId??null,role,metrics,evidence:facts,engagements,teamBoard};
  const scenarios=recognizeTacticalScenarios(base,{prior,teamScenarios:teamBoard?.activeScenarios??[]});
  const subjectId=base.subjectId,assignment=teamBoard?.assignments?.find(entry=>entry.actorId===subjectId)??teamBoard?.subjectAssignment??null;
  return {...base,scenarioBoard:scenarios,activeScenarios:scenarios.activeScenarios,assignment};
}

export function ensureBattlefieldModel(state){
  if(state.battlefield?.schema==='foundry-creature-ai/battlefield-model@1')return state.battlefield;
  const model=buildBattlefieldModel(state);state.battlefield=model;return model;
}

/** Backward-compatible diagnostic export; new consumers should use the model. */
export function battlefieldEvidence(state){return buildBattlefieldModel(state).evidence;}

