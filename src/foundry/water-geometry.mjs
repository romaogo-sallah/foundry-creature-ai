export const WATER_BEHAVIOR_TYPE='water';

const epsilon=0.01;
const source=document=>document?._source??document;
const fields=['x','y','elevation','level','width','height','depth','shape'];

export function validateWaterElevations({bottom,top}){
  bottom=Number(bottom);top=Number(top);
  if(!Number.isFinite(bottom)||!Number.isFinite(top))throw new Error('Water bottom and surface elevations must be finite numbers.');
  if(top<=bottom)throw new Error('Water surface elevation must be higher than its bottom elevation.');
  return {bottom,top};
}

export function waterConfig(region,{includeDisabled=false}={}){
  if(!region)return null;
  const behavior=(region.behaviors?.contents??[]).find(entry=>entry.type===WATER_BEHAVIOR_TYPE&&(includeDisabled||!entry.disabled));
  if(!behavior)return null;
  try{return {...validateWaterElevations(region.elevation??{}),region,behavior};}catch{return null;}
}

export function waterRegions(scene,{includeDisabled=false}={}){
  return (scene?.regions?.contents??[]).map(region=>waterConfig(region,{includeDisabled})).filter(Boolean);
}

function center(document,position){
  return document.getMovementOrigin?.(position)??{
    x:position.x+(position.width??document.width)*document.parent.grid.size/2,
    y:position.y+(position.height??document.height)*document.parent.grid.size/2};
}

export function waterContains(config,document,position){
  if(!config||!document||!position||position.level!==undefined&&config.region.includedInLevel&&!config.region.includedInLevel(position.level))return false;
  const elevation=position.elevation??source(document).elevation;
  if(!Number.isFinite(elevation)||elevation<config.bottom-epsilon||elevation>config.top+epsilon)return false;
  const point=center(document,position),probe=Math.max(config.bottom+epsilon,Math.min(config.top-epsilon,elevation));
  return config.region.testPoint({...point,elevation:probe});
}

export function waterAt(document,position=source(document)){
  return waterRegions(document?.parent).find(config=>waterContains(config,document,position))??null;
}

function movementAction(document,waypoints){
  const actions=new Set(waypoints.map(point=>point.action).filter(Boolean));
  return actions.size===1?[...actions][0]:actions.size?null:document.movementAction;
}

// A Water Region is a bounded 3D volume. Its horizontal shape comes from the
// Region and its bottom/surface come from the Region elevation range. Native
// path completion supplies square-grid and diagonal parity; this validator only
// permits the resulting points while their token origin remains in water.
export function waterMovementPath(document,waypoints,options={}){
  if(options.isUndo||options.isPaste||options.teleport||options.planned||['hud','config','undo','paste'].includes(options.method)||
    !document?.actor?.isOfType?.('creature')||!document.getCompleteMovementPath||!waypoints?.length||movementAction(document,waypoints)!=='swim')return null;
  const origin={...Object.fromEntries(fields.filter(key=>source(document)[key]!==undefined).map(key=>[key,source(document)[key]])),action:'swim',snapped:false};
  if(!waterAt(document,origin))return null;
  let prior=origin;
  const requested=waypoints.map(point=>{const full={...prior,...point,action:'swim'};prior=full;return full;});
  if(requested.some(point=>point.level!==origin.level||['width','height','depth','shape'].some(key=>
    point[key]!==undefined&&origin[key]!==undefined&&point[key]!==origin[key])))return null;
  const complete=document.getCompleteMovementPath([origin,...requested]);
  if(complete.length>1024)throw new Error('Split this Swim movement into shorter paths.');
  const path=complete.map(point=>({...origin,...point,action:'swim'}));
  if(path.length<2)return null;
  for(const point of path)if(!waterAt(document,point))
    throw new Error('Keep the Swim path inside an enabled Water Region and between its bottom and surface elevations.');
  return path;
}
