const ns='foundry-creature-ai';
const source='player-sneak';
const changes=new WeakMap();

// A native effect gives owners a visible, removable movement choice. Detection
// remains per observer; enabling this mode never grants Hidden or Undetected.
export const isSneakEffect=item=>item?.type==='effect'&&item.flags?.[ns]?.sneakMode?.source===source;
export const sneakEffects=actor=>(actor?.itemTypes?.effect??[]).filter(isSneakEffect);
export const sneakMode=token=>sneakEffects(token?.actor).some(effect=>effect.isExpired!==true)||Boolean(token?.document.getFlag(ns,'sneakNextMove'));

function effectData(actor){
  return {name:'Sneak',type:'effect',img:'icons/svg/mystery-man.svg',
    system:{slug:'creature-ai-sneak',description:{value:'<p>Your ground movements use Sneak automatically while this effect is active. Each move is a separate one-action Sneak with a new secret Stealth check.</p><p>Move up to half your Speed, or full Speed with Swift Sneak. Start hidden or undetected from the observer and finish with cover or concealment. Legendary Sneak removes the cover/concealment requirement.</p><p>Remove this effect from your Effects panel or sheet, or use Stop Sneak in Player Hide / Sneak, to return to normal movement. Removing the effect does not itself reveal you or spend an action.</p>'},
      duration:{unit:'unlimited',value:-1,expiry:null,sustained:false},level:{value:actor.level??0},
      tokenIcon:{show:true},traits:{value:[]},rules:[]},
    flags:{[ns]:{sneakMode:{source,version:1}}}};
}

export function setSneakMode(token,enabled){
  const actor=token.actor;
  // Linked tokens share the same effect collection. Concurrent activations
  // must not create duplicates or undo a later request to stop sneaking.
  const operation=(changes.get(actor)??Promise.resolve()).catch(()=>{}).then(async()=>{
    const effects=sneakEffects(actor),keep=enabled?effects.find(effect=>effect.isExpired!==true):null;
    const remove=effects.filter(effect=>effect!==keep).map(effect=>effect.id);
    if(remove.length)await actor.deleteEmbeddedDocuments('Item',remove);
    if(enabled&&!keep)await actor.createEmbeddedDocuments('Item',[effectData(actor)]);
    // Migrate the old one-move flag. Removing an effect must remain sufficient
    // to stop Sneak, including on another linked token for the same actor.
    const documents=new Set([token.document,...(game.scenes?.contents??[]).flatMap(scene=>scene.tokens?.contents??[])
      .filter(document=>document.actor===actor||actor.uuid&&document.actor?.uuid===actor.uuid)]);
    for(const document of documents)if(document.getFlag(ns,'sneakNextMove'))await document.setFlag(ns,'sneakNextMove',false);
    if(globalThis.CONFIG?.Token?.movement?.actions?.sneak){
      for(const document of documents)if(typeof document.update==='function'&&
        (enabled&&document.movementAction!=='sneak'||!enabled&&document.movementAction==='sneak'))
        await document.update({movementAction:enabled?'sneak':null});
    }
  });
  changes.set(actor,operation);
  void operation.finally(()=>{if(changes.get(actor)===operation)changes.delete(actor);}).catch(()=>{});
  return operation;
}
