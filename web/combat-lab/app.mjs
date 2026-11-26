import {combatFrames} from '../../src/simulation/replay.mjs';

const elements=Object.fromEntries(['scenario','run','scenario-name','scenario-description','outcome','battlefield','first','previous','play','next','last','timeline','speed','frame-label','decision-title','decision-reason','resolution','actors','candidates','terms','findings','loading'].map(id=>[id,document.getElementById(id)]));
let scenario=null,report=null,frames=[],index=0,timer=null,worker=null;

const actorName=id=>scenario?.actors.find(actor=>actor.id===id)?.name??id??'';
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function terrainClass(symbol){return symbol==='#'?'wall':symbol==='+'?'cover':symbol==='?'?'mist':symbol==='~'?'difficult':symbol==='^'?'hazard':'floor';}
function renderBoard(frame){
  const width=scenario.map[0].length,byCell=new Map(frame.actors.filter(actor=>actor.alive).map(actor=>[`${actor.position.x},${actor.position.y}`,actor]));
  elements.battlefield.style.setProperty('--columns',width);elements.battlefield.replaceChildren();
  scenario.map.forEach((row,y)=>[...row].forEach((symbol,x)=>{
    const cell=document.createElement('div'),actor=byCell.get(`${x},${y}`);cell.className=`cell ${terrainClass(symbol)}`;cell.title=`${x}, ${y}`;
    if(actor){const token=document.createElement('div');token.className=`token ${actor.team}${frame.decision?.actorId===actor.id?' active':''}${frame.decision?.chosen?.targetId===actor.id?' target':''}`;
      token.textContent=actor.glyph??actor.name[0];token.title=`${actor.name}: ${actor.hp}/${actor.maxHp} HP`;cell.append(token);}
    elements.battlefield.append(cell);
  }));
}

function renderActors(frame){elements.actors.innerHTML=frame.actors.map(actor=>`<div class="actor ${actor.alive?'':'defeated'}"><span class="actor-glyph ${escapeHtml(actor.team)}">${escapeHtml(actor.glyph??actor.name[0])}</span><div><strong>${escapeHtml(actor.name)}</strong><small>${actor.hp} / ${actor.maxHp} HP</small></div><meter min="0" max="${actor.maxHp}" value="${actor.hp}"></meter></div>`).join('');}

function renderDecision(frame){
  const decision=frame.decision;elements['frame-label'].textContent=frame.label;
  if(!decision){elements['decision-title'].textContent='Starting conditions';elements['decision-reason'].textContent='The teams begin 24 squares apart.';elements.resolution.textContent='Press Play or step forward to inspect each production-planner decision.';elements.candidates.replaceChildren();elements.terms.replaceChildren();return;}
  const chosen=decision.chosen;elements['decision-title'].textContent=chosen?`${decision.plan?.label??'Directive'}: ${chosen.kind}${chosen.targetId?` → ${actorName(chosen.targetId)}`:''}`:'No legal action';
  elements['decision-reason'].textContent=decision.plan?.reason??'';elements.resolution.textContent=decision.effect?.summary??'';
  elements.candidates.innerHTML=decision.alternatives.map(candidate=>`<tr class="${candidate.id===chosen?.id?'selected':''}"><td>${escapeHtml(candidate.kind)}</td><td>${escapeHtml(actorName(candidate.targetId))}</td><td>${candidate.score}</td><td>${candidate.layer}</td></tr>`).join('');
  elements.terms.innerHTML=(chosen?.terms??[]).map(term=>`<li><span>${escapeHtml(term.label)}</span><strong class="${term.contribution<0?'negative':'positive'}">${term.contribution>=0?'+':''}${term.contribution}</strong></li>`).join('')||'<li class="muted">No additional score terms.</li>';
}

function render(){if(!frames.length)return;index=Math.max(0,Math.min(index,frames.length-1));const frame=frames[index];elements.timeline.value=index;renderBoard(frame);renderActors(frame);renderDecision(frame);
  elements.outcome.textContent=index===frames.length-1?`${report.outcome.status}${report.outcome.winner?` · ${report.outcome.winner}`:''}`:`Frame ${index} / ${frames.length-1}`;
  elements.first.disabled=elements.previous.disabled=index===0;elements.last.disabled=elements.next.disabled=index===frames.length-1;}
function stop(){clearInterval(timer);timer=null;elements.play.textContent='Play';}
function play(){if(timer){stop();return;}if(index===frames.length-1)index=0;elements.play.textContent='Pause';timer=setInterval(()=>{if(index>=frames.length-1){stop();return;}index++;render();},Number(elements.speed.value));render();}

async function loadScenario(url){scenario=await fetch(url).then(response=>{if(!response.ok)throw new Error(`Scenario load failed: ${response.status}`);return response.json();});elements['scenario-name'].textContent=scenario.name;elements['scenario-description'].textContent=scenario.description;await run();}
async function run(){stop();elements.loading.hidden=false;elements.run.disabled=true;worker?.terminate();worker=new Worker('./simulation-worker.mjs',{type:'module'});
  try{report=await new Promise((resolve,reject)=>{worker.onmessage=event=>event.data.ok?resolve(event.data.report):reject(new Error(event.data.error));worker.onerror=reject;worker.postMessage({scenario});});
    frames=combatFrames(scenario,report);index=0;elements.timeline.max=frames.length-1;elements.findings.innerHTML=report.findings.map(finding=>`<li class="${escapeHtml(finding.severity)}"><strong>${escapeHtml(finding.code)}</strong><span>${escapeHtml(finding.message)}</span></li>`).join('')||'<li class="muted">No structural warnings.</li>';render();
  }catch(error){elements.outcome.textContent='Error';elements.resolution.textContent=error.message;console.error(error);}finally{worker?.terminate();worker=null;elements.loading.hidden=true;elements.run.disabled=false;}}

elements.run.addEventListener('click',run);elements.play.addEventListener('click',play);elements.first.addEventListener('click',()=>{stop();index=0;render();});elements.last.addEventListener('click',()=>{stop();index=frames.length-1;render();});
elements.previous.addEventListener('click',()=>{stop();index--;render();});elements.next.addEventListener('click',()=>{stop();index++;render();});elements.timeline.addEventListener('input',event=>{stop();index=Number(event.target.value);render();});
elements.scenario.addEventListener('change',event=>loadScenario(event.target.value));elements.speed.addEventListener('change',()=>{if(timer){stop();play();}});

const manifest=await fetch('/simulations/index.json').then(response=>response.json());elements.scenario.innerHTML=manifest.scenarios.map(entry=>`<option value="${escapeHtml(entry.file)}">${escapeHtml(entry.name)}</option>`).join('');
await loadScenario(elements.scenario.value);
