import {readFile} from 'node:fs/promises';
import {fixture as flightFixture} from './eagle-fixture.mjs';
import {PF2eManticoreQuillAdapter} from '../../src/foundry/manticore-quill-adapter.mjs';
export const quillData=JSON.parse(await readFile(new URL('../fixtures/manticore-quill-mechanics.json',import.meta.url)));
export function fixture(options={}){
 const f=flightFixture({...options,npcData:quillData,Adapter:PF2eManticoreQuillAdapter,footprint:2});
 for(const item of f.actor.items.values())item.uuid=`${f.actor.uuid}.Item.${item.id}`;
 game.time={worldTime:0};
 f.addTarget=(id,x=700,y=200)=>{
  const target=f.token(id,f.makeActor(id,quillData),x,y,2);target.actor.alliance='party';target.actor.dimensions={height:10};
  target.document.update=async changes=>Object.assign(target.document,changes);
  target.distanceTo=f.player.distanceTo;
  f.combat.combatants.push({id:`c-${id}`,tokenId:id,sceneId:'scene',actor:target.actor});
  return target;
 };
 return f;
}
