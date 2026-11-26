import {attackValue,priorityLayer} from '../dawnsbury/chooser.mjs';
import {planCreatureDecision} from '../framework/decision-engine.mjs';
import {defaultBehaviorConfiguration} from '../framework/tactical-behaviors.mjs';
import {cellKey,gridFromAscii} from './virtual-grid.mjs';

const clone=value=>structuredClone(value);
const round=value=>Math.round(value*100)/100;
const strikeDefaults={bonus:10,damage:7,mapPenalties:[0,-5,-10],reach:5,rangeIncrement:null,maxIncrements:6,precisionDamage:0};
const model={profileId:'basic-npc',kind:'basic',extra:{},bonusKinds:['stride','step']};

function seededRandom(seed=1){let value=seed>>>0||1;return ()=>{value=(value*1664525+1013904223)>>>0;return value/0x100000000;};}
function degree(roll,total,dc){let result=total>=dc+10?2:total>=dc?1:total<=dc-10?-1:0;if(roll===20)result++;if(roll===1)result--;return Math.max(-1,Math.min(2,result));}
const degreeName=value=>['critical failure','failure','success','critical success'][value+1];

function validateActor(source,index){
  const actor={...source,initiative:source.initiative??100-index,hp:Number(source.hp??30),maxHp:Number(source.maxHp??source.hp??30),
    ac:Number(source.ac??18),speed:Number(source.speed??25),reach:Number(source.reach??5),referenceAC:Number(source.referenceAC??18),
    glyph:source.glyph??source.id?.[0]?.toUpperCase(),strikes:(source.strikes??[{id:'melee',name:'Strike'}]).map(strike=>({...strikeDefaults,...strike})),
    plans:source.plans??null,components:source.components??null,decisionVariation:source.decisionVariation??0,conditions:{...source.conditions},memory:{previous:null},alive:true};
  if(!actor.id||!actor.team||!actor.position||!Number.isInteger(actor.position.x)||!Number.isInteger(actor.position.y))throw new Error('Combat-lab actors need id, team and integer position');
  if(!actor.strikes.length)throw new Error(`${actor.id} needs at least one strike`);return actor;
}

function adjacentGoals(grid,target){const goals=[];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if((dx||dy)&&!grid.isBlocked({x:target.position.x+dx,y:target.position.y+dy}))goals.push({x:target.position.x+dx,y:target.position.y+dy});return goals;}
function actorAttackValue(actor,strike,target,position){return attackValue({bonus:strike.bonus-(position.rangePenalty??0),damage:strike.damage,
  referenceAC:actor.referenceAC,defenseAdjustment:position.coverBonus??0});}

export class CombatLab {
  constructor(scenario,{seed=scenario.seed??1,maxRounds=scenario.maxRounds??8}={}){
    if(!scenario?.id||!scenario.map||!Array.isArray(scenario.actors))throw new Error('Combat scenario needs id, map and actors');
    const parsed=gridFromAscii(scenario.map,{hazardDamage:scenario.hazardDamage});this.grid=parsed.grid;this.scenario=clone(scenario);this.random=seededRandom(seed);
    this.maxRounds=maxRounds;this.actors=scenario.actors.map((source,index)=>{const marker=source.marker&&parsed.markers.get(source.marker);
      return validateActor({...source,position:clone(source.position??marker)},index);});
    for(const actor of this.actors){if(this.grid.isBlocked(actor.position))throw new Error(`${actor.id} starts in blocked cell ${cellKey(actor.position)}`);
      if(this.actors.some(other=>other!==actor&&cellKey(other.position)===cellKey(actor.position)))throw new Error(`Actors share ${cellKey(actor.position)}`);}
    this.report={schema:'foundry-creature-ai/combat-lab-report@1',scenario:{id:scenario.id,name:scenario.name??scenario.id,
      description:scenario.description??'',seed,maxRounds},initialGrid:this.grid.render(this.actors),rounds:[],events:[],findings:[],outcome:null,metrics:{decisions:0,actions:0,damage:0,movement:0}};
  }

  living(team=null){return this.actors.filter(actor=>actor.hp>0&&(!team||actor.team===team));}
  enemies(actor){return this.living().filter(other=>other.team!==actor.team);}
  allies(actor){return this.living(actor.team).filter(other=>other!==actor);}
  occupied(){return new Map(this.living().map(actor=>[cellKey(actor.position),actor.id]));}

  #positionFacts(actor,target,from=actor.position){
    const sight=this.grid.sight(from,target.position),distance=this.grid.distanceFeet(from,target.position),strikes={};
    for(const strike of actor.strikes){const ranged=Number.isFinite(strike.rangeIncrement)&&strike.rangeIncrement>0;
      const increment=ranged?Math.max(0,Math.ceil(distance/strike.rangeIncrement)-1):0,rangePenalty=ranged?Math.min(strike.maxIncrements-1,increment)*2:0;
      const inReach=ranged?distance<=strike.rangeIncrement*strike.maxIncrements:distance<=strike.reach;
      strikes[strike.id]={usable:inReach&&sight.lineOfSight&&sight.lineOfEffect,inReach,rangePenalty,coverBonus:sight.coverBonus,
        concealmentDC:null,lineOfSight:sight.lineOfSight,lineOfEffect:sight.lineOfEffect};
    }
    return {distance,lineOfSight:sight.lineOfSight,lineOfEffect:sight.lineOfEffect,coverBonus:sight.coverBonus,strikes};
  }

  #routeDistance(actor,from){
    const occupied=this.occupied(),allies=new Set(this.allies(actor).map(ally=>ally.id));
    return Math.min(Infinity,...this.enemies(actor).map(enemy=>this.grid.routeDistance(from,adjacentGoals(this.grid,enemy),{occupied,allies,moverId:actor.id})));
  }

  #moves(actor,stateEnemies){
    const occupied=this.occupied(),allies=new Set(this.allies(actor).map(ally=>ally.id)),currentRoute=this.#routeDistance(actor,actor.position);
    const reachable=this.grid.reachable(actor.position,{speed:actor.speed,occupied,allies,moverId:actor.id});
    return reachable.flatMap(node=>{
      const targets=Object.fromEntries(this.enemies(actor).map(enemy=>[enemy.id,this.#positionFacts(actor,enemy,node.cell)]));
      const nearestEnemy=this.#routeDistance(actor,node.cell),threatened=stateEnemies.some(enemy=>enemy.inReach),terrainRisk=node.risk;
      const common={x:node.cell.x,y:node.cell.y,cost:node.cost,path:node.path,targets,nearestEnemy:Number.isFinite(nearestEnemy)?nearestEnemy:currentRoute,
        provokes:threatened,reactionRisk:threatened?Math.max(0,...this.enemies(actor).filter(enemy=>enemy.inReach).flatMap(enemy=>enemy.strikes.map(strike=>strike.damage))):0,
        terrainRisk,destinationThreatened:this.enemies(actor).some(enemy=>this.grid.distanceFeet(node.cell,enemy.position)<=enemy.reach)};
      const choices=[{...common,kind:'stride'}];
      if(node.cost<=5&&!this.grid.terrain(node.cell).difficult&&!terrainRisk)choices.push({...common,kind:'step',provokes:false,reactionRisk:0});
      return choices;
    });
  }

  #state(actor,turn){
    const enemies=this.enemies(actor).map(enemy=>{const position=this.#positionFacts(actor,enemy),enemyMelee=enemy.strikes.filter(strike=>!strike.rangeIncrement);
      return {id:enemy.id,name:enemy.name??enemy.id,distance:position.distance,lineOfSight:position.lineOfSight,lineOfEffect:position.lineOfEffect,
        coverBonus:position.coverBonus,strikes:position.strikes,inReach:enemyMelee.some(strike=>position.distance<=strike.reach),awareness:{state:'observed',detection:'observed'},
        alliesInReach:this.allies(actor).filter(ally=>this.grid.distanceFeet(ally.position,enemy.position)<=ally.reach).length,
        tactics:{role:enemy.strikes.some(strike=>strike.rangeIncrement)?'ranged':'melee',reach:enemy.reach,speed:enemy.speed,
          rangeIncrement:Math.max(0,...enemy.strikes.map(strike=>strike.rangeIncrement??0))},prone:Boolean(enemy.conditions.prone),offGuard:false};});
    const moves=this.#moves(actor,enemies),strikeNow=actor.strikes.flatMap(strike=>enemies.filter(enemy=>enemy.strikes[strike.id]?.usable).map(enemy=>({strike,enemy,position:enemy.strikes[strike.id]})));
    const rangedNow=strikeNow.filter(entry=>entry.strike.rangeIncrement),meleeNow=strikeNow.filter(entry=>!entry.strike.rangeIncrement),bestRangePenalty=Math.min(Infinity,...rangedNow.map(entry=>entry.position.rangePenalty));
    const meleeAttackValue=Math.max(0,...meleeNow.map(entry=>actorAttackValue(actor,entry.strike,entry.enemy,entry.position)));
    const rangedAttackValue=Math.max(0,...rangedNow.map(entry=>actorAttackValue(actor,entry.strike,entry.enemy,entry.position)));
    const health=actor.hp/actor.maxHp,friendPower=this.living(actor.team).reduce((sum,ally)=>sum+ally.hp,0),enemyPower=this.enemies(actor).reduce((sum,enemy)=>sum+enemy.hp,0);
    const configuration=defaultBehaviorConfiguration('basic-npc');if(actor.plans)configuration.plans=[...actor.plans];if(actor.components)configuration.components=[...actor.components];
    const state={actionsRemaining:turn.actionsRemaining,bonusMovementActions:0,attacksMade:turn.attacksMade,decisionVariation:actor.decisionVariation,
      nearestEnemy:this.#routeDistance(actor,actor.position),visited:[...turn.visited],moves,strikes:actor.strikes.map(strike=>({id:strike.id,name:strike.name??strike.id,
        bonus:strike.bonus,damage:strike.damage,mapPenalties:strike.mapPenalties,precisionDamage:strike.precisionDamage,ranged:Boolean(strike.rangeIncrement),
        rangeAversion:strike.rangeAversion??0,available:true})),enemies,allies:this.allies(actor).map(ally=>({id:ally.id})),
      self:{cell:clone(actor.position),speed:actor.speed,reachSquares:actor.reach/5,referenceAC:actor.referenceAC,threatened:enemies.some(enemy=>enemy.inReach),
        restrained:false,immobile:false,unable:false,prone:Boolean(actor.conditions.prone),canStand:true,mapPenalties:[0,-5,-10],attackBonus:actor.strikes[0].bonus,
        averageDamage:actor.strikes.reduce((sum,strike)=>sum+strike.damage,0)/actor.strikes.length,reactionRisk:7},
      behavior:{configuration,previous:actor.memory.previous,context:{health,forceRatio:enemyPower?friendPower/enemyPower:10,knownEnemies:enemies.length,
        visibleEnemies:enemies.filter(enemy=>enemy.lineOfSight).length,melee:actor.strikes.some(strike=>!strike.rangeIncrement),ranged:actor.strikes.some(strike=>strike.rangeIncrement),
        rangedAttackAvailable:rangedNow.length>0,immediateAttack:strikeNow.length>0,bestRangePenalty:Number.isFinite(bestRangePenalty)?bestRangePenalty:0,
        canCloseRange:moves.some(move=>enemies.some(enemy=>(move.targets[enemy.id]?.distance??Infinity)<enemy.distance)),meleeAttackValue,rangedAttackValue,
        caster:false,skulk:Boolean(actor.skulk),pack:Boolean(actor.pack),allies:this.allies(actor).length,closingMelee:enemies.some(enemy=>enemy.tactics.role==='melee'),
        swarmOpportunity:this.allies(actor).length>0,supportRecipients:0,emergency:health<0.2,hideUseful:this.grid.terrain(actor.position).cover,
        hiddenBelief:false,planAge:0,waitPatienceReached:false}},diagnostics:{},conditionRules:null,rejectedActionIds:[],seek:{available:false},
      escapes:[],escapeBlocked:false,retreatComplete:false,morale:{broken:false},conditionRules:{},sharedBehaviors:{hideCandidates:[],sneakCandidates:[],protectedMoves:[]}};
    return state;
  }

  #resolveStrike(actor,choice,turn){
    const target=this.actors.find(entry=>entry.id===choice.targetId&&entry.hp>0),strike=actor.strikes.find(entry=>entry.id===choice.strikeId);
    if(!target||!strike)return {summary:'target or strike disappeared',invalid:true};
    const position=this.#positionFacts(actor,target),flat=position.strikes[strike.id];if(!flat?.usable)return {summary:'strike became illegal',invalid:true};
    const concealment=flat.concealmentDC,flatRoll=concealment?1+Math.floor(this.random()*20):null;if(concealment&&flatRoll<concealment){turn.attacksMade++;return {summary:`${strike.name??strike.id}: concealment ${flatRoll} vs DC ${concealment}; no effect`,damage:0};}
    const roll=1+Math.floor(this.random()*20),map=strike.mapPenalties[Math.min(2,turn.attacksMade)],total=roll+strike.bonus+map-flat.rangePenalty;
    const result=degree(roll,total,target.ac+flat.coverBonus),damage=result===2?strike.damage*2:result===1?strike.damage:0;target.hp=round(Math.max(0,target.hp-damage));target.alive=target.hp>0;turn.attacksMade++;
    this.report.metrics.damage=round(this.report.metrics.damage+damage);
    return {summary:`${strike.name??strike.id} → ${target.id}: d20 ${roll} + ${strike.bonus+map-flat.rangePenalty} = ${total} vs ${target.ac+flat.coverBonus}; ${degreeName(result)}; ${damage} damage`,
      targetId:target.id,roll,total,dc:target.ac+flat.coverBonus,degree:degreeName(result),damage,rangePenalty:flat.rangePenalty,coverBonus:flat.coverBonus};
  }

  #execute(actor,choice,turn){
    if(choice.kind==='endTurn')return {summary:`ends turn with ${turn.actionsRemaining} action${turn.actionsRemaining===1?'':'s'} left`,endTurn:true};
    if(['stride','step','crawl','escapeStride'].includes(choice.kind)){
      const destination=choice.destination;if(!destination||this.grid.isBlocked(destination)||this.occupied().has(cellKey(destination)))return {summary:'movement destination became illegal',invalid:true};
      const from=clone(actor.position),hazardDamage=(choice.path??[]).reduce((sum,cell)=>sum+(this.grid.terrain(cell).hazard??0),0);
      actor.position=clone(destination);turn.visited.add(cellKey(destination));this.report.metrics.movement+=choice.movementCost??0;
      if(hazardDamage){actor.hp=round(Math.max(0,actor.hp-hazardDamage));actor.alive=actor.hp>0;this.report.metrics.damage=round(this.report.metrics.damage+hazardDamage);}
      return {summary:`${choice.kind} ${choice.movementCost??0} ft: (${from.x},${from.y}) -> (${destination.x},${destination.y})${hazardDamage?`; ${hazardDamage} hazard damage`:''}`,
        from,destination:clone(destination),hazardDamage};
    }
    if(choice.kind==='strike')return this.#resolveStrike(actor,choice,turn);
    if(choice.kind==='stand'){actor.conditions.prone=false;return {summary:'stands up'};}
    return {summary:`${choice.kind} is recorded without a virtual resolver`,unsupported:true};
  }

  #decisionRecord(actor,state,decision,effect,before,after){
    const chosen=decision.chosen,ranked=(decision.ranked??[]).slice(0,5).map(entry=>({id:entry.candidate.id,kind:entry.candidate.kind,
      targetId:entry.candidate.targetId??null,score:round(entry.utility),layer:priorityLayer(entry.candidate.assessment),terms:(entry.terms??[]).map(term=>({...term,contribution:round(term.contribution)}))}));
    return {index:this.report.metrics.decisions,actorId:actor.id,actionsBefore:before,actionsAfter:after,position:clone(actor.position),
      plan:decision.diagnostics?.tactic?{id:decision.diagnostics.tactic.planId,label:decision.diagnostics.tactic.label,reason:decision.diagnostics.tactic.reason,
        goal:decision.diagnostics.tactic.goal}:null,chosen:chosen?{id:chosen.id,kind:chosen.kind,targetId:chosen.targetId??null,score:round(chosen.assessment?.value??0),
        layer:priorityLayer(chosen.assessment),actionCost:chosen.actionCost,terms:(chosen.scoringTerms??[]).map(term=>({...term,contribution:round(term.contribution)}))}:null,
      effect,alternatives:ranked,rejected:(decision.rejected??[]).slice(0,8),trace:decision.diagnostics?.tactic?.planningTrace??null};
  }

  run(){
    for(let round=1;round<=this.maxRounds&&new Set(this.living().map(actor=>actor.team)).size>1;round++){
      const roundRecord={round,turns:[],startGrid:this.grid.render(this.actors),endGrid:null};let roundProgress=0;
      for(const actor of [...this.actors].sort((a,b)=>b.initiative-a.initiative||a.id.localeCompare(b.id))){
        if(actor.hp<=0||!this.enemies(actor).length)continue;
        const turn={actorId:actor.id,start:clone(actor.position),startHp:actor.hp,actionsRemaining:3,attacksMade:0,visited:new Set([cellKey(actor.position)]),decisions:[]};
        for(let guard=0;guard<8&&turn.actionsRemaining>0&&actor.hp>0&&this.enemies(actor).length;guard++){
          const state=this.#state(actor,turn),decision=planCreatureDecision({state,model,random:this.random}),choice=decision.chosen;this.report.metrics.decisions++;
          if(!choice){turn.decisions.push(this.#decisionRecord(actor,state,decision,{summary:'no legal decision'},turn.actionsRemaining,turn.actionsRemaining));break;}
          const before=turn.actionsRemaining,effect=this.#execute(actor,choice,turn);if(!effect.invalid){turn.actionsRemaining-=choice.actionCost??0;this.report.metrics.actions+=choice.actionCost??0;}
          const record=this.#decisionRecord(actor,state,decision,effect,before,turn.actionsRemaining);turn.decisions.push(record);
          actor.memory.previous=record.plan?{planId:record.plan.id,goal:clone(record.plan.goal)}:actor.memory.previous;
          if(effect.damage||effect.destination)roundProgress++;if(effect.endTurn||effect.invalid||effect.unsupported)break;
        }
        turn.end=clone(actor.position);turn.endHp=actor.hp;turn.actionsLeft=turn.actionsRemaining;roundRecord.turns.push(turn);
      }
      roundRecord.endGrid=this.grid.render(this.actors);this.report.rounds.push(roundRecord);
      if(!roundProgress&&new Set(this.living().map(actor=>actor.team)).size>1)this.report.findings.push({severity:'error',code:'no-progress-round',round,
        message:`Round ${round} caused no movement or damage while opposing teams remained.`});
    }
    const teams=[...new Set(this.living().map(actor=>actor.team))];this.report.outcome=teams.length===1?{status:'victory',winner:teams[0]}:
      teams.length===0?{status:'mutual-defeat',winner:null}:{status:'round-limit',winner:null};
    this.report.finalActors=this.actors.map(actor=>({id:actor.id,team:actor.team,hp:actor.hp,maxHp:actor.maxHp,position:clone(actor.position),alive:actor.hp>0}));
    this.#diagnose();return this.report;
  }

  #diagnose(){
    const decisions=this.report.rounds.flatMap(round=>round.turns.flatMap(turn=>turn.decisions.map(decision=>({...decision,round:round.round}))));
    for(const decision of decisions){
      if(decision.chosen?.kind==='endTurn'&&decision.actionsBefore>0&&this.enemies(this.actors.find(actor=>actor.id===decision.actorId)).length)
        this.report.findings.push({severity:'warning',code:'early-end',round:decision.round,actorId:decision.actorId,message:`${decision.actorId} ended with ${decision.actionsBefore} actions.`});
      if(decision.chosen?.kind==='strike'&&decision.effect.rangePenalty>0&&decision.chosen.terms.some(term=>String(term.label).includes('Close or use melee')))
        this.report.findings.push({severity:'warning',code:'avoidable-range-penalty',round:decision.round,actorId:decision.actorId,
          message:`${decision.actorId} fired with -${decision.effect.rangePenalty} despite a documented closing option.`});
      if(decision.effect.invalid)this.report.findings.push({severity:'error',code:'invalid-execution',round:decision.round,actorId:decision.actorId,message:decision.effect.summary});
      if(decision.effect.hazardDamage)this.report.findings.push({severity:'warning',code:'hazard-entry',round:decision.round,actorId:decision.actorId,
        message:`${decision.actorId} accepted ${decision.effect.hazardDamage} hazard damage while moving.`});
    }
    for(const actor of this.actors){const ends=this.report.rounds.flatMap(round=>round.turns.filter(turn=>turn.actorId===actor.id).map(turn=>cellKey(turn.end)));
      for(let index=3;index<ends.length;index++)if(ends[index]===ends[index-2]&&ends[index-1]===ends[index-3]){
        this.report.findings.push({severity:'warning',code:'two-cell-cycle',actorId:actor.id,message:`${actor.id} alternated between ${ends[index]} and ${ends[index-1]}.`});break;}}
  }
}

export function renderCombatReport(report){
  const lines=[`# Combat lab: ${report.scenario.name}`,'',report.scenario.description,'',
    `- Scenario: \`${report.scenario.id}\``, `- Seed: ${report.scenario.seed}`,`- Outcome: **${report.outcome.status}**${report.outcome.winner?` — ${report.outcome.winner}`:''}`,
    `- Decisions: ${report.metrics.decisions}; actions spent: ${report.metrics.actions}; damage: ${report.metrics.damage}; movement: ${report.metrics.movement} ft`,'',
    '## Legend','','`#` wall · `+` cover · `~` difficult terrain · `^` hazard · letters are living actors','','## Initial grid','','```text',report.initialGrid,'```',''];
  for(const round of report.rounds){lines.push(`## Round ${round.round}`,'','```text',round.startGrid,'```','');
    for(const turn of round.turns){lines.push(`### ${turn.actorId}`,'',`Start: (${turn.start.x},${turn.start.y}), ${turn.startHp} HP. End: (${turn.end.x},${turn.end.y}), ${turn.endHp} HP, ${turn.actionsLeft} actions left.`,'',
      '| # | Actions | Plan | Decision | Score/layer | Resolution |','|---:|---:|---|---|---:|---|');
      turn.decisions.forEach((decision,index)=>lines.push(`| ${index+1} | ${decision.actionsBefore}→${decision.actionsAfter} | ${decision.plan?.label??'directive'} | ${decision.chosen?`${decision.chosen.kind}${decision.chosen.targetId?` → ${decision.chosen.targetId}`:''}`:'none'} | ${decision.chosen?`${decision.chosen.score} / ${decision.chosen.layer}`:'—'} | ${decision.effect.summary} |`));
      for(const [index,decision]of turn.decisions.entries()){
        lines.push('',`<details><summary>Decision ${index+1}: ${decision.plan?.reason??decision.effect.summary}</summary>`,'',
          `Goal: ${decision.plan?.goal?.label??'none'}`,'','Top candidates:','', '| Candidate | Target | Score | Layer |','|---|---|---:|---:|',
          ...decision.alternatives.map(entry=>`| ${entry.kind} | ${entry.targetId??''} | ${entry.score} | ${entry.layer} |`));
        if(decision.chosen?.terms.length)lines.push('','Chosen score factors:','',...decision.chosen.terms.map(term=>`- ${term.label}: ${term.contribution>=0?'+':''}${term.contribution}`));
        if(decision.rejected.length)lines.push('','Representative rejections:','',...decision.rejected.map(entry=>`- ${entry.id}: ${entry.reason}`));
        lines.push('','</details>','');
      }
    }
    lines.push('End of round:','','```text',round.endGrid,'```','');
  }
  lines.push('## Automated findings','');if(!report.findings.length)lines.push('- No structural behavior warning was detected.');
  else for(const finding of report.findings)lines.push(`- **${finding.severity.toUpperCase()} ${finding.code}**${finding.actorId?` (${finding.actorId})`:''}: ${finding.message}`);
  return lines.join('\n');
}

export function assertCombat(report,expectations={}){
  const failures=[];if(expectations.winner&&report.outcome.winner!==expectations.winner)failures.push(`expected winner ${expectations.winner}, got ${report.outcome.winner??report.outcome.status}`);
  if(expectations.noErrors!==false)for(const finding of report.findings.filter(entry=>entry.severity==='error'))failures.push(`${finding.code}: ${finding.message}`);
  for(const code of expectations.forbidFindings??[])for(const finding of report.findings.filter(entry=>entry.code===code))failures.push(`${code}: ${finding.message}`);
  const actor=id=>report.finalActors?.find(entry=>entry.id===id);
  if(expectations.actorDamaged)for(const id of expectations.actorDamaged){const entry=actor(id);if(!entry)failures.push(`missing actor ${id}`);else if(entry.hp>=entry.maxHp)failures.push(`expected ${id} to take damage`);}
  if(expectations.actorAlive)for(const id of expectations.actorAlive){const entry=actor(id);if(!entry?.alive)failures.push(`expected ${id} to remain alive`);}
  if(expectations.actorDefeated)for(const id of expectations.actorDefeated){const entry=actor(id);if(!entry||entry.alive)failures.push(`expected ${id} to be defeated`);}
  if(expectations.requireActions)for(const kind of expectations.requireActions){const used=report.rounds.some(round=>round.turns.some(turn=>turn.decisions.some(decision=>decision.chosen?.kind===kind)));if(!used)failures.push(`expected at least one ${kind} action`);}
  if(failures.length){const error=new Error(`Combat-lab expectations failed:\n- ${failures.join('\n- ')}`);error.report=report;throw error;}return report;
}
