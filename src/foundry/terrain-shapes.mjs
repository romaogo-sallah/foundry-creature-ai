function rotate(x,y,cx,cy,degrees){
  const angle=degrees*Math.PI/180,dx=x-cx,dy=y-cy;
  return [cx+dx*Math.cos(angle)-dy*Math.sin(angle),cy+dx*Math.sin(angle)+dy*Math.cos(angle)];
}

export function drawingShape(drawing){
  const {x,y,rotation=0,shape}=drawing;
  if(shape.type==='r')return {type:'rectangle',x:x+shape.width/2,y:y+shape.height/2,width:shape.width,height:shape.height,anchorX:0.5,anchorY:0.5,rotation,hole:false};
  if(shape.type==='e')return {type:'ellipse',x:x+shape.width/2,y:y+shape.height/2,radiusX:shape.width/2,radiusY:shape.height/2,rotation,hole:false};
  if(shape.type!=='p'||shape.points.length<6)throw new Error('Only area drawings can become terrain regions');
  const points=[];
  for(let i=0;i<shape.points.length;i+=2)points.push(...rotate(x+shape.points[i],y+shape.points[i+1],x+shape.width/2,y+shape.height/2,rotation));
  if(points[0]===points.at(-2)&&points[1]===points.at(-1))points.splice(-2);
  return {type:'polygon',points,hole:false};
}

export function tileShape(tile){
  return {type:'rectangle',x:tile.x+tile.width/2,y:tile.y+tile.height/2,width:tile.width,height:tile.height,anchorX:0.5,anchorY:0.5,rotation:tile.rotation??0,hole:false};
}
