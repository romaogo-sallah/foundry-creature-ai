import {MODULE_ID,MANAGED_OPTION} from './rules-context.mjs';
export function markManagedRuleMessage(message){
  const options=message.flags?.pf2e?.context?.options??[];
  if(!options.includes(MANAGED_OPTION))return;
  const explicit=message.flags?.[MODULE_ID]?.damageAutoApplied;
  const reaction=options.includes(`${MODULE_ID}:reaction`);
  const changes={[`flags.${MODULE_ID}.managed`]:true,'flags.xdy-pf2e-workbench.noAutoDamageRoll':true};
  if(typeof explicit==='boolean'||reaction)changes['flags.pf2e.suppressDamageButtons']=typeof explicit==='boolean'?explicit:options.includes(`${MODULE_ID}:reaction-auto-damage`);
  message.updateSource(changes);
}
