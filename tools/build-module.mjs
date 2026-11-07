import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import {PACKAGE_IDS,ENTRIES,DEPENDENCIES,packageGraph,packagedSource,packageManifest} from './package-graph.mjs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = new URL('dist/foundry-creature-ai/', root);
const version=JSON.parse(await readFile(new URL('package.json',root),'utf8')).version;
const graph=await packageGraph(),workspace=fileURLToPath(root),dist=path.resolve(workspace,'dist');
for(const id of PACKAGE_IDS){
 const target=path.resolve(dist,id);if(path.dirname(target)!==dist||!PACKAGE_IDS.includes(path.basename(target)))throw new Error('Unexpected build output');
 await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
 await writeFile(path.join(target,'module.json'),JSON.stringify(packageManifest(id,version),null,2)+'\n');
}
for(const [file,source]of graph.sources){
 const target=path.join(dist,graph.owners.get(file),file);await mkdir(path.dirname(target),{recursive:true});
 await writeFile(target,packagedSource(file,source,graph.owners));
}
await cp(new URL('module/styles',root),new URL('styles',output),{recursive:true});
await cp(new URL('module/macros',root),new URL('macros',output),{recursive:true});
const resetCommand = await readFile(new URL('module/macros/reset-selected-actors.js', root), 'utf8');
await writeFile(new URL('macros/reset-selected-actors.json', output), JSON.stringify({
  name: 'Reset selected actors to prototype', type: 'script', scope: 'global',
  img: 'icons/svg/regen.svg', command: resetCommand,
}, null, 2));
const fullAutoCommand=await readFile(new URL('module/macros/enable-selected-full-auto.js',root),'utf8');
await writeFile(new URL('macros/enable-selected-full-auto.json',output),JSON.stringify({
  name:'Enable full auto for selected NPCs',type:'script',scope:'global',img:'icons/svg/clockwork.svg',command:fullAutoCommand,
},null,2));
await cp(new URL('profiles', root), new URL('profiles', output), { recursive: true });
await cp(new URL('docs/creature-ai-foundry.md', root), new URL('README.md', output));
await cp(new URL('docs/actor-reset.md', root), new URL('actor-reset.md', output));
await cp(new URL('docs/wolf-foundry.md', root), new URL('wolf-foundry.md', output));
await cp(new URL('docs/ogre-boss-foundry.md', root), new URL('ogre-boss-foundry.md', output));
await cp(new URL('docs/ogre-foundry.md', root), new URL('ogre-foundry.md', output));
await cp(new URL('docs/creature-framework.md', root), new URL('creature-framework.md', output));
await cp(new URL('docs/tactics-and-components.md', root), new URL('tactics-and-components.md', output));
await cp(new URL('docs/flight-worker.md', root), new URL('flight-worker.md', output));
await cp(new URL('docs/target-memory.md', root), new URL('target-memory.md', output));
await cp(new URL('docs/npc-perception.md', root), new URL('npc-perception.md', output));
await cp(new URL('docs/environment-zones.md', root), new URL('environment-zones.md', output));
await cp(new URL('docs/player-stealth.md', root), new URL('player-stealth.md', output));
await cp(new URL('docs/ai-pacing.md', root), new URL('ai-pacing.md', output));
await cp(new URL('docs/scene-terrain.md', root), new URL('scene-terrain.md', output));
await cp(new URL('docs/eagle-flight.md', root), new URL('eagle-flight.md', output));
await cp(new URL('docs/aerial-combat.md', root), new URL('aerial-combat.md', output));
await cp(new URL('docs/manticore-scorpion.md', root), new URL('manticore-scorpion.md', output));
await cp(new URL('docs/manticore-quill.md', root), new URL('manticore-quill.md', output));
await cp(new URL('docs/dero-magister.md',root),new URL('dero-magister.md',output));
await cp(new URL('docs/vampires.md',root),new URL('vampires.md',output));
const vampireReview=await readFile(new URL('docs/battle-analysis-2026-11-07-vampires.md',root),'utf8');
for(const id of ['foundry-creature-ai','pf2e-tactical-conditions'])await writeFile(path.join(dist,id,'battle-analysis-2026-11-07-vampires.md'),vampireReview
 .replaceAll('(../src/','(https://github.com/romaogo-sallah/foundry-creature-ai/blob/main/src/')
 .replaceAll('(../research/','(https://github.com/romaogo-sallah/foundry-creature-ai/blob/main/research/'));
const finishedReview=await readFile(new URL('docs/battle-analysis-2026-11-07-vampires-finished.md',root),'utf8');
for(const id of ['foundry-creature-ai','pf2e-tactical-conditions'])await writeFile(path.join(dist,id,'battle-analysis-2026-11-07-vampires-finished.md'),finishedReview
 .replaceAll('(../src/','(https://github.com/romaogo-sallah/foundry-creature-ai/blob/main/src/')
 .replaceAll('(../research/','(https://github.com/romaogo-sallah/foundry-creature-ai/blob/main/research/'));
await cp(new URL('docs/spellcaster-framework.md',root),new URL('spellcaster-framework.md',output));
await cp(new URL('docs/condition-handling.md',root),new URL('condition-handling.md',output));
await cp(new URL('docs/condition-ai.md',root),new URL('condition-ai.md',output));
await cp(new URL('docs/condition-manual.md',root),new URL('condition-manual.md',output));
const conditionAudit=await readFile(new URL('docs/condition-rules-audit-2026-11-06.md',root),'utf8');
await writeFile(new URL('condition-rules-audit-2026-11-06.md',output),conditionAudit.replaceAll('../research/condition-automation-verification-2026-11-06.json','condition-automation-verification-2026-11-06.json'));
await cp(new URL('research/condition-automation-verification-2026-11-06.json',root),new URL('condition-automation-verification-2026-11-06.json',output));
await cp(new URL('docs/foundry-diagnostics.md',root),new URL('foundry-diagnostics.md',output));
await cp(new URL('docs/kobold-scout-foundry.md', root), new URL('kobold-scout-foundry.md', output));
await cp(new URL('docs/goblin-pyro-foundry.md', root), new URL('goblin-pyro-foundry.md', output));
await cp(new URL('docs/reactions-foundry.md', root), new URL('reactions-foundry.md', output));
await cp(new URL('docs/wolf-maneuvers.md', root), new URL('wolf-maneuvers.md', output));
await cp(new URL('docs/wolf-decision-improvements.md', root), new URL('wolf-decision-improvements.md', output));
await cp(new URL('docs/wolf-escape-automation.md', root), new URL('wolf-escape-automation.md', output));
await cp(new URL('docs/wolf-pacing-and-morale.md', root), new URL('wolf-pacing-and-morale.md', output));
await cp(new URL('docs/dawnsbury-ai-additional-findings.md', root), new URL('dawnsbury-ai-additional-findings.md', output));
const casterReport = await readFile(new URL('docs/dawnsbury-caster-ai-findings.md', root), 'utf8');
await writeFile(new URL('dawnsbury-caster-ai-findings.md', output), casterReport
  .replaceAll('(../research/dawnsbury-caster-verification.json)', '(dawnsbury-caster-verification.json)'));
await cp(new URL('research/dawnsbury-caster-verification.json', root), new URL('dawnsbury-caster-verification.json', output));
const behaviorReport = await readFile(new URL('docs/dawnsbury-ai-behavior.md', root), 'utf8');
await writeFile(new URL('dawnsbury-ai-behavior.md', output), behaviorReport
  .replaceAll('(../research/dawnsbury-behavior-verification.json)', '(dawnsbury-behavior-verification.json)')
  .replaceAll('[initial report](dawnsbury-ai-findings.md)', 'initial metadata report in the source workspace'));
await cp(new URL('research/dawnsbury-behavior-verification.json', root), new URL('dawnsbury-behavior-verification.json', output));
const index={version,apiVersion:1,packages:[]};
for(const id of PACKAGE_IDS){
 const files=[...graph.owners].filter(([,owner])=>owner===id).map(([file])=>file).sort();
 const build={version,apiVersion:1,builtAt:new Date().toISOString(),sourceFiles:files,dependencies:DEPENDENCIES[id]};
 await writeFile(path.join(dist,id,'BUILD.json'),JSON.stringify(build,null,2)+'\n');
 index.packages.push({id,entry:ENTRIES[id],sourceFiles:files.length,dependencies:DEPENDENCIES[id]});
 if(id!=='foundry-creature-ai')await cp(new URL('docs/modular-suite.md',root),path.join(dist,id,'README.md'));
}
await cp(new URL('docs/modular-suite.md',root),new URL('modular-suite.md',output));
for(const id of PACKAGE_IDS)await cp(new URL('docs/ramps.md',root),path.join(dist,id,'ramps.md'));
await cp(new URL('docs/confused-ai.md',root),new URL('confused-ai.md',output));
for(const [id,documents]of [['pf2e-tactical-environment',['environment-zones.md','scene-terrain.md']],
 ['pf2e-tactical-conditions',['condition-manual.md','condition-handling.md','vampires.md']],['pf2e-tactical-movement',['player-stealth.md','eagle-flight.md','condition-manual.md']]]){
 for(const document of documents)await cp(new URL('docs/'+document,root),path.join(dist,id,document));
}
await writeFile(path.join(dist,'package-index.json'),JSON.stringify(index,null,2)+'\n');
console.log('Built '+PACKAGE_IDS.length+' independent packages ('+[...graph.sources].length+' source modules, one canonical owner each)');
