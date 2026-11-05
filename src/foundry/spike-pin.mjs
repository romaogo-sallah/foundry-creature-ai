const ns='foundry-creature-ai';
export function spikePinData(adapter){
 return {name:'Spike Volley — Pinned (Escape DC 23)',type:'effect',img:'icons/weapons/ammunition/arrow-broadhead-white.webp',
  system:{slug:'creature-ai-spike-pin',description:{value:'<p>Immobilized by Spike Volley. Escape or Force Open DC 23 ends this pin. Delete this effect after a successful manual check.</p><p>[[/act escape dc=23]] · [[/act force-open dc=23]]</p>'},
   duration:{unit:'unlimited',value:-1,expiry:null,sustained:false},level:{value:adapter.actor.level},traits:{value:[]},tokenIcon:{show:true},
   context:{origin:{actor:adapter.actor.uuid,token:adapter.token.document.uuid,item:adapter.parts().volley.uuid,spellcasting:null,rollOptions:[]}},
   rules:[{key:'GrantItem',uuid:'Compendium.pf2e.conditionitems.Item.eIcWbB5o3pP6OIMe',inMemoryOnly:true}]},
  flags:{[ns]:{restraint:'spike-pin',escapeDC:23}}};
}
export async function applySpikePin(adapter,target){
 if(target.actor.itemTypes.effect.some(effect=>effect.flags?.[ns]?.restraint==='spike-pin'))return;
 await target.actor.createEmbeddedDocuments('Item',[spikePinData(adapter)]);
}
