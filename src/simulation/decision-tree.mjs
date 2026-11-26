export function simulationDecisions(report,scenario){
  const names=new Map((scenario?.actors??[]).map(actor=>[actor.id,actor.name??actor.id]));let number=0;
  return (report?.rounds??[]).flatMap(round=>round.turns.flatMap(turn=>turn.decisions.map((decision,turnIndex)=>{
    number++;
    const actor=names.get(decision.actorId)??decision.actorId,target=decision.chosen?.targetId?(names.get(decision.chosen.targetId)??decision.chosen.targetId):null;
    return {id:`decision-${number}`,number,round:round.round,turnIndex,actor,
      label:`${number}. Round ${round.round} - ${actor}: ${decision.chosen?.kind??'no action'}${target?` -> ${target}`:''}`,decision};
  })));
}

export function decisionGraphRecord(decision){
  return {chosenId:decision?.chosen?.id??null,reason:decision?.plan?.reason??decision?.effect?.summary??'',options:decision?.alternatives??[],rejected:decision?.rejected??[],
    tactic:{planId:decision?.plan?.id??null,label:decision?.plan?.label??null,goal:decision?.plan?.goal??null,planningTrace:decision?.trace??null}};
}
