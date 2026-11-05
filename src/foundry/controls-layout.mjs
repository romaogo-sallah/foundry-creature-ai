import {RUNTIME_VERSION} from './runtime-version.mjs';

const styleId='foundry-creature-ai-controls-styles';
let loading;

// A running Foundry server may retain package metadata from before this module
// had a stylesheet. Opening the controls must not depend on refreshing that
// server-side manifest; load the versioned style from the running JS as well.
export function ensureCreatureControlsStyles(){
  if(!globalThis.document?.head)return Promise.resolve();
  const href=new URL('../../styles/creature-ai.css',import.meta.url);
  href.searchParams.set('v',RUNTIME_VERSION);
  const existing=document.getElementById(styleId);
  if(existing?.href===href.href&&existing.sheet)return Promise.resolve();
  if(loading)return loading;
  loading=new Promise((resolve,reject)=>{
    const link=document.createElement('link');link.id=styleId;link.rel='stylesheet';link.href=href.href;
    link.onload=()=>{if(existing!==link)existing?.remove();resolve();};
    link.onerror=()=>{link.remove();reject(new Error('Creature AI controls stylesheet could not load. Reload Foundry and try again.'));};
    document.head.append(link);
  }).catch(error=>{loading=null;throw error;});
  return loading;
}

export function creatureControlsLayout(title){
  return {classes:['creature-ai-controls'],window:{title,resizable:true},position:{width:560,height:620}};
}
