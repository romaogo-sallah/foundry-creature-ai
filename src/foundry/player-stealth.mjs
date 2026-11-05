import { stealthObservers, stealthRecord, stealthContext, detectionFor, hidingFrom, rollStealth, reveal } from './stealth-awareness.mjs';
import { coverAlongPath } from './environment-zones.mjs';
import { combatStamp } from './reaction-prompts.mjs';
import { sneakMode, setSneakMode } from './sneak-mode.mjs';
import {actionRestriction} from './action-restrictions.mjs';

const ns='foundry-creature-ai';
export const PLAYER_STEALTH_QUERY=`${ns}.playerStealth`;
const managed=`${ns}:managed`,hideMarker=`${ns}:player-hide:`;
export const HIDDEN_STRIKE=`${ns}:hidden-strike`;
const wrappedDamage=new WeakSet();
const position=token=>Object.fromEntries(['x','y','elevation','level'].map(key=>[key,(token.document._source??token.document)[key]]));
const equal=(a,b)=>Object.keys(a).every(key=>a[key]===b[key]);
const has=(options,key)=>options?.has?.(key)??options?.includes?.(key)??false;
const center=(token,point)=>({x:point.x+token.document.width*canvas.grid.size/2,y:point.y+token.document.height*canvas.grid.size/2});
export function playerSneakSpeed(actor){
  const speed=actor.system.movement?.speeds.land?.value??actor.system.attributes.speed?.total??actor.system.attributes.speed?.value;
  const swift=(actor.itemTypes?.feat??[]).some(item=>['swift-sneak','legendary-sneak'].includes(item.slug));
  return Number.isFinite(speed)?speed/(swift?1:2):0;
}
export function stealthStart(observer,subject){
  const saved=detectionFor(observer,subject);
  if(saved.state!=='observed')return saved;
  if(hidingFrom(observer,subject).blocked)return {state:'hidden',knownPosition:position(subject)};
  return saved;
}

export class PlayerStealth {
  constructor({enabled=()=>true,onError=error=>ui.notifications.error(error.message)}={}){
    this.enabled=enabled;this.onError=onError;this.pending=new Set();this.completed=new Map();this.mirrorQueue=Promise.resolve();
  }
  supports(token){return this.enabled()&&token?.actor?.isOfType?.('character');}
  movementEnabled(token){return this.supports(token)&&(stealthObservers(token).length>0||stealthRecord(token)?.entries.length>0||this.armed(token));}
  armed(token){return sneakMode(token);}
  enableSneak(token){return setSneakMode(token,true);}
  mirror(subject){
    // Two players can Hide at once. Serialize read/modify/write operations on
    // their shared observers so one character's result cannot erase another's.
    const context=stealthContext();
    const operation=this.mirrorQueue.catch(()=>{}).then(()=>{
      const current=stealthContext();
      if(current.sceneId===context.sceneId&&current.combatId===context.combatId&&canvas.tokens.get(subject.id)===subject)return this.writeMirror(subject);
    });
    this.mirrorQueue=operation;return operation;
  }
  async writeMirror(subject){
    const context=stealthContext(),entries=stealthRecord(subject)?.entries??[];
    for(const observer of stealthObservers(subject)){
      const saved=observer.document.getFlag(ns,'perception'),same=saved?.sceneId===context.sceneId&&(saved.combatId??null)===context.combatId;
      const others=same?(saved.entries??[]).filter(entry=>entry.subjectId!==subject.id&&canvas.tokens.get(entry.subjectId)):[];
      const recorded=entries.find(entry=>entry.observerId===observer.id),effective=detectionFor(observer,subject);
      const next={...context,entries:[...others,{subjectId:subject.id,state:effective.state,
        knownPosition:effective.state==='undetected'?recorded?.knownPosition??null:position(subject)}]};
      if(JSON.stringify(saved)!==JSON.stringify(next))await observer.document.setFlag(ns,'perception',next);
    }
  }
  async clear(subject){await reveal(subject);await this.mirror(subject);}
  async afterStep(subject){
    const saved=stealthRecord(subject);if(!saved)return;
    const entries=saved.entries.filter(entry=>canvas.tokens.get(entry.observerId)).map(entry=>{
      const state=detectionFor(canvas.tokens.get(entry.observerId),subject).state;
      return {...entry,state,knownPosition:state==='undetected'?entry.knownPosition:position(subject)};
    });
    const next={...stealthContext(),moving:false,entries};
    if(JSON.stringify(saved)!==JSON.stringify(next))await subject.document.setFlag(ns,'stealth',next);
    await this.mirror(subject);
  }
  async refresh(){
    if(!canvas.ready||!this.enabled()||game.users.activeGM?.id!==game.user.id)return;
    this.refreshAgain=true;if(this.refreshing)return this.refreshing;
    this.refreshing=(async()=>{
      do{
        this.refreshAgain=false;
        for(const subject of [...canvas.tokens.placeables]){
          if(this.supports(subject)&&subject.document.getFlag(ns,'sneakNextMove'))await this.enableSneak(subject);
          const saved=stealthRecord(subject);
          if(this.supports(subject)&&saved&&!saved.moving&&!this.pending.has(subject.id))await this.afterStep(subject);
        }
      }while(this.refreshAgain);
    })();
    try{await this.refreshing;}finally{this.refreshing=null;}
  }
  async request(action,token=canvas.tokens.controlled[0],extra={}){
    if(!this.supports(token)||!game.user.isGM&&!token.actor.testUserPermission(game.user,'OWNER'))throw new Error('Select your character token first');
    const gm=game.users.activeGM;if(!gm)throw new Error('An active GM is required for secret Stealth checks');
    const data={action,sceneId:canvas.scene.id,tokenId:token.id,origin:position(token),stamp:combatStamp(),expires:Date.now()+120000,
      requestId:foundry.utils.randomID(),...extra};
    return gm.id===game.user.id?this.receive(data,game.user):gm.query(PLAYER_STEALTH_QUERY,data,{timeout:125000});
  }
  async receive(data,sender){
    if(game.users.activeGM?.id!==game.user.id||!sender?.active||!this.enabled())throw new Error('Player Stealth requires the active GM');
    const token=canvas.scene?.id===data.sceneId?canvas.tokens.get(data.tokenId):null;
    if(!this.supports(token)||!sender.isGM&&!token.actor.testUserPermission(sender,'OWNER'))throw new Error('You do not own this character');
    if(!Number.isFinite(data.expires)||data.expires<Date.now()||data.expires>Date.now()+180000||combatStamp()!==data.stamp||
      !data.origin||!equal(position(token),data.origin)||typeof data.requestId!=='string')throw new Error('The Stealth request is stale');
    const id=`${sender.id}:${data.requestId}`;
    if(this.completed.has(id))return this.completed.get(id);
    if(this.pending.has(token.id))throw new Error('This character already has a Stealth check resolving');
    const valid=()=>game.users.activeGM?.id===game.user.id&&canvas.scene?.id===data.sceneId&&combatStamp()===data.stamp&&
      canvas.tokens.get(token.id)===token&&equal(position(token),data.origin)&&(sender.isGM||token.actor.testUserPermission(sender,'OWNER'));
    this.pending.add(token.id);
    try{
      if(data.action==='arm-sneak')await this.enableSneak(token);
      else if(data.action==='stop-sneak')await setSneakMode(token,false);
      else if(data.action==='reveal'){await this.clear(token);await setSneakMode(token,false);}
      else if(data.action==='reveal-action')await this.clear(token);
      else if(['hide','resolve-hide-roll'].includes(data.action)){
        const restriction=actionRestriction(token.actor);if(restriction)throw new Error(restriction.reason);
        let providedRoll,circumstanceBonus;
        if(data.action==='resolve-hide-roll'){
          const message=game.messages.get(data.messageId),options=message?.flags.pf2e?.context?.options??[];
          if(!message||!message.rolls?.length||(message.author?.id??message.user?.id)!==sender.id||message.speaker.token!==token.id||
            message.speaker.scene!==data.sceneId||message.flags.pf2e.context.type!=='skill-check'||!has(options,`${hideMarker}${data.nonce}`)||!has(options,'action:hide'))
            throw new Error('Cannot validate the native Hide roll');
          providedRoll=message.rolls[0];
          circumstanceBonus=Math.max(0,...(message.flags.pf2e.modifiers??[]).filter(m=>m.type==='circumstance'&&m.enabled!==false&&!m.ignored).map(m=>m.modifier??0));
        }
        const observers=stealthObservers(token),starts=new Map(observers.map(observer=>[observer.id,stealthStart(observer,token)]));
        await rollStealth(token,'hide',{observers,starts,eligible:observers.filter(observer=>hidingFrom(observer,token).canHide).map(o=>o.id),
          valid,providedRoll,circumstanceBonus});
        await this.mirror(token);
      }else throw new Error('Unknown player Stealth action');
      const answer={complete:true};this.completed.set(id,answer);if(this.completed.size>200)this.completed.delete(this.completed.keys().next().value);
      return answer;
    }finally{this.pending.delete(token.id);}
  }
  async prepareSneak(token,path,valid){
    const observers=stealthObservers(token),starts=new Map(observers.map(observer=>[observer.id,stealthStart(observer,token)]));
    const eligible=observers.filter(observer=>starts.get(observer.id).state!=='observed').map(o=>o.id);
    const coverThroughout=new Map(observers.map(observer=>[observer.id,coverAlongPath(observer,token,path.map(p=>center(token,p)))]));
    // Resolve secretly in advance: success/failure applies throughout the move,
    // so reactions must use that result. Final eligibility is checked on arrival.
    const roll=await token.actor.getStatistic('stealth').check.roll({skipDialog:true,action:'sneak',traits:['secret'],
      extraRollOptions:[managed,'secret','skip-handling-message','action:sneak']});
    if(!roll||!Number.isFinite(roll.total))throw new Error('Sneak roll was cancelled; no movement occurred');
    const context=stealthContext();
    await rollStealth(token,'sneak',{observers,starts,eligible,coverThroughout,destination:center(token,path.at(-1)),moving:true,providedRoll:roll,valid});
    await this.mirror(token);
    return {observers,starts,eligible,roll,context};
  }
  async finishSneak(token,plan,traveled){
    const context=stealthContext();
    if(game.users.activeGM?.id!==game.user.id||context.sceneId!==plan.context.sceneId||context.combatId!==plan.context.combatId)return;
    const actual=position(token),path=[...traveled];if(!equal(path.at(-1),actual))path.push(actual);
    const observers=plan.observers.filter(observer=>canvas.tokens.get(observer.id)===observer);
    const coverThroughout=new Map(observers.map(observer=>[observer.id,coverAlongPath(observer,token,path.map(p=>center(token,p)))]));
    await rollStealth(token,'sneak',{observers,starts:plan.starts,eligible:plan.eligible,coverThroughout,destination:center(token,actual),
      moving:false,providedRoll:plan.roll});
    await this.mirror(token);
  }
  async open(token=canvas.tokens.controlled[0]){
    if(!this.supports(token))throw new Error('Select your character token first');
    const action=await foundry.applications.api.DialogV2.wait({window:{title:`Stealth — ${token.name}`},
      content:`<p>Hide resolves one secret Stealth check against each enemy. Start Sneak adds a visible effect; ground movements use Sneak until you remove it. Each movement spends one action and rolls separately. Stop Sneak removes the effect without changing enemy detection. Reveal ends ordinary hiding and also stops Sneak.</p><p>Sneak is currently <strong>${this.armed(token)?'on':'off'}</strong>.</p>`,
      buttons:[{action:'hide',label:'Hide',default:true},this.armed(token)?{action:'stop-sneak',label:'Stop Sneak'}:{action:'arm-sneak',label:'Start Sneak'},
        {action:'reveal',label:'Reveal / stop Sneak'}],rejectClose:false});
    if(action)await this.request(action,token);
  }
  install(){
    CONFIG.queries??={};CONFIG.queries[PLAYER_STEALTH_QUERY]=(data,{user})=>this.receive(data,user);
  }
  installRolls(){
    const controller=this;
    // Damage is often rolled after the Strike has already revealed its attacker.
    // Preserve only that Strike's saved off-guard option for native precision
    // damage; never put an Off-Guard condition on the target's actor.
    if(globalThis.CONFIG?.PF2E?.Actor?.documentClasses?.character?.prototype?.prepareStrike){
      libWrapper.register(ns,'CONFIG.PF2E.Actor.documentClasses.character.prototype.prepareStrike',function(wrapped,...args){
        const strike=wrapped(...args);controller.prepareDamage(strike);return strike;
      },'WRAPPER');
      for(const token of canvas.tokens.placeables)if(controller.supports(token))for(const strike of token.actor.system.actions??[])controller.prepareDamage(strike);
    }
  }
  // The environment installer owns our single libWrapper registration for
  // Check.roll. It calls this outer stage before contextual terrain handling.
  async wrapRoll(wrapped,check,context,...rest){
    const controller=this;
      const token=(context?.origin?.token??context?.token)?.object,options=context?.options??[];
      if(!controller.supports(token)||has(options,managed)||context?.isReroll||context?.createMessage===false)return wrapped(check,context,...rest);
      const action=context.action;
      let kind=has(options,'action:hide')||action==='hide'?'hide':has(options,'action:sneak')||action==='sneak'?'sneak':null;
      const stealth=context.type==='skill-check'&&(check.slug==='stealth'||context.domains?.includes('stealth'));
      if(!kind&&stealth){
        kind=await foundry.applications.api.DialogV2.wait({window:{title:'Stealth — purpose'},content:'<p>Choose the action this Stealth check is for.</p>',
          buttons:[{action:'hide',label:'Hide',default:true},{action:'sneak',label:'Start Sneak'},{action:'roll',label:'Other Stealth check'}],rejectClose:false});
        if(!kind)return null;
      }
      if(kind==='sneak'){await controller.request('arm-sneak',token);ui.notifications.info('Sneak is on: drag a path to Sneak. Remove the Sneak effect or use Stop Sneak to stop.');return null;}
      if(kind==='hide'){
        const nonce=foundry.utils.randomID(),origin=position(token),original=rest[1];let messageId;
        context.options=new Set([...options,'action:hide','secret','skip-handling-message',`${hideMarker}${nonce}`]);context.messageMode='blind';
        rest[1]=async(...args)=>{messageId=args[2]?.id;await original?.(...args);};
        const roll=await wrapped(check,context,...rest);
        if(roll){if(!messageId)throw new Error('Hide rolled without a message; resolve detection manually');
          if(!equal(position(token),origin))throw new Error('The character moved during Hide; resolve the spent action manually');
          await controller.request('resolve-hide-roll',token,{messageId,nonce});}
        return roll;
      }
      if(context.type==='attack-roll'){
        if(action!=='strike')await controller.request('reveal-action',token);
        const roll=await wrapped(check,context,...rest);if(roll&&action==='strike')await controller.request('reveal-action',token);return roll;
      }
      // Action-labelled skill checks (Escape, Trip, Treat Wounds, and so on)
      // break ordinary hiding before the action. Unlabelled saves/flat checks
      // and exploratory skill checks are not evidence of a revealing action.
      if(context.type==='skill-check'&&action&&kind!=='roll')await controller.request('reveal-action',token);
      return wrapped(check,context,...rest);
  }
  prepareDamage(strike){
    if(!strike||wrappedDamage.has(strike))return;
    wrappedDamage.add(strike);
    for(const kind of ['damage','critical']){
      const native=strike[kind];if(typeof native!=='function')continue;
      strike[kind]=async function(options={}){
        if(options.getFormula)return native.call(this,options);
        const target=options.target?.document??game.user.targets?.first?.()?.document;
        const saved=options.checkContext??game.messages.contents?.slice(-3).reverse().find(message=>
          message.actor?.uuid===strike.item?.actor?.uuid&&message.item?.uuid===strike.item?.uuid&&message.target?.token===target&&
          has(message.flags.pf2e?.context?.options,HIDDEN_STRIKE))?.flags.pf2e.context;
        if(has(saved?.options,HIDDEN_STRIKE))options={...options,options:new Set([...(options.options??[]),'target:condition:off-guard'])};
        return native.call(this,options);
      };
    }
  }
}
