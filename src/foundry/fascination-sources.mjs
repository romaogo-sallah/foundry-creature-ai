const ns='foundry-creature-ai',queues=new WeakMap(),requests=new WeakMap();
// ConditionManager returns a clone without an embedded ID. sourceId retains
// the canonical compendium UUID and works for both UUID spelling variants.
const normalized=uuid=>typeof uuid==='string'?uuid.replace('.Item.','.'):null;
const nativeConditionSource=()=>normalized(game.pf2e?.ConditionManager?.getCondition?.('fascinated')?.sourceId);
const rules=item=>item?._source?.system?.rules??item?.system?.rules??[];
const directGrant=rule=>rule.key==='GrantItem'&&!rule.ignored&&
  Boolean(nativeConditionSource())&&normalized(rule.uuid)===nativeConditionSource();
const stored=item=>Boolean(item?.id&&item.actor?.items?.get?.(item.id)===item);
function conditions(actor){return actor.conditions?.bySlug?.('fascinated')??actor.getCondition?.('fascinated',{all:true})??[];}
function sourceOf(condition){return condition.appliedBy??condition.actor?.items?.get?.(condition.flags?.pf2e?.grantedBy?.id)??condition;}
function sources(actor){
  const found=new Map();
  for(const condition of conditions(actor)){const source=sourceOf(condition);if(source?.id&&!source.isExpired)found.set(source.id,source);}
  // A GrantItem rule whose predicate is false is not an application. Native
  // preparation already exposes both active and redundant granted conditions.
  return [...found.values()].filter(source=>source.type==='condition'||rules(source).some(directGrant)||conditions(actor).some(c=>sourceOf(c).id===source.id));
}
function subject(source){
  const explicit=source.getFlag?.(ns,'fascinationSubjectId')??source.flags?.[ns]?.fascinationSubjectId;
  if(explicit)return canvas.tokens.get(explicit)?.id??null;
  const origin=source.system?.context?.origin;
  return canvas.tokens.placeables.find(token=>token.document.uuid===origin?.token||token.actor?.uuid===origin?.actor)?.id??null;
}
function grantIndices(parent,children){
  const prepared=parent.rules??[];
  return rules(parent).flatMap((rule,index)=>{
    if(directGrant(rule))return [index];
    const native=prepared.find(r=>r.sourceIndex===index||r._sourceIndex===index);
    return rule.key==='GrantItem'&&children.some(child=>native?.grantedId===child.id||
      rule.flag&&parent.flags?.pf2e?.itemGrants?.[rule.flag]?.id===child.id)?[index]:[];
  });
}
async function retire(actor,source){
  const children=conditions(actor).filter(c=>sourceOf(c).id===source.id),indices=grantIndices(source,children);
  if(source.type!=='condition'&&indices.length){
    const updated=structuredClone(rules(source));for(const index of indices)updated[index].ignored=true;
    await source.update({'system.rules':updated,[`flags.${ns}.supersededFascination`]:true});
  }
  for(const condition of children){
    if(!stored(condition))continue; // Disabling the in-memory grant removed it.
    const parent=sourceOf(condition);
    if(parent!==condition){
      // Detach this grant only. Deleting its parent could remove unrelated
      // spell effects; native cascade/restrict links must not do that either.
      const entries=Object.entries(parent.flags?.pf2e?.itemGrants??{}).filter(([,grant])=>grant.id===condition.id);
      if(entries.length)await parent.update(Object.fromEntries(entries.map(([key])=>[`flags.pf2e.itemGrants.-=${key}`,null])));
      await condition.update({'flags.pf2e.-=grantedBy':null,'system.references.parent':null});
    }
    await actor.deleteEmbeddedDocuments('Item',[condition.id]);
  }
}
export function replaceFascination(actor,preferred,{created=false}={}){
  const requested=preferred?.slug==='fascinated'?sourceOf(preferred):preferred;
  if(!requested||requested.flags?.[ns]?.supersededFascination&&!rules(requested).some(directGrant))return Promise.resolve(null);
  requests.set(actor,requested.id);
  const operation=(queues.get(actor)??Promise.resolve()).catch(()=>{}).then(async()=>{
    if(requests.get(actor)!==requested.id)return null;
    const available=sources(actor),canonical=preferred?.slug==='fascinated'?sourceOf(preferred):preferred;
    const winner=available.find(source=>source.id===canonical?.id);
    if(!winner||winner.flags?.[ns]?.supersededFascination&&!rules(winner).some(directGrant))return null;
    const creationOrder=[...actor.items.keys()],winnerIndex=creationOrder.indexOf(winner.id);
    for(const old of available)if(old.id!==winner.id&&old.id!==requests.get(actor)&&
      // A native batch prepares every item before emitting its create hooks.
      // Its first hook must not disable a later source awaiting its own hook.
      !(created&&creationOrder.indexOf(old.id)>winnerIndex))await retire(actor,old);
    if(requests.get(actor)!==winner.id)return null;
    const previous=actor.getFlag?.(ns,'conditionContext')??{},changed=previous.fascinationSourceId!==winner.id;
    if(changed)await actor.setFlag(ns,'conditionContext',{...previous,fascinationSourceId:winner.id,
      fascinationSubjects:[subject(winner)].filter(Boolean)});
    return winner.id;
  });
  queues.set(actor,operation);void operation.finally(()=>{if(queues.get(actor)===operation)queues.delete(actor);}).catch(()=>{});
  return operation;
}
export function installFascinationSources({reactions,onError}){
  const added=(item,created=false)=>{
    if(game.users.activeGM?.id!==game.user.id||!item.actor||item.isExpired)return;
    if(item.slug!=='fascinated'&&!rules(item).some(directGrant))return;
    void reactions.resolve(()=>replaceFascination(item.actor,item,{created})).catch(onError);
  };
  Hooks.on('createItem',item=>added(item,true));
  Hooks.on('updateItem',(item,changes)=>{
    if(changes.system?.rules||changes['system.rules']||changes.system?.slug==='fascinated')added(item);
  });
}
