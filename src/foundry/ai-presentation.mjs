import {actionIntent} from '../framework/action-intent.mjs';
import {stealthRecord} from './stealth-awareness.mjs';

const ns='foundry-creature-ai';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const has=(options,key)=>options?.has?.(key)??options?.includes?.(key)??false;
const read=key=>game.settings?.get(ns,key);

export function registerPresentationSettings(){
  for(const [key,name,value]of [['actionPause','AI pause before acting (seconds)',1.5],['resultPause','AI pause after an action (seconds)',0.75]]){
    game.settings.register(ns,key,{name,scope:'world',config:true,type:Number,default:value,range:{min:0,max:5,step:0.25},
      hint:'Give players time to read intent and follow results. Set to 0 for no pause. Stop automation cancels the wait.'});
  }
  game.settings.register(ns,'intentAudience',{name:'AI intent messages',scope:'world',config:true,type:String,default:'public',
    choices:{public:'Speech bubbles for players',gm:'GM only: local bubble and whispered text',off:'Off'},
    hint:'Short action intentions. Hidden or undetected speakers use GM-only text to avoid revealing their location. Requires core Chat Bubbles for bubbles.'});
  game.settings.register(ns,'aiRollVisibility',{name:'Automated NPC roll visibility',scope:'world',config:true,type:String,default:'default',
    choices:{default:'Use the normal roll visibility',gm:'GM only'},hint:'GM only hides automated NPC attack, damage, skill and flat-check rolls. Player rolls keep their normal visibility.'});
  game.settings.register(ns,'suppressAI3DDice',{name:'Suppress Dice So Nice for AI-controlled NPCs',scope:'world',config:true,type:Boolean,default:false,
    hint:'Skip 3D dice animations for rolls from NPC tokens enabled in Creature AI, including automated reactions. Roll results and chat visibility are preserved. Applies to all clients; Dice So Nice remains optional.'});
}

export function waitForPresentation(ms,{signal,valid=()=>true}={}){
  if(signal?.aborted||!valid())return Promise.resolve(false);
  if(ms<=0)return Promise.resolve(true);
  return new Promise(resolve=>{
    let timer,poll;
    const finish=value=>{clearTimeout(timer);clearInterval(poll);signal?.removeEventListener('abort',abort);resolve(value);};
    const abort=()=>finish(false);
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(!signal?.aborted&&valid()),ms);
    poll=setInterval(()=>{if(!valid())finish(false);},50);
  });
}

export class AIPresentation {
  constructor({setting=read,wait=waitForPresentation,onError=error=>console.warn(`${ns}: intent message unavailable`,error)}={}){
    this.setting=setting;this.wait=wait;this.onError=onError;
  }
  delay(key){const value=this.setting(key);return typeof value==='number'&&Number.isFinite(value)?Math.min(5,Math.max(0,value))*1000:0;}
  valid(adapter,canContinue){
    return ()=>canContinue()&&canvas.ready&&!game.paused&&game.user.isGM&&game.users.activeGM?.id===game.user.id&&
      canvas.scene?.id===adapter.token.document.parent?.id&&canvas.tokens.get(adapter.token.id)===adapter.token;
  }
  async beforeAction({adapter,decision,state,signal,canContinue}){
    const valid=this.valid(adapter,canContinue);if(!valid())return false;
    const text=actionIntent({profileId:adapter.profileId,choice:decision.chosen,state});
    const audience=this.setting('intentAudience');
    if(text&&['public','gm'].includes(audience)){
      // Presentation failures must not interrupt an otherwise valid NPC turn.
      try{await this.announce(adapter.token,text,audience);}catch(error){this.onError(error);}
    }
    return this.wait(this.delay('actionPause'),{signal,valid});
  }
  afterAction({adapter,signal,canContinue}){
    return this.wait(this.delay('resultPause'),{signal,valid:this.valid(adapter,canContinue)});
  }
  async announce(token,text,audience){
    const hidden=token.document.hidden||token.actor.hasCondition('hidden','undetected','unnoticed','invisible')||
      stealthRecord(token)?.entries.some(entry=>['hidden','undetected'].includes(entry.state));
    const bubbles=canvas.hud?.bubbles,content=escape(text);
    if(audience==='public'&&!hidden){
      await bubbles?.broadcast(token,content,{requireVisible:true,pan:false});
      return;
    }
    // Never broadcast private text through the public chatBubble socket.
    const recipients=ChatMessage.getWhisperRecipients('GM').map(user=>user.id);
    if(!recipients.length)throw new Error('Cannot send private intent: no GM recipient is available');
    await ChatMessage.create({speaker:ChatMessage.getSpeaker({token:token.document}),content:`<p>${content}</p>`,
      whisper:recipients,flags:{[ns]:{intent:true,tokenId:token.id}}},{chatBubble:false});
    await bubbles?.say(token,content,{pan:false});
  }
}

export function applyAIRollPrivacy(message,mode=read('aiRollVisibility')){
  if(mode!=='gm'||!has(message.flags.pf2e?.context?.options,`${ns}:managed`))return false;
  const actor=message.speakerActor??message.actor??canvas.tokens?.get(message.speaker.token)?.actor;
  if(actor?.type!=='npc')return false;
  const recipients=ChatMessage.getWhisperRecipients('GM').map(user=>user.id);
  if(!recipients.length)throw new Error('Cannot make this NPC roll private: no GM recipient is available');
  message.updateSource({whisper:recipients,blind:true});return true;
}

export function applyAIDiceSuppression(message,enabled=read('suppressAI3DDice')){
  if(enabled!==true)return false;
  const speaker=message.speaker??{};
  // The author may be looking at a different scene; do not confuse token IDs
  // from that canvas with the message's own scene/token.
  const scene=game.scenes?.get?.(speaker.scene)??(globalThis.canvas?.scene?.id===speaker.scene||!speaker.scene?globalThis.canvas?.scene:null);
  const token=scene===globalThis.canvas?.scene?globalThis.canvas?.tokens?.get?.(speaker.token):null;
  const document=scene?.tokens?.get?.(speaker.token)??
    token?.document;
  const actor=message.speakerActor??message.actor??document?.actor??token?.actor??game.actors?.get?.(speaker.actor);
  if(actor?.type!=='npc')return false;
  const managed=message.flags?.[ns]?.managed===true||has(message.flags?.pf2e?.context?.options,`${ns}:managed`);
  const controlled=document?.getFlag?.(ns,'config')?.enabled===true||actor.token?.getFlag?.(ns,'config')?.enabled===true;
  if(!managed&&!controlled)return false;
  // Dice So Nice 6.4.5 checks this before starting its animation pipeline or
  // opening an interactive throw. The persisted flag applies on every client.
  message.updateSource({'flags.dice-so-nice.skip':true});
  return true;
}
