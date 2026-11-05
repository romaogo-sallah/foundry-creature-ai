const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderTacticalMap(field,nameOf=id=>id){
  const {first,last}=field.bounds,width=last.x-first.x+3,height=last.y-first.y+3;
  const cells=[...field.cells.values()].map(cell=>{
    const hue=Math.max(0,Math.min(120,(cell.positionValue+1.5)*40-(cell.enemyArrival<=1?30:0)));
    const arrival=Number.isFinite(cell.enemyArrival)?`${cell.enemyArrival.toFixed(1)} movement actions`:'beyond the forecast horizon';
    return `<rect x="${cell.x}" y="${cell.y}" width="1" height="1" fill="hsl(${hue} 65% 45%)" stroke="#ffffff33" stroke-width=".02"><title>${cell.x},${cell.y}: enemy arrival ${arrival}; safe space ${cell.safeSpace} squares; safe exits ${cell.exits}</title></rect>`;
  }).join('');
  const walls=field.barriers.map(([x,y,x2,y2])=>`<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="#ddd" stroke-width=".08"/>`).join('');
  const enemies=field.threats.map(t=>`<rect x="${t.cell.x}" y="${t.cell.y}" width="${t.width??1}" height="${t.height??1}" fill="#ff000044" stroke="#ff6666" stroke-width=".07"><title>Known or remembered ${escape(nameOf(t.id))}</title></rect>`).join('');
  const origin=field.origin?`<circle cx="${field.origin.x+.5}" cy="${field.origin.y+.5}" r=".33" fill="none" stroke="#53baff" stroke-width=".1"/>`:'';
  return `<p>Round ${field.round}. Last calculated snapshot. Blue circle: scout; red outlines: known or remembered opponents. Green: escape space; red: restricted or interceptable. Hover a square for estimates.</p>
    <svg role="img" aria-label="Scout tactical grid" viewBox="${first.x-1} ${first.y-1} ${width} ${height}" style="width:100%;max-height:65vh;background:#222">${cells}${walls}${enemies}${origin}</svg>
    <p>Only nearby evaluated squares are colored. Lines show blocked grid connections. ${field.cropped?'The map is bounded around this scout. ':''}Arrival times use a bounded movement estimate, not a guarantee of enemy actions.</p>`;
}
