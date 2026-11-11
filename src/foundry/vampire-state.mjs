const ns='foundry-creature-ai';
export const vampireAbility=(actor,slug)=>(actor?.itemTypes?.action??[]).find(i=>(i.slug??i.system?.slug)===slug);
export const isTrueVampire=actor=>Boolean(vampireAbility(actor,'vampire-true-mist-escape')&&vampireAbility(actor,'vampire-true-turn-to-mist'));
export const vampireState=actor=>actor?.getFlag?.(ns,'vampire')??actor?.flags?.[ns]?.vampire??{};
export const escapingMist=actor=>Boolean(vampireState(actor).escape&&!vampireState(actor).destroyed&&
 (vampireState(actor).expiresAt??Infinity)>(globalThis.game?.time?.worldTime??0));
export const movingMist=actor=>escapingMist(actor)&&!vampireState(actor).escaped;
export const retreatingMist=actor=>vampireForm(actor)==='mist'&&!escapingMist(actor)&&Boolean(vampireState(actor).retreat);
export const pendingMistEscape=actor=>isTrueVampire(actor)&&actor.hitPoints?.value<=0&&!vampireState(actor).destroyed&&!vampireState(actor).staked&&!vampireState(actor).coffin&&!vampireState(actor).escapeTriggered&&!escapingMist(actor);
export const vampireForm=actor=>vampireState(actor).form??'vampire';
export const activeVampireBody=actor=>isTrueVampire(actor)&&!vampireState(actor).destroyed&&!escapingMist(actor);
