import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PACKAGE_IDS,ENTRIES,DEPENDENCIES,packageGraph,packagedSource,sourceReferences,packageManifest} from '../tools/package-graph.mjs';
import {fixture} from './helpers/ogre-fixture.mjs';

test('each source has one owner; manual closures exclude AI; generated imports resolve to declared packages',async()=>{
 const graph=await packageGraph();assert.equal(graph.owners.size,graph.sources.size);
 for(const [file,source]of graph.sources){
  const owner=graph.owners.get(file),built=packagedSource(file,source,graph.owners);
  for(const ref of sourceReferences(built,owner+'/'+file)){
   const [targetOwner,...targetFile]=ref.file.split('/');assert.ok(PACKAGE_IDS.includes(targetOwner));
   assert.equal(graph.owners.get(targetFile.join('/')),targetOwner);
   assert.ok(targetOwner===owner||DEPENDENCIES[owner].includes(targetOwner));
  }
 }
 for(const id of PACKAGE_IDS){const manifest=packageManifest(id,'0.41.1');assert.deepEqual(manifest.esmodules,[ENTRIES[id]]);
  if(id==='pf2e-tactical-movement')assert.deepEqual(manifest.documentTypes,{RegionBehavior:{ramp:{}}});
  if(id!=='foundry-creature-ai')assert.equal(manifest.relationships.requires.some(d=>d.id==='foundry-creature-ai'),false);
 }
});

test('built manual packages start without AI; AI consumes the same services without duplicate rule wrappers',async()=>{
 const f=fixture(),once=new Map(),events=new Map(),wrappers=new Map(),registry=new Map(),storage=new Map([['client',new Map()],['world',new Map()]]);
 const add=(map,name,fn)=>map.set(name,[...map.get(name)??[],fn]);
 globalThis.Hooks={once:(name,fn)=>add(once,name,fn),on:(name,fn)=>add(events,name,fn),off:()=>{}};
 const run=async name=>{const callbacks=once.get(name)??[];once.delete(name);await Promise.all(callbacks.map(fn=>fn()));};
 game.modules=new Map(PACKAGE_IDS.filter(id=>id!=='foundry-creature-ai').map(id=>[id,{active:true,version:'0.41.1'}]));
 game.settings={settings:registry,storage:new Map([...storage].map(([scope,data])=>[scope,scope==='world'?{getSetting:(key,fallback)=>data.get(key)??fallback}:{getItem:key=>data.get(key)??null}])),
  register:(namespace,key,data)=>registry.set(`${namespace}.${key}`,data),
  get:(namespace,key)=>{const id=`${namespace}.${key}`,meta=registry.get(id);if(!meta)return undefined;const raw=storage.get(meta.scope??'client').get(id);return raw===undefined?meta.default:JSON.parse(raw);},
  set:async(namespace,key,value)=>{const id=`${namespace}.${key}`,meta=registry.get(id);storage.get(meta.scope??'client').set(id,JSON.stringify(value));return value;}};
 storage.get('world').set('foundry-creature-ai.playerStealth','false');
 game.user.active=true;game.users.activeGM=game.user;game.keybindings={register:()=>{}};
 game.actors=new Map([[f.actor.id,f.actor],[f.player.actor.id,f.player.actor]]);
 globalThis.ui={notifications:{info:()=>{},warn:()=>{},error:message=>assert.fail(message)}};
 const scopes=['core','world','pf2e',...game.modules.keys()];
 globalThis.CONFIG={DatabaseBackend:{getFlagScopes:()=>scopes},queries:{},Token:{movement:{actions:{walk:{label:'Walk'}}}},RegionBehavior:{dataModels:{modifyMovementCost:class{}}}};
 for(const document of [f.actor,f.player.actor,f.boss.document,f.player.document]){
  const get=document.getFlag;document.getFlag=(namespace,key)=>{assert.ok(scopes.includes(namespace),`native flag scope is available: ${namespace}`);return get(namespace,key);};
 }
 globalThis.libWrapper={register:(id,target,fn)=>{assert.ok(game.modules.get(id)?.active,`wrapper owner ${id} is active`);
  const caller=new Error().stack.match(/dist[\\/](pf2e-tactical-[^\\/]+|foundry-creature-ai)[\\/]/)?.[1];
  assert.equal(id,caller,'libWrapper requires the owner of the first package frame');
  assert.equal(wrappers.has(target),false,target);wrappers.set(target,{id,fn});}};
 for(const id of PACKAGE_IDS.filter(id=>id!=='foundry-creature-ai'))await import(new URL('../dist/'+id+'/'+ENTRIES[id],import.meta.url));
 // Native Foundry replaces the global bootstrap object before init/ready.
 globalThis.game={...game};
 await run('init');await run('ready');
 const core=game.modules.get('pf2e-tactical-core').api;
 assert.ok(scopes.includes('foundry-creature-ai'),'Core owns the preserved data namespace with AI absent');
 assert.equal(core.apiVersion,1);assert.equal(core.rules.stealth.player.enabled(),false);
 assert.equal(storage.get('world').get('pf2e-tactical-movement.playerStealth'),'false');
 await game.settings.set('pf2e-tactical-movement','playerStealth',true);assert.equal(core.rules.stealth.player.enabled(),true);
 assert.equal(typeof core.rules.conditions.open,'function');assert.equal(typeof CONFIG.Token.movement.actions.step.canSelect,'function');
 assert.equal(typeof core.rules.ramps.configure,'function');assert.equal(typeof game.modules.get('pf2e-tactical-movement').api.ramps.open,'function');
 assert.equal(core.rules.conditions.owners().managedFlatChecks,'pf2e-tactical-core');
 assert.equal(game.modules.get('pf2e-tactical-environment').api.stealth.hide,undefined,'Environment does not expose Movement-only controls');
 assert.equal(wrappers.get('CONFIG.Token.objectClass.prototype._getMovementCostFunction').id,'pf2e-tactical-core');
 assert.equal(wrappers.get('game.pf2e.Check.roll').id,'pf2e-tactical-core');
 const buttons={tokens:{tools:{}}};for(const hook of events.get('getSceneControlButtons')??[])hook(buttons);
 assert.ok(buttons.tokens.tools.conditionActions&&buttons.tokens.tools.environmentZones&&buttons.tokens.tools.playerStealth&&buttons.tokens.tools.rampControls);
 assert.equal(buttons.tokens.tools.wolfAI,undefined);assert.equal(game.modules.has('foundry-creature-ai'),false);
 let pathRefreshes=0;const recalculate=canvas.tokens.recalculatePlannedMovementPaths;
 canvas.tokens.recalculatePlannedMovementPaths=()=>pathRefreshes++;
 for(const [event,arg]of [['controlToken',f.boss],['targetToken',game.user],['drawToken',f.boss]])for(const hook of events.get(event)??[])hook(arg);
 await Promise.resolve();assert.equal(pathRefreshes,0,'selection/redraw must not restart pathfinding');
 canvas.tokens.recalculatePlannedMovementPaths=recalculate;
 assert.ok(events.get('updateRegionBehavior')?.length,'edited Region behaviors refresh rules');
 f.boss.document.object=f.boss;f.boss.document.movementAction='sneak';
 for(const hook of events.get('updateToken')??[])hook(f.boss.document,{movementAction:'sneak'});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(core.rules.stealth.player.armed(f.boss),true,'choosing native Sneak arms an NPC too');
 let metadata;for(const hook of events.get('preCreateChatMessage')??[])hook({flags:{pf2e:{context:{options:['foundry-creature-ai:managed','foundry-creature-ai:reaction','foundry-creature-ai:reaction-auto-damage']}}},updateSource:change=>metadata=change});
 assert.equal(metadata['flags.xdy-pf2e-workbench.noAutoDamageRoll'],true,'manual reactions prevent duplicate Workbench damage with AI absent');
 assert.equal(metadata['flags.pf2e.suppressDamageButtons'],true);
 const before=wrappers.size;game.modules.set('foundry-creature-ai',{active:true});
 const profiles=JSON.parse(await readFile(new URL('../profiles/creatures.json',import.meta.url),'utf8'));
 globalThis.fetch=async()=>({ok:true,json:async()=>profiles});
 await import(new URL('../dist/foundry-creature-ai/'+ENTRIES['foundry-creature-ai'],import.meta.url));await run('init');await run('ready');
 assert.equal(wrappers.size,before);assert.equal(game.modules.get('foundry-creature-ai').api.reactions,core.rules.reactions);
 assert.equal(f.calls.some(c=>['attack','move'].includes(c[0])),false);assert.equal(game.actors.size,2);
});
