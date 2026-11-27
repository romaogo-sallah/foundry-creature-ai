const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:0));
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const position=actor=>actor.position??actor.cell??null;
const euclidean=(a,b)=>{const pa=position(a),pb=position(b);return pa&&pb?Math.hypot(pa.x-pb.x,pa.y-pb.y)*5:Infinity;};

function center(actors){const placed=actors.filter(actor=>position(actor));if(!placed.length)return null;
  return {x:placed.reduce((sum,actor)=>sum+position(actor).x,0)/placed.length,y:placed.reduce((sum,actor)=>sum+position(actor).y,0)/placed.length};}
function vector(from,to){if(!from||!to)return {x:1,y:0};const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy)||1;return {x:dx/length,y:dy/length};}
function actorRole(actor){return actor.role??(actor.caster?'caster':actor.ranged&&!actor.melee?'ranged':actor.melee&&!actor.ranged?'melee':actor.skulk?'ranged':'hybrid');}
function alive(actor){return actor.alive!==false&&finite(actor.hp,1)>0;}
function power(actor){const hp=Math.max(0,finite(actor.hp,1)),output=Math.max(1,finite(actor.expectedDamage,actor.ranged?7:10));
  const readiness=clamp(actor.engagementReadiness??1,0.2,1);return hp*(0.55+Math.min(2,output/12))*readiness;}

function connectedComponents(actors,distance,supportDistance=30){const remaining=new Set(actors.map(actor=>actor.id)),components=[];
  while(remaining.size){const seed=remaining.values().next().value,component=[],queue=[seed];remaining.delete(seed);
    while(queue.length){const id=queue.shift(),actor=actors.find(entry=>entry.id===id);component.push(id);
      for(const otherId of [...remaining]){const other=actors.find(entry=>entry.id===otherId);if(distance(actor,other)<=supportDistance){remaining.delete(otherId);queue.push(otherId);}}}
    components.push(component);
  }return components;
}

function clusterSize(actors,distance,radius=20){return actors.length?Math.max(...actors.map(actor=>actors.filter(other=>distance(actor,other)<=radius).length)):0;}
function scenario(id,label,objective,candidateMethods,confidence,priority,evidence=[]){return {id,label,status:'active',confidence:clamp(confidence),priority:clamp(priority),
  objective,candidateMethods:[...candidateMethods],evidence:[...evidence]};}

function selectFocusTarget(allies,enemies,distance){return [...enemies].sort((a,b)=>{
  const supportA=enemies.filter(other=>other!==a&&distance(a,other)<=30).length,supportB=enemies.filter(other=>other!==b&&distance(b,other)<=30).length;
  const nearestA=Math.min(...allies.map(ally=>distance(ally,a))),nearestB=Math.min(...allies.map(ally=>distance(ally,b)));
  return supportA-supportB||finite(a.hp)-finite(b.hp)||nearestA-nearestB||a.id.localeCompare(b.id);
})[0]??null;}

function assignment(actor,objective,{role,preferredPlans,fallbackPlans=[],targetId=null,laneIndex=null,priority=0.7,winningBidId=null}={}){
  return {id:`assignment:${actor.id}:${objective.id}`,objectiveId:objective.id,objectiveLabel:objective.label,actorId:actor.id,
    role:role??'engage',preferredPlans:[...preferredPlans],fallbackPlans:[...fallbackPlans],targetId,laneIndex,priority,winningBidId,status:'active'};
}

function roleBid(actor,role,{round,index,protectedPosition=false}={}){
  const actorType=actorRole(actor),phase=(index+round)%2,expected=Math.min(1.5,finite(actor.expectedDamage,7)/10),mobility=Math.min(1.5,finite(actor.speed,25)/25);
  const capabilityFit=role==='ambusher'?Number(Boolean(actor.skulk)):role==='withdraw'?mobility:role==='rear-guard'?Number(['ranged','caster'].includes(actorType))+expected*0.5:
    role==='charge-lane'?Number(actorType==='melee')+mobility*0.5:role==='firing-lane'?Number(['ranged','caster'].includes(actorType))+expected*0.4:0.7;
  const positionFit=(protectedPosition&&['ambusher','rear-guard','firing-lane'].includes(role)?0.45:0)+(role==='withdraw'&&!protectedPosition?0.2:0);
  const initiativeTiming=role==='withdraw'?(phase===0?1.4:0):role==='rear-guard'?(phase===1?1.4:0):0.5;
  const resourceFit=clamp(actor.engagementReadiness??1,0,1),travelCost=finite(actor.assignmentTravelCost,0),commitmentCost=finite(actor.commitmentCost,0),risk=finite(actor.assignmentRisk,0),conflict=finite(actor.assignmentConflict,0);
  const total=capabilityFit+positionFit+initiativeTiming+resourceFit-travelCost-commitmentCost-risk-conflict;
  return {id:`bid:${actor.id}:${role}`,actorId:actor.id,role,capabilityFit,positionFit,initiativeTiming,resourceFit,travelCost,commitmentCost,risk,conflict,total};
}

/**
 * Build a serializable team board from information available to that team.
 * Callers are responsible for excluding unknown/secret enemy positions.
 */
export function buildTeamBoard(world,{teamId,subjectId=null,prior=null}={}){
  const distance=world.distance??euclidean,round=Math.max(1,finite(world.round,1));
  const allies=(world.actors??[]).filter(actor=>alive(actor)&&actor.team===teamId).sort((a,b)=>a.id.localeCompare(b.id));
  const enemies=(world.actors??[]).filter(actor=>alive(actor)&&actor.team!==teamId);
  const friendlyCenter=center(allies),enemyCenter=center(enemies),direction=vector(friendlyCenter,enemyCenter),perpendicular={x:-direction.y,y:direction.x};
  const projected=allies.filter(actor=>position(actor)).map(actor=>position(actor).x*perpendicular.x+position(actor).y*perpendicular.y);
  const width=projected.length?(Math.max(...projected)-Math.min(...projected)+1)*5:0;
  const force=allies.reduce((sum,actor)=>sum+power(actor),0),enemyForce=enemies.reduce((sum,actor)=>sum+power(actor),0),forceRatio=enemyForce?force/enemyForce:10;
  const components=connectedComponents(allies,distance),nearestEnemy=Math.min(Infinity,...allies.flatMap(ally=>enemies.map(enemy=>distance(ally,enemy))));
  const ranged=allies.filter(actor=>['ranged','caster'].includes(actorRole(actor))),melee=allies.filter(actor=>actorRole(actor)==='melee');
  const rangedRatio=ranged.length/Math.max(1,allies.length),meleeRatio=melee.length/Math.max(1,allies.length),protectionRatio=allies.filter(actor=>actor.protected).length/Math.max(1,allies.length);
  const closingMelee=ranged.some(ally=>enemies.some(enemy=>actorRole(enemy)!=='ranged'&&distance(ally,enemy)<=finite(enemy.speed,25)+finite(enemy.reach,5)+5));
  const friendlyCluster=clusterSize(allies,distance),enemyCluster=clusterSize(enemies,distance),focusTarget=selectFocusTarget(allies,enemies,distance);
  const activeScenarios=[];
  const ambushers=allies.filter(actor=>actor.skulk&&!actor.ambushComplete);
  // An ambush is complete per actor, not when the first enemy reaches the line.
  // Dropping this objective on contact made late-lane scouts abandon Hidden and
  // Stride before taking the shot they had spent earlier turns preparing.
  if(ambushers.length)activeScenarios.push(scenario('opening-ambush','Opening ambush','Prepare and exploit protected opening attacks before pressure arrives',
    ['hiding','ranged'],0.98,0.99,['team-stealth','team-pressure']));
  if(meleeRatio>=0.5&&nearestEnemy>Math.max(30,...melee.map(actor=>finite(actor.speed,25)+finite(actor.reach,5))))activeScenarios.push(
    scenario('distant-melee-approach','Distant melee approach','Close rapidly through assigned approach lanes',['charge','aggressive'],0.9,0.82,['team-distance','team-doctrine']));
  if(rangedRatio>=0.5&&!closingMelee&&nearestEnemy>15)activeScenarios.push(scenario('protected-firing-line','Protected firing line',
    'Hold useful range and firing lanes until pressure justifies withdrawal',['ranged','hiding','defensive'],0.75+protectionRatio*0.2,0.76,['team-range','team-pressure']));
  if(rangedRatio>=0.5&&closingMelee)activeScenarios.push(scenario('ranged-line-under-approach','Ranged line under approach',
    'Withdraw in alternating waves while preserving attacks',['kiting','ranged','defensive'],0.95,0.94,['team-range','team-pressure']));
  if(components.length>1)activeScenarios.push(scenario('form-up','Form up','Reconnect the formation without stopping every useful attack',
    ['defensive','ranged','aggressive'],clamp(0.55+(components.length-1)*0.15),0.6,['team-components']));
  if(enemyCluster>=3)activeScenarios.push(scenario('enemy-area-opportunity','Enemy area opportunity','Exploit safe area effects before the cluster disperses',
    ['spell-damage','spell-control'],clamp(0.55+enemyCluster*0.08),0.72,['enemy-cluster']));
  if(friendlyCluster>=3)activeScenarios.push(scenario('friendly-area-vulnerability','Friendly area vulnerability','Break hostile template geometry while retaining support',
    ['defensive','kiting'],clamp(0.5+friendlyCluster*0.08),0.58,['friendly-cluster']));
  if(forceRatio>=1.35)activeScenarios.push(scenario('press-advantage','Press advantage','Advance in bounds and deny useful exits without overkill',
    ['aggressive','charge','swarming'],clamp(0.6+(forceRatio-1.35)*0.15),0.68,['effective-force']));
  const sufferedLoss=allies.some(actor=>finite(actor.hp)<finite(actor.maxHp,actor.hp));
  if(forceRatio<0.7&&(closingMelee||sufferedLoss))activeScenarios.push(scenario('fighting-withdrawal','Fighting withdrawal','Retreat in waves while a rear guard preserves contact',
    ['avoiding','kiting','defensive'],clamp(0.7+(0.7-forceRatio)*0.35),0.96,['effective-force']));
  if(focusTarget)activeScenarios.push(scenario('focus-isolated-enemy','Focus isolated enemy','Commit enough effect to an accessible weakly supported target',
    ['aggressive','swarming','ranged'],0.62,0.58,['target-support','target-hp']));
  const revision=world.revision??round;
  for(const entry of activeScenarios){const old=prior?.activeScenarios?.find(candidate=>candidate.id===entry.id),continuity=old?0.02:0,
    firstRecognizedAt=old?.firstRecognizedAt??old?.recognizedAt??revision;
    entry.priority=clamp(entry.priority+continuity);entry.continuity=continuity;entry.entryThreshold=0.55;entry.exitThreshold=0.4;
    entry.recognizedAt=revision;entry.firstRecognizedAt=firstRecognizedAt;entry.age=Number.isFinite(revision)&&Number.isFinite(firstRecognizedAt)?Math.max(0,revision-firstRecognizedAt):old?(old.age??0)+1:0;
    entry.provenance={kind:'team-board',revision};
  }
  activeScenarios.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));

  const primary=activeScenarios[0]??scenario('general-engagement','General engagement','Engage known opposition without abandoning formation',
    ['aggressive','ranged'],0.5,0.5,['known-opposition']);
  const coordinationStrength=allies.length>1&&(world.coordinationQuality??'disciplined')!=='minimal'?1:0;
  const assignments=[],reservations=[],roleBids=[],ordered=[...allies].sort((a,b)=>{
    const lateralA=position(a)?position(a).x*perpendicular.x+position(a).y*perpendicular.y:0,lateralB=position(b)?position(b).x*perpendicular.x+position(b).y*perpendicular.y:0;
    return lateralA-lateralB||a.id.localeCompare(b.id);
  });
  const targetBudget=focusTarget?{targetId:focusTarget.id,expectedHp:finite(focusTarget.hp,1),reservedEffect:0,contributors:[]}:null;
  for(const [index,actor] of ordered.entries()){
    const role=actorRole(actor),laneIndex=index-(ordered.length-1)/2,protectedPosition=Boolean(actor.protected),
      actorNearest=Math.min(Infinity,...enemies.map(enemy=>distance(actor,enemy))),needsCharge=role==='melee'&&actorNearest>finite(actor.reach,5),
      chargeObjective=activeScenarios.find(entry=>entry.id==='distant-melee-approach')??scenario('distant-melee-approach','Distant melee approach','Close rapidly through useful approach lanes',['charge','aggressive'],0.8,0.82,['actor-distance']);
    let entry,bids=[];
    if(primary.id==='opening-ambush'&&actor.skulk&&!actor.ambushComplete){
      bids=[roleBid(actor,'ambusher',{round,index,protectedPosition})];
      entry=assignment(actor,primary,{role:'ambusher',preferredPlans:['hiding'],fallbackPlans:['ranged'],targetId:focusTarget?.id,laneIndex,priority:primary.priority,winningBidId:bids[0].id});
    }else if(needsCharge&&primary.id!=='fighting-withdrawal'){
      bids=[roleBid(actor,'charge-lane',{round,index,protectedPosition})];entry=assignment(actor,chargeObjective,{role:'charge-lane',preferredPlans:['charge'],fallbackPlans:['aggressive'],targetId:focusTarget?.id,laneIndex,priority:chargeObjective.priority,winningBidId:bids[0].id});
    }else if(primary.id==='ranged-line-under-approach'&&['ranged','caster'].includes(role)){
      bids=['withdraw','rear-guard'].map(candidateRole=>roleBid(actor,candidateRole,{round,index,protectedPosition}));const winner=[...bids].sort((a,b)=>b.total-a.total||a.role.localeCompare(b.role))[0],mover=winner.role==='withdraw';
      entry=assignment(actor,primary,{role:winner.role,preferredPlans:mover?['kiting']:['ranged','hiding'],fallbackPlans:['defensive'],targetId:focusTarget?.id,laneIndex,priority:primary.priority,winningBidId:winner.id});
    }else if(primary.id==='fighting-withdrawal'){
      bids=['withdraw','rear-guard'].map(candidateRole=>roleBid(actor,candidateRole,{round,index,protectedPosition}));const winner=[...bids].sort((a,b)=>b.total-a.total||a.role.localeCompare(b.role))[0],mover=winner.role==='withdraw';
      entry=assignment(actor,primary,{role:winner.role,preferredPlans:mover?[role==='ranged'?'kiting':'avoiding']:[role==='ranged'?'ranged':'defensive'],fallbackPlans:['avoiding'],targetId:focusTarget?.id,laneIndex,priority:primary.priority,winningBidId:winner.id});
    }else if(primary.id==='protected-firing-line'&&['ranged','caster'].includes(role)){
      bids=[roleBid(actor,'firing-lane',{round,index,protectedPosition})];entry=assignment(actor,primary,{role:'firing-lane',preferredPlans:actor.skulk&&!actor.ambushComplete?['hiding']:['ranged'],fallbackPlans:['defensive'],targetId:focusTarget?.id,laneIndex,priority:primary.priority,winningBidId:bids[0].id});
    }else if(primary.id==='distant-melee-approach'&&role==='melee'){
      bids=[roleBid(actor,'charge-lane',{round,index,protectedPosition})];entry=assignment(actor,primary,{role:'charge-lane',preferredPlans:['charge'],fallbackPlans:['aggressive'],targetId:focusTarget?.id,laneIndex,priority:primary.priority,winningBidId:bids[0].id});
    }else if(primary.id==='form-up'&&components.length>1){
      entry=assignment(actor,primary,{role:index===0?'anchor':'regroup',preferredPlans:index===0?[role==='ranged'?'ranged':'defensive']:['defensive'],fallbackPlans:['aggressive'],targetId:focusTarget?.id,laneIndex,priority:primary.priority});
    }else{
      const preferred=role==='ranged'?['ranged']:role==='caster'?(enemyCluster>=3?['spell-damage','spell-control']:['spell-control','spell-damage']):['aggressive','swarming'];
      entry=assignment(actor,primary,{role:'focus',preferredPlans:preferred,fallbackPlans:['aggressive','ranged'],targetId:focusTarget?.id,laneIndex,priority:primary.priority});
    }
    if(!bids.length){bids=[roleBid(actor,entry.role,{round,index,protectedPosition})];entry.winningBidId=bids[0].id;}
    roleBids.push(...bids.map(bid=>({...bid,selected:bid.id===entry.winningBidId})));
    entry.coordinationStrength=coordinationStrength;
    assignments.push(entry);reservations.push({kind:'lane',ownerId:actor.id,laneIndex,
      centerProjection:friendlyCenter?friendlyCenter.x*perpendicular.x+friendlyCenter.y*perpendicular.y+laneIndex*2:null,
      perpendicular,objectiveId:primary.id,expiresAt:{round}});
    if(targetBudget&&['focus-isolated-enemy','press-advantage','general-engagement'].includes(primary.id)&&entry.targetId===targetBudget.targetId){const effect=Math.max(1,finite(actor.expectedDamage,actor.ranged?7:10));
      if(targetBudget.reservedEffect<targetBudget.expectedHp*1.2){targetBudget.reservedEffect+=effect;targetBudget.contributors.push(actor.id);
        reservations.push({kind:'target-budget',ownerId:actor.id,targetId:targetBudget.targetId,value:effect,objectiveId:primary.id,expiresAt:{round}});}
      else{entry.targetId=null;entry.role='reserve';entry.preferredPlans=role==='ranged'?['ranged','defensive']:['defensive','aggressive'];}
    }
  }
  const confidence=clamp(0.5+Math.log2(Math.max(0.125,forceRatio))*0.2);
  const board={schema:'foundry-creature-ai/team-board@1',teamId,subjectId,revision,beliefRevision:world.beliefRevision??revision,
    coordinationQuality:world.coordinationQuality??'disciplined',frontline:{origin:friendlyCenter&&enemyCenter?{x:(friendlyCenter.x+enemyCenter.x)/2,y:(friendlyCenter.y+enemyCenter.y)/2}:friendlyCenter,
      direction,width,friendlyDepth:nearestEnemy,enemyDepth:nearestEnemy,confidence:enemies.length?0.85:0.3},confidence:{value:confidence,trend:prior?confidence-finite(prior.confidence?.value,confidence):0,
      reasons:[`Effective force ratio ${forceRatio.toFixed(2)}`,`${components.length} formation component${components.length===1?'':'s'}`]},
    metrics:{force,enemyForce,forceRatio,nearestEnemy,rangedRatio,meleeRatio,protectionRatio,formationComponents:components.length,friendlyCluster,enemyCluster},
    activeScenarios,objectives:activeScenarios.slice(0,3).map(entry=>({id:entry.id,label:entry.objective,priority:entry.priority,status:'active'})),roleBids,assignments,reservations,
    engagementBudgets:targetBudget?[targetBudget]:[]};
  board.subjectAssignment=assignments.find(entry=>entry.actorId===subjectId)??null;return board;
}

