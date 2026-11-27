import { BehaviorSystem, chooseBehaviorAction } from './behavior-system.mjs';
import { recoveryCandidates } from './recovery.mjs';
import { seekCandidates } from './perception.mjs';
import { preparedStrikeCandidates } from './strike-capability.mjs';
import {withdrawalCandidates} from './withdrawal.mjs';
import {scenarioBonus} from './caster-scenarios.mjs';

const movement = candidate => candidate.assessment?.movement;
const attack = candidate => ['strike','eagleDive','spikeVolley','castSpell','trip','knockdown','sweepingHook'].includes(candidate.kind);
export const tacticalBehaviors = new BehaviorSystem();
for (const [id,label,actionKinds,core] of [
  ['recovery','Recovery',['endTurn','stand','escape','retch'],true],['perception','Perception',['seek'],true],
  ['movement','Movement',['stride','step','crawl','escapeStride','scamper'],true],['strikes','Strikes',['strike'],true],
  ['control','Combat control',['trip','knockdown','sweepingHook','gaze']],['spellcasting','Spellcasting',['castSpell','sustainSpell']],
  ['stealth','Stealth',['hide','sneak']],['equipment','Equipment',['reload','regrip','drawMelee','drawJavelin','drawRefuse','drawSword','stow','stowSword','gripBow']],
  ['leadership','Leadership',['bellow']],['pack','Pack coordination',[]],
  ['flight','Flight',['fly']],['diving','Dive attacks',['eagleDive']],
  ['volleys','Ranged volleys',['spikeVolley']],
]) tacticalBehaviors.registerComponent({id,label,actionKinds,core,kind:'ability',
  ...(id==='recovery'?{candidates:state=>[{id:'end',kind:'endTurn',legal:true,actionCost:0,assessment:{value:0}},
    ...state.actionsRemaining>0&&!state.self.unable&&!state.retreatComplete&&(state.self.prone||state.escapes?.length||state.sickenedRecovery?.available)?recoveryCandidates(state,{canStrike:state.enemies.some(enemy=>enemy.inReach||Object.values(enemy.strikes??{}).some(position=>position.usable))}):[]]}:{}),
  ...(id==='perception'?{candidates:seekCandidates}:{}),
  ...(id==='strikes'?{candidates:preparedStrikeCandidates}:{}),
  ...(id==='stealth'?{candidates:(state,selection)=>['hiding','lay-low','defensive','avoiding','kiting','aerial-disengage'].includes(selection.planId)?
    [...state.sharedBehaviors?.hideCandidates??[],...state.sharedBehaviors?.sneakCandidates??[]]:[]}: {})});

tacticalBehaviors.registerComponent({id:'pressure',label:'Press the attack',kind:'policy',
  adjust:(candidate,_state,selection)=>attack(candidate)?0.4+(candidate.targetId===selection.goal?.targetId?0.3:0):0});
tacticalBehaviors.registerComponent({id:'advance',label:'Close to effective reach',kind:'policy',
  adjust:(candidate,state)=>movement(candidate)&&!state.behavior.context.immediateAttack&&
    candidate.assessment.nearestEnemy<state.nearestEnemy&&!candidate.provokes?
      Math.min(2,Math.max(0.4,(state.nearestEnemy-candidate.assessment.nearestEnemy)/2.5)):0});
tacticalBehaviors.registerComponent({id:'charge-run',label:'Commit to a rapid approach',kind:'policy',
  candidates:(state,selection)=>{
    if(state.self.immobile||state.self.unable||state.self.restrained||state.actionsRemaining<1||!Number.isFinite(state.nearestEnemy))return [];
    const targetId=selection.goal?.targetId,available=(state.moves??[]).filter(move=>move.kind==='stride'&&move.cost>0&&
      !state.visited?.includes(`${move.x},${move.y}`)&&Number.isFinite(move.nearestEnemy)&&move.nearestEnemy<state.nearestEnemy);
    if(!available.length)return [];
    const maximumProgress=Math.max(...available.map(move=>state.nearestEnemy-move.nearestEnemy));
    // A charge is a commitment, rather than another name for any approach.
    // Retain near-maximal advances so a Step or short sidestep cannot beat a
    // full Stride merely because both lead to an attack on a later turn.
    return available.filter(move=>state.nearestEnemy-move.nearestEnemy>=Math.max(1,maximumProgress-1)).sort((a,b)=>
      (b.nearestEnemy-a.nearestEnemy)||(a.terrainRisk??0)-(b.terrainRisk??0)||(a.reactionRisk??0)-(b.reactionRisk??0)).slice(0,12).map(move=>{
      const progress=state.nearestEnemy-move.nearestEnemy,risk=(move.reactionRisk??0)+(move.terrainRisk??0);
      const target=targetId?move.targets?.[targetId]:null;
      const meleeReady=Boolean(target&&state.strikes?.some(strike=>!strike.ranged&&target.strikes?.[strike.id]?.usable));
      const value=1.25+Math.min(4,progress*0.65)+(meleeReady?1.5:0)-risk;
      return {id:`charge:${move.x},${move.y}`,kind:'stride',legal:true,actionCost:1,path:move.path,
        destination:{x:move.x,y:move.y},movementCost:move.cost,targetId,provokes:Boolean(move.provokes),
        destinationThreatened:Boolean(move.destinationThreatened),intent:'commit to a rapid approach against a distant foe',
        features:{chargeApproach:true,goodAttacksLeft:meleeReady,engagementTargetId:targetId},
        assessment:{value,movement:true,fullTurnPlan:true,goodAttacksLeft:meleeReady,nearestEnemy:move.nearestEnemy,
          currentNearestEnemy:state.nearestEnemy,distanceMoved:move.cost/5,reachSquares:state.self.reachSquares},
        scoringTerms:[{label:'Close substantial distance toward melee reach',contribution:1.25+Math.min(4,progress*0.65)},
          ...(meleeReady?[{label:'Reach the chosen foe for the next action',contribution:1.5}]:[]),
          ...(risk?[{label:'Known reaction and terrain risk',contribution:-risk}]:[])]};
    }).filter(candidate=>candidate.assessment.value>0);
  }});
tacticalBehaviors.registerComponent({id:'effective-range',label:'Fight inside an effective range increment',kind:'policy',
  adjust:candidate=>candidate.features?.rangeApproach?1.25:
    candidate.assessment?.movement&&candidate.features?.rangedFollowUp?0.65:
    candidate.features?.ranged&&candidate.features?.rangePenalty>0?-Math.min(2,0.5+candidate.features.rangePenalty*0.2):0});
tacticalBehaviors.registerComponent({id:'kite-retreat',label:'Retreat while preserving a firing lane',kind:'policy',
  candidates:(state,selection)=>{
    if(state.self.immobile||state.self.unable||state.self.restrained||state.actionsRemaining<1)return [];
    const threats=state.enemies.filter(enemy=>enemy.tactics?.role!=='ranged');
    if(!threats.length)return [];
    const before=Math.min(...threats.map(enemy=>enemy.distance)),targetId=selection.goal?.targetId;
    return (state.moves??[]).flatMap(move=>{
      if(!['stride','step'].includes(move.kind)||!move.cost||state.visited?.includes(`${move.x},${move.y}`))return [];
      const projected=threats.map(enemy=>({...enemy,...move.targets?.[enemy.id]}));
      const after=Math.min(...projected.map(enemy=>enemy.distance??0)),gain=after-before;
      if(gain<4.9)return [];
      const lane=projected.find(enemy=>enemy.lineOfSight!==false&&enemy.lineOfEffect!==false&&state.strikes?.some(strike=>
        strike.ranged&&enemy.strikes?.[strike.id]?.geometryUsable!==false&&enemy.strikes?.[strike.id]?.inReach!==false));
      if(!lane)return [];
      const destinationThreatened=Boolean(move.destinationThreatened),risk=(move.kind==='step'?0:move.reactionRisk??0)+(move.terrainRisk??0);
      const incoming=lane.incoming??lane,cover=Math.max(0,incoming.coverBonus??lane.coverBonus??0),concealed=Boolean(incoming.concealed||lane.concealmentDC);
      const safe=projected.every(enemy=>after>(enemy.tactics?.reach??5)+(enemy.tactics?.speed??25));
      const value=2.5+Math.min(3,gain/10)+(safe?1.25:0)+Math.min(1.2,cover*0.3)+(concealed?0.6:0)-risk-(destinationThreatened?1.5:0);
      if(value<=0)return [];
      return [{id:`kite:${move.kind}:${move.x},${move.y}`,kind:move.kind,legal:true,actionCost:1,path:move.path,
        destination:{x:move.x,y:move.y},movementCost:move.cost,targetId:targetId??lane.id,provokes:move.kind!=='step'&&Boolean(move.provokes),
        destinationThreatened,intent:'retreat while preserving a ranged attack lane',
        features:{groupGoal:'kite',rangedFollowUp:true,defensiveSetup:cover>0||concealed,engagementTargetId:targetId??lane.id},
        assessment:{value,movement:true,fullTurnPlan:true,goodAttacksLeft:true,nearestEnemy:move.nearestEnemy,
          currentNearestEnemy:state.nearestEnemy,distanceMoved:move.cost/5},scoringTerms:[
          {label:'Create distance from closing melee threats',contribution:2.5+Math.min(3,gain/10)},
          ...(safe?[{label:'Move beyond one-turn melee pursuit',contribution:1.25}]:[]),
          ...(cover||concealed?[{label:'Retain cover or concealment',contribution:Math.min(1.2,cover*0.3)+(concealed?0.6:0)}]:[]),
          ...(risk||destinationThreatened?[{label:'Reaction, terrain, and destination risk',contribution:-risk-(destinationThreatened?1.5:0)}]:[])]}];
    }).sort((a,b)=>b.assessment.value-a.assessment.value||b.movementCost-a.movementCost).slice(0,12);
  }});
tacticalBehaviors.registerComponent({id:'protection',label:'Use protection',kind:'policy',
  candidates:(state,selection)=>['defensive','hiding','lay-low','avoiding','kiting'].includes(selection.planId)?
    (state.sharedBehaviors?.protectedMoves??[]).filter(candidate=>selection.planId!=='defensive'||!candidate.features?.visibility?.losesAll):[],
  adjust:candidate=>candidate.kind==='hide'?0.5:movement(candidate)&&
    (candidate.features?.defensiveSetup||candidate.features?.stealthPreserved)?0.5:0});
tacticalBehaviors.registerComponent({id:'distance',label:'Keep distance and firing lanes',kind:'policy',
  adjust:candidate=>candidate.features?.groupGoal==='kite'?0.75:
    movement(candidate)&&candidate.intent?.includes('escape')&&!candidate.features?.visibility?.losesAll?0.5:0});
tacticalBehaviors.registerComponent({id:'surround',label:'Coordinate a surround',kind:'policy',
  adjust:candidate=>candidate.features?.groupGoal==='swarm'||candidate.intent==='flank'||candidate.intent==='join pack'||
    candidate.features?.packAllies>=1?0.6:0});
tacticalBehaviors.registerComponent({id:'assist',label:'Enable allies',kind:'policy',
  adjust:candidate=>candidate.kind==='bellow'?0.75:['trip','knockdown'].includes(candidate.kind)?0.3:0});
tacticalBehaviors.registerComponent({id:'withdraw',label:'Avoid immediate danger',kind:'policy',
  candidates:withdrawalCandidates});

for(const [role,label]of [['control','Control an open threat'],['damage','Exploit a damage opening'],['drain','Damage while building a temporary HP buffer'],['support','Keep injured allies fighting']]){
  tacticalBehaviors.registerComponent({id:`spell-${role}`,label,kind:'policy',adjust:(candidate,state)=>scenarioBonus(role,candidate,state)});
  tacticalBehaviors.registerPlan({id:`spell-${role}`,label:role==='control'?'Spell control':role==='damage'?'Spell assault':role==='support'?'Spell support':'Life drain',
    intent:role==='support'?'support':role==='control'?'control':'damage',delivery:['spell'],posture:'exploit',
    requires:['spellcasting'],components:[`spell-${role}`,...role==='control'?['protection']:['pressure']],
    score:(_context,state)=>state.casterScenarios?.[role]?{value:6+Math.min(6,state.casterScenarios[role].value*0.25),
      reason:role==='control'?'A supported control spell has the best local opening':role==='damage'?'An affordable damage spell can exploit the current position':'Touch damage and additional temporary HP are worth the approach risk'}:null,
    objective:(_context,state)=>({kind:`spell-${role}`,label,...state.casterScenarios[role]})});
}

function objective(id,context,state,previous){
  if(['aerial-engage','aerial-disengage'].includes(id))return {kind:id,...state.flight.airCombat};
  if(id==='aerial-hunt')return {kind:'aerial-hunt',phase:state.flight.hunt.phase,label:state.flight.hunt.reason,preferredElevation:state.flight.hunt.preferredElevation};
  const choices=[...state.enemies].sort((a,b)=>(a.distance-(a.alliesInReach??0)*2)-(b.distance-(b.alliesInReach??0)*2)||a.id.localeCompare(b.id));
  const assigned=state.enemies.find(enemy=>enemy.id===state.battlefield?.assignment?.targetId);
  const prior=assigned??state.enemies.find(enemy=>enemy.id===previous?.goal?.targetId);
  const target=prior&&prior.distance<=(choices[0]?.distance??0)+10?prior:choices[0];
  if(id==='avoiding')return {kind:'withdraw',label:'Break firing lines and create distance from known threats',fromIds:state.enemies.map(enemy=>enemy.id),
    desiredDistance:Math.max(30,...state.enemies.map(enemy=>enemy.tactics?.role==='ranged'?(enemy.tactics.rangeIncrement??60)*2+5:
      (enemy.tactics?.reach??5)+(enemy.tactics?.speed??25)+5))};
  if(id==='defensive')return {kind:'hold-position',label:context.caster?'Hold a protected casting position':'Keep protection while remaining able to fight',anchor:previous?.planId===id?previous.goal?.anchor??state.self.cell:state.self.cell};
  if(id==='hiding')return {kind:'break-observation',label:'Hide from known observers',observerIds:state.enemies.map(enemy=>enemy.id)};
  if(id==='lay-low')return {kind:'avoid-hunter',label:'Take cover, Hide and Sneak until the hunter can be opposed',observerIds:state.groundThreats.ids};
  if(id==='supporting')return {kind:'enable-allies',label:'Enable allies who can benefit',recipientIds:(state.commandRecipients??[]).filter(ally=>ally.needsMovement!==false).map(ally=>ally.id)};
  if(id==='ranged')return {kind:'effective-range',label:context.bestRangePenalty>0?
    `Close before firing at -${context.bestRangePenalty}`:`Use the strongest ranged lane against ${target?.name??'known opponents'}`,
    targetId:target?.id??null,maximumPreferredPenalty:0};
  return {kind:id==='kiting'?'keep-range':id==='swarming'?'surround':id==='charge'?'approach':'engage',
    label:`${id==='kiting'?'Keep range from':id==='swarming'?'Surround':id==='charge'?'Close to':'Engage'} ${target?.name??'known opponents'}`,
    targetId:target?.id??null,...id==='kiting'?{minimumDistance:(target?.tactics?.reach??5)+10}:id==='charge'?{desiredDistance:(state.self.reachSquares??1)*5}:{}};
}
const PLAN_META={aggressive:{intent:'damage',delivery:['melee','ranged','spell'],posture:'exploit'},
  desperate:{intent:'damage',delivery:['melee','ranged','spell'],posture:'desperate'},charge:{intent:'damage',delivery:['melee'],posture:'setup'},
  ranged:{intent:'damage',delivery:['ranged'],posture:'position'},defensive:{intent:'survive',delivery:['melee','ranged','spell'],posture:'hold'},
  avoiding:{intent:'survive',delivery:['movement'],posture:'disengage'},kiting:{intent:'damage',delivery:['ranged','movement'],posture:'disengage'},
  hiding:{intent:'survive',delivery:['stealth'],posture:'setup'},swarming:{intent:'control',delivery:['melee'],posture:'setup'},
  supporting:{intent:'support',delivery:['support'],posture:'setup'}};
const plan=(id,label,components,score)=>tacticalBehaviors.registerPlan({id,label,components,score,...PLAN_META[id],
  ...(id==='hiding'?{requires:['stealth']}:{}),objective:(context,state,previous)=>objective(id,context,state,previous)});
plan('aggressive','Aggressive',['pressure'],c=>({value:3+(c.immediateAttack?2:0),reason:c.immediateAttack?'A useful attack is available':'Engage known opponents'}));
plan('desperate','Desperate engagement',['advance','pressure'],()=>({value:0.25,reason:'Last-resort engagement when preferred and backup tactics produce no useful legal action'}));
plan('charge','Charge',['charge-run','pressure'],(c,state)=>{
  const reach=state.self.reachSquares??1,speed=Math.max(1,(state.self.speed??25)/5),gap=Number.isFinite(state.nearestEnemy)?state.nearestEnemy-reach:Infinity;
  const distant=gap>speed,poorRanged=!c.rangedAttackAvailable||c.bestRangePenalty>=4||c.meleeAttackValue>c.rangedAttackValue*1.15;
  const meleePrimary=c.meleePrimary??(c.melee&&!c.ranged);
  if(!meleePrimary||!c.melee||c.immediateAttack||c.knownEnemies<1||c.health<=0.4||c.forceRatio<0.5||!poorRanged)return null;
  return {value:distant?7.75:5.75,reason:distant?'A distant foe can keep its position unless melee closes at full speed':
    c.visibleEnemies?'Melee attacks need a committed approach':'Close rapidly on a remembered opponent and regain contact'};
});
plan('ranged','Ranged engagement',['effective-range','advance','pressure'],c=>!c.rangedAttackAvailable?null:
  c.bestRangePenalty>0&&c.canCloseRange?{value:6.75+Math.min(1,c.bestRangePenalty/10),
    reason:`A ranged attack is available at -${c.bestRangePenalty}; close to an effective increment before firing`}:
  c.meleeAttackValue>c.rangedAttackValue*1.15?{value:2.5,reason:'Melee currently has greater expected value than the ranged option'}:
  {value:5.25,reason:'A clear ranged attack has competitive expected value'});
plan('defensive','Defensive',['protection'],c=>({value:c.caster&&!(c.melee&&!c.immediateAttack)?5.5:c.health<0.5||c.forceRatio<0.6?5:2,
  reason:c.caster?'Preserve a protected casting position':'Reduce exposure while remaining able to fight'}));
plan('avoiding','Avoiding',['withdraw','protection'],c=>c.emergency?{value:100,reason:c.broken?'The group has broken':'Own HP is critically low'}:
  c.health<0.4&&c.forceRatio<0.6?{value:7,reason:'Wounded and locally outnumbered'}:null);
plan('kiting','Kiting',['kite-retreat','distance','protection','pressure'],c=>(c.rangedPrimary??c.ranged)&&c.closingMelee&&c.kiteRetreatAvailable!==false?
  {value:9.25,reason:'A melee threat can close soon; retreat while preserving a firing lane'}:null);
plan('hiding','Hiding',['protection','pressure'],c=>{
  if(c.openingAmbush&&c.hiddenBelief&&c.immediateAttack)return {value:11,reason:'Exploit the opening Hide with an off-guard ranged attack before repositioning'};
  if(c.openingAmbush&&!c.closingMelee)return {value:9.5,reason:'Set an opening ambush before melee pressure arrives'};
  if((c.hideUseful||c.hiddenBelief)&&c.visibleEnemies>0&&!c.immediateAttack&&!(c.planAge>=2||c.waitPatienceReached))
    return {value:c.caster||c.skulk||c.health<0.5?6:3.5,reason:c.hiddenBelief?'Retain the estimated hiding advantage while waiting':'Protection permits hiding before engagement'};
  return null;
});
tacticalBehaviors.registerPlan({id:'lay-low',label:'Lay low',requires:['stealth'],components:['protection'],
  intent:'survive',delivery:['stealth'],posture:'hold',
  score:context=>context.unanswerableAirThreat?
    {value:11,reason:'Known enemies are above available attack reach; use stealth instead of a futile pursuit'}:null,
  objective:(context,state,previous)=>objective('lay-low',context,state,previous)});
plan('swarming','Swarming',['surround','pressure'],c=>(c.pack||c.melee)&&c.allies>0&&c.swarmOpportunity?
  {value:6.5,reason:'Known allies can surround an isolated opponent'}:null);
plan('supporting','Supporting',['assist','protection'],c=>c.supportRecipients>0?
  {value:7,reason:'Allies can benefit from a supported enabling action'}:null);
tacticalBehaviors.registerPlan({id:'aerial-hunt',label:'Aerial hunt',requires:['flight'],components:['distance','protection'],
  intent:'damage',delivery:['flight','melee'],posture:'setup',
  score:(_context,state)=>state.flight?.hunt?{value:12,reason:state.flight.hunt.reason}:null,
  objective:(context,state,previous)=>objective('aerial-hunt',context,state,previous)});
for(const [id,mode,label]of [['aerial-engage',null,'Aerial engagement'],['aerial-disengage','disengage','Aerial disengagement']])
  tacticalBehaviors.registerPlan({id,label,requires:['flight'],components:mode?['distance','protection']:['pressure','distance'],
    intent:mode?'survive':'damage',delivery:['flight',...(mode?[]:['melee','ranged'])],posture:mode?'disengage':'exploit',
    score:(_context,state)=>state.flight?.airCombat&&(mode?state.flight.airCombat.mode===mode:state.flight.airCombat.mode!=='disengage')?
      {value:12,reason:state.flight.airCombat.reason}:null,
    objective:(context,state,previous)=>objective(id,context,state,previous)});

export const defaultBehaviorConfiguration = profileId => ({
  components:['recovery','perception','movement','strikes','control','stealth','equipment',
    ...(profileId==='manticore-quill'?['volleys']:[]),
    ...(['goblin-pyro','dero-magister','spellcaster','generic'].includes(profileId)?['spellcasting']:[]),...(['ogre-boss','generic'].includes(profileId)?['leadership']:[]),
    ...['wolf','kobold-scout'].includes(profileId)?['pack']:[],
    'pressure','advance','charge-run','kite-retreat','effective-range','protection','distance','surround','assist','withdraw',
    ...['goblin-pyro','dero-magister','spellcaster','generic'].includes(profileId)?['spell-control','spell-damage','spell-drain','spell-support']:[]],
  plans:['aggressive','ranged','defensive','avoiding','hiding','lay-low','charge','kiting','swarming','supporting','desperate',
    ...['goblin-pyro','dero-magister','spellcaster','generic'].includes(profileId)?['spell-control','spell-damage','spell-drain','spell-support']:[]],
});

export const chooseTacticalAction = (candidates,state,options) => chooseBehaviorAction(tacticalBehaviors,candidates,state,options);
