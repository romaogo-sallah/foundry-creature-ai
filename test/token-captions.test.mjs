import test from 'node:test';
import assert from 'node:assert/strict';
import {TokenCaptions} from '../src/foundry/token-captions.mjs';
import {EnvironmentAwareness} from '../src/foundry/environment-awareness.mjs';
import {fixture} from './helpers/ogre-fixture.mjs';
import {captionRenderer} from './helpers/caption-renderer.mjs';

test('token redraw replaces a destroyed caption and cleanup preserves unrelated display children',()=>{
  const f=fixture();captionRenderer(canvas.tokens.placeables);const captions=new TokenCaptions(),other={parent:f.player};
  f.player.children.push(other);captions.update(f.player,'Hidden (stealth)');const first=captions.get(f.player);
  first.destroy();captions.update(f.player,'Hidden (stealth)');const second=captions.get(f.player);
  assert.notEqual(first,second);assert.equal(second.parent,f.player);
  captions.clear();assert.equal(second.destroyed,true);assert.deepEqual(f.player.children,[other]);
});

test('native secrecy hides the caption and height changes never write to caption text',()=>{
  const f=fixture();captionRenderer(canvas.tokens.placeables);const captions=new TokenCaptions();
  captions.update(f.player,'Concealed');const display=captions.get(f.player),writes=display.writes;
  f.player.tooltip.text='+15 ft';captions.layout(f.player);assert.equal(display.writes,writes);
  f.player.document.isSecret=true;captions.layout(f.player);assert.equal(display.visible,false);
  f.player.document.isSecret=false;f.player.tooltip.visible=false;captions.layout(f.player);assert.equal(display.visible,false);
  f.player.tooltip.visible=true;captions.layout(f.player);assert.equal(display.visible,true);
});

test('a player renderer never creates a caption at an undetected creature even if native party vision keeps it visible',async()=>{
  const f=fixture();captionRenderer(canvas.tokens.placeables);game.user.isGM=false;
  f.player.actor.conditionsSet.add('undetected');f.player.isVisible=true;
  const awareness=new EnvironmentAwareness();await awareness.schedule();
  assert.equal(awareness.captions.get(f.player),undefined);assert.equal(f.player.children.length,0);
  f.player.actor.conditionsSet.delete('undetected');f.player.actor.conditionsSet.add('hidden');await awareness.schedule();
  const displayed=awareness.captions.get(f.player);assert.match(displayed.text,/Hidden/);
  f.player.actor.conditionsSet.add('undetected');await awareness.schedule();
  assert.equal(displayed.destroyed,true);assert.equal(awareness.captions.get(f.player),undefined);
});
