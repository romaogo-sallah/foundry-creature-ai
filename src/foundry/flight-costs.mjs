export function flySpeed(actor){
  const speed=actor.system.movement?.speeds?.fly;
  const prepared=speed?.total??speed?.value;
  const other=actor.system.attributes?.speed?.otherSpeeds?.find(speed=>speed.type==='fly');
  const legacy=other?.total??other?.value;
  const value=prepared??legacy;
  return Number.isFinite(value)&&value>0?value:0;
}
export function flightStepCost(base,from,to,distance,step=5){
  if(!Number.isFinite(base))return base;
  if(to.k>from.k)return Math.max(base,distance+step);
  if(to.k<from.k&&to.i===from.i&&to.j===from.j)return base<=distance/2?base:base/2;
  return base;
}
let installed=false;
export function installFlightCosts(){
  if(installed)return;
  libWrapper.register('foundry-creature-ai','CONFIG.Token.objectClass.prototype._getMovementCostFunction',function(wrapped,...args){
    const native=wrapped(...args),document=this.document;
    return (from,to,distance,segment)=>{
      const base=native?.(from,to,distance,segment)??distance;
      return segment.action==='fly'&&flySpeed(document.actor)&&canvas.grid.type===1&&canvas.grid.distance===5?
        flightStepCost(base,from,to,distance):base;
    };
  },'WRAPPER');
  installed=true;
}
