import {PF2eSpellcasterAdapter} from './spellcaster-adapter.mjs';
import {casterCatalog} from './spell-catalog.mjs';
import {preparedNPCStrikes} from './basic-npc-adapter.mjs';
import {casterTurnCandidates} from '../framework/caster-planning.mjs';
import {chooseTacticalAction} from '../framework/tactical-behaviors.mjs';
import {executeSpell} from './spellcasting.mjs';
import {sustainCast} from './ongoing-spells.mjs';
// Attach spell capabilities to a taught martial/flying kit as well as the
// generic caster fallback. Creature identity and its native abilities survive.
export function attachSpellcastingSystem(adapter){
 adapter.hasSpellcasting=Boolean(adapter.actor.itemTypes?.spell?.length);
 if(!adapter.hasSpellcasting||adapter instanceof PF2eSpellcasterAdapter||adapter.profileId==='goblin-pyro')return adapter;
 const driver=new PF2eSpellcasterAdapter(adapter.token,adapter.profile,{reactions:adapter.reactions});
 const parts=adapter.parts.bind(adapter);
 adapter.parts=()=>{const base=parts(),catalog=casterCatalog(adapter.actor);return {...base,...catalog,entry:catalog.entries[0],native:base.native??preparedNPCStrikes(adapter.actor),
  abilityNames:[...base.abilityNames??[],...catalog.spells.map(s=>s.name),'Sustain'],unsupported:[...base.unsupported??[],...catalog.unsupported.map(s=>`${s.name}: ${s.reason}`)]};};
 driver.parts=()=>adapter.parts();
 const snapshot=adapter.snapshot.bind(adapter),candidates=adapter.candidates.bind(adapter),execute=adapter.executeProfileAction.bind(adapter),record=adapter.recordOutcome.bind(adapter);
 adapter.snapshot=async(ledger,options)=>driver.enrichCasterState(await snapshot(ledger,options),ledger,options);
 adapter.candidates=state=>[...candidates(state),...casterTurnCandidates(state,{actions:s=>driver.casterActions(s).filter(c=>['castSpell','sustainSpell'].includes(c.kind))})];
 adapter.decide=state=>{const d=chooseTacticalAction(adapter.candidates(state),state,{actionsRemaining:state.actionsRemaining,threatened:state.self.threatened});return {...d,diagnostics:{...state.diagnostics,...d.diagnostics}};};
 adapter.executeProfileAction=(choice,ledger,context)=>choice.kind==='castSpell'?executeSpell(adapter,choice,ledger,context):choice.kind==='sustainSpell'?sustainCast(adapter.actor,choice.castId):execute(choice,ledger,context);
 adapter.recordOutcome=async(choice,ledger,result)=>{await record(choice,ledger,result);if(choice.kind==='castSpell')await driver.recordOutcome(choice,ledger,result);};
 return adapter;
}
