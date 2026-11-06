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
    candidate.assessment.nearestEnemy<state.nearestEnemy&&!candidate.provokes?0.6:0});
tacticalBehaviors.registerComponent({id:'protection',label:'Use protection',kind:'policy',
  candidates:(state,selection)=>['defensive','hiding','lay-low','avoiding'].includes(selection.planId)?
    (state.sharedBehaviors?.protectedMoves??[]).filter(candidate=>selection.planId!=='defensive'||!candidate.features.visibility.losesAll):[],
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
    requires:['spellcasting'],components:[`spell-${role}`,...role==='control'?['protection']:['pressure']],
    score:(_context,state)=>state.casterScenarios?.[role]?{value:6+Math.min(6,state.casterScenarios[role].value*0.25),
      reason:role==='control'?'A supported control spell has the best local opening':role==='damage'?'An affordable damage spell can exploit the current position':'Touch damage and additional temporary HP are worth the approach risk'}:null,
    objective:(_context,state)=>({kind:`spell-${role}`,label,...state.casterScenarios[role]})});
}

function objective(id,context,state,previous){
  if(['aerial-engage','aerial-disengage'].includes(id))return {kind:id,...state.flight.airCombat};
  if(id==='aerial-hunt')return {kind:'aerial-hunt',phase:state.flight.hunt.phase,label:state.flight.hunt.reason,preferredElevation:state.flight.hunt.preferredElevation};
  const choices=[...state.enemies].sort((a,b)=>(a.distance-(a.alliesInReach??0)*2)-(b.distance-(b.alliesInReach??0)*2)||a.id.localeCompare(b.id));
  const prior=state.enemies.find(enemy=>enemy.id===previous?.goal?.targetId);
  const target=prior&&prior.distance<=(choices[0]?.distance??0)+10?prior:choices[0];
  if(id==='avoiding')return {kind:'withdraw',label:'Break firing lines and create distance from known threats',fromIds:state.enemies.map(enemy=>enemy.id),
    desiredDistance:Math.max(30,...state.enemies.map(enemy=>enemy.tactics?.role==='ranged'?(enemy.tactics.rangeIncrement??60)*2+5:
      (enemy.tactics?.reach??5)+(enemy.tactics?.speed??25)+5))};
  if(id==='defensive')return {kind:'hold-position',label:context.caster?'Hold a protected casting position':'Keep protection while remaining able to fight',anchor:previous?.planId===id?previous.goal?.anchor??state.self.cell:state.self.cell};
  if(id==='hiding')return {kind:'break-observation',label:'Hide from known observers',observerIds:state.enemies.map(enemy=>enemy.id)};
  if(id==='lay-low')return {kind:'avoid-hunter',label:'Take cover, Hide and Sneak until the hunter can be opposed',observerIds:state.groundThreats.ids};
  if(id==='supporting')return {kind:'enable-allies',label:'Enable allies who can benefit',recipientIds:(state.commandRecipients??[]).filter(ally=>ally.needsMovement!==false).map(ally=>ally.id)};
  return {kind:id==='kiting'?'keep-range':id==='swarming'?'surround':id==='charge'?'approach':'engage',
    label:`${id==='kiting'?'Keep range from':id==='swarming'?'Surround':id==='charge'?'Close to':'Engage'} ${target?.name??'known opponents'}`,
    targetId:target?.id??null,...id==='kiting'?{minimumDistance:(target?.tactics?.reach??5)+10}:id==='charge'?{desiredDistance:(state.self.reachSquares??1)*5}:{}};
}
const plan=(id,label,components,score)=>tacticalBehaviors.registerPlan({id,label,components,score,
  ...(id==='hiding'?{requires:['stealth']}:{}),objective:(context,state,previous)=>objective(id,context,state,previous)});
plan('aggressive','Aggressive',['pressure'],c=>({value:3+(c.immediateAttack?2:0),reason:c.immediateAttack?'A useful attack is available':'Engage known opponents'}));
plan('charge','Charge',['advance','pressure'],c=>c.melee&&!c.immediateAttack&&c.visibleEnemies>0&&c.health>0.4&&c.forceRatio>=0.5?
  {value:5,reason:'Melee attacks need a safe approach'}:null);
plan('defensive','Defensive',['protection'],c=>({value:c.caster?5.5:c.health<0.5||c.forceRatio<0.6?5:2,
  reason:c.caster?'Preserve a protected casting position':'Reduce exposure while remaining able to fight'}));
plan('avoiding','Avoiding',['withdraw','protection'],c=>c.emergency?{value:100,reason:c.broken?'The group has broken':'Own HP is critically low'}:
  c.health<0.4&&c.forceRatio<0.6?{value:7,reason:'Wounded and locally outnumbered'}:null);
plan('kiting','Kiting',['distance','protection'],c=>c.ranged&&c.closingMelee&&c.allies>0?
  {value:6,reason:'Ranged attacks and visible ally support permit a fighting retreat'}:null);
plan('hiding','Hiding',['protection'],c=>(c.hideUseful||c.hiddenBelief)&&c.visibleEnemies>0&&!c.immediateAttack&&!(c.planAge>=2||c.waitPatienceReached)?
  {value:c.caster||c.skulk||c.health<0.5?6:3.5,reason:c.hiddenBelief?'Retain the estimated hiding advantage while waiting':'Protection permits hiding before engagement'}:null);
tacticalBehaviors.registerPlan({id:'lay-low',label:'Lay low',requires:['stealth'],components:['protection'],
  score:context=>context.unanswerableAirThreat?
    {value:11,reason:'Known enemies are above available attack reach; use stealth instead of a futile pursuit'}:null,
  objective:(context,state,previous)=>objective('lay-low',context,state,previous)});
plan('swarming','Swarming',['surround','pressure'],c=>(c.pack||c.melee)&&c.allies>0&&c.swarmOpportunity?
  {value:6.5,reason:'Known allies can surround an isolated opponent'}:null);
plan('supporting','Supporting',['assist','protection'],c=>c.supportRecipients>0?
  {value:7,reason:'Allies can benefit from a supported enabling action'}:null);
tacticalBehaviors.registerPlan({id:'aerial-hunt',label:'Aerial hunt',requires:['flight'],components:['distance','protection'],
  score:(_context,state)=>state.flight?.hunt?{value:12,reason:state.flight.hunt.reason}:null,
  objective:(context,state,previous)=>objective('aerial-hunt',context,state,previous)});
for(const [id,mode,label]of [['aerial-engage',null,'Aerial engagement'],['aerial-disengage','disengage','Aerial disengagement']])
  tacticalBehaviors.registerPlan({id,label,requires:['flight'],components:mode?['distance','protection']:['pressure','distance'],
    score:(_context,state)=>state.flight?.airCombat&&(mode?state.flight.airCombat.mode===mode:state.flight.airCombat.mode!=='disengage')?
      {value:12,reason:state.flight.airCombat.reason}:null,
    objective:(context,state,previous)=>objective(id,context,state,previous)});

export const defaultBehaviorConfiguration = profileId => ({
  components:['recovery','perception','movement','strikes','control','stealth','equipment',
    ...(profileId==='manticore-quill'?['volleys']:[]),
    ...(['goblin-pyro','dero-magister','spellcaster','generic'].includes(profileId)?['spellcasting']:[]),...(['ogre-boss','generic'].includes(profileId)?['leadership']:[]),
    ...['wolf','kobold-scout'].includes(profileId)?['pack']:[],
    'pressure','advance','protection','distance','surround','assist','withdraw',
    ...['goblin-pyro','dero-magister','spellcaster','generic'].includes(profileId)?['spell-control','spell-damage','spell-drain','spell-support']:[]],
  plans:['aggressive','defensive','avoiding','hiding','lay-low','charge','kiting','swarming','supporting',
    ...['goblin-pyro','dero-magister','spellcaster','generic'].includes(profileId)?['spell-control','spell-damage','spell-drain','spell-support']:[]],
});

export const chooseTacticalAction = (candidates,state,options) => chooseBehaviorAction(tacticalBehaviors,candidates,state,options);
