const fields=['x','y','elevation','level','width','height','depth','shape','action','snapped','explicit','checkpoint','intermediate'];

// Movement API waypoints may omit unchanged fields. Capture user intent before
// native regionalization adds fractional terrain-boundary control points.
export function requestedMovementPath(document,waypoints){
  const source=document._source??document;
  let previous=Object.fromEntries(fields.filter(key=>source[key]!==undefined).map(key=>[key,source[key]]));
  previous.action=document.movementAction??'walk';
  const origin={...previous};
  const path=waypoints.map(point=>{
    const next=Object.fromEntries(fields.filter(key=>point[key]!==undefined).map(key=>[key,point[key]]));
    for(const key of ['x','y','elevation','level','width','height','depth','shape','action'])if(next[key]===undefined&&previous[key]!==undefined)next[key]=previous[key];
    previous=next;return next;
  });
  return [origin,...path];
}
