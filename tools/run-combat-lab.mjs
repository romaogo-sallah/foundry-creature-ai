import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {CombatLab,assertCombat,renderCombatReport} from '../src/simulation/combat-lab.mjs';
import {combatLabScenarios,scenarioById} from '../src/simulation/scenarios.mjs';

const args=process.argv.slice(2),print=args.includes('--print'),ids=args.filter(arg=>arg!=='--print');
const loadScenario=async id=>{const builtIn=scenarioById(id);if(builtIn)return builtIn;
  try{return JSON.parse(await readFile(id,'utf8'));}catch{throw new Error(`Unknown scenario or JSON file ${id}. Built-ins: ${combatLabScenarios.map(entry=>entry.id).join(', ')}`);}};
const scenarios=ids.length?await Promise.all(ids.map(loadScenario)):combatLabScenarios;
const directory=new URL('../.scratch/combat-lab/',import.meta.url);await mkdir(directory,{recursive:true});let failed=false;
for(const scenario of scenarios){
  const report=new CombatLab(scenario).run(),markdown=renderCombatReport(report),url=new URL(`${scenario.id}.md`,directory);await writeFile(url,markdown,'utf8');
  try{assertCombat(report,scenario.expect);}catch(error){failed=true;console.error(error.message);}
  console.log(`${scenario.id}: ${report.outcome.status}${report.outcome.winner?` (${report.outcome.winner})`:''}; ${report.metrics.decisions} decisions, ${report.findings.length} findings`);
  for(const finding of report.findings)console.log(`  ${finding.severity.toUpperCase()} ${finding.code}: ${finding.message}`);
  console.log(`  report: ${fileURLToPath(url)}`);if(print)console.log(`\n${markdown}\n`);
}
if(failed)process.exitCode=1;
