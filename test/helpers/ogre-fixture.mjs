import { readFile } from 'node:fs/promises';
import { PF2eOgreAdapter } from '../../src/foundry/ogre-adapter.mjs';
import { ReactionEngine } from '../../src/foundry/reactions.mjs';
import { MODULE_ID } from '../../src/foundry/pf2e-adapter.mjs';

export const ogreData = JSON.parse(await readFile(new URL('../fixtures/ogre-boss-mechanics.json', import.meta.url)));
function setPath(object, path, value) {
  const keys = path.split('.'), last = keys.pop();
  for (const key of keys) object = object[key] ??= {};
  object[last] = value;
}
export function fixture({ attackDegree = 2, tripOutcome = 'success', applyDamage = true, size = 16, npcData = ogreData, Adapter = PF2eOgreAdapter, footprint = 2 } = {}) {
  const calls = [], tokens = [], prompts = [], flags = new Map(), walls = new Set();
  class Rectangle { constructor(x,y,width,height) { Object.assign(this,{x,y,width,height,left:x,top:y,right:x+width,bottom:y+height}); } }
  globalThis.PIXI = { Rectangle };
  const distance = (a,b,reach) => {
    const one=a.mechanicalBounds,two=b.mechanicalBounds;
    const dx=Math.max(0,one.left-two.right+100,two.left-one.right+100)/100;
    const dy=Math.max(0,one.top-two.bottom+100,two.top-one.bottom+100)/100;
    return (reach===10&&dx===2&&dy===2?2:Math.max(dx,dy)+Math.floor(Math.min(dx,dy)/2))*5;
  };
  function makeActor(id, data) {
    const conditions=new Set(), actor={id,uuid:`Actor.${id}`,type:data.type,name:data.name,sourceId:data.source,
      system:structuredClone(data.system), alliance:data.type==='npc'?'opposition':'party', canAttack:true,
      hitPoints:structuredClone(data.system.attributes.hp), size:data.system.traits.size.value, level:data.system.details.level.value,
      attributes:{flanking:{canFlank:true,flankable:true},immunities:[]}, items:new Map(), conditionsSet:conditions,
      hasCondition:(...slugs)=>slugs.some(slug=>conditions.has(slug)),
      getCondition:(slug,{all=false}={})=>{const entry=conditions.has(slug)?{id:slug,slug,value:1,isLocked:false}:null;return all?entry?[entry]:[]:entry;},
      increaseCondition:async slug=>{conditions.add(slug);calls.push(['condition',id,slug]);},
      getStatistic:slug=>({check:{mod:data.system.skills?.[slug]?.base??6,...slug==='perception'?{roll:async options=>{
        calls.push(['perception',id,options]);return {total:21,dice:[{faces:20,total:15}]};}}:{}},dc:{value:(data.system.skills?.[slug]?.base??6)+10}}),
      getReach:({weapon}={})=>weapon?.reach??(data.type==='npc'?10:5),
      getFlag:(namespace,key)=>flags.get(`${id}:${namespace}:${key}`),
      setFlag:async(namespace,key,value)=>flags.set(`${id}:${namespace}:${key}`,structuredClone(value)),
      isOfType:type=>type==='creature'||type===actor.type,isAllyOf:other=>actor.alliance===other.alliance,isEnemyOf:other=>actor.alliance!==other.alliance,
      getSelfRollOptions:()=>[],getRollOptions:()=>[],
      applyDamage:async options=>{actor.hitPoints.value-=options.damage.total;calls.push(['damage-applied',id,options]);},
      deleteEmbeddedDocuments:async(_type,ids)=>{for(const itemId of ids){actor.items.delete(itemId);conditions.delete(itemId);}if(![...actor.items.values()].some(item=>item.system.rules?.some(rule=>rule.uuid?.endsWith('nlCjDvLMf2EkV2dl'))))conditions.delete('quickened');calls.push(['delete-items',id,ids]);},
      createEmbeddedDocuments:async(_type,entries)=>{const created=entries.map((entry,index)=>makeItem({...entry,_id:`effect-${actor.items.size}-${index}`},actor));for(const item of created){actor.items.set(item.id,item);if(item.system.rules?.some(rule=>rule.uuid?.endsWith('nlCjDvLMf2EkV2dl')))conditions.add('quickened');}calls.push(['create-effects',id,entries]);return created;},
    };
    for(const entry of data.items??[]) { const item=makeItem(entry,actor);actor.items.set(item.id,item); }
    actor.itemTypes={};
    for(const type of ['weapon','ammo','armor','action','effect','feat'])Object.defineProperty(actor.itemTypes,type,{get:()=>[...actor.items.values()].filter(item=>item.type===type)});
    const actions=(data.items??[]).filter(item=>item.type==='melee').map(entry=>{
      const item=actor.items.get(entry._id);
      return {type:'strike',item,label:item.name,ready:true,canAttack:true,
        get totalModifier(){return item.system.bonus.value-(conditions.has('prone')?2:0);},
        variants:[0,-5,-10].map((penalty,variant)=>({penalty,roll:async options=>{calls.push(['attack',id,item.id,variant,options]);return {degreeOfSuccess:attackDegree};}})),
        damage:async options=>{calls.push(['damage-roll',id,item.id,options]);return {total:10,instances:[{type:'piercing',total:10}]};},
        critical:async options=>{calls.push(['critical-roll',id,item.id,options]);return {total:25,instances:[{type:'piercing',total:25}]};},
      };
    });
    actor.system.actions=actions;return actor;
  }
  function makeItem(raw,actor) {
    const entry=structuredClone(raw),item={...entry,id:entry._id,slug:entry.system.slug??null,
      actor, flags:entry.flags??{},traits:new Set(entry.system.traits?.value??[]),
      getRollOptions:()=>[],isOfType:type=>type===entry.type,
      update:async changes=>{for(const [key,value]of Object.entries(changes))setPath(item,key,value);calls.push(['item-update',item.id,changes]);},
    };
    Object.defineProperties(item,{
      linkedWeapon:{get:()=>actor.items.get(item.flags.pf2e?.linkedWeapon)},
      isMelee:{get:()=>!item.system.range},isRanged:{get:()=>Boolean(item.system.range)},
      reach:{get:()=>item.system.traits?.value.includes('reach-10')?10:5},
      actionCost:{get:()=>({type:item.system.actionType?.value,value:item.system.actions?.value})},
      isEquipped:{get:()=>item.system.equipped?.carryType==='held'},
    });return item;
  }
  const scene={id:'scene',regions:{contents:[]},tokens:{get contents(){return tokens.map(token=>token.document);}}};
  function token(id,actor,x,y,width=1) {
    const document={id,uuid:`Scene.scene.Token.${id}`,actorId:actor.id,actor,parent:scene,x,y,width,height:width,elevation:0,level:'ground',actorLink:false,
      getFlag:(namespace,key)=>flags.get(`token-${id}:${namespace}:${key}`),
      setFlag:async(namespace,key,value)=>flags.set(`token-${id}:${namespace}:${key}`,structuredClone(value)),
      getSnappedPosition:p=>({x:Math.round(p.x/100)*100,y:Math.round(p.y/100)*100}),
      move:async path=>{Object.assign(document,path.at(-1));calls.push(['move',id,path]);return true;},
    };
    const token={id,name:actor.name,actor,document,w:width*100,h:width*100,
      get center(){return {x:document.x+width*50,y:document.y+width*50};},
      get mechanicalBounds(){return new Rectangle(document.x,document.y,width*100,width*100);},
      distanceTo(other,{reach}={}) {return distance(this,other,reach);},canFlank:()=>true,onOppositeSides:()=>false,
      checkCollision:()=>false,
      constrainMovementPath:path=>[path,path.some(p=>{for(let dx=0;dx<width;dx++)for(let dy=0;dy<width;dy++)if(walls.has(`${p.x/100+dx},${p.y/100+dy}`))return true;return false;})],
      measureMovementPath:path=>{let cost=0,diagonals=0;for(let i=1;i<path.length;i++){const dx=Math.abs(path[i].x-path[i-1].x),dy=Math.abs(path[i].y-path[i-1].y);if(dx||dy)cost+=dx&&dy?(++diagonals%2?5:10):5;}return {cost};},
    };tokens.push(token);return token;
  }
  const actor=makeActor('boss',npcData), boss=token('boss',actor,200,200,footprint);
  const playerData={type:'character',name:'Fighter',system:{traits:{size:{value:'med'},value:['humanoid']},details:{level:{value:7},languages:{value:['common']}},attributes:{hp:{value:100,max:100}},skills:{athletics:{base:15}}}};
  const player=token('fighter',makeActor('fighter',playerData),500,200);
  const combat={id:'combat',round:1,turn:0,started:true,combatant:{id:'c-boss',tokenId:'boss',sceneId:'scene'},
    combatants:[{id:'c-boss',tokenId:'boss',sceneId:'scene',actor},{id:'c-fighter',tokenId:'fighter',sceneId:'scene',actor:player.actor}],
    get turns(){return combat.combatants;},getFlag:(namespace,key)=>flags.get(`combat:${namespace}:${key}`),
    setFlag:async(namespace,key,value)=>flags.set(`combat:${namespace}:${key}`,structuredClone(value)),
    nextTurn:async()=>{calls.push(['next-turn']);combat.turn++;combat.combatant=combat.combatants[combat.turn%combat.combatants.length];},
  };
  globalThis.canvas={ready:true,scene,tokens:{placeables:tokens,get:id=>tokens.find(token=>token.id===id),controlled:[boss]},
    grid:{type:1,distance:5,size:100,getOffset:p=>({i:Math.floor(p.y/100),j:Math.floor(p.x/100)}),getTopLeftPoint:p=>({x:p.j*100,y:p.i*100})},
    dimensions:{sceneRect:{x:0,y:0,width:size*100,height:size*100,contains:(x,y)=>x>=0&&x<size*100&&y>=0&&y<size*100}}};
  globalThis.CONST={GRID_TYPES:{SQUARE:1}};
  globalThis.game={paused:false,system:{id:'pf2e'},release:{generation:14},combat,scenes:{contents:[scene]},
    settings:{get:(namespace,key)=>key==='seekScope'?'area':undefined},
    user:{id:'gm',isGM:true,targets:new Set(),settings:{showCheckDialogs:true,showDamageDialogs:true}},users:{activeGM:{id:'gm'}},
    pf2e:{settings:{automation:{flanking:true}},actions:new Map([
      ['trip',{use:async options=>{calls.push(['trip',options]);return [{outcome:tripOutcome}];}}],
      ['escape',{getDefaultVariant:()=>({preview:()=>[{slug:'athletics',modifier:16}]}),use:async options=>{calls.push(['escape',options]);return [{outcome:'success'}];}}],
    ])}};
  globalThis.ChatMessage={create:async data=>{calls.push(['chat',data]);return data;},getWhisperRecipients:()=>[{id:'gm'}],getSpeaker:()=>({token:'boss'})};
  const reactions=new ReactionEngine({prompts:{ask:async request=>{prompts.push(request);return 'pass';}}});
  flags.set(`token-boss:${MODULE_ID}:config`,{enabled:true,autoAdvance:false,applyDamage,pauseForReactions:true,entertaining:true});
  const adapter=new Adapter(boss,null,{reactions});
  const addOgre=(id,x=900,y=500)=>{const other=token(id,makeActor(id,ogreData),x,y,2);combat.combatants.push({id:`c-${id}`,tokenId:id,sceneId:'scene',actor:other.actor});return other;};
  return {adapter,boss,player,actor,combat,calls,flags,walls,reactions,prompts,addOgre,makeActor,token};
}
