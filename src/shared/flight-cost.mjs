// Shared by native rulers/movement and worker route estimates. Any change in
// elevation applies to the whole measured grid step, including diagonals.
export function flightStepCost(base,from,to,distance){
  if(!Number.isFinite(base))return base;
  if(to.k>from.k)return Math.max(base,distance*2);
  if(to.k<from.k)return base<=distance/2?base:base/2;
  return base;
}
