import {RAMP_BEHAVIOR_TYPE,RAMP_DIRECTIONS,rampFromSettings,rampConfig,validateRampSettings} from './ramp-geometry.mjs';
import {escapeHTML} from './rules-context.mjs';
export async function configureRamp(region,settings){
  if(!game.user?.isGM)throw new Error('Only a GM can configure ramps.');
  if(!region||region.parent?.id!==canvas.scene?.id)throw new Error('Choose a Region in the viewed scene.');
  const value=validateRampSettings(settings);rampFromSettings(region,value);
  const existing=(region.behaviors?.contents??[]).find(behavior=>behavior.type===RAMP_BEHAVIOR_TYPE);
  if(existing){await existing.update({system:value,disabled:settings.enabled===false});return existing;}
  const [created]=await region.createEmbeddedDocuments('RegionBehavior',[{name:'Ramp / stairs',type:RAMP_BEHAVIOR_TYPE,disabled:settings.enabled===false,system:value}]);
  return created;
}
export async function openRamps(regionId){
  if(!game.user?.isGM||!canvas.ready)throw new Error('Open a scene as GM first.');
  const regions=canvas.scene.regions.contents;
  if(!regions.length){ui.notifications.info('Draw a Scene Region over the stairs/ramp first, then open Ramps / stairs.');return;}
  const region=regions.find(r=>r.id===regionId)??canvas.regions?.controlled?.[0]?.document??regions[0];
  const existing=(region.behaviors?.contents??[]).find(b=>b.type===RAMP_BEHAVIOR_TYPE),legacy=rampConfig(region,{includeDisabled:true});
  const from=legacy?.from,to=legacy?.to,reverse=from&&to&&from.elevation>to.elevation;
  const angle=from&&to?Math.atan2((to.y-from.y)*(reverse?-1:1),(to.x-from.x)*(reverse?-1:1))*180/Math.PI:0;
  const value=existing?.system??{lowerElevation:legacy?Math.min(from.elevation,to.elevation):0,upperElevation:legacy?Math.max(from.elevation,to.elevation):5,
    direction:Object.keys(RAMP_DIRECTIONS)[(Math.round(angle/45)+8)%8]};
  const options=(entries,current)=>Object.entries(entries).map(([key,label])=>`<option value="${escapeHTML(key)}" ${key===current?'selected':''}>${escapeHTML(label)}</option>`).join('');
  const answer=await foundry.applications.api.DialogV2.wait({window:{title:'Tactical Rules — Ramps / stairs'},
    content:`<p>Draw a Region over the ramp's full width and length. Set its lower and upper elevations and the direction that goes uphill. Walking adjusts elevation along that slope. Platforms use a separate native <strong>Define Surface</strong>.</p>
      <div class="form-group"><label>Region</label><select name="region">${options(Object.fromEntries(regions.map(r=>[r.id,r.name])),region.id)}</select></div>
      <p>Click <strong>Load region</strong> before editing another Region's existing values. A saved behavior can also be edited directly in its Region sheet.</p>
      <div class="form-group"><label>Enabled</label><input name="enabled" type="checkbox" ${existing?.disabled?'':'checked'}></div>
      <div class="form-group"><label>Lower elevation</label><input name="lowerElevation" type="number" step="any" required value="${value.lowerElevation}"></div>
      <div class="form-group"><label>Upper elevation</label><input name="upperElevation" type="number" step="any" required value="${value.upperElevation}"></div>
      <div class="form-group"><label>Uphill direction</label><select name="direction">${options(RAMP_DIRECTIONS,value.direction)}</select></div>
      <p>North is the top of the scene. The Region shape determines the slope endpoints, so resizing it changes the ramp automatically. Hide the Region or disable the behavior to turn it off. This supports walking connections within one scene level.</p>`,
    buttons:[{action:'load',label:'Load region',callback:(event,button)=>({action:'load',region:button.form.elements.region.value})},
      {action:'save',label:'Save ramp',default:true,callback:(event,button)=>{const form=button.form.elements;return {action:'save',region:form.region.value,enabled:form.enabled.checked,
        lowerElevation:form.lowerElevation.value.trim()===''?NaN:Number(form.lowerElevation.value),upperElevation:form.upperElevation.value.trim()===''?NaN:Number(form.upperElevation.value),direction:form.direction.value};}}],rejectClose:false});
  if(!answer)return;if(answer.action==='load')return openRamps(answer.region);
  const behavior=await configureRamp(regions.find(r=>r.id===answer.region),answer);
  ui.notifications.info('Ramp saved. Edit Ramp / stairs in the Region sheet to change it.');return behavior;
}
