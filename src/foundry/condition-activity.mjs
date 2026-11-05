const active=new WeakMap();
export const conditionActivityActive=actor=>(active.get(actor)??0)>0;
export async function withConditionActivity(actor,operation){
  active.set(actor,(active.get(actor)??0)+1);
  try{return await operation();}finally{const count=(active.get(actor)??1)-1;if(count)active.set(actor,count);else active.delete(actor);}
}
