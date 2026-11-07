import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
export const PACKAGE_IDS=['pf2e-tactical-core','pf2e-tactical-environment','pf2e-tactical-conditions','pf2e-tactical-movement','foundry-creature-ai'];
export const ENTRIES={
 'pf2e-tactical-core':'src/modules/core.mjs','pf2e-tactical-environment':'src/modules/environment.mjs',
 'pf2e-tactical-conditions':'src/modules/conditions.mjs','pf2e-tactical-movement':'src/modules/movement.mjs','foundry-creature-ai':'src/foundry/main.mjs'};
export const DEPENDENCIES={
 'pf2e-tactical-core':[], 'pf2e-tactical-environment':['pf2e-tactical-core'],
 'pf2e-tactical-conditions':['pf2e-tactical-core','pf2e-tactical-environment'],
 'pf2e-tactical-movement':['pf2e-tactical-core','pf2e-tactical-environment','pf2e-tactical-conditions'],
 'foundry-creature-ai':PACKAGE_IDS.slice(0,4)};
const literals=/(['"])(\.[^'"\r\n]+\.mjs)\1/g;
export function sourceReferences(source,file){
 return [...source.matchAll(literals)].map(match=>({specifier:match[2],file:path.posix.normalize(path.posix.join(path.posix.dirname(file),match[2]))}));
}
async function sourceFiles(directory='src'){
 return (await Promise.all((await readdir(directory,{withFileTypes:true})).map(entry=>entry.isDirectory()?sourceFiles(`${directory}/${entry.name}`):entry.name.endsWith('.mjs')?[`${directory}/${entry.name}`]:[]))).flat();
}
export async function packageGraph(){
 const sources=new Map(await Promise.all((await sourceFiles()).map(async file=>[file,await readFile(file,'utf8')]))),owners=new Map();
 function collect(file,id){
  if(owners.has(file))return;
  if(!sources.has(file))throw new Error(`Missing source import: ${file}`);
  owners.set(file,id);for(const ref of sourceReferences(sources.get(file),file))collect(ref.file,id);
 }
 for(const id of PACKAGE_IDS)collect(ENTRIES[id],id);
 for(const file of sources.keys())if(!owners.has(file))owners.set(file,'foundry-creature-ai');
 for(const [file,owner]of owners)for(const ref of sourceReferences(sources.get(file),file)){
  const dependency=owners.get(ref.file);
  if(!dependency)throw new Error(`Unowned module: ${ref.file}`);
  if(dependency!==owner&&!DEPENDENCIES[owner].includes(dependency))throw new Error(`${owner}: undeclared dependency on ${dependency} through ${file}`);
 }
 for(const [file,owner]of owners)if(owner!=='foundry-creature-ai'&&(/src\/(wolf|profiles|dawnsbury|workers)\//.test(file)||/adapter\.mjs$/.test(file)||file.includes('planning-worker')))
  throw new Error(`Manual package depends on AI code: ${owner}: ${file}`);
 return {sources,owners};
}
export function packagedSource(file,source,owners){
 const owner=owners.get(file),from=`${owner}/${path.posix.dirname(file)}`;
 return source.replace(literals,(_match,quote,specifier)=>{
  const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier)),targetOwner=owners.get(target);
  if(!targetOwner)throw new Error(`Missing source owner: ${target}`);
  let rewritten=path.posix.relative(from,`${targetOwner}/${target}`);if(!rewritten.startsWith('.'))rewritten='./'+rewritten;
  return `${quote}${rewritten}${quote}`;
 });
}
export function packageManifest(id,version){
 const info={
  'pf2e-tactical-core':['PF2e Tactical Rules — Core','Shared native PF2e rule services, one reaction barrier, roll pipeline and stable API; no NPC decision engine.'],
  'pf2e-tactical-environment':['PF2e Tactical Rules — Environment','Cover, concealment, visibility captions, terrain zones and hazards for manual play.'],
  'pf2e-tactical-conditions':['PF2e Tactical Rules — Conditions & Spells','Condition action restrictions, recovery, lingering supported spell effects and existing automation integration.'],
  'pf2e-tactical-movement':['PF2e Tactical Rules — Movement','Native Step/Sneak modes, player stealth, awaited movement reactions and shared upward/downward flight costs.'],
  'foundry-creature-ai':['Foundry Creature AI','NPC tactical plans, creature profiles, worker planning and automatic turns using the independent Tactical Rules modules.']};
 return {id,title:info[id][0],description:info[id][1],version,compatibility:{minimum:'14.361',verified:'14.369',maximum:'14'},
  relationships:{systems:[{id:'pf2e',type:'system',compatibility:{minimum:'8.6.1',maximum:'8.6.1'}}],
   requires:[...DEPENDENCIES[id].map(dependency=>({id:dependency,type:'module',compatibility:{minimum:version},reason:'Use shared Tactical Rules services and their public API'})),
    ...id==='pf2e-tactical-core'?[{id:'lib-wrapper',type:'module',reason:'Install each native rule wrapper once'}]:[]]},
  esmodules:[ENTRIES[id]],...id==='pf2e-tactical-movement'?{documentTypes:{RegionBehavior:{ramp:{},pit:{}}}}:{},...id==='foundry-creature-ai'?{styles:['styles/creature-ai.css']}:{}};
}
