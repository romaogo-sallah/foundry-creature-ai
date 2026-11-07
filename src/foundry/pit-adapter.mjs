import {pitAt} from './pit-geometry.mjs';
import {pitActionChoices,executePitAction} from './pit-actions.mjs';
import {chooseTacticalAction} from '../framework/tactical-behaviors.mjs';
import {flySpeed} from './flight-costs.mjs';
import {resolveFlightFall} from './flight-falling.mjs';
export function attachPitSystem(adapter){
 const prepare=adapter.prepareTurn.bind(adapter);adapter.prepareTurn=async(options={})=>{
  const pit=pitAt(adapter.token.document);if(pit&&Math.abs(adapter.token.document.elevation-pit.rim)<0.1&&!flySpeed(adapter.actor))await resolveFlightFall(adapter.token,{force:true,reactions:adapter.reactions,applyDamage:adapter.config.applyDamage,valid:options.canContinue??(()=>true)});
  return prepare(options);
 };
 const snapshot=adapter.snapshot.bind(adapter),candidates=adapter.candidates.bind(adapter),execute=adapter.execute.bind(adapter),decide=adapter.decide.bind(adapter);
 adapter.snapshot=async(...args)=>{const state=await snapshot(...args);state.pit=pitAt(adapter.token.document);
  state.pitActions=pitActionChoices(adapter.token,state).map(c=>{
   if(['climb','pitStow'].includes(c.kind))return c;
   const before=Math.min(Infinity,...state.enemies.map(e=>e.distance)),after=Math.min(Infinity,...state.enemies.map(e=>adapter.targetAt(adapter.cell(c.destination),adapter.perceivedTarget(e),[],c.destination).distance));
   const value=before-after;if(value<=0)return {...c,legal:false};return {...c,assessment:{value:value+3},scoringTerms:[{label:'Cross a pit to approach a known opponent',contribution:value+3}]};
  });return state;};
 adapter.candidates=state=>[...candidates(state),...(state.pitActions??[])];
 adapter.decide=state=>{
  if(!state.pitActions?.some(c=>c.legal))return decide(state);
  const result=chooseTacticalAction(adapter.candidates(state),state,{actionsRemaining:state.actionsRemaining,bonusMovementActions:state.bonusMovementActions??0});
  return {...result,diagnostics:{...state.diagnostics,...result.diagnostics,turnComplete:result.chosen?.kind==='endTurn'}};
 };
 adapter.execute=(choice,ledger,context={})=>['climb','jump','pitStow'].includes(choice.kind)?executePitAction(adapter.token,choice,{reactions:adapter.reactions,valid:()=> (context.canContinue?.()??true)&&adapter.turnKey()===ledger.turn}):execute(choice,ledger,context);
 return adapter;
}
