import {buildDecisionGraph,renderDecisionGraphShell,mountDecisionGraph} from '../../src/foundry/decision-graph.mjs';
import {decisionGraphRecord,simulationDecisions} from '../../src/simulation/decision-tree.mjs';

const elements=Object.fromEntries(['scenario','decision','previous','next','rerun','actor','action','resolution','graph'].map(id=>[id,document.getElementById(id)]));
let scenario=null,entries=[],mounted=null,worker=null;

async function showDecision(index){
  index=Math.max(0,Math.min(index,entries.length-1));const entry=entries[index],decision=entry?.decision;if(!decision)return;
  elements.decision.selectedIndex=index;mounted?.destroy();
  const record=decisionGraphRecord(decision),graph=buildDecisionGraph(record,{},{});elements.graph.innerHTML=renderDecisionGraphShell(graph,{recorded:true});
  elements.actor.textContent=entry.actor;elements.action.textContent=`${decision.chosen?.kind??'No action'}${decision.chosen?.targetId?` -> ${scenario.actors.find(actor=>actor.id===decision.chosen.targetId)?.name??decision.chosen.targetId}`:''}`;
  elements.resolution.textContent=decision.effect?.summary??'No resolution recorded';
  mounted=await mountDecisionGraph(elements.graph,graph,{fileName:`${scenario.id}-${entry.id}`});
  elements.previous.disabled=index===0;elements.next.disabled=index===entries.length-1;
}

async function run(){
  mounted?.destroy();mounted=null;elements.graph.innerHTML='<p class="empty-state">Running the saved simulation in a worker&hellip;</p>';elements.rerun.disabled=true;
  try{
    const report=await new Promise((resolve,reject)=>{worker=new Worker('./simulation-worker.mjs',{type:'module'});
      worker.addEventListener('message',event=>event.data.ok?resolve(event.data.report):reject(new Error(event.data.error)),{once:true});
      worker.addEventListener('error',event=>reject(event.error??new Error(event.message)),{once:true});worker.postMessage({scenario});});
    entries=simulationDecisions(report,scenario);elements.decision.replaceChildren(...entries.map((entry,index)=>new Option(entry.label,String(index))));await showDecision(0);
  }catch(error){elements.graph.innerHTML=`<p class="empty-state error"></p>`;elements.graph.querySelector('p').textContent=error.message;console.error(error);
  }finally{worker?.terminate();worker=null;elements.rerun.disabled=false;}
}

async function loadScenario(url){scenario=await fetch(url).then(response=>{if(!response.ok)throw new Error(`Scenario load failed: ${response.status}`);return response.json();});await run();}
elements.decision.addEventListener('change',()=>showDecision(elements.decision.selectedIndex));
elements.previous.addEventListener('click',()=>showDecision(elements.decision.selectedIndex-1));
elements.next.addEventListener('click',()=>showDecision(elements.decision.selectedIndex+1));
elements.rerun.addEventListener('click',run);elements.scenario.addEventListener('change',()=>loadScenario(elements.scenario.value));
const manifest=await fetch('/simulations/index.json').then(response=>response.json());
elements.scenario.replaceChildren(...manifest.scenarios.map(entry=>new Option(entry.name,entry.file)));await loadScenario(elements.scenario.value);
