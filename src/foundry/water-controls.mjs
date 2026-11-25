import {WATER_BEHAVIOR_TYPE,validateWaterElevations,waterConfig} from './water-geometry.mjs';
import {escapeHTML} from './rules-context.mjs';

export async function configureWater(region,settings){
  if(!game.user?.isGM)throw new Error('Only a GM can configure water.');
  if(!region||region.parent?.id!==canvas.scene?.id)throw new Error('Choose a Region in the viewed scene.');
  const elevation=validateWaterElevations(settings);
  await region.update({elevation});
  const existing=(region.behaviors?.contents??[]).find(behavior=>behavior.type===WATER_BEHAVIOR_TYPE);
  if(existing){await existing.update({disabled:settings.enabled===false});return existing;}
  const [created]=await region.createEmbeddedDocuments('RegionBehavior',[{name:'Water',type:WATER_BEHAVIOR_TYPE,
    disabled:settings.enabled===false,system:{}}]);
  return created;
}

export async function openWaterZones(regionId){
  if(!game.user?.isGM||!canvas.ready)throw new Error('Open a scene as GM first.');
  const regions=canvas.scene.regions.contents;
  if(!regions.length){ui.notifications.info('Draw a Scene Region over the water first, then open Water zones.');return;}
  const region=regions.find(entry=>entry.id===regionId)??canvas.regions?.controlled?.[0]?.document??regions[0];
  const existing=(region.behaviors?.contents??[]).find(entry=>entry.type===WATER_BEHAVIOR_TYPE),saved=waterConfig(region,{includeDisabled:true});
  const value={bottom:saved?.bottom??Math.min(-10,region.elevation?.bottom??-10),top:saved?.top??region.elevation?.top??0};
  const options=Object.fromEntries(regions.map(entry=>[entry.id,entry.name]));
  const answer=await foundry.applications.api.DialogV2.wait({window:{title:'Tactical Rules — Water zones'},
    content:`<p>Draw a Region over the water's horizontal footprint. Its bottom and surface elevations define the swimmable volume. Negative bottom elevations allow swimming below the map's zero elevation.</p>
      <div class="form-group"><label>Region</label><select name="region">${Object.entries(options).map(([id,name])=>`<option value="${escapeHTML(id)}" ${id===region.id?'selected':''}>${escapeHTML(name)}</option>`).join('')}</select></div>
      <p>Click <strong>Load region</strong> before editing another Region's existing values. The behavior can also be disabled from the Region sheet.</p>
      <div class="form-group"><label>Enabled</label><input name="enabled" type="checkbox" ${existing?.disabled?'':'checked'}></div>
      <div class="form-group"><label>Water bottom elevation</label><input name="bottom" type="number" step="any" required value="${value.bottom}"></div>
      <div class="form-group"><label>Water surface elevation</label><input name="top" type="number" step="any" required value="${value.top}"></div>
      <p>Select <strong>Swim</strong> on a creature token to move through this volume. Each action uses the creature's prepared Swim Speed. Fly remains a separate movement mode.</p>`,
    buttons:[{action:'load',label:'Load region',callback:(event,button)=>({action:'load',region:button.form.elements.region.value})},
      {action:'save',label:'Save water',default:true,callback:(event,button)=>{const form=button.form.elements;return {action:'save',region:form.region.value,
        enabled:form.enabled.checked,bottom:form.bottom.value.trim()===''?NaN:Number(form.bottom.value),top:form.top.value.trim()===''?NaN:Number(form.top.value)};}}],rejectClose:false});
  if(!answer)return;if(answer.action==='load')return openWaterZones(answer.region);
  const behavior=await configureWater(regions.find(entry=>entry.id===answer.region),answer);
  ui.notifications.info('Water zone saved. Select Swim on a token to move within it.');return behavior;
}
