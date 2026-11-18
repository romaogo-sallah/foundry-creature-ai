import test from 'node:test';
import assert from 'node:assert/strict';
import { beginRayCache, endRayCache, withRayCache, clearSightPath, footprintVisibility } from '../src/foundry/attack-path.mjs';

const hooks=new Map();let hookId=0;
globalThis.Hooks={on:(name,fn)=>{hooks.set(name,[...hooks.get(name)??[],{id:++hookId,fn}]);return hookId;},
  off:(name,fn)=>hooks.set(name,(hooks.get(name)??[]).filter(hook=>hook.fn!==fn))};
const fire=name=>{for(const hook of hooks.get(name)??[])hook.fn();};

function fixture(blocked=()=>false) {
  const rays=[];
  const scene={id:'scene',grid:{distance:5},testSurfaceCollision:()=>false};
  const token=x=>{
    const document={x,y:0,elevation:0,depth:1,level:'ground',parent:scene};
    document.getVisionOrigin=()=>({x:x+50,y:50,elevation:2.5});
    document.getMovementOrigin=()=>({x:x+50,y:50,elevation:2.5});
    return {document,center:{x:x+50,y:50},checkCollision:(destination,options)=>{rays.push({destination,...options});return blocked(destination,options);}};
  };
  return {rays,attacker:token(0),target:token(300)};
}

test('a plan reuses corner rays it has already traced',async()=>{
  const f=fixture();
  const first=await withRayCache(async()=>{
    const a=footprintVisibility(f.attacker,f.target,{type:'sight'});
    const traced=f.rays.length;
    const b=footprintVisibility(f.attacker,f.target,{type:'sight'});
    assert.equal(clearSightPath(f.attacker,f.target),true);
    assert.equal(f.rays.length,traced);
    assert.deepEqual(a,b);
    return a;
  });
  assert.equal(first.visible,true);
});

test('outside a plan every call traces its rays',()=>{
  const f=fixture();
  footprintVisibility(f.attacker,f.target,{type:'sight'});
  const traced=f.rays.length;
  footprintVisibility(f.attacker,f.target,{type:'sight'});
  assert.equal(f.rays.length,traced*2);
});

test('sight and attack rays are cached separately',async()=>{
  const f=fixture((destination,options)=>options.type==='move');
  await withRayCache(async()=>{
    assert.equal(footprintVisibility(f.attacker,f.target,{type:'sight'}).visible,true);
    assert.equal(footprintVisibility(f.attacker,f.target,{type:'move'}).visible,false);
  });
});

test('a world change during a plan clears the cached rays',async()=>{
  let wall=false;
  const f=fixture(()=>wall);
  beginRayCache();
  try{
    assert.equal(clearSightPath(f.attacker,f.target),true);
    wall=true;
    assert.equal(clearSightPath(f.attacker,f.target),true,'cached until something changes');
    fire('createWall');
    assert.equal(clearSightPath(f.attacker,f.target),false);
  }finally{endRayCache();}
});

test('the cache ends with the outermost plan',async()=>{
  let wall=false;
  const f=fixture(()=>wall);
  beginRayCache();beginRayCache();
  clearSightPath(f.attacker,f.target);
  endRayCache();
  wall=true;
  assert.equal(clearSightPath(f.attacker,f.target),true,'the outer plan still holds the cache');
  endRayCache();
  assert.equal(clearSightPath(f.attacker,f.target),false);
});

test('no listeners remain once the plan ends',async()=>{
  await withRayCache(async()=>{assert.ok((hooks.get('createWall')??[]).length>0);});
  assert.equal([...hooks.values()].flat().length,0);
});
