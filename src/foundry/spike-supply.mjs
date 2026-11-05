const ns='foundry-creature-ai',day=24*60*60,limit=12,locks=new Map();
const now=()=>game.time?.worldTime??0;
export function quillSupply(actor){
  const spent=(actor.getFlag(ns,'quills')?.spent??[]).filter(e=>e.time>now()-day);
  return {remaining:Math.max(0,limit-spent.reduce((sum,e)=>sum+e.count,0)),spent};
}
async function serial(actor,operation){
 const previous=locks.get(actor.uuid)??Promise.resolve(),task=previous.catch(()=>{}).then(operation);
 locks.set(actor.uuid,task);try{return await task;}finally{if(locks.get(actor.uuid)===task)locks.delete(actor.uuid);}
}
function assertGM(){if(!game.user.isGM||game.users.activeGM?.id!==game.user.id)throw new Error('Only the active GM can change quill resources');}
export function consumeSpikes(actor,count){return serial(actor,async()=>{
 assertGM();const supply=quillSupply(actor);
 if(!Number.isInteger(count)||count<1||count>2||supply.remaining<count)throw new Error('Not enough spikes remain for this attack');
 await actor.setFlag(ns,'quills',{spent:[...supply.spent,{time:now(),count}]});
});}
export function setSpikesRemaining(actor,count){return serial(actor,async()=>{
 assertGM();if(!Number.isInteger(count)||count<0||count>limit)throw new Error('Spikes remaining must be a whole number from 0 to 12');
 await actor.setFlag(ns,'quills',{spent:count===limit?[]:[{time:now(),count:limit-count}]});
});}
