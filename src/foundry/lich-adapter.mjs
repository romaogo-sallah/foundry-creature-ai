import {profileActions} from '../framework/profile-actions.mjs';
import {profileActionFacts} from './decision-snapshot.mjs';
import {PF2eSpellcasterAdapter} from './spellcaster-adapter.mjs';
import {monsterAbility} from './monster-abilities.mjs';
import {raiseFireShield} from './fire-shield.mjs';
export const isLich=actor=>actor?.type==='npc'&&Boolean(monsterAbility(actor,'lich-siphon-life'))&&Boolean(monsterAbility(actor,'lich-drain-soul-cage'));
export class PF2eLichAdapter extends PF2eSpellcasterAdapter{
 get profileId(){return 'lich';}
 parts(){const p=super.parts();return {...p,abilityNames:[...p.abilityNames,'Counterspell','Siphon Life','Frightful Presence','Drain Soul Cage','Steady Spellcasting'],
  unsupported:p.unsupported.filter(n=>!['Counterspell','Siphon Life','Frightful Presence','Drain Soul Cage','Steady Spellcasting','Void Healing','+1 Status to All Saves vs. Vitality'].includes(n))};}
 extraCasterActions(state){return profileActions(state,profileActionFacts(this,state));}
 async executeProfileAction(choice,ledger,context){if(choice.kind==='raiseFireShield')return raiseFireShield(this.token);return super.executeProfileAction(choice,ledger,context);}
}
