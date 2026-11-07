export async function resistSpellDisruption(actor,token){
 const steady=[...actor.itemTypes.action??[],...actor.itemTypes.feat??[]].some(a=>(a.slug??a.name.toLowerCase().replaceAll(' ','-'))==='steady-spellcasting');
 if(!steady)return false;
 const roll=await new Roll('1d20').evaluate();await roll.toMessage({speaker:ChatMessage.getSpeaker({token:token.document}),flavor:'Steady Spellcasting: DC 15',flags:{'foundry-creature-ai':{managed:true}}});return roll.total>=15;
}
export function castingResourceReady(entry,spell,{rank=spell.rank,slotId}={}){
 if(spell.atWill||spell.isCantrip)return true;
 const mode=entry.system.prepared.value,slot=entry.system.slots?.[`slot${rank}`];
 if(mode==='prepared'&&!entry.system.prepared.flexible)return Object.entries(slot?.prepared??{}).some(([index,p])=>(slotId==null||Number(index)===slotId)&&p.id===spell.id&&!p.expended);
 if(mode==='innate')return spell.system.location.uses?.value>0;
 if(mode==='focus')return entry.actor.system.resources.focus.value>=(spell.system.cast.focusPoints??1);
 return slot?.value>0;
}
