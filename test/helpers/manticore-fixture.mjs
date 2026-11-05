import {readFile} from 'node:fs/promises';
import {fixture as flightFixture} from './eagle-fixture.mjs';
import {PF2eManticoreAdapter} from '../../src/foundry/manticore-adapter.mjs';
export const manticoreData=JSON.parse(await readFile(new URL('../fixtures/manticore-scorpion-mechanics.json',import.meta.url)));
export function fixture(options={}){
 const f=flightFixture({...options,npcData:manticoreData,Adapter:PF2eManticoreAdapter,footprint:2});
 for(const item of f.actor.items.values())item.uuid=`${f.actor.uuid}.Item.${item.id}`;
 f.degrees=[1];game.time={worldTime:0};
 const getStatistic=f.player.actor.getStatistic;
 f.player.actor.getStatistic=slug=>slug==='fortitude'?{check:{roll:async options=>{
  f.calls.push(['venom-save',options]);const degree=f.degrees.length?f.degrees.shift():1;
  return degree===null?null:{degreeOfSuccess:degree};
 }}}:getStatistic(slug);
 globalThis.CONFIG.Dice.rolls=[class DamageRoll{
  constructor(formula){this.formula=formula;this.total=formula.startsWith('2d10')?11:5;this.instances=[{type:'poison',total:this.total}];}
  async evaluate(){return this;}
  async toMessage(data){f.calls.push(['poison-damage',this.formula,data]);}
 }];
 return f;
}
