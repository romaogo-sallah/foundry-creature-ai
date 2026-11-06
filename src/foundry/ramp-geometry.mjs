export const RAMP_BEHAVIOR_TYPE='pf2e-tactical-movement.ramp';
export const RAMP_DIRECTIONS={east:'East →',southeast:'Southeast ↘',south:'South ↓',southwest:'Southwest ↙',west:'West ←',northwest:'Northwest ↖',north:'North ↑',northeast:'Northeast ↗'};
const bearings={east:0,southeast:45,south:90,southwest:135,west:180,northwest:225,north:270,northeast:315};
const ns='foundry-creature-ai';
export function validRamp(ramp){
  return Boolean(ramp&&[ramp.from,ramp.to].every(p=>p&&['x','y','elevation'].every(key=>Number.isFinite(p[key])))&&
    Math.hypot(ramp.to.x-ramp.from.x,ramp.to.y-ramp.from.y)>0.01);
}
export function validateRampSettings(settings){
  if(!settings||!Number.isFinite(settings.lowerElevation)||!Number.isFinite(settings.upperElevation)||settings.upperElevation<=settings.lowerElevation)
    throw new Error('The upper elevation must be greater than the lower elevation. Use finite elevations in scene distance units.');
  if(!Object.hasOwn(bearings,settings.direction))throw new Error('Choose a valid uphill direction.');
  return {lowerElevation:settings.lowerElevation,upperElevation:settings.upperElevation,direction:settings.direction};
}
function projection(shape,axis){
  const dot=(x,y)=>x*axis.x+y*axis.y,angle=(shape.rotation??0)*Math.PI/180;
  const rotate=(x,y)=>[shape.x+x*Math.cos(angle)-y*Math.sin(angle),shape.y+x*Math.sin(angle)+y*Math.cos(angle)];
  if(shape.type==='polygon'){
    const values=[];for(let i=0;i<shape.points.length;i+=2)values.push(dot(shape.points[i],shape.points[i+1]));
    return values.length?[Math.min(...values),Math.max(...values)]:null;
  }
  if(shape.type==='rectangle'){
    const left=-(shape.anchorX??0)*shape.width,top=-(shape.anchorY??0)*shape.height;
    const values=[[left,top],[left+shape.width,top],[left,top+shape.height],[left+shape.width,top+shape.height]].map(([x,y])=>dot(...rotate(x,y)));
    return [Math.min(...values),Math.max(...values)];
  }
  if(['circle','ellipse'].includes(shape.type)){
    const rx=shape.radius??shape.radiusX,ry=shape.radius??shape.radiusY;
    const x=axis.x*Math.cos(angle)+axis.y*Math.sin(angle),y=axis.y*Math.cos(angle)-axis.x*Math.sin(angle);
    const radius=Math.hypot(rx*x,ry*y),center=dot(shape.x,shape.y);return [center-radius,center+radius];
  }
  return null;
}
export function rampFromSettings(region,settings){
  const value=validateRampSettings(settings),angle=bearings[value.direction]*Math.PI/180,axis={x:Math.cos(angle),y:Math.sin(angle)},side={x:-axis.y,y:axis.x};
  const shapes=(region.shapes??[]).filter(shape=>!shape.hole);
  // Grid-based templates and exotic shapes need native conversion first. Never
  // guess a slope from unsupported geometry or fall back to a stale legacy flag.
  if(shapes.some(shape=>shape.gridBased))throw new Error('Ramp regions need ordinary rectangle, polygon, ellipse or circle shapes, without grid-based geometry.');
  const along=shapes.map(shape=>projection(shape,axis)),across=shapes.map(shape=>projection(shape,side));
  if(!along.length||along.some(range=>!range)||across.some(range=>!range))throw new Error('Draw a rectangle, polygon, ellipse or circle Region for this ramp.');
  const low=Math.min(...along.map(range=>range[0])),high=Math.max(...along.map(range=>range[1]));
  const mid=(Math.min(...across.map(range=>range[0]))+Math.max(...across.map(range=>range[1])))/2;
  const point=(distance,elevation)=>({x:axis.x*distance+side.x*mid,y:axis.y*distance+side.y*mid,elevation});
  const ramp={from:point(low,value.lowerElevation),to:point(high,value.upperElevation)};
  if(!validRamp(ramp))throw new Error('The ramp Region must have a nonzero length in its uphill direction.');
  return ramp;
}
export function rampConfig(region,{includeDisabled=false}={}){
  if(region.hidden&&!includeDisabled)return null;
  const behaviors=(region.behaviors?.contents??[]).filter(behavior=>behavior.type===RAMP_BEHAVIOR_TYPE);
  if(behaviors.length){
    const behavior=includeDisabled?behaviors[0]:behaviors.find(b=>!b.disabled);if(!behavior)return null;
    try{return rampFromSettings(region,behavior.system);}catch{return null;}
  }
  const legacy=region.flags?.[ns]?.ramp;return validRamp(legacy)?legacy:null;
}
