import { readFile } from 'node:fs/promises';
import { fixture as creatureFixture } from './ogre-fixture.mjs';
import { PF2eGoblinPyroAdapter } from '../../src/foundry/goblin-pyro-adapter.mjs';

export const pyroData=JSON.parse(await readFile(new URL('../fixtures/goblin-pyro-mechanics.json',import.meta.url)));
const ns='foundry-creature-ai';
function setPath(object,path,value){const keys=path.split('.'),last=keys.pop();for(const key of keys)object=object[key]??={};object[last]=value;}
class Message {
  constructor(data={}){Object.assign(this,{flags:{pf2e:{context:{options:[]}}}},data);}
  updateSource(changes){for(const [key,value]of Object.entries(changes))setPath(this,key,value);}
  toObject(){return structuredClone({flags:this.flags,content:this.content??'Spell card'});}
}
export function fixture({degree=2,saveDegree=1,size=24}={}){
  const f=creatureFixture({npcData:pyroData,Adapter:PF2eGoblinPyroAdapter,footprint:1,size});
  f.degree=degree;f.saveDegree=saveDegree;f.flatTotal=20;
  class DamageRoll {
    constructor(formula){this.formula=formula;this.total=formula.includes('persistent')?0:formula.includes('2d6')?7:5;this.instances=[{type:'fire',total:this.total,persistent:formula.includes('persistent')}];}
    async evaluate(){return this;}
    alter(multiplier){const result=new DamageRoll(this.formula);result.total=this.total*multiplier;result.instances=[{...this.instances[0],total:result.total}];return result;}
    async toMessage(data){f.calls.push(['spell-damage-message',this.total,data]);return data;}
  }
  class Region {
    constructor(data,{parent}={}){Object.assign(this,data);this.parent=parent;this.id=data._id??`region-${parent?.regions.contents.length??0}`;this.behaviors={contents:data.behaviors??[]};}
    testPoint(point){return this.shapes.some(shape=>{
      if(shape.type==='rectangle')return point.x>=shape.x&&point.x<shape.x+shape.width&&point.y>=shape.y&&point.y<shape.y+shape.height;
      const dx=point.x-shape.x,dy=point.y-shape.y,angle=Math.atan2(dy,dx)*180/Math.PI;
      const delta=Math.abs(((angle-shape.rotation+540)%360)-180);
      return Math.hypot(dx,dy)<=shape.radius+1e-6&&delta<=45+1e-6;
    });}
  }
  globalThis.CONFIG={Region:{documentClass:Region},Dice:{rolls:[DamageRoll]}};
  globalThis.Roll=class {async evaluate(){return {total:f.flatTotal,toMessage:async data=>f.calls.push(['flat-message',data])};}};
  globalThis.CONST.REGION_VISIBILITY={ALWAYS:0};
  game.time={worldTime:0};game.combats=[game.combat];
  game.modules=new Map();
  globalThis.ui={notifications:{info:()=>{},warn:()=>{},error:()=>{}}};
  game.pf2e.Modifier=class {constructor(data){Object.assign(this,data);}};
  const scene=canvas.scene;scene.grid=canvas.grid;
  scene.createEmbeddedDocuments=async(type,entries,options)=>{
    const created=entries.map(data=>new Region(data,{parent:scene}));scene.regions.contents.push(...created);f.calls.push(['create-region',entries,options]);return created;
  };
  scene.deleteEmbeddedDocuments=async(type,ids)=>{scene.regions.contents=scene.regions.contents.filter(region=>!ids.includes(region.id));f.calls.push(['delete-regions',ids]);};
  const initializeToken=token=>{
    token.document.testInsideRegion=(region,position={})=>{
      if(region.levels?.length&&!region.levels.includes(position.level??token.document.level))return false;
      if(region.elevation&&Math.abs((position.elevation??token.document.elevation)-region.elevation.bottom)>0.1)return false;
      for(let x=0;x<token.document.width;x++)for(let y=0;y<token.document.height;y++)
        if(region.testPoint({x:(position.x??token.document.x)+(x+0.5)*100,y:(position.y??token.document.y)+(y+0.5)*100}))return true;
      return false;
    };
    const getStatistic=token.actor.getStatistic;
    token.actor.getStatistic=slug=>{
      const statistic=getStatistic(slug);
      if(['reflex','acrobatics'].includes(slug))statistic.check.roll=async options=>{
        f.calls.push(['spell-save',token.id,slug,options]);return {degreeOfSuccess:f.saveDegree,total:12};
      };
      return statistic;
    };
    return token;
  };
  const initializeActor=actor=>{
    for(const type of ['spell','spellcastingEntry'])Object.defineProperty(actor.itemTypes,type,{get:()=>[...actor.items.values()].filter(item=>item.type===type)});
    const entry=actor.itemTypes.spellcastingEntry[0];
    entry.statistic={check:{mod:6},dc:{value:16}};
    entry.consume=async spell=>{
      f.calls.push(['consume-spell',spell.slug]);if(spell.isCantrip)return true;
      if(entry.system.slots.slot1.value<=0)return false;await entry.update({'system.slots.slot1.value':entry.system.slots.slot1.value-1});return true;
    };
    for(const spell of actor.itemTypes.spell){
      spell.rank=1;spell.isCantrip=spell.traits.has('cantrip');spell.isAttack=spell.traits.has('attack');spell.uuid=`${actor.uuid}.Item.${spell.id}`;
      spell.toMessage=async()=>new Message();spell.getOriginData=()=>({uuid:spell.uuid});
      spell.rollAttack=async(event,number,options)=>{f.calls.push(['spell-attack',spell.slug,number,options]);return {degreeOfSuccess:f.degree};};
      spell.getDamage=async function(){return {template:{damage:{roll:new DamageRoll(this.system.damage[Object.keys(this.system.damage)[0]].formula)}},context:{options:new Set()}};};
      spell.overlays={contents:Object.values(spell.system.overlays??{})};
      spell.loadVariant=({overlayIds})=>{const overlay=spell.overlays.contents.find(entry=>overlayIds.includes(entry._id));return {...spell,system:{...spell.system,...overlay.system}};};
    }
    const item={id:'torch-strike',slug:'torch',name:'Torch',isMelee:true,reach:5,getRollOptions:()=>[],system:{traits:{value:[]},damageRolls:{base:{damage:'1d4',damageType:'bludgeoning'},fire:{damage:'1',damageType:'fire'}}}};
    actor.system.actions=[{type:'strike',item,totalModifier:7,variants:[0,-5,-10].map((penalty,index)=>({penalty,roll:async options=>{f.calls.push(['torch-attack',index,options]);return {degreeOfSuccess:f.degree};}})),
      damage:async()=>new DamageRoll('2d4'),critical:async()=>new DamageRoll('2d4').alter(2)}];
    actor.getReach=()=>5;
    actor.getRollOptions=()=>['lit-torch'];
    return actor;
  };
  initializeActor(f.actor);initializeToken(f.boss);initializeToken(f.player);f.player.actor.level=1;
  f.flags.set(`token-boss:${ns}:config`,{...f.adapter.config,entertaining:false});
  f.addPyro=(id,x,y)=>initializeToken(f.token(id,initializeActor(f.makeActor(id,pyroData)),x,y));
  f.addEnemy=(id,x,y)=>{const token=f.token(id,f.makeActor(id,{type:'character',name:id,system:{traits:{size:{value:'med'},value:['humanoid']},details:{level:{value:1},languages:{value:['common']}},attributes:{hp:{value:20,max:20}},skills:{}}}),x,y);
    initializeToken(token);game.combat.combatants.push({id:`c-${id}`,tokenId:id,sceneId:scene.id,actor:token.actor});return token;};
  globalThis.fromUuid=async()=>({toObject:()=>({type:'effect',name:'Spell Effect: Tangle Vine',system:{duration:{unit:'rounds',value:1,expiry:'turn-start'},rules:[{key:'ChoiceSet',selection:null},{key:'FlatModifier',selector:'all-speeds',type:'circumstance',value:-10}]},flags:{}})});
  return Object.assign(f,{initializeToken,DamageRoll,Region});
}
