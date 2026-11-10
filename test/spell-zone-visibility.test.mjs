import test from 'node:test';
import assert from 'node:assert/strict';
import {spellZoneVisibility,refreshSpellZoneVisibility} from '../src/foundry/spell-zone-visibility.mjs';
const ns='foundry-creature-ai';
function setup(){
 globalThis.CONST={REGION_VISIBILITY:{LAYER:0,GAMEMASTER:1,ALWAYS:2,OBSERVER:3,LAYER_UNLOCKED:4}};
 globalThis.game={users:{activeGM:{id:'gm'}},user:{id:'gm'}};
 const updates=[],scene={regions:{contents:[]},updateEmbeddedDocuments:async(type,rows)=>{assert.equal(type,'Region');updates.push(...rows);for(const row of rows)Object.assign(scene.regions.contents.find(r=>r.id===row._id),row);}};
 return {scene,updates};
}
test('all supported persistent spell zones upgrade to visibility across canvas layers once',async()=>{
 const {scene,updates}=setup();
 scene.regions.contents=['spellZone','lingeringFire','obscuring','weather','iceWall'].map((key,i)=>({id:String(i),visibility:i%2?4:0,flags:{[ns]:{[key]:{}}}}));
 await refreshSpellZoneVisibility(scene);assert.equal(updates.length,5);assert.ok(updates.every(r=>r.visibility===2));
 await refreshSpellZoneVisibility(scene);assert.equal(updates.length,5,'already-visible zones cause no further writes');
});
test('spell visibility migration preserves GM/observer restrictions, hidden zones and ordinary terrain',async()=>{
 const {scene,updates}=setup();scene.regions.contents=[{id:'gm',visibility:1},{id:'observer',visibility:3},{id:'hidden',visibility:0,hidden:true}].map(r=>({...r,flags:{[ns]:{obscuring:{}}}}));
 scene.regions.contents.push({id:'terrain',visibility:0,flags:{[ns]:{environment:{}}}});
 await refreshSpellZoneVisibility(scene);assert.equal(updates.length,0);
 game.user.id='player';scene.regions.contents.push({id:'spell',visibility:0,flags:{[ns]:{weather:{}}}});
 await refreshSpellZoneVisibility(scene);assert.equal(updates.length,0,'only the active GM updates shared documents');
});
test('visibility fallback matches native ALWAYS rather than native LAYER',()=>{
 setup();delete CONST.REGION_VISIBILITY;assert.equal(spellZoneVisibility(),2);
});
