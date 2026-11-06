import { clearAttackPath, clearSightPath } from './attack-path.mjs';

// Temporary RegionDocuments use Foundry 14's own grid/coverage geometry. They
// are never saved by planning; execution saves only the selected spell area.
export function spellRegion(shapes, caster) {
  return new CONFIG.Region.documentClass({ name: 'Spell area preview', shapes,
    levels: caster.document.level ? [caster.document.level] : [],
    elevation: { bottom: caster.document.elevation, top: caster.document.elevation + 5 } }, { parent: caster.document.parent });
}
export function inSpellArea(token, region, position) {
  const source = position ?? token.document._source ?? token.document;
  const native = token.document.testInsideRegion ? token.document : canvas.tokens.get(token.id)?.document;
  if (!native?.testInsideRegion) throw new Error('Foundry token/Region coverage API is unavailable');
  return native.testInsideRegion(region, source);
}
export function sameSpellLevel(caster, token) {
  return token.document.level === caster.document.level && token.document.elevation === caster.document.elevation;
}
export function coneShapes(caster, position = caster.document,range=15) {
  const size = canvas.grid.size, width = caster.document.width * size, height = caster.document.height * size;
  return Array.from({ length: 8 }, (_, i) => {
    const angle = i * 45, rad = angle * Math.PI / 180;
    // The cone starts at a corner on the appropriate edge of the footprint.
    const x = position.x + (Math.cos(rad) >= 0 ? width : 0), y = position.y + (Math.sin(rad) >= 0 ? height : 0);
    return { id: `cone:${i}`, shapes: [{ type: 'cone', x, y, radius: size * range/5, angle: 90, rotation: angle, gridBased: true }] };
  });
}
function groundTarget(caster, x, y) {
  const document = { ...caster.document, x, y, width: 1, height: 1,
    parent: caster.document.parent, getVisionOrigin: undefined, getMovementOrigin: undefined };
  return { actor: caster.actor, document, center: { x: x + canvas.grid.size / 2, y: y + canvas.grid.size / 2 } };
}
export function greaseShapes(adapter, enemies, position = adapter.actualWaypoint(), prepare = false) {
  const caster = adapter.token, size = canvas.grid.size, areas = new Map();
  const origin = { x: position.x + caster.w / 2, y: position.y + caster.h / 2 };
  function add(left,top,approach) {
    const key = `${left},${top}`;
    if (!areas.has(key)) {
      const squares = [0,1].flatMap(x => [0,1].map(y => groundTarget(caster, left + x * size, top + y * size)));
      const rect = canvas.dimensions.sceneRect;
      if (left < rect.x || top < rect.y || left + size * 2 > rect.x + rect.width || top + size * 2 > rect.y + rect.height) return;
      if (squares.some(square => {
        const dx = Math.abs(square.center.x - origin.x) / size, dy = Math.abs(square.center.y - origin.y) / size;
        const distance = Math.max(dx,dy) + Math.floor(Math.min(dx,dy) / 2);
        return distance * 5 > 30 || !clearAttackPath(caster, square, origin) || !clearSightPath(caster, square, origin);
      })) return;
      areas.set(key,{ id: `grease:${key}`, shapes: [{ type: 'rectangle', x: left, y: top, width: size * 2, height: size * 2 }], approaches: [] });
    }
    if (approach && !areas.get(key).approaches.some(enemy => enemy.id === approach.id)) areas.get(key).approaches.push(approach);
  }
  for (const enemy of enemies) {
    if (enemy.awareness?.searchRequired&&!enemy.awareness.allowAttackEstimate&&!enemy.awareness.attackOnSight) continue;
    const target = adapter.perceivedSpellTarget(enemy), cell = adapter.cell(target.document);
    for (const dx of [-1,0]) for (const dy of [-1,0]) add((cell.x + dx) * size,(cell.y + dy) * size);
    // Preparation predicts only a clear direct approach by an observed melee
    // foe. It grants no knowledge of Undetected positions or future decisions.
    if (!prepare || enemy.tactics?.role !== 'melee' || enemy.awareness?.state !== 'observed' ||
      enemy.lineOfSight === false || enemy.lineOfEffect === false || enemy.distance <= 30 || enemy.distance > 60 ||
      enemy.greased || enemy.airborne || enemy.immobilized || !target.constrainMovementPath) continue;
    const start = adapter.cell(position), length = Math.max(Math.abs(cell.x-start.x),Math.abs(cell.y-start.y));
    for (let step=2;step<Math.min(length,6);step++) {
      const goal = {x:Math.round(start.x+(cell.x-start.x)*step/length),y:Math.round(start.y+(cell.y-start.y)*step/length)};
      const routeLength = Math.max(Math.abs(cell.x-goal.x),Math.abs(cell.y-goal.y));
      const path = Array.from({length:routeLength+1},(_,i)=>({x:Math.round(cell.x+(goal.x-cell.x)*i/routeLength)*size,
        y:Math.round(cell.y+(goal.y-cell.y)*i/routeLength)*size,elevation:target.document.elevation,level:target.document.level,action:'walk',snapped:true}));
      // Native constraints use this foe's footprint, rather than assuming an
      // ogre can follow the caster through a one-square passage.
      if (target.constrainMovementPath(path,{ignoreWalls:false,ignoreCost:true})[1]) continue;
      for (const dx of [-1,0]) for (const dy of [-1,0]) add((goal.x+dx)*size,(goal.y+dy)*size,enemy);
    }
  }
  return [...areas.values()];
}

export function describeSpellAreas(adapter, spell, state, bystanders, position) {
  const caster = adapter.token, origin = position ? { x: position.x + caster.w / 2, y: position.y + caster.h / 2 } : caster.center;
  const shapes = ['wall-of-fire','floating-flame'].includes(spell.slug)?fireAreaShapes(adapter,spell,state.enemies,position):spell.slug==='grease'?greaseShapes(adapter,state.enemies,position,state.casterDefense?.enabled&&!state.casterDefense.preparedGrease):
    spell.area?.type==='line'?lineShapes(caster,position,spell.area.value):spell.area?.type==='burst'?burstShapes(adapter,spell,state.enemies,position):coneShapes(caster,position,spell.area?.value??15);
  return shapes.map(area => {
    const region = spellRegion(area.shapes, caster);
    const included = token => sameSpellLevel(caster, token) && inSpellArea(token, region) && clearAttackPath(caster, token, origin);
    const others=bystanders.filter(included);
    if(inSpellArea(caster,region,position))others.push(caster);
    return { ...area, enemies: state.enemies.filter(enemy => enemy.awareness?.detection!=='undetected'&&included(adapter.perceivedSpellTarget(enemy))),
      bystanders: others.map(token => ({ id: token.id, prone: token.actor.hasCondition('prone'),
        immobilized: token.actor.hasCondition('immobilized'), greased: state.bystanderGrease?.[token.id] ?? false,
        airborne: token.document.movementAction === 'fly' })) };
  }).filter(area => area.enemies.length || area.approaches?.length);
}
export function fireAreaShapes(adapter,spell,enemies,position=adapter.actualWaypoint()){
 const size=canvas.grid.size,result=[],rect=canvas.dimensions.sceneRect;
 for(const enemy of enemies.filter(e=>e.lineOfSight!==false&&e.awareness?.detection!=='undetected')){
  const target=adapter.perceivedSpellTarget(enemy),x=Math.floor(target.center.x/size)*size,y=Math.floor(target.center.y/size)*size;
  if(Math.hypot(x-position.x,y-position.y)/size*5>spell.range)continue;
  for(const horizontal of spell.slug==='floating-flame'?[true]:[true,false])for(const length of spell.slug==='floating-flame'?[1]:[3,6,12]){
   const shape={type:'rectangle',x:horizontal?x-Math.floor(length/2)*size:x,y:horizontal?y:y-Math.floor(length/2)*size,
    width:horizontal?length*size:size,height:horizontal?size:length*size};
   if(shape.x<rect.x||shape.y<rect.y||shape.x+shape.width>rect.x+rect.width||shape.y+shape.height>rect.y+rect.height)continue;
   const origin={x:position.x+adapter.token.w/2,y:position.y+adapter.token.h/2};let legal=true;
   for(let ox=0;ox<shape.width&&legal;ox+=size)for(let oy=0;oy<shape.height;oy+=size){const ground=groundTarget(adapter.token,shape.x+ox,shape.y+oy);
    if(Math.hypot(ground.center.x-origin.x,ground.center.y-origin.y)/size*5>spell.range||!clearAttackPath(adapter.token,ground,origin)){legal=false;break;}}
   if(!legal)continue;
   result.push({id:`fire:${x},${y}:${horizontal}:${length}`,shapes:[shape]});
  }
 }
 return result;
}

export function lineShapes(caster,position=caster.document,range=30){
 const unit=canvas.grid.size,start={x:position.x+caster.w/2,y:position.y+caster.h/2};
 return Array.from({length:16},(_,index)=>{
  const a=index*Math.PI/8,dx=Math.cos(a),dy=Math.sin(a),distance=range/5*unit,half=unit/2;
  const x=start.x+dx*caster.w/2,y=start.y+dy*caster.h/2;
  return {id:`line:${index}`,shapes:[{type:'polygon',hole:false,points:[x-dy*half,y+dx*half,x+dy*half,y-dx*half,x+dx*distance+dy*half,y+dy*distance-dx*half,x+dx*distance-dy*half,y+dy*distance+dx*half]}]};
 });
}
export function burstShapes(adapter,spell,enemies,position=adapter.actualWaypoint()){
 const caster=adapter.token,size=canvas.grid.size,result=new Map(),origin={x:position.x+caster.w/2,y:position.y+caster.h/2};
 for(const enemy of enemies.filter(e=>e.awareness?.detection!=='undetected')){
  const target=adapter.perceivedSpellTarget(enemy);
  for(const dx of [-1,0,1])for(const dy of [-1,0,1]){
   const x=Math.round(target.center.x/size)*size+dx*size,y=Math.round(target.center.y/size)*size+dy*size;
   const ground=groundTarget(caster,x-size/2,y-size/2);
   if(Math.hypot(x-origin.x,y-origin.y)/size*5>spell.range||!clearAttackPath(caster,ground,origin))continue;
   result.set(`${x},${y}`,{id:`burst:${x},${y}`,shapes:[{type:'ellipse',x,y,radiusX:spell.area.value/5*size,radiusY:spell.area.value/5*size,rotation:0,hole:false}]});
  }
 }
 return [...result.values()];
}
