import test from 'node:test';
import assert from 'node:assert/strict';
import {captureAppliedDamage} from '../src/foundry/resolved-damage.mjs';
function setup(){const callbacks=new Set();globalThis.Hooks={on:(_event,fn)=>callbacks.add(fn),off:(_event,fn)=>callbacks.delete(fn)};
 const actor={uuid:'Actor.target'},emit=(updated,damageTaken)=>{for(const fn of callbacks)fn(updated,{}, {damageTaken});};return {actor,emit,callbacks};}
test('resolved damage capture isolates the first native target result and releases its listener',async()=>{
 const f=setup(),result=await captureAppliedDamage(f.actor,async()=>{f.emit({uuid:'Actor.other'},100);f.emit(f.actor,12);f.emit(f.actor,99);});
 assert.equal(result.damageTaken,12);assert.equal(f.callbacks.size,0);
});
test('immune/no-update damage resolves to zero and failed damage never leaves a listener',async()=>{
 const f=setup();assert.deepEqual(await captureAppliedDamage(f.actor,async()=>{}),{damageTaken:0});
 await assert.rejects(captureAppliedDamage(f.actor,async()=>{throw new Error('Damage permission changed');}),/permission/);
 assert.equal(f.callbacks.size,0);
});
