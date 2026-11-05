import {readFile} from 'node:fs/promises';
import {fixture as creatureFixture} from './ogre-fixture.mjs';
import {PF2eEagleAdapter} from '../../src/foundry/eagle-adapter.mjs';
import {flightStepCost} from '../../src/foundry/flight-costs.mjs';
export const eagleData=JSON.parse(await readFile(new URL('../fixtures/eagle-mechanics.json',import.meta.url)));
export function fixture({size=14,altitude=0,attackDegree=2}={}){
 const f=creatureFixture({npcData:eagleData,Adapter:PF2eEagleAdapter,footprint:1,size,attackDegree});
 for(const token of [f.boss,f.player]){
  token.document.depth=1;token.actor.dimensions={height:5};
  token.document.update=async changes=>{Object.assign(token.document,changes);return token.document;};
 }
 f.player.actor.level=1;f.boss.document.elevation=altitude;
 // Match the installed PF2e cuboid/grid measurement, including three-axis
 // diagonals. A 2D stub masked corner/altitude mistakes in earlier tests.
 for(const token of [f.boss,f.player])token.distanceTo=function(other,{reach}={}){
  const a=this.mechanicalBounds,b=other.mechanicalBounds;
  const overlap=a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  const dx=overlap?0:Math.max(a.left-b.right,b.left-a.right,0)/100+1;
  const dy=overlap?0:Math.max(a.top-b.bottom,b.top-a.bottom,0)/100+1;
  const low=this.document.elevation,otherLow=other.document.elevation;
  const high=low+this.actor.dimensions.height,otherHigh=otherLow+other.actor.dimensions.height;
  const dz=low===otherLow||low<otherHigh&&high>otherLow?0:Math.max(low-otherHigh,otherLow-high,0)/5+1;
  const [one,two,three]=[dx,dy,dz].map(Math.ceil).sort((a,b)=>a-b),diagonal=two-one;
  return (Math.floor(one*1.75+diagonal*1.5+three-two)-Number(reach===10&&two>1))*5;
 };
 canvas.scene.levels={get:()=>({elevation:{bottom:0,top:25}})};
 f.actor.system.actions.find(s=>s.item.name==='Talon').variants[1].penalty=-4;
 f.actor.system.actions.find(s=>s.item.name==='Talon').variants[2].penalty=-8;
 f.actor.getStatistic=slug=>({check:{mod:6,...slug==='acrobatics'?{roll:async options=>{f.calls.push(['arrest',options]);return {degreeOfSuccess:f.arrestDegree??2};}}:{}},dc:{value:16}});
 f.boss.measureMovementPath=path=>{
  let cost=0,diagonals=0;
  for(let i=1;i<path.length;i++){
   const a=path[i-1],b=path[i],dx=Math.abs((b.x-a.x)/100),dy=Math.abs((b.y-a.y)/100),dz=Math.abs(((b.elevation??0)-(a.elevation??0))/5);
   const steps=Math.ceil(Math.max(dx,dy,dz));
   for(let n=0;n<steps;n++){
    const from={i:0,j:0,k:0},to={i:dy?1:0,j:dx?1:0,k:dz?Math.sign(b.elevation-a.elevation):0};
    const axes=Number(dx>0)+Number(dy>0)+Number(dz>0),distance=axes>1?(++diagonals%2?5:10):5;
    cost+=b.action==='fly'?flightStepCost(distance,from,to,distance):distance;
   }
  }
  return {cost};
 };
 globalThis.CONFIG={Dice:{rolls:[class DamageRoll{
  constructor(formula){this.total=Number.parseInt(formula);this.instances=[{type:'bludgeoning',total:this.total}];}
  async evaluate(){return this;}
  async toMessage(data){f.calls.push(['fall-damage',this.total,data]);}
 }]}};
 const flags=f.flags.get('token-boss:foundry-creature-ai:config');flags.entertaining=false;
 return f;
}
