import { MODULE_ID } from './rules-context.mjs';
import { combatStamp } from './reaction-prompts.mjs';
import { MANAGED_MOVEMENT, REQUESTED_MOVEMENT, inheritManagedMovement } from './movement-options.mjs';
import { requestedMovementPath } from './movement-request.mjs';
import { incapacitationReason } from './combat-state.mjs';
import { unsupportedMovementRegions, terrainMovementPath } from './movement-regions.mjs';
import { beginTerrainAction, endTerrainAction } from './hazardous-terrain.mjs';
import { playerSneakSpeed } from './player-stealth.mjs';
import { STEALTH_MOVEMENT, stealthContext } from './stealth-awareness.mjs';
import { greaseOnPath, greaseExtraCost, prepareGreaseMove, withGreaseMode } from './spell-zones.mjs';
import { settleGreaseSlip, finishGreaseFall } from './grease-landing.mjs';
import { surfaceMovementPath } from './surface-terrain.mjs';
import { selectedGroundAction } from './native-movement-modes.mjs';
import {withConditionActivity} from './condition-activity.mjs';
import {waterMovementPath} from './water-geometry.mjs';
import {landSpeed,swimSpeed} from './flight-costs.mjs';

export const MOVEMENT_QUERY = `${MODULE_ID}.manualMovement`;
const positionKeys = ['x', 'y', 'elevation', 'level'];
const position = document => Object.fromEntries(positionKeys.map(key => [key, (document._source ?? document)[key]]));
const samePosition = (a, b) => positionKeys.every(key => a[key] === b[key]);

// Cancel the original synchronous preMoveToken hook, then replay the validated
// path through native movement, one square at a time, on the active GM.
export class ManualMovement {
  constructor(reactions, { enabled = () => true, playerStealth = null, onMoveAction = async()=>{}, onError = error => ui.notifications.error(error.message) } = {}) {
    this.reactions = reactions; this.enabled = enabled; this.onError = onError;
    this.playerStealth = playerStealth;
    this.onMoveAction = onMoveAction;
    this.generation = 0; this.pending = new Set(); this.running = false;
    this.readinessNotices = new Map();
  }
  cancel() { this.generation++;this.playerStealth?.clearSneakAction(); }
  install() {
    CONFIG.queries ??= {};
    CONFIG.queries[MOVEMENT_QUERY] = (data, { user }) => this.receive(data, user);
    Hooks.on('preMoveToken', (document, movement, options) => this.intercept(document, movement, options));
  }
  proxy(token, point) {
    const width = token.document.width * canvas.grid.size, height = token.document.height * canvas.grid.size;
    return { id: token.id, actor: token.actor,
      document: { ...position(token.document), ...point, depth: token.document.depth, hidden: token.document.hidden, width: token.document.width, height: token.document.height },
      center: { x: point.x + width / 2, y: point.y + height / 2 },
      mechanicalBounds: new PIXI.Rectangle(point.x, point.y, width, height) };
  }
  hasThreat(token, path) {
    return path.slice(0, -1).some(point => this.reactions.reactors(this.proxy(token, point))
      .some(reactor => this.reactions.automaticReactiveStrike(reactor)));
  }
  explainUnready(token, path) {
    for (const reactor of canvas.tokens.placeables) {
      if (!this.reactions.automaticReactiveStrike(reactor) || !reactor.actor.isEnemyOf(token.actor) ||
        reactor.document.hidden || reactor.document.elevation !== token.document.elevation || reactor.document.level !== token.document.level) continue;
      const check = this.reactions.inspectReactiveStrike(reactor);
      if (check.eligible || !check.reactionAvailable || !check.abilityFound) continue;
      const nearby = path.slice(0, -1).some(point => this.reactions.meleeOptions(reactor).some(({ strike }) => {
        const reach = reactor.actor.getReach({ action: 'attack', weapon: strike.item });
        return reactor.distanceTo(this.proxy(token, point), { reach }) <= reach;
      }));
      const key = `${combatStamp()}:${check.reason}`;
      if (nearby && this.readinessNotices.get(reactor.id) !== key) {
        this.readinessNotices.set(reactor.id, key);
        ui.notifications.warn(`${reactor.name} cannot Reactive Strike: ${check.reason}`);
      }
    }
  }
  path(token, points, mode=selectedGroundAction(token.document,points)) {
    if (canvas.grid.type !== 1 || canvas.grid.distance !== 5 || points.length > 512 || points.length < 2) throw new Error('Manual reaction movement needs a 5-foot square grid and a bounded path.');
    const document=token.document,origin = position(document);
    points=requestedMovementPath(document,points).slice(1);
    const surface=surfaceMovementPath(document,points),water=waterMovementPath(document,points);
    if(points.some(point=>!Number.isFinite(point.x)||!Number.isFinite(point.y)||
      !surface&&!water&&point.elevation!==origin.elevation||point.level!==origin.level||
      ['width','height','depth','shape'].some(key=>point[key]!==undefined&&document[key]!==undefined&&point[key]!==document[key]))) {
      throw new Error('Keep this ground movement on one elevation/level without resizing the token. Resolve other movement manually.');
    }
    // Foundry marks generated terrain boundaries BOTH explicit and intermediate:
    // explicit controls native measurement, not user intent. Keep requested
    // non-intermediate corners/endpoints and regenerate all native grid steps.
    points=points.filter((point,index)=>index===0||index===points.length-1||!point.intermediate);
    if(points.some(point=>{
      const snapped=document.getSnappedPosition(point);
      return Math.round(point.x)!==Math.round(snapped.x)||Math.round(point.y)!==Math.round(snapped.y);
    })) {
      throw new Error('Snap this ground movement to the grid and keep it on one elevation/level. Resolve other movement manually.');
    }
    // Native token traversal honors footprint-specific snapping and integer
    // rounding, including Small/Tiny footprints, rather than x/y modulo size.
    const complete=surface??water??document.getCompleteMovementPath?.(points)??canvas.grid.getDirectPath(points.map(({x,y})=>({x,y})))
      .map(offset=>({...origin,...canvas.grid.getTopLeftPoint(offset)}));
    const path=complete.filter((point,index)=>index===0||!samePosition(point,complete[index-1]));
    if (path.length > 256) throw new Error('Split this movement into individual move actions.');
    const action=mode==='stride'?'walk':mode;
    return path.map(point=>({...origin,...point,action,snapped:surface||water?Boolean(point.snapped):true}));
  }
  sneakActionPaths(token,path,budget,history=[...(token.document.movementHistory??[])],progress=null){
    if(!(budget>0)||path.length<2)throw new Error('This creature has no usable Sneak movement budget.');
    const historyCost=history.length?token.measureMovementPath(history).cost:0;
    const cumulative=path.map((_point,index)=>index===0?0:withGreaseMode(token,'sneak',()=>
      Math.max(0,token.measureMovementPath([...history,...terrainMovementPath(token,path.slice(0,index+1))]).cost-historyCost)+
      greaseExtraCost(token,path.slice(0,index+1),'sneak')));
    if(cumulative.some(cost=>!Number.isFinite(cost)))throw new Error('Cannot measure this Sneak path.');
    const actions=[];let start=0,continuing=Boolean(progress),number=progress?.number??1;
    let remaining=continuing?Math.max(0,budget-progress.cost):budget;
    while(start<path.length-1){
      let end=start;
      while(end+1<path.length&&cumulative[end+1]-cumulative[start]<=remaining+1e-8)end++;
      if(end===start){
        if(continuing){continuing=false;number++;remaining=budget;continue;}
        throw new Error(`One square of this path costs more than the ${budget}-foot Sneak budget.`);
      }
      actions.push({path:path.slice(start,end+1),continuing,number,cost:cumulative[end]-cumulative[start]});start=end;
      continuing=false;number++;remaining=budget;
    }
    return actions;
  }
  sneakPathCost(token,path,history){
    if(path.length<2)return 0;
    const historyCost=history.length?token.measureMovementPath(history).cost:0;
    return withGreaseMode(token,'sneak',()=>Math.max(0,token.measureMovementPath([...history,...terrainMovementPath(token,path)]).cost-historyCost))+
      greaseExtraCost(token,path,'sneak');
  }
  async executeSneakActions(token,actions,{valid,data,automaticSneak,sneakLimit}){
    if(!automaticSneak)await this.playerStealth.enableSneak(token);
    if(!valid()||!this.playerStealth.armed(token))return false;
    const seen=new Set();let used=0,completedAll=true;
    for(let index=0;index<actions.length;index++){
      const action=actions[index],expected=position(token.document),planned=action.path.map((point,i)=>i?point:{...point,...expected});
      const atActionOrigin=()=>valid()&&samePosition(position(token.document),expected)&&this.playerStealth.armed(token);
      if(!atActionOrigin()||incapacitationReason(token)||token.actor.hasCondition('prone','grabbed','restrained','immobilized')){completedAll=false;break;}
      const progress=action.continuing?this.playerStealth.sneakAction(token,{stamp:data.stamp,budget:sneakLimit}):null;
      if(action.continuing&&!progress){completedAll=false;break;}
      if(!action.continuing)this.playerStealth.clearSneakAction(token);
      const history=[...(token.document.movementHistory??[])],historyCost=history.length?token.measureMovementPath(history).cost:0;
      const remaining=progress?Math.max(0,sneakLimit-progress.cost):sneakLimit;
      const grease=await prepareGreaseMove(token,planned,{kind:'sneak',valid:atActionOrigin,speed:remaining,
        baseCost:points=>Math.max(0,token.measureMovementPath([...history,...terrainMovementPath(token,points)]).cost-historyCost)});
      if(grease.note)ui.notifications.info(grease.note);
      if(grease.blocked){this.playerStealth.clearSneakAction(token);completedAll=false;break;}
      if(grease.path.length<2){this.playerStealth.clearSneakAction(token);if(grease.fallOnArrival)await finishGreaseFall(token,{valid});completedAll=false;break;}
      const actionPath=grease.path,localTraveled=[actionPath[0]],traveled=[...(progress?.traveled??[actionPath[0]])];
      let sneak=progress?.plan,landed=false,segmentComplete=true;
      beginTerrainAction(token,`manual:${data.stamp}:${data.expires}:sneak:${action.number}`);
      try{
        if(sneak)await this.playerStealth.continueSneak(token,sneak,[...traveled,...actionPath.slice(1)]);
        else{sneak=await this.playerStealth.prepareSneak(token,actionPath,()=>atActionOrigin());used++;}
        for(const point of actionPath.slice(1)){
          const before=position(token.document);
          const unchanged=()=>valid()&&samePosition(position(token.document),before)&&this.playerStealth.armed(token);
          if(!unchanged()||incapacitationReason(token)){segmentComplete=completedAll=false;break;}
          if(this.enabled()){
            const result=await this.reactions.resolveMovement({mover:token,seen,valid:unchanged,applyDamage:true,
              trigger:'leaves a threatened square',reactorFilter:reactor=>this.reactions.automaticReactiveStrike(reactor)});
            if(result.endTurn){segmentComplete=completedAll=false;break;}
            if(result.pause||!unchanged()){
              if(result.pauseReason)ui.notifications.warn(result.pauseReason);
              this.reactions.onPause();segmentComplete=completedAll=false;break;
            }
          }
          if(!unchanged()||token.actor.hasCondition('prone','grabbed','restrained','immobilized')){segmentComplete=completedAll=false;break;}
          const completed=await token.document.move([point],{[MANAGED_MOVEMENT]:true,[STEALTH_MOVEMENT]:true,showRuler:false,
            constrainOptions:{ignoreWalls:false,ignoreCost:false,maxCost:historyCost+sneakLimit}});
          await (token.movementAnimationPromise??token.document.movement?.animation?.ended);
          const falling=grease.fallOnArrival&&point===actionPath.at(-1);
          if(falling||token.actor.hasCondition('prone')){
            const landing=await settleGreaseSlip(token,{path:[before,point],fall:Boolean(falling),valid});
            if(landing.settled){if(falling)await finishGreaseFall(token,{valid});const actual=position(token.document);localTraveled.push(actual);traveled.push(actual);landed=true;segmentComplete=completedAll=false;break;}
          }
          const actual=position(token.document);localTraveled.push(actual);traveled.push(actual);
          if(!completed||!samePosition(actual,point)){segmentComplete=completedAll=false;break;}
        }
        await this.onMoveAction(token,{valid});
      }finally{
        if(sneak)await this.playerStealth.finishSneak(token,sneak,traveled);
        endTerrainAction(token);
      }
      if(segmentComplete&&actionPath.length===planned.length){
        this.playerStealth.rememberSneakAction(token,{stamp:data.stamp,budget:sneakLimit,number:action.number,
          cost:(progress?.cost??0)+this.sneakPathCost(token,localTraveled,history),plan:sneak,traveled});
      }else this.playerStealth.clearSneakAction(token);
      if(landed||!completedAll||actionPath.length<planned.length)break;
    }
    if(used>1)ui.notifications.info(`Sneak used ${used} actions and ${used} secret Stealth checks.`);
    return completedAll;
  }
  intercept(document, movement, options = {}) {
    if (inheritManagedMovement(document,movement,options) || options.isUndo || options.isPaste || options.teleport ||
      !['dragging', 'keyboard', 'api'].includes(movement.method) || !canvas.ready) return;
    const token = document.object ?? canvas.tokens.get(document.id);
    const points = options[REQUESTED_MOVEMENT] ?? [movement.origin, ...movement.passed.waypoints, ...movement.pending.waypoints];
    let mode;try{mode=selectedGroundAction(document,points);}catch(error){this.onError(error);return false;}
    let aquatic=false;
    if(mode==='swim')try{aquatic=Boolean(waterMovementPath(document,points,options));}catch(error){this.onError(error);return false;}
    const explicitMode=['step','sneak'].includes(mode)||aquatic;
    const player = this.playerStealth?.movementEnabled(token)||mode==='sneak'&&this.playerStealth?.supports(token);
    const greasy = mode!=='swim'&&token?.actor&&greaseOnPath(token,points);
    if (!this.enabled() && !player && !greasy&&!explicitMode || !game.combat?.started && !player && !greasy&&!explicitMode) return;
    const scopedCombatId=token?stealthContext(token).combatId:null;
    if (!token?.actor || scopedCombatId && (game.combat.combatant?.tokenId !== token.id || game.combat.combatant?.sceneId &&
      game.combat.combatant.sceneId !== document.parent.id)) return;
    if (points.slice(1).every(point => point.x === points[0].x && point.y === points[0].y&&point.elevation===points[0].elevation) ||
      points.slice(1).every(point => point.action === 'displace')) return;
    // Other movement modes keep their native/manual workflow. They must not be
    // recast as walking just because an automated ogre exists in the encounter.
    if (!['stride','step','sneak'].includes(mode)&&!aquatic) return;
    // Avoid touching ordinary movement in encounters without automated reactors.
    if (!player && !greasy&&!explicitMode && !canvas.tokens.placeables.some(reactor => reactor !== token && this.reactions.automaticReactiveStrike(reactor) &&
      this.reactions.available(reactor) && reactor.actor.isEnemyOf(token.actor))) return;
    if (this.pending.has(document.id) || this.running) {
      ui.notifications.warn('Finish the pending movement/reaction decision first.'); return false;
    }
    let path;
    try {
      path = this.path(token, points,mode);
      if (!player && !greasy&&!explicitMode&&!this.hasThreat(token, path)) { this.explainUnready(token, path); return; }
    } catch (error) { this.onError(error); return false; }
    const data = { sceneId: document.parent.id, tokenId: token.id, origin: position(document), path,
      mode,stamp: combatStamp(), expires: Date.now() + 120000 };
    const generation = this.generation;
    this.pending.add(document.id);
    // Yield until Foundry has rejected the initial update and its movement chain.
    setTimeout(() => {
      if (generation !== this.generation) { this.pending.delete(document.id); return; }
      const gm = game.users.activeGM;
      const request = gm?.id === game.user.id ? this.receive(data, game.user) :
        gm?.query(MOVEMENT_QUERY, data, { timeout: 125000 });
      Promise.resolve(request ?? Promise.reject(new Error('An active GM is required to resolve this movement.')))
        .catch(this.onError).finally(() => this.pending.delete(document.id));
    }, 0);
    return false;
  }
  async receive(data, sender) {
    if (game.users.activeGM?.id !== game.user.id || !sender?.active) throw new Error('Movement needs the active GM.');
    const token = canvas.scene?.id === data.sceneId ? canvas.tokens.get(data.tokenId) : null;
    const mode=data.mode??selectedGroundAction(token?.document??{},data.path);
    if(!['stride','step','sneak','swim'].includes(mode))throw new Error('Unsupported movement mode');
    const explicitMode=['step','sneak','swim'].includes(mode);
    const player = this.playerStealth?.movementEnabled(token)||mode==='sneak'&&this.playerStealth?.supports(token);
    const greasy = mode!=='swim'&&token?.actor&&greaseOnPath(token,data.path);
    if (!this.enabled() && !player && !greasy&&!explicitMode) throw new Error('Manual movement automation is disabled');
    if (!token?.actor || !sender.isGM && !token.actor.testUserPermission(sender, 'OWNER')) throw new Error('You do not own this combatant.');
    if (!Number.isFinite(data.expires) || data.expires > Date.now() + 180000) throw new Error('Invalid movement expiry.');
    if (this.running) throw new Error('Another movement decision is still resolving.');
    const generation = this.generation;
    const valid = () => generation === this.generation && combatStamp() === data.stamp && Date.now() < data.expires &&
      game.users.activeGM?.id === game.user.id && canvas.scene?.id === data.sceneId && !game.paused &&
      canvas.tokens.get(token.id) === token && (!stealthContext(token).combatId ? player || greasy||explicitMode : game.combat.combatant?.tokenId === token.id) &&
      (sender.isGM || token.actor.testUserPermission(sender, 'OWNER'));
    if (!valid() || !samePosition(position(token.document), data.origin)) throw new Error('The movement trigger changed; move again from the current position.');
    let path = this.path(token, data.path,mode);
    if (!samePosition(path[0], data.origin)) throw new Error('Movement origin does not match the token.');
    this.running = true;
    try {
      return await this.reactions.resolve(()=>withConditionActivity(token.actor,async () => {
        const stillAtOrigin = () => valid() && samePosition(position(token.document), data.origin);
        if (!player && !greasy&&!explicitMode&&!this.hasThreat(token, path)) return false; // Never replay a stale reaction request.
        if (incapacitationReason(token) || token.actor.hasCondition('prone', 'grabbed', 'restrained', 'immobilized')) throw new Error('Resolve the movement-blocking condition before moving.');
        const speed = mode==='swim'?swimSpeed(token.actor):landSpeed(token.actor);
        const history = [...(token.document.movementHistory ?? [])];
        const historyCost = history.length ? token.measureMovementPath(history).cost : 0;
        const terrainPath = terrainMovementPath(token, path);
        const cost = token.measureMovementPath([...history, ...terrainPath]).cost - historyCost;
        if(mode==='swim'&&!(speed>0))throw new Error('This creature has no prepared Swim Speed. Resolve an Athletics-based Swim action manually.');
        if (!Number.isFinite(speed) || !Number.isFinite(cost) || cost <= 0) throw new Error('Cannot measure this movement path.');
        const freshCost = withGreaseMode(token,'step',()=>token.measureMovementPath(terrainMovementPath(token,path)).cost);
        const uncertainTerrain = unsupportedMovementRegions(canvas.scene).length > 0;
        const stepLegal = path.length === 2 && speed >= 10 && freshCost <= 5 && !uncertainTerrain;
        const sneakLimit = player ? playerSneakSpeed(token.actor) : 0;
        const automaticSneak = player && this.playerStealth.armed(token);
        const answer=mode==='stride'&&automaticSneak&&token.document._source?.movementAction!=='walk'?'sneak':mode;
        if(answer!=='sneak'&&cost>speed+1e-8)throw new Error(`This path exceeds one ${answer==='swim'?'Swim':'Stride'}. Split it into individual move actions.`);
        if(answer==='sneak'&&(!player||uncertainTerrain))throw new Error(`Sneak cannot automate this path because its terrain is unsupported.`);
        if(answer!=='sneak')this.playerStealth?.clearSneakAction(token);
        const sneakProgress=answer==='sneak'?this.playerStealth.sneakAction(token,{stamp:data.stamp,budget:sneakLimit}):null;
        const sneakActions=answer==='sneak'?this.sneakActionPaths(token,path,sneakLimit,history,sneakProgress):[];
        const lastSneakAction=sneakActions.at(-1)?.number??sneakProgress?.number??0;
        if(answer==='sneak'&&game.combat?.started&&lastSneakAction>3)
          throw new Error(`This path requires ${lastSneakAction} Sneak actions; a combat turn normally has only three.`);
        if(answer==='step'&&!stepLegal)throw new Error('Step allows one legal 5-foot square and requires Speed 10 feet or more. Check difficult terrain or select Walk.');
        if (!stillAtOrigin() || !['stride','swim', ...(stepLegal ? ['step'] : []), ...(sneakActions.length ? ['sneak'] : [])].includes(answer)) {
          this.reactions.onPause(); return false;
        }
        if(answer==='sneak')return this.executeSneakActions(token,sneakActions,{valid,data,automaticSneak,sneakLimit});
        const grease = answer==='swim'?{path,mode:'swim'}:await prepareGreaseMove(token,path,{kind:answer,valid:stillAtOrigin,speed,
          baseCost:points=>Math.max(0,token.measureMovementPath([...history,...terrainMovementPath(token,points)]).cost-historyCost)});
        if (grease.note) ui.notifications.info(grease.note);
        if (grease.blocked) return false;
        if(grease.path.length<2){if(grease.fallOnArrival)await finishGreaseFall(token,{valid});return false;}
        path = grease.path;
        return withGreaseMode(token,grease.mode??answer,async()=>{
        const seen = new Set();
        beginTerrainAction(token,`manual:${data.stamp}:${data.expires}`);
        if (player && answer !== 'step') { await this.playerStealth.clear(token); await token.document.setFlag(MODULE_ID,'sneakNextMove',false); }
        try {
        for (const point of path.slice(1)) {
          const before = position(token.document);
          const unchanged = () => valid() && samePosition(position(token.document), before);
          if (!unchanged() || incapacitationReason(token)) return false;
          if (answer !== 'step' && this.enabled()) {
            const result = await this.reactions.resolveMovement({ mover: token, seen, valid: unchanged, applyDamage: true,
              trigger: 'leaves a threatened square', reactorFilter: reactor => this.reactions.automaticReactiveStrike(reactor) });
            if (result.endTurn) return false;
            if (result.pause || !unchanged()) {
              if (result.pauseReason) ui.notifications.warn(result.pauseReason);
              this.reactions.onPause(); return false;
            }
          }
          if (!unchanged() || token.actor.hasCondition('prone', 'grabbed', 'restrained', 'immobilized')) return false;
          const completed = await token.document.move([point], { [MANAGED_MOVEMENT]: true, showRuler: true,
            constrainOptions: { ignoreWalls: false, ignoreCost: false, maxCost: historyCost + speed } });
          await (token.movementAnimationPromise ?? token.document.movement?.animation?.ended);
          const falling=grease.fallOnArrival&&point===path.at(-1);
          if(falling||token.actor.hasCondition('prone')){
            const landing=await settleGreaseSlip(token,{path:[before,point],fall:Boolean(falling),valid});
            if(landing.settled){
              if(falling)await finishGreaseFall(token,{valid});
              await this.onMoveAction(token,{valid});
              return true;
            }
          }
          if (!completed || !samePosition(position(token.document), point)) return false;
        }
        await this.onMoveAction(token,{valid});
        return true;
        } finally {
          if (player && answer === 'step') await this.playerStealth.afterStep(token);
        }
        });
      }));
    } finally { endTerrainAction(token); this.running = false; }
  }
}
