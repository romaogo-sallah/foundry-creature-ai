import {PF2eSpellcasterAdapter} from './spellcaster-adapter.mjs';
import {monsterAbility} from './monster-abilities.mjs';
import {fireShield,raiseFireShield} from './fire-shield.mjs';
export const isLich=actor=>actor?.type==='npc'&&Boolean(monsterAbility(actor,'lich-siphon-life'))&&Boolean(monsterAbility(actor,'lich-drain-soul-cage'));
export class PF2eLichAdapter extends PF2eSpellcasterAdapter{
 get profileId(){return 'lich';}
 parts(){const p=super.parts();return {...p,abilityNames:[...p.abilityNames,'Counterspell','Siphon Life','Frightful Presence','Drain Soul Cage','Steady Spellcasting'],
  unsupported:p.unsupported.filter(n=>!['Counterspell','Siphon Life','Frightful Presence','Drain Soul Cage','Steady Spellcasting','Void Healing','+1 Status to All Saves vs. Vitality'].includes(n))};}
 extraCasterActions(state){return state.actionsRemaining&&!state.plannedCapabilities?.includes('raise-shield')&&fireShield(this.actor)&&!this.actor.attributes.shield?.raised?[{id:'lich:shield',kind:'raiseFireShield',actionCost:1,legal:true,features:{onceKey:'raise-shield'},assessment:{value:state.self.threatened?8:2},scoringTerms:[]}]:[];}
 async executeProfileAction(choice,ledger,context){if(choice.kind==='raiseFireShield')return raiseFireShield(this.token);return super.executeProfileAction(choice,ledger,context);}
}
