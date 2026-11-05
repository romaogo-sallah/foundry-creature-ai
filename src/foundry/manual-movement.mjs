import { MODULE_ID } from './rules-context.mjs';
import { combatStamp } from './reaction-prompts.mjs';
import { MANAGED_MOVEMENT, REQUESTED_MOVEMENT, inheritManagedMovement } from './movement-options.mjs';
import { requestedMovementPath } from './movement-request.mjs';
import { incapacitationReason } from './combat-state.mjs';
import { unsupportedMovementRegions, terrainMovementPath } from './movement-regions.mjs';
import { beginTerrainAction, endTerrainAction } from './hazardous-terrain.mjs';
import { playerSneakSpeed } from './player-stealth.mjs';
import { STEALTH_MOVEMENT } from './stealth-awareness.mjs';
import { greaseOnPath, prepareGreaseMove, withGreaseMode } from './spell-zones.mjs';
import { settleGreaseSlip, finishGreaseFall } from './grease-landing.mjs';
import { surfaceMovementPath } from './surface-terrain.mjs';
import { selectedGroundAction } from './native-movement-modes.mjs';
import {withConditionActivity} from './condition-activity.mjs';

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
  cancel() { this.generation++; }
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
  path(token, points) {
    if (canvas.grid.type !== 1 || canvas.grid.distance !== 5 || points.length > 512 || points.length < 2) throw new Error('Manual reaction movement needs a 5-foot square grid and a bounded path.');
    const document=token.document,origin = position(document);
    points=requestedMovementPath(document,points).slice(1);
    const surface=surfaceMovementPath(document,points);
    if(points.some(point=>!Number.isFinite(point.x)||!Number.isFinite(point.y)||
      !surface&&point.elevation!==origin.elevation||point.level!==origin.level||
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
    const complete=surface??document.getCompleteMovementPath?.(points)??canvas.grid.getDirectPath(points.map(({x,y})=>({x,y})))
      .map(offset=>({...origin,...canvas.grid.getTopLeftPoint(offset)}));
    const path=complete.filter((point,index)=>index===0||!samePosition(point,complete[index-1]));
    if (path.length > 256) throw new Error('Split this movement into individual move actions.');
    return path.map(point=>({...origin,...point,action:'walk',snapped:surface?Boolean(point.snapped):true}));
  }
  intercept(document, movement, options = {}) {
    if (inheritManagedMovement(document,movement,options) || options.isUndo || options.isPaste || options.teleport ||
      !['dragging', 'keyboard', 'api'].includes(movement.method) || !canvas.ready) return;
    const token = document.object ?? canvas.tokens.get(document.id);
    const points = options[REQUESTED_MOVEMENT] ?? [movement.origin, ...movement.passed.waypoints, ...movement.pending.waypoints];
    let mode;try{mode=selectedGroundAction(document,points);}catch(error){this.onError(error);return false;}
    const explicitMode=['step','sneak'].includes(mode);
    const player = this.playerStealth?.movementEnabled(token)||mode==='sneak'&&this.playerStealth?.supports(token);
    const greasy = token?.actor && greaseOnPath(token,points);
    if (!this.enabled() && !player && !greasy&&!explicitMode || !game.combat?.started && !player && !greasy&&!explicitMode) return;
    if (!token?.actor || game.combat?.started && (game.combat.combatant?.tokenId !== token.id || game.combat.combatant?.sceneId &&
      game.combat.combatant.sceneId !== document.parent.id)) return;
    if (points.slice(1).every(point => point.x === points[0].x && point.y === points[0].y) ||
      points.slice(1).every(point => point.action === 'displace')) return;
    // Other movement modes keep their native/manual workflow. They must not be
    // recast as walking just because an automated ogre exists in the encounter.
    if (!['stride','step','sneak'].includes(mode)) return;
    // Avoid touching ordinary movement in encounters without automated reactors.
    if (!player && !greasy&&!explicitMode && !canvas.tokens.placeables.some(reactor => reactor !== token && this.reactions.automaticReactiveStrike(reactor) &&
      this.reactions.available(reactor) && reactor.actor.isEnemyOf(token.actor))) return;
    if (this.pending.has(document.id) || this.running) {
      ui.notifications.warn('Finish the pending movement/reaction decision first.'); return false;
    }
    let path;
    try {
      path = this.path(token, points);
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
    if(!['stride','step','sneak'].includes(mode))throw new Error('Unsupported ground movement mode');
    const explicitMode=['step','sneak'].includes(mode);
    const player = this.playerStealth?.movementEnabled(token)||mode==='sneak'&&this.playerStealth?.supports(token);
    const greasy = token?.actor && greaseOnPath(token,data.path);
    if (!this.enabled() && !player && !greasy&&!explicitMode) throw new Error('Manual movement automation is disabled');
    if (!token?.actor || !sender.isGM && !token.actor.testUserPermission(sender, 'OWNER')) throw new Error('You do not own this combatant.');
    if (!Number.isFinite(data.expires) || data.expires > Date.now() + 180000) throw new Error('Invalid movement expiry.');
    if (this.running) throw new Error('Another movement decision is still resolving.');
    const generation = this.generation;
    const valid = () => generation === this.generation && combatStamp() === data.stamp && Date.now() < data.expires &&
      game.users.activeGM?.id === game.user.id && canvas.scene?.id === data.sceneId && !game.paused &&
      canvas.tokens.get(token.id) === token && (!game.combat?.started ? player || greasy||explicitMode : game.combat.combatant?.tokenId === token.id) &&
      (sender.isGM || token.actor.testUserPermission(sender, 'OWNER'));
    if (!valid() || !samePosition(position(token.document), data.origin)) throw new Error('The movement trigger changed; move again from the current position.');
    let path = this.path(token, data.path);
    if (!samePosition(path[0], data.origin)) throw new Error('Movement origin does not match the token.');
    this.running = true;
    try {
      return await this.reactions.resolve(()=>withConditionActivity(token.actor,async () => {
        const stillAtOrigin = () => valid() && samePosition(position(token.document), data.origin);
        if (!player && !greasy&&!explicitMode&&!this.hasThreat(token, path)) return false; // Never replay a stale reaction request.
        if (incapacitationReason(token) || token.actor.hasCondition('prone', 'grabbed', 'restrained', 'immobilized')) throw new Error('Resolve the movement-blocking condition before moving.');
        const speed = token.actor.system.movement?.speeds.land?.value ?? token.actor.system.attributes.speed?.total ?? token.actor.system.attributes.speed?.value;
        const history = [...(token.document.movementHistory ?? [])];
        const historyCost = history.length ? token.measureMovementPath(history).cost : 0;
        const terrainPath = terrainMovementPath(token, path);
        const cost = token.measureMovementPath([...history, ...terrainPath]).cost - historyCost;
        if (!Number.isFinite(speed) || !Number.isFinite(cost) || cost <= 0 || cost > speed + 1e-8) throw new Error('This path exceeds one Stride. Split it into individual move actions.');
        const freshCost = withGreaseMode(token,'step',()=>token.measureMovementPath(terrainMovementPath(token,path)).cost);
        const uncertainTerrain = unsupportedMovementRegions(canvas.scene).length > 0;
        const stepLegal = path.length === 2 && speed >= 10 && freshCost <= 5 && !uncertainTerrain;
        const sneakLimit = player ? playerSneakSpeed(token.actor) : 0;
        const sneakLegal = player && cost <= sneakLimit + 1e-8 && !uncertainTerrain;
        const automaticSneak = player && this.playerStealth.armed(token);
        if (automaticSneak && !sneakLegal) throw new Error(`This Sneak path exceeds its ${sneakLimit}-foot movement budget or uses unsupported terrain. Shorten the path; no movement occurred.`);
        const answer=mode==='stride'&&automaticSneak&&token.document._source?.movementAction!=='walk'?'sneak':mode;
        if(answer==='step'&&!stepLegal)throw new Error('Step allows one legal 5-foot square and requires Speed 10 feet or more. Check difficult terrain or select Walk.');
        if(answer==='sneak'&&!sneakLegal)throw new Error(`Sneak allows ${sneakLimit} feet on this path. Shorten the path or select Walk.`);
        if (!stillAtOrigin() || !['stride', ...(stepLegal ? ['step'] : []), ...(sneakLegal ? ['sneak'] : [])].includes(answer)) {
          this.reactions.onPause(); return false;
        }
        const grease = await prepareGreaseMove(token,path,{kind:answer,valid:stillAtOrigin,speed:answer==='sneak'?sneakLimit:speed,
          baseCost:points=>Math.max(0,token.measureMovementPath([...history,...terrainMovementPath(token,points)]).cost-historyCost)});
        if (grease.note) ui.notifications.info(grease.note);
        if (grease.blocked) return false;
        if(grease.path.length<2){if(grease.fallOnArrival)await finishGreaseFall(token,{valid});return false;}
        path = grease.path;
        return withGreaseMode(token,grease.mode??answer,async()=>{
        const seen = new Set();
        beginTerrainAction(token,`manual:${data.stamp}:${data.expires}`);
        let sneak;
        const traveled=[path[0]];
        if (answer === 'sneak') {
          // A Sneak chosen in the movement prompt starts the same visible mode
          // as the sheet action. Its removal can cancel a pending movement.
          if(!automaticSneak)await this.playerStealth.enableSneak(token);
          if(!stillAtOrigin()||!this.playerStealth.armed(token))return false;
          sneak = await this.playerStealth.prepareSneak(token,path,()=>stillAtOrigin()&&this.playerStealth.armed(token));
        }
        else if (player && answer !== 'step') { await this.playerStealth.clear(token); await token.document.setFlag(MODULE_ID,'sneakNextMove',false); }
        try {
        for (const point of path.slice(1)) {
          const before = position(token.document);
          const unchanged = () => valid() && samePosition(position(token.document), before) && (!sneak || this.playerStealth.armed(token));
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
          const completed = await token.document.move([point], { [MANAGED_MOVEMENT]: true, ...(sneak ? {[STEALTH_MOVEMENT]:true}:{}), showRuler: !sneak,
            constrainOptions: { ignoreWalls: false, ignoreCost: false, maxCost: historyCost + (sneak ? sneakLimit : speed) } });
          await (token.movementAnimationPromise ?? token.document.movement?.animation?.ended);
          const falling=grease.fallOnArrival&&point===path.at(-1);
          if(falling||token.actor.hasCondition('prone')){
            const landing=await settleGreaseSlip(token,{path:[before,point],fall:Boolean(falling),valid});
            if(landing.settled){
              if(falling)await finishGreaseFall(token,{valid});
              traveled.push(position(token.document));
              await this.onMoveAction(token,{valid});
              return true;
            }
          }
          traveled.push(position(token.document));
          if (!completed || !samePosition(position(token.document), point)) return false;
        }
        await this.onMoveAction(token,{valid});
        return true;
        } finally {
          if (sneak) await this.playerStealth.finishSneak(token,sneak,traveled);
          else if (player && answer === 'step') await this.playerStealth.afterStep(token);
        }
        });
      }));
    } finally { endTerrainAction(token); this.running = false; }
  }
}
