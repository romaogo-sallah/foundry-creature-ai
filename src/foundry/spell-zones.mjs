import { spellDefenseCheck, bestGreaseDefense } from './spell-checks.mjs';
import { inSpellArea } from './spell-areas.mjs';
import { environmentBetween } from './environment-zones.mjs';

const ns = 'foundry-creature-ai';
export const GREASE_SCRIPT = "await game.modules.get('foundry-creature-ai')?.api?.spells?.refresh?.();";
const owned = region => region.flags?.[ns]?.spellZone?.slug === 'grease';
const movementModes=new Map();
const movementKey=token=>(token?.document??token)?.uuid;
let terrainInstalled=false;
export function withGreaseMode(token,mode,operation){
  const key=movementKey(token);
  if(!key)return operation();
  const previous=movementModes.get(key);
  movementModes.set(key,mode);
  const restore=()=>{if(previous===undefined)movementModes.delete(key);else movementModes.set(key,previous);};
  try{const value=operation();if(value?.then)return value.finally(restore);restore();return value;}catch(error){restore();throw error;}
}
export function installGreaseTerrain(){
  if(terrainInstalled||!globalThis.CONFIG?.RegionBehavior?.dataModels?.modifyMovementCost)return;
  libWrapper.register(ns,'CONFIG.RegionBehavior.dataModels.modifyMovementCost.prototype._getTerrainEffects',function(wrapped,token,...args){
    const effects=wrapped(token,...args);
    // Foundry's terrain pipeline passes a TokenDocument, while our movement
    // callers usually have a Token placeable. Unrelated terrain needs no token
    // lookup at all; detached previews keep their native behavior unchanged.
    if(!this.behavior.flags?.[ns]?.greaseMovement)return effects;
    const key=movementKey(token),mode=key?movementModes.get(key):undefined;
    if(['step','crawl','criticalSuccess'].includes(mode))return [];
    return effects;
  },'WRAPPER');
  terrainInstalled=true;
}
export const greaseZones = (scene = canvas.scene) => (scene?.regions?.contents ?? []).filter(region => owned(region));
export const inGrease = (token, position) => greaseZones(token.document.parent).filter(region => inSpellArea(token,region,position));
export function greaseOnPath(token,path) {
  return path.some(point => inGrease(token,point).length);
}

export async function createGreaseZone(adapter,spell,area,affected,{valid}) {
  const now = game.time.worldTime;
  const data = { name: `Grease — ${adapter.token.name}`, color: '#a18b25', shapes: area.shapes,
    elevation: { bottom: adapter.token.document.elevation, top: adapter.token.document.elevation + 0.1 },
    levels: adapter.token.document.level ? [adapter.token.document.level] : [],
    visibility: CONST.REGION_VISIBILITY?.ALWAYS ?? 0,
    flags: { 'pf2e-toolbelt': { targetHelper: { skip: true } }, [ns]: { spellZone: { slug: 'grease', casterId: adapter.token.id, casterUuid: adapter.actor.uuid,
      spellId: spell.id, dc: adapter.parts().entry.statistic.dc.value, expiresAt: now + 60,
      combatId: game.combat?.id, casterCombatantId: game.combat?.combatant?.id, expiryRound: (game.combat?.round ?? 0) + 10 } } },
    behaviors: [{name:'Grease: slippery ground',type:'modifyMovementCost',system:{difficulties:{walk:2}},flags:{[ns]:{greaseMovement:true}}},
      { name: 'Grease: ground movement and balance', type: 'executeScript', system: {
      events: ['tokenEnter','tokenExit'], source: GREASE_SCRIPT }, flags: { [ns]: { spellTerrain: 'grease' } } }] };
  await adapter.token.document.parent.createEmbeddedDocuments('Region',[data],{renderSheet:false});
  for (const token of affected) {
    if (!valid()) throw new Error('Casting stopped during Grease checks');
    if (token.actor.hasCondition('prone') || ['fly','swim','burrow'].includes(token.document.movementAction)) continue;
    const statistic=bestGreaseDefense(token.actor),cover=statistic==='reflex'?environmentBetween(adapter.token,token).coverBonus:0;
    const degree = await spellDefenseCheck(token,{ dc: data.flags[ns].spellZone.dc, statistic,
      cover:cover>=2?cover:0,origin: adapter.token, spell, label: 'Grease: initial defense' });
    if (!valid()) throw new Error('Casting stopped before Grease was applied');
    if (degree < 2 && !token.actor.hasCondition('prone')) await token.actor.increaseCondition('prone');
  }
  await refreshSpellZones();
}

export function greaseExtraCost(token,path,kind = 'stride') {
  if (['step','crawl'].includes(kind)) return 0;
  // Real Foundry tokens obtain the non-stacking difficulty from the native
  // Region behavior. The fallback supports geometry-only adapters/fixtures.
  if(typeof token.createTerrainMovementPath==='function')return 0;
  let extra = 0;
  for (const point of path.slice(1)) if (inGrease(token,point).length) extra += 5;
  return extra;
}

// Resolve the Balance requirement for one complete move action, never for
// every square of the GM's per-square reaction replay. A failed check spends
// this action; critical failure also ends the creature's turn.
export async function prepareGreaseMove(token,path,{kind = 'stride',valid = () => true,baseCost,speed} = {}) {
  if (['step','crawl'].includes(kind) || !greaseOnPath(token,path)) return { path };
  const zones = [...new Set(path.flatMap(point => inGrease(token,point)))];
  const dc = Math.max(...zones.map(region => region.flags[ns].spellZone.dc));
  const degree = await spellDefenseCheck(token,{dc,statistic:bestGreaseDefense(token.actor),label:'Grease: Balance'});
  if (!valid()) throw new Error('Movement stopped during the Grease Balance check');
  if(degree===0){
    const first=path.findIndex(point=>inGrease(token,point).length);
    return {path:path.slice(0,first+1),fallOnArrival:true,forfeitActions:true,
      note:'Critical Balance failure: the creature falls prone on the Grease entry square and its turn ends.'};
  }
  if (degree < 2) {
    return { blocked: true, forfeitActions: false, pause: true,
      note: 'Balance failed: remain stationary; the movement action is spent.' };
  }
  let count = 1;
  for (let end = 2; end <= path.length; end++) {
    const prefix = path.slice(0,end),cost=withGreaseMode(token,degree===3?'criticalSuccess':kind,
      ()=>baseCost(prefix)+(degree===3?0:greaseExtraCost(token,prefix,kind)));
    if (cost > speed + 1e-8) break;
    count = end;
  }
  return { path: path.slice(0,count), mode:degree===3?'criticalSuccess':kind,
    note: count < path.length ? 'Balance: movement shortened to the available Speed budget.' : null };
}

let refreshing = Promise.resolve();
export function refreshSpellZones() {
  const task = refreshing.catch(()=>{}).then(async () => {
    if (!canvas.ready || !game.user?.isGM || game.users.activeGM?.id !== game.user.id) return;
    for (const token of canvas.tokens.placeables) {
      if (!token.actor?.isOfType?.('creature')) continue;
      const active = token.actor.hitPoints?.value>0&&!['fly','swim','burrow'].includes(token.document.movementAction) && inGrease(token).length > 0;
      const effects = (token.actor.itemTypes.effect ?? []).filter(effect => effect.flags?.[ns]?.greaseOffGuard);
      if (!active && effects.length) await token.actor.deleteEmbeddedDocuments('Item',effects.map(effect=>effect.id));
      if (active && !effects.length) await token.actor.createEmbeddedDocuments('Item',[{name:'Grease — off-guard',type:'effect',
        img:'icons/environment/traps/trap-jaw-steel.webp',system:{slug:'creature-ai-grease-off-guard',duration:{unit:'unlimited',value:-1,expiry:null,sustained:false},
          level:{value:1},tokenIcon:{show:true},traits:{value:[]},rules:[{key:'GrantItem',uuid:'Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg',inMemoryOnly:true}]},
        flags:{[ns]:{greaseOffGuard:true}}}]);
    }
  });
  refreshing = task; return task;
}

export async function expireSpellZones({ combat = game.combat, removeAll = false, tokenIds = [] } = {}) {
  if (!game.user?.isGM || game.users.activeGM?.id !== game.user.id) return;
  for (const scene of game.scenes?.contents ?? [canvas.scene]) {
    const expired = greaseZones(scene).filter(region => {
      const zone = region.flags[ns].spellZone;
      const inCombat=combat?.started&&combat.id===zone.combatId;
      const casterTurn=Array.from(combat?.turns??combat?.combatants??[]).findIndex(entry=>entry.id===zone.casterCombatantId);
      const roundExpired=inCombat&&(combat.round>zone.expiryRound||combat.round===zone.expiryRound&&(casterTurn<0||combat.turn>=casterTurn));
      return tokenIds.includes(zone.casterId) && scene.id === canvas.scene.id ||
        removeAll && zone.combatId === combat?.id || !inCombat&&game.time.worldTime >= zone.expiresAt || roundExpired;
    });
    if (expired.length) await scene.deleteEmbeddedDocuments('Region',expired.map(region=>region.id));
    for(const token of scene.tokens?.contents??[]){
      const effects=(token.actor?.itemTypes.effect??[]).filter(effect=>{
        const flags=effect.flags?.[ns];
        return flags?.spellEffect==='tangle-vine'&&(tokenIds.includes(flags.casterId)&&scene.id===canvas.scene.id||removeAll&&flags.combatId===combat?.id);
      });
      if(effects.length)await token.actor.deleteEmbeddedDocuments('Item',effects.map(effect=>effect.id));
    }
  }
  await refreshSpellZones();
}

export async function applyTangleVine(adapter,target,spell,degree) {
  const source = await fromUuid('Compendium.pf2e.spell-effects.Item.TwtUIEyenrtAbeiX');
  if (!source) throw new Error('The native Tangle Vine effect is unavailable');
  const existing = (target.actor.itemTypes.effect ?? []).filter(effect => effect.flags?.[ns]?.spellEffect === 'tangle-vine');
  if (existing.length) await target.actor.deleteEmbeddedDocuments('Item',existing.map(effect=>effect.id));
  const effect = source.toObject(); delete effect._id;
  for (const rule of effect.system.rules) if (rule.key === 'ChoiceSet') {
    const selected=Array.isArray(rule.choices)?rule.choices.find(choice=>degree===3?/critical/i.test(choice.value):choice.value==='success'):null;
    rule.selection=selected?.value??(degree===3?'critical-success':'success');
  }
  effect.system.context = { origin: { actor: adapter.actor.uuid, token: adapter.token.document.uuid, item: spell.uuid } };
  effect.flags = { ...effect.flags, [ns]: { spellEffect: 'tangle-vine', casterId:adapter.token.id,combatId:game.combat?.id,
    escapeDC: adapter.parts().entry.statistic.dc.value } };
  await target.actor.createEmbeddedDocuments('Item',[effect]);
}
