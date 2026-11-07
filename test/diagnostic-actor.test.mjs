import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnosticActor} from '../tools/diagnostic-actor.mjs';
test('diagnostic actors use only in-memory construction and preserve world actors and source data',()=>{
 const original={_id:'original',name:'Dero',items:[{_id:'effect'}]},actors=new Map([['original',{id:'original'}]]);
 class NativeActor{
  constructor(source,options){this.id=source._id;this.source=source;this.options=options;}
  static create(){throw new Error('The persistent factory must never be called');}
 }
 const actor=createDiagnosticActor(original,{ActorClass:NativeActor,actors,randomID:()=> 'detached'});
 assert.equal(actor.id,'detached');assert.equal(actor.options.strict,true);
 assert.equal(original._id,'original');assert.deepEqual([...actors.keys()],['original']);
 actor.source.items[0]._id='changed';assert.equal(original.items[0]._id,'effect');
});
test('diagnostic actors reject writes, including flags, embedded items and damage',()=>{
 class NativeActor{constructor(source){this.id=source._id;}}
 const actor=createDiagnosticActor({},{ActorClass:NativeActor,actors:new Map(),randomID:()=> 'detached'});
 for(const method of ['update','delete','setFlag','unsetFlag','createEmbeddedDocuments','updateEmbeddedDocuments','deleteEmbeddedDocuments','applyDamage','toggleStatusEffect'])
  assert.throws(()=>actor[method]({}),/cannot persist/);
});
test('diagnostic construction detects an unexpected insertion into the world collection',()=>{
 const actors=new Map();class UnsafeActor{constructor(source){this.id=source._id;actors.set(this.id,this);}}
 assert.throws(()=>createDiagnosticActor({},{ActorClass:UnsafeActor,actors,randomID:()=> 'bad'}),/changed the world actor collection/);
});
