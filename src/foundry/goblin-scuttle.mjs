import { MANAGED_MOVEMENT } from './movement-options.mjs';
import { clearSightPath } from './attack-path.mjs';
import { detectionFor } from './stealth-awareness.mjs';
import { occupiesMovementSpace } from './combat-state.mjs';
import { hazardousAt } from './hazardous-terrain.mjs';
import { withGreaseMode } from './spell-zones.mjs';
import { terrainMovementPath } from './movement-regions.mjs';

const ns='foundry-creature-ai';
export class GoblinScuttle {
  constructor(reactions,{presentation=null}={}) { this.reactions=reactions;this.presentation=presentation; }
  async afterMove(mover,{valid=()=>true,seen=new Set()}={}) {
    if (!mover.actor?.system.traits.value.includes('goblin') || !valid()) return;
    return this.reactions.resolve(async()=>{
      for (const token of canvas.tokens.placeables) {
        const config=token.document.getFlag(ns,'config');
        if(token===mover||seen.has(token.id)||token.actor?.type!=='npc'||!config?.enabled||config.autoReactions===false||
          !token.actor.system.traits.value.includes('goblin')||!token.actor.isAllyOf(mover.actor)||
          !token.actor.itemTypes.action.some(item=>item.slug==='goblin-scuttle'||item.id==='otqsXx9gjh7rnOpU'||item.name==='Goblin Scuttle')||
          !this.reactions.available(token)||token.actor.hasCondition('prone','immobilized','grabbed','restrained')||
          token.document.level!==mover.document.level||token.document.elevation!==mover.document.elevation||token.distanceTo(mover)>5)continue;
        const speed=token.actor.system.movement?.speeds.land?.value??token.actor.system.attributes.speed.total??token.actor.system.attributes.speed.value;
        if(!(speed>=10))continue;
        const foes=canvas.tokens.placeables.filter(enemy=>enemy.actor?.isEnemyOf(token.actor)&&enemy.actor.hitPoints?.value>0&&
          !enemy.document.hidden&&clearSightPath(token,enemy)&&!['undetected','unnoticed'].includes(detectionFor(token,enemy).state));
        const origin={x:token.document.x,y:token.document.y},size=canvas.grid.size;
        const distance=point=>Math.min(100,...foes.map(enemy=>Math.hypot((point.x+size/2)-enemy.center.x,(point.y+size/2)-enemy.center.y)/size*5));
        const quality=point=>{const d=distance(point);return d<15?d:30-Math.abs(25-d)*0.1;};
        const occupied=point=>canvas.tokens.placeables.some(other=>other!==token&&occupiesMovementSpace(other)&&other.document.level===token.document.level&&
          other.document.elevation===token.document.elevation&&point.x<other.document.x+other.w&&point.x+token.w>other.document.x&&
          point.y<other.document.y+other.h&&point.y+token.h>other.document.y);
        const choices=[];
        for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
          if(!dx&&!dy)continue;
          const point={...origin,x:origin.x+dx*size,y:origin.y+dy*size,elevation:token.document.elevation,level:token.document.level,action:'walk',snapped:true};
          const rect=canvas.dimensions.sceneRect;
          if(!rect.contains(point.x,point.y)||!rect.contains(point.x+token.w-1,point.y+token.h-1)||
            token.constrainMovementPath([origin,point],{ignoreWalls:false,ignoreCost:false})[1]||
            withGreaseMode(token,'step',()=>token.measureMovementPath(terrainMovementPath(token,[origin,point])).cost)>5||hazardousAt(token,point).length||
            occupied(point)||dx&&dy&&(occupied({x:point.x,y:origin.y})||occupied({x:origin.x,y:point.y})))continue;
          const score=quality(point)-quality(origin);
          if(score>0)choices.push({point,score});
        }
        choices.sort((a,b)=>b.score-a.score);if(!choices.length)continue;
        seen.add(token.id);
        const frame={adapter:{token,profileId:'goblin-pyro'},decision:{chosen:{kind:'goblinScuttle'}},state:{},canContinue:valid};
        if(this.presentation&&await this.presentation.beforeAction(frame)===false)continue;
        await this.reactions.exclusive(token,async()=>{
          if(!valid()||!this.reactions.available(token)||token.distanceTo(mover)>5||occupied(choices[0].point)||
            token.constrainMovementPath([origin,choices[0].point],{ignoreWalls:false,ignoreCost:false})[1])return;
          const reservation=await this.reactions.reserve(token,'goblin-scuttle',valid);
          const moved=await withGreaseMode(token,'step',()=>token.document.move([choices[0].point],{[MANAGED_MOVEMENT]:true,showRuler:true,constrainOptions:{ignoreWalls:false,ignoreCost:false}}));
          await (token.movementAnimationPromise??token.document.movement?.animation?.ended);
          if(!moved&&token.document.x===origin.x&&token.document.y===origin.y)await this.reactions.releaseUnexecuted(token,reservation);
          else await this.reactions.confirm(token,reservation);
        });
        // Every goblin shares its ordinary reaction and is considered once per chain.
        await this.afterMove(token,{valid,seen});
      }
    });
  }
}
