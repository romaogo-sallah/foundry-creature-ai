import { attackValue } from '../dawnsbury/chooser.mjs';
import { setupUtility } from '../framework/setup-utility.mjs';
import { scoutGroupPosition, scoutMeleeProgress } from './scout-group-tactics.mjs';
import {tacticalPosition} from '../framework/tactical-field.mjs';

const chance=value=>Math.max(0,Math.min(1,value??0));
export function scoutAttackValue(state,enemy,position,strike){
  if(!position?.usable||position.lineOfSight===false||position.lineOfEffect===false||enemy.lineOfSight===false)return 0;
  const value=offGuard=>attackValue({bonus:strike.bonus+strike.mapPenalties[Math.min(state.attacksMade,2)]-(position.rangePenalty??0),
    referenceAC:state.self.referenceAC,damage:strike.damage+(offGuard?state.sneakDamage:0),
    defenseAdjustment:(position.coverBonus??0)-(offGuard?2:0),concealmentDC:position.concealmentDC});
  if(enemy.prone||enemy.offGuard||!strike.ranged&&position.flanked)return value(true);
  return value(false)*(1-chance(enemy.stealthChance))+value(true)*chance(enemy.stealthChance);
}

// A bounded estimate of next-turn pressure, using known geometry/capabilities.
// No actual HP, AC, Perception DC, secret roll or GM detection result is read.
export function scoutExposure(state,enemies=state.enemies){
  const costs=enemies.map(enemy=>{
    const threat=enemy.threat??{},distance=enemy.threatDistance??enemy.distance??Infinity;
    const reach=threat.reach??5,speed=threat.speed??25;
    const mapped=typeof enemy.arrivalActions==='number';
    if(!mapped&&(enemy.lineOfSight===false||enemy.physicalPath===false))return 0;
    let pressure=mapped?(enemy.arrivalActions===0?1:enemy.arrivalActions<=1?0.65:enemy.arrivalActions<=2?0.25:enemy.arrivalActions<=3?0.05:0):
      distance<=reach?1:distance<=reach+speed?0.65:distance<=reach+speed*2?0.25:0.05;
    if(enemy.lineOfSight!==false&&enemy.physicalPath!==false&&distance<=reach)pressure=Math.max(pressure,1);
    if(threat.ranged&&enemy.lineOfSight!==false&&enemy.physicalPath!==false&&distance<=(threat.range??120))pressure=Math.max(pressure,0.7);
    const incoming=enemy.incoming??{};
    const cover=Math.min(0.35,Math.max(0,incoming.coverBonus??0)*0.08);
    const conceal=incoming.concealed?0.8:1;
    const stealth=1-chance(enemy.stealthChance)*0.5-chance(enemy.undetectedChance)*0.2;
    const support=state.group?.targets?.[enemy.id];
    const sharing=state.bladeReady&&distance<=5&&support?.swarm?1+Math.min(0.6,support.helpers*0.2):1;
    return pressure*(1-cover)*conceal*stealth/sharing;
  });
  const worst=Math.max(0,...costs),others=costs.reduce((sum,cost)=>sum+cost,0)-worst;
  return (worst+Math.min(0.5,others*0.25))*Math.max(2,state.self.averageDamage??4.5);
}

const revealed=enemies=>enemies.map(enemy=>({...enemy,stealthChance:0,undetectedChance:0}));
const empty=()=>({value:0,offense:0,focus:0,frontline:0,readiness:0,danger:0,group:0,position:0,approach:0,routePenalty:0,setupCost:0,showcase:0,reactionRisk:0,redundancy:0,sequence:[]});
function prepend(tail,action,changes={}){
  const result={...tail,sequence:[action,...tail.sequence]};
  for(const [key,value]of Object.entries(changes))result[key]=(result[key]??0)+value;
  result.value=result.offense+result.focus+result.frontline+result.readiness-result.danger+result.group+result.position+result.approach-result.routePenalty-result.setupCost+result.showcase-result.reactionRisk-result.redundancy;
  return result;
}

// Forecast stationary attack/stealth/equipment sequences inside the remaining
// ordinary action budget. Recompute after every real action; this is not a queue.
export function scoutPositionPlan(state){
  const memo=new Map(),cost=setupUtility(state,{gain:0}).actionCost;
  const first={actions:state.actionsRemaining,attacks:state.attacksMade,loaded:state.loaded,bolts:state.bolts,bowReady:state.bowReady,bladeReady:state.bladeReady,
    hidden:state.enemies.map(e=>[chance(e.stealthChance),chance(e.undetectedChance)]),hideAttempts:state.hideAttempts??0,
    frontline:Boolean(state.frontlineEngaged),reaction:Boolean(state.self.threatened)};
  const enemiesAt=node=>state.enemies.map((enemy,index)=>({...enemy,stealthChance:node.hidden[index][0],undetectedChance:node.hidden[index][1]}));
  const readyEnemies=(node,enemies)=>enemies.map(enemy=>({...enemy,strikes:Object.fromEntries(state.strikes.map(strike=>{
    const p=enemy.strikes?.[strike.id],ready=strike.ranged?node.loaded&&node.bowReady&&node.bolts>0:node.bladeReady;
    const geometry=p?.geometryUsable??(p?.usable||!state.loaded&&p?.inReach!==false&&p?.lineOfEffect!==false);
    return [strike.id,p?{...p,usable:ready&&geometry&&p.inReach!==false&&p.lineOfEffect!==false&&p.lineOfSight!==false}:undefined];
  }))}));
  const attack=(node,enemy,strike)=>scoutAttackValue({...state,attacksMade:node.attacks},enemy,enemy.strikes?.[strike.id],strike);
  const bestAttack=(node,enemies)=>Math.max(0,...enemies.flatMap(enemy=>state.strikes.map(strike=>attack(node,enemy,strike))));
  function leaf(node){
    const enemies=enemiesAt(node),plain=readyEnemies({...node,attacks:0},revealed(enemies));
    let readiness=node.loaded&&node.bowReady&&node.bolts>0?bestAttack({...node,attacks:0},plain)*0.3:0;
    if(node.bolts<1&&node.bladeReady&&state.enemies.length){
      const sword=state.strikes.find(s=>!s.ranged);
      if(sword)readiness=Math.max(readiness,cost+0.1,attackValue({bonus:sword.bonus,referenceAC:state.self.referenceAC,damage:sword.damage})*0.35);
    }
    const danger=scoutExposure({...state,bladeReady:node.bladeReady},enemies),group=scoutGroupPosition(state,enemies,node);
    const position=tacticalPosition(state,node);
    return {...empty(),value:readiness-danger+group+position,readiness,danger,group,position};
  }
  function available(node){
    if(node.actions<1)return [];
    const enemies=readyEnemies(node,enemiesAt(node)),actions=[];
    for(const enemy of enemies)for(const strike of state.strikes)if(attack(node,enemy,strike)>0)
      actions.push({kind:'strike',targetId:enemy.id,strikeId:strike.id});
    if(!node.loaded&&node.bowReady&&node.bolts>0)actions.push({kind:'reload'});
    if(!node.bladeReady&&(node.bolts<1&&enemies.length||enemies.some(e=>e.distance<=5&&e.lineOfEffect)||node.actions>=2&&state.futureMoves?.some(m=>m.swarmTargetId)))actions.push({kind:'drawSword'});
    if(!node.bowReady&&node.bolts>0&&enemies.every(e=>e.distance>5))actions.push({kind:node.bladeReady?'stowSword':'gripBow'});
    if(node.hideAttempts<1&&(node.loaded&&node.bowReady||node.bladeReady||node.actions===1)&&
      enemies.some((enemy,index)=>!(node.hidden[index][0]>0)&&
        (state.freshHideEstimates??state.hideEstimates??[]).some(e=>e.observerId===enemy.id&&e.unseenChance>0)))actions.push({kind:'hide'});
    actions.push(...(state.futureMoves??[]).map(move=>({kind:move.kind,moveId:move.id,destination:move.destination,targetId:move.swarmTargetId??move.meleeTargetId})));
    return actions;
  }
  function take(node,action){
    if(node.actions<1)return null;
    const enemies=readyEnemies(node,enemiesAt(node)),next={...node,actions:node.actions-1},changes={};
    if(action.kind==='strike'){
      const enemy=enemies.find(e=>e.id===action.targetId),strike=state.strikes.find(s=>s.id===action.strikeId);
      if(!enemy||!strike||(changes.offense=attack(node,enemy,strike))<=0)return null;
      changes.focus=enemy.focusFire?0.35:0;
      changes.frontline=state.style?.enabled&&enemy.frontline&&!node.frontline?1.5:0;
      next.frontline=node.frontline||Boolean(enemy.frontline);next.attacks++;next.hidden=node.hidden.map(()=>[0,0]);
      if(strike.ranged){next.loaded=false;next.bolts--;}
      if(strike.ranged&&node.reaction){changes.reactionRisk=state.self.reactionRisk??state.self.averageDamage;next.reaction=false;}
    }else if(action.kind==='reload'){
      if(node.loaded||!node.bowReady||node.bolts<1)return null;
      next.loaded=true;next.hidden=node.hidden.map(()=>[0,0]);changes.setupCost=cost;
      if(node.reaction){changes.reactionRisk=state.self.reactionRisk??state.self.averageDamage;next.reaction=false;}
    }else if(action.kind==='hide'){
      if(node.hideAttempts>=1)return null;
      const estimates=state.freshHideEstimates??state.hideEstimates??[];
      next.hideAttempts++;next.hidden=enemies.map((enemy,index)=>node.hidden[index][0]>0?node.hidden[index]:
        [chance(estimates.find(e=>e.observerId===enemy.id)?.unseenChance),0]);
      const after=readyEnemies(next,enemiesAt(next)),offense=Math.max(0,bestAttack(next,after)-bestAttack(node,enemies));
      const canShoot=node.bowReady&&node.loaded&&bestAttack(node,enemies)>0&&node.actions>1;
      const defense=canShoot?0:Math.max(0,scoutExposure(state,enemies)-scoutExposure(state,after));
      const gain=offense+defense,existing=enemies.some(e=>e.stealthChance>0||e.prone||e.offGuard);
      changes.setupCost=cost;changes.redundancy=gain<=1e-6&&existing?cost:0;
      changes.showcase=gain>0&&state.style?.enabled&&!state.hiddenShown?Math.min(state.style.showcaseBonus??4,gain*2):0;
    }else if(['drawSword','stowSword','gripBow'].includes(action.kind)){
      if(action.kind==='drawSword'){if(node.bladeReady)return null;next.bladeReady=true;next.bowReady=false;}
      else if(action.kind==='stowSword'){if(!node.bladeReady)return null;next.bladeReady=false;}
      else {if(node.bladeReady||node.bowReady)return null;next.bowReady=true;}
      next.hidden=node.hidden.map(()=>[0,0]);changes.setupCost=cost;
      if(node.reaction){changes.reactionRisk=state.self.reactionRisk??state.self.averageDamage;next.reaction=false;}
    }else if(action.moveId){
      const entry=state.futureMoves?.find(m=>m.id===action.moveId);if(!entry)return null;
      const move=entry.move;
      const projected=state.enemies.map((enemy,index)=>({...enemy,...move.targets[enemy.id],
        stealthChance:action.kind==='step'&&move.hideEstimates?.some(e=>e.observerId===enemy.id&&e.unseenChance>0)?node.hidden[index][0]:0,
        undetectedChance:action.kind==='step'&&move.hideEstimates?.some(e=>e.observerId===enemy.id&&e.unseenChance>0)?node.hidden[index][1]:0}));
      const tail=scoutPositionPlan({...state,enemies:projected,actionsRemaining:next.actions,attacksMade:node.attacks,
        loaded:node.loaded,bolts:node.bolts,bowReady:node.bowReady,bladeReady:node.bladeReady,hideAttempts:node.hideAttempts,frontlineEngaged:node.frontline,
        futureMoves:[],tactical:move.tactical,hideEstimates:move.hideEstimates??[],freshHideEstimates:move.hideEstimates??[],
        self:{...state.self,threatened:Boolean(move.destinationThreatened),reactionRisk:move.destinationThreatened?state.self.averageDamage:0}}).best();
      return prepend(tail,{kind:action.kind,destination:entry.destination,targetId:entry.swarmTargetId??entry.meleeTargetId},
        {approach:scoutMeleeProgress(state,move),setupCost:cost,routePenalty:(move.sightPenalty??0)+(move.returnPenalty??0)+(move.historyPenalty??0),
          reactionRisk:(action.kind==='step'?0:move.reactionRisk??0)+(move.terrainRisk??0)});
    }else return null;
    return prepend(solve(next),action,changes);
  }
  function solve(node){
    const key=JSON.stringify(node);if(memo.has(key))return memo.get(key);
    let best=leaf(node);
    for(const action of available(node)){const plan=take(node,action);if(plan&&plan.value>best.value)best=plan;}
    memo.set(key,best);return best;
  }
  return {best:()=>solve(first),first:action=>take(first,action)};
}

export function scoutPlanTerms(plan,baseline,initialGroup=0,initialPosition=0){
  return [{label:'Expected attacks in remaining actions',contribution:plan.offense},
    {label:'Witnessed focus fire',contribution:plan.focus},{label:'Let the front line hold attention (once this turn)',contribution:plan.frontline},
    {label:'Weapon readiness for next turn',contribution:plan.readiness},
    {label:'Expected end-of-turn exposure change',contribution:baseline-plan.danger},
    {label:'Coordinated kite or swarm position',contribution:plan.group-initialGroup},
    {label:'Grid escape space and enemy control',contribution:plan.position-initialPosition},
    {label:'Future sight, route returns and movement history',contribution:-plan.routePenalty},
    {label:'Future approach with shortsword after ammunition is exhausted',contribution:plan.approach},
    {label:'Setup action cost',contribution:-plan.setupCost},{label:'Already has the advantage',contribution:-plan.redundancy},
    {label:'Show useful stealth',contribution:plan.showcase},{label:'Known reaction risk',contribution:-plan.reactionRisk}];
}
