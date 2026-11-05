import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/ogre-fixture.mjs';
import { environmentBetween, zoneConfig, configureZone, withinFiringRadius, openZones } from '../src/foundry/environment-zones.mjs';
import { environmentBehavior } from '../src/foundry/terrain-contract.mjs';
import { applyEnvironmentCover } from '../src/foundry/environment-rolls.mjs';
import { EnvironmentAwareness } from '../src/foundry/environment-awareness.mjs';

const ns='foundry-creature-ai';
function setup({radius,cover='standard',concealment='none'}={}){
  const f=fixture({footprint:1});canvas.scene.grid={size:100,distance:5};
  const config={enabled:true,cover,coverMode:'intervening',concealment,...(radius===undefined?{}:{firingRadius:radius})};
  const region={id:'cover',name:'Barricade',parent:canvas.scene,hidden:false,levels:new Set(['ground']),elevation:{bottom:0,top:10,topInclusive:false},
    flags:{[ns]:{environment:config}},behaviors:{contents:[environmentBehavior(config)]},
    testPoint:p=>p.x>=400&&p.x<=420&&p.y>=100&&p.y<=400&&p.elevation>=0&&p.elevation<10,
    polygonTree:{testPoint:(p,tolerance)=>Math.hypot(Math.max(400-p.x,0,p.x-420),Math.max(100-p.y,0,p.y-400))<=tolerance},
    segmentizeMovementPath:([a,b])=>Math.min(a.x,b.x)<400&&Math.max(a.x,b.x)>420&&a.y===250&&b.y===250&&a.elevation===2.5&&b.elevation===2.5?
      [{type:0,from:{x:400,y:250,elevation:2.5},to:{x:420,y:250,elevation:2.5}}]:[],
    getFlag:(namespace,key)=>region.flags[namespace]?.[key],setFlag:async(namespace,key,value)=>region.flags[namespace][key]=value};
  region.behaviors.contents[0].update=async changes=>{
    const b=region.behaviors.contents[0];b.disabled=changes.disabled;b.flags[ns].environment=changes[`flags.${ns}.environment`];
  };
  canvas.scene.regions.contents.push(region);
  f.boss.document.x=250;f.player.document.x=800; // Centers 300 and 850; near/far.
  return {...f,region};
}

test('legacy cover zones default to a ten-foot firing radius with asymmetric return fire',()=>{
  const f=setup();assert.equal(zoneConfig(f.region).firingRadius,10);
  const outgoing=environmentBetween(f.boss,f.player),incoming=environmentBetween(f.player,f.boss);
  assert.equal(outgoing.coverBonus,0);assert.equal(outgoing.sources[0].firingBypass,true);
  assert.equal(incoming.coverBonus,2);assert.equal(incoming.canHide,true);
});

test('when both creatures are within the firing radius ordinary crossing cover works in both directions',()=>{
  const f=setup();f.player.document.x=470; // Center 520, within 5 feet of the east edge.
  assert.equal(environmentBetween(f.boss,f.player).coverBonus,2);
  assert.equal(environmentBetween(f.player,f.boss).coverBonus,2);
});

test('two distant creatures retain ordinary cover and uncrossed cover grants no new protection',()=>{
  const f=setup();f.boss.document.x=0;
  assert.equal(environmentBetween(f.boss,f.player).coverBonus,2);
  f.boss.document.x=650;
  assert.equal(environmentBetween(f.boss,f.player).coverBonus,0);
});

test('custom radius and zero-disable use scene distance scaling and include the exact boundary',()=>{
  const f=setup({radius:5}),point={x:300,y:250,elevation:2.5};
  assert.equal(withinFiringRadius(f.region,point,5),true);
  assert.equal(withinFiringRadius(f.region,{...point,x:299.99},5),false);
  assert.equal(environmentBetween(f.boss,f.player).coverBonus,0);
  f.region.behaviors.contents[0].flags[ns].environment.firingRadius=0;
  assert.equal(environmentBetween(f.boss,f.player).coverBonus,2);
  assert.equal(withinFiringRadius(f.region,point,0),false);
});

test('proximity delegates actual shape geometry and honors elevation rather than expanding its bounding box',()=>{
  const f=setup(),calls=[];
  f.region.polygonTree.testPoint=(point,tolerance)=>{calls.push({point,tolerance});return false;};
  assert.equal(withinFiringRadius(f.region,{x:300,y:250,elevation:2.5},10),false);
  assert.ok(Math.abs(calls[0].tolerance-200)<0.00001);
  assert.equal(withinFiringRadius(f.region,{x:300,y:250,elevation:10},10),false);
  assert.equal(calls.length,1,'out-of-height-range proximity never queries the planar shape');
  f.region.elevation={bottom:2.5,top:2.5,topInclusive:false};
  f.region.polygonTree.testPoint=()=>true;
  assert.equal(withinFiringRadius(f.region,{x:300,y:250,elevation:2.5},10),true,'native flat regions include their bottom');
});

test('ignoring one zone never suppresses concealment or a different intervening cover zone',()=>{
  const f=setup({concealment:'through'});
  let result=environmentBetween(f.boss,f.player);
  assert.equal(result.coverBonus,0);assert.equal(result.concealed,true);assert.equal(result.flatCheckDC,5);
  const other={...f.region,id:'distant-cover',behaviors:{contents:[environmentBehavior({enabled:true,cover:'greater',coverMode:'intervening',concealment:'none',firingRadius:10})]},
    testPoint:()=>false,polygonTree:{testPoint:point=>point.x>=650}};
  canvas.scene.regions.contents.push(other);
  result=environmentBetween(f.boss,f.player);assert.equal(result.coverBonus,4);
  assert.equal(result.sources.find(source=>source.id==='cover').firingBypass,true);
});

test('hypothetical AI origins and the local indicators use the same directional firing exemption',async()=>{
  const f=setup();f.boss.document.x=0;
  assert.equal(environmentBetween(f.boss,f.player).coverBonus,2);
  assert.equal(environmentBetween(f.boss,f.player,{origin:{x:300,y:250}}).coverBonus,0);
  f.boss.document.x=250;
  const awareness=new EnvironmentAwareness();await awareness.schedule();assert.equal(awareness.label(f.player),'');
  canvas.tokens.controlled=[f.player];await awareness.schedule();assert.equal(awareness.label(f.boss),'Cover +2');
});

test('native targeted AC rolls use the firing exemption without changing the target actor or unrelated modifiers',()=>{
  const f=setup();game.pf2e.Modifier=class {constructor(data){Object.assign(this,data);}};
  const makeContext=(observer,target)=>({type:'attack-roll',origin:{token:{object:observer}},target:{token:{object:target}},options:new Set(),
    dc:{value:25,statistic:{parent:{clone:({modifiers})=>({dc:{value:25+Math.max(...modifiers.map(m=>m.modifier))}})}}}});
  const outgoing=makeContext(f.boss,f.player),incoming=makeContext(f.player,f.boss);
  applyEnvironmentCover(outgoing);applyEnvironmentCover(incoming);
  assert.equal(outgoing.dc.value,25);assert.equal(incoming.dc.value,27);
  assert.equal(f.calls.some(call=>['create-effects','delete-items'].includes(call[0])),false);
});

test('saving a zone persists a custom firing radius and partial configuration preserves it',async()=>{
  const f=setup();
  await configureZone(f.region,{enabled:true,cover:'standard',coverMode:'intervening',concealment:'none',firingRadius:7.5});
  assert.equal(zoneConfig(f.region).firingRadius,7.5);assert.equal(f.region.flags[ns].environment.firingRadius,7.5);
  await configureZone(f.region,{enabled:true,cover:'greater',coverMode:'intervening',concealment:'none'});
  assert.equal(zoneConfig(f.region).firingRadius,7.5);
  for(const firingRadius of [-1,Infinity,NaN,'10'])await assert.rejects(configureZone(f.region,{enabled:true,firingRadius}),/Firing radius/);
});

test('zone editor loads and saves the radius as a number',async()=>{
  const f=setup({radius:15});globalThis.ui={notifications:{info:()=>{}}};
  globalThis.foundry={applications:{api:{DialogV2:{wait:async dialog=>{
    assert.match(dialog.content,/name="firingRadius"[^>]*value="15"/);
    const form={elements:Object.fromEntries(Object.entries({region:'cover',cover:'standard',coverMode:'intervening',concealment:'none',firingRadius:'12.5'}).map(([key,value])=>[key,{value}]))};
    form.elements.enabled={checked:true};return dialog.buttons.find(button=>button.action==='save').callback({}, {form});
  }}}}};
  await openZones('cover');assert.equal(zoneConfig(f.region).firingRadius,12.5);
});
