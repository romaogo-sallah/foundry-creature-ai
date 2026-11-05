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
export function coneShapes(caster, position = caster.document) {
  const size = canvas.grid.size, width = caster.document.width * size, height = caster.document.height * size;
  return Array.from({ length: 8 }, (_, i) => {
    const angle = i * 45, rad = angle * Math.PI / 180;
    // The cone starts at a corner on the appropriate edge of the footprint.
    const x = position.x + (Math.cos(rad) >= 0 ? width : 0), y = position.y + (Math.sin(rad) >= 0 ? height : 0);
    return { id: `cone:${i}`, shapes: [{ type: 'cone', x, y, radius: size * 3, angle: 90, rotation: angle, gridBased: true }] };
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
  const shapes = spell.slug === 'breathe-fire' ? coneShapes(caster, position) : greaseShapes(adapter, state.enemies, position,
    state.casterDefense?.enabled && !state.casterDefense.preparedGrease);
  return shapes.map(area => {
    const region = spellRegion(area.shapes, caster);
    const included = token => sameSpellLevel(caster, token) && inSpellArea(token, region) && clearAttackPath(caster, token, origin);
    const others=bystanders.filter(included);
    if(spell.slug==='grease'&&inSpellArea(caster,region,position))others.push(caster);
    return { ...area, enemies: state.enemies.filter(enemy => enemy.awareness?.detection!=='undetected'&&included(adapter.perceivedSpellTarget(enemy))),
      bystanders: others.map(token => ({ id: token.id, prone: token.actor.hasCondition('prone'),
        immobilized: token.actor.hasCondition('immobilized'), greased: state.bystanderGrease?.[token.id] ?? false,
        airborne: token.document.movementAction === 'fly' })) };
  }).filter(area => area.enemies.length || area.approaches?.length);
}
