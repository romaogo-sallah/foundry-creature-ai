import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = new URL('dist/foundry-creature-ai/', root);
await mkdir(output, { recursive: true });
await cp(new URL('module/module.json', root), new URL('module.json', output));
await cp(new URL('module/styles', root), new URL('styles', output), { recursive: true });
await cp(new URL('module/macros', root), new URL('macros', output), { recursive: true });
const resetCommand = await readFile(new URL('module/macros/reset-selected-actors.js', root), 'utf8');
await writeFile(new URL('macros/reset-selected-actors.json', output), JSON.stringify({
  name: 'Reset selected actors to prototype', type: 'script', scope: 'global',
  img: 'icons/svg/regen.svg', command: resetCommand,
}, null, 2));
const fullAutoCommand=await readFile(new URL('module/macros/enable-selected-full-auto.js',root),'utf8');
await writeFile(new URL('macros/enable-selected-full-auto.json',output),JSON.stringify({
  name:'Enable full auto for selected NPCs',type:'script',scope:'global',img:'icons/svg/clockwork.svg',command:fullAutoCommand,
},null,2));
await cp(new URL('src', root), new URL('src', output), { recursive: true });
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
await cp(new URL('docs/condition-handling.md',root),new URL('condition-handling.md',output));
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
const manifest = JSON.parse(await readFile(new URL('module.json', output)));
await writeFile(new URL('BUILD.json', output), JSON.stringify({ version: manifest.version, builtAt: new Date().toISOString(),
  source: 'New JavaScript implementing recovered Dawnsbury 4.44 decision behavior, with Foundry adaptations; no game binaries or raw decompiled C# included',
  dawnsburyAssemblySha256: '61d48e6c059777a74b17e0fe4d9bc6600d57fbf6a09fe78e47cfdb7272304b23' }, null, 2));
console.log(`Built ${fileURLToPath(output)}`);
