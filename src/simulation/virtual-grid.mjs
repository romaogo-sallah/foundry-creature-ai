import {tileDistance} from '../dawnsbury/chooser.mjs';

const DIRECTIONS=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
export const cellKey=cell=>`${cell.x},${cell.y}`;

function point(value){
  if(Array.isArray(value)&&value.length===2)return {x:value[0],y:value[1]};
  if(value&&Number.isInteger(value.x)&&Number.isInteger(value.y))return {x:value.x,y:value.y};
  throw new Error('Grid cells need integer x/y coordinates');
}

/** A deterministic square-grid battlefield independent from Foundry and PIXI. */
export class VirtualGrid {
  constructor({width,height,blocked=[],cover=[],difficult=[],hazards={}}){
    if(!Number.isInteger(width)||width<2||!Number.isInteger(height)||height<2)throw new Error('Virtual grid needs width/height >= 2');
    this.width=width;this.height=height;
    this.blocked=new Set(blocked.map(value=>cellKey(point(value))));
    this.cover=new Set(cover.map(value=>cellKey(point(value))));
    this.difficult=new Set(difficult.map(value=>cellKey(point(value))));
    this.hazards=new Map(Object.entries(hazards).map(([key,value])=>[key,Number(value)]));
    for(const key of [...this.blocked,...this.cover,...this.difficult,...this.hazards.keys()]){
      const [x,y]=key.split(',').map(Number);if(!this.contains({x,y}))throw new Error(`Terrain cell ${key} is outside the virtual grid`);
    }
  }
  contains(cell){return cell.x>=0&&cell.y>=0&&cell.x<this.width&&cell.y<this.height;}
  isBlocked(cell){return !this.contains(cell)||this.blocked.has(cellKey(cell));}
  terrain(cell){const key=cellKey(cell);return {blocked:this.blocked.has(key),cover:this.cover.has(key),
    difficult:this.difficult.has(key),hazard:this.hazards.get(key)??0};}

  /** Center-to-center supercover cells. Endpoints are included. */
  ray(fromValue,toValue){
    const from=point(fromValue),to=point(toValue),cells=[];
    let x=from.x,y=from.y;const dx=to.x-from.x,dy=to.y-from.y,nx=Math.abs(dx),ny=Math.abs(dy),sx=Math.sign(dx),sy=Math.sign(dy);
    let ix=0,iy=0;cells.push({x,y});
    while(ix<nx||iy<ny){
      const tx=(1+2*ix)*ny,ty=(1+2*iy)*nx;
      if(tx===ty){x+=sx;y+=sy;ix++;iy++;}
      else if(tx<ty){x+=sx;ix++;}
      else {y+=sy;iy++;}
      cells.push({x,y});
    }
    return cells;
  }

  sight(from,to){
    const cells=this.ray(from,to),between=cells.slice(1,-1),blocked=between.some(cell=>this.isBlocked(cell));
    const cover=!blocked&&cells.slice(1).some(cell=>this.cover.has(cellKey(cell)));
    return {lineOfSight:!blocked,lineOfEffect:!blocked,coverBonus:cover?2:0,cells};
  }

  distanceFeet(from,to){return tileDistance(point(from),point(to))*5;}

  #edgeAllowed(from,to){
    if(this.isBlocked(to))return false;
    const dx=to.x-from.x,dy=to.y-from.y;
    // Do not squeeze through a corner where both adjoining squares are solid.
    return !dx||!dy||!(this.isBlocked({x:from.x+dx,y:from.y})&&this.isBlocked({x:from.x,y:from.y+dy}));
  }

  /**
   * Enumerate cheapest destinations inside one movement action. Alternating
   * PF2e diagonals are represented by parity in the Dijkstra state.
   */
  reachable(startValue,{speed=25,occupied=new Map(),allies=new Set(),moverId=null}={}){
    const start=point(startValue),states=new Map(),queue=[{cell:start,cost:0,diagonals:0,path:[],risk:0}],bestCells=new Map();
    states.set(`${cellKey(start)}|0`,0);
    while(queue.length){
      queue.sort((a,b)=>a.cost-b.cost||a.risk-b.risk||cellKey(a.cell).localeCompare(cellKey(b.cell)));
      const current=queue.shift(),stateKey=`${cellKey(current.cell)}|${current.diagonals%2}`;
      if(current.cost!==states.get(stateKey))continue;
      for(const [dx,dy]of DIRECTIONS){
        const cell={x:current.cell.x+dx,y:current.cell.y+dy};if(!this.#edgeAllowed(current.cell,cell))continue;
        const occupant=occupied.get(cellKey(cell));if(occupant&&occupant!==moverId&&!allies.has(occupant))continue;
        const diagonal=Boolean(dx&&dy),diagonals=current.diagonals+Number(diagonal);
        const base=diagonal?(current.diagonals%2?10:5):5,step=this.difficult.has(cellKey(cell))?base*2:base;
        const cost=current.cost+step;if(cost>speed)continue;
        const next={cell,cost,diagonals,path:[...current.path,cell],risk:current.risk+(this.hazards.get(cellKey(cell))??0)};
        const key=`${cellKey(cell)}|${diagonals%2}`,prior=states.get(key);
        if(prior!==undefined&&prior<=cost)continue;states.set(key,cost);queue.push(next);
        // Allies can be crossed but cannot be used as a destination.
        if(!occupant||occupant===moverId){const old=bestCells.get(cellKey(cell));if(!old||cost<old.cost||cost===old.cost&&next.risk<old.risk)bestCells.set(cellKey(cell),next);}
      }
    }
    return [...bestCells.values()];
  }

  /** Shortest movement cost in squares to any goal; Infinity means disconnected. */
  routeDistance(startValue,goals,{occupied=new Map(),allies=new Set(),moverId=null,maxCost=10000}={}){
    const start=point(startValue),wanted=new Set(goals.map(value=>cellKey(point(value))));if(wanted.has(cellKey(start)))return 0;
    const queue=[{cell:start,cost:0,diagonals:0}],seen=new Map([[`${cellKey(start)}|0`,0]]);
    while(queue.length){
      queue.sort((a,b)=>a.cost-b.cost);const current=queue.shift();
      for(const [dx,dy]of DIRECTIONS){const cell={x:current.cell.x+dx,y:current.cell.y+dy};if(!this.#edgeAllowed(current.cell,cell))continue;
        const occupant=occupied.get(cellKey(cell));if(occupant&&occupant!==moverId&&!allies.has(occupant)&&!wanted.has(cellKey(cell)))continue;
        const diagonal=Boolean(dx&&dy),diagonals=current.diagonals+Number(diagonal),cost=current.cost+(diagonal?(current.diagonals%2?2:1):1);
        if(cost>maxCost)continue;if(wanted.has(cellKey(cell)))return cost;
        const key=`${cellKey(cell)}|${diagonals%2}`,old=seen.get(key);if(old!==undefined&&old<=cost)continue;
        seen.set(key,cost);queue.push({cell,cost,diagonals});
      }
    }return Infinity;
  }

  render(actors=[]){
    const tokens=new Map(actors.filter(actor=>actor.hp>0).map(actor=>[cellKey(actor.position),actor.glyph??actor.id[0].toUpperCase()]));
    const rows=[];for(let y=0;y<this.height;y++){let row='';for(let x=0;x<this.width;x++){const key=`${x},${y}`;
      row+=tokens.get(key)??(this.blocked.has(key)?'#':this.hazards.has(key)?'^':this.difficult.has(key)?'~':this.cover.has(key)?'+':'.');}rows.push(row);}
    return rows.join('\n');
  }
}

export function gridFromAscii(rows,{hazardDamage=6}={}){
  if(!Array.isArray(rows)||!rows.length||rows.some(row=>typeof row!=='string'||row.length!==rows[0].length))throw new Error('ASCII grid rows need equal width');
  const terrain={width:rows[0].length,height:rows.length,blocked:[],cover:[],difficult:[],hazards:{}};
  const markers=new Map();
  rows.forEach((row,y)=>[...row].forEach((symbol,x)=>{const cell={x,y},key=cellKey(cell);
    if(symbol==='#')terrain.blocked.push(cell);else if(symbol==='+')terrain.cover.push(cell);else if(symbol==='~')terrain.difficult.push(cell);
    else if(symbol==='^')terrain.hazards[key]=hazardDamage;else if(symbol!=='.'&&symbol!==' ')markers.set(symbol,cell);
  }));
  return {grid:new VirtualGrid(terrain),markers};
}
