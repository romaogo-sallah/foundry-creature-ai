const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
}[char]));

const compact=value=>{
  if(value==null)return '';
  if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return String(value);
  if(Array.isArray(value))return value.map(compact).filter(Boolean).join(', ');
  return Object.entries(value).filter(([,entry])=>entry!=null&&entry!==false&&entry!=='')
    .slice(0,8).map(([key,entry])=>`${key}: ${compact(entry)}`).join('\n');
};
const signed=value=>`${value>=0?'+':''}${Number(value).toFixed(Math.abs(value)<10?2:1)}`;
const safe=value=>String(value??'unknown').replace(/[^a-zA-Z0-9_-]/g,char=>`_${char.codePointAt(0).toString(16)}_`);
const optionLabel=(option,rank,nameOf)=>{
  const subject=option.spellName??option.kind??option.id;
  const target=option.targetId?` -> ${nameOf(option.targetId)}`:'';
  const movement=option.destination?`\nto ${option.destination.x}, ${option.destination.y}${option.destination.elevation!=null?`, ${option.destination.elevation} ft`:''}`:'';
  const chance=option.selectionProbability!=null?` | roll ${Math.round(option.selectionProbability*1000)/10}%`:'';
  return `${rank}. ${subject}${target}\nLayer ${option.layer} | value ${Number(option.value).toFixed(2)} | ${option.actionCost} action${option.actionCost===1?'':'s'}${chance}${movement}`;
};

/** Build a serializable graph of the recorded tactic and action ranking. */
export function buildDecisionGraph(record,catalog={components:[],plans:[]},{nameOf=id=>id}={}){
  const nodes=[],edges=[],nodeIds=new Set();let edgeIndex=0;
  const addNode=(id,label,category,classes=[],detail={})=>{
    id=safe(id);if(nodeIds.has(id))return id;nodeIds.add(id);
    nodes.push({data:{id,label,category,detail:JSON.stringify(detail,null,2)},classes:[category,...classes].join(' ')});return id;
  };
  const addEdge=(source,target,label='',classes=[])=>edges.push({data:{id:`edge-${edgeIndex++}`,source:safe(source),target:safe(target),label},classes:classes.join(' ')});
  const tactic=record.tactic??{},context=tactic.context??{},configuration=tactic.configuration??{};
  const state=addNode('situation',`Situation\n${[
    context.health!=null?`HP ${Math.round(context.health*100)}%`:null,
    context.knownEnemies!=null?`${context.knownEnemies} known / ${context.visibleEnemies??0} visible enemies`:null,
    context.forceRatio!=null?`force ratio ${Number(context.forceRatio).toFixed(2)}`:null,
    context.immediateAttack?'useful attack available':null,
    context.emergency?'emergency':null,
  ].filter(Boolean).join('\n')||'Recorded combat state'}`,'situation',[],context);
  const planGate=addNode('plan-ranking','1. Select tactical plan','gate',[],{selected:tactic.planId,reason:tactic.reason});
  addEdge(state,planGate,'evaluate');
  const planCatalog=new Map((catalog.plans??[]).map(plan=>[plan.id,plan]));
  const scores=new Map((tactic.scores??[]).map(score=>[score.id,score]));
  const evaluations=tactic.evaluations??(configuration.plans??[...scores.keys()]).map(id=>scores.get(id)??{
    id,label:planCatalog.get(id)?.label??id,applicable:false,value:null,reason:'Not active in the recorded situation',
  });
  let selectedPlan=null;
  for(const evaluation of evaluations){
    const selected=evaluation.id===tactic.planId,classes=[selected?'selected':'',evaluation.applicable===false?'inactive':''].filter(Boolean);
    const value=evaluation.applicable===false?'inactive':`score ${Number(evaluation.value).toFixed(2)}`;
    const id=addNode(`plan-${evaluation.id}`,`${evaluation.label??evaluation.id}\n${value}\n${evaluation.reason??''}`,'plan',classes,evaluation);
    addEdge(planGate,id,evaluation.applicable===false?'not applicable':selected?'selected':'ranked');
    if(selected)selectedPlan=id;
  }
  if(!selectedPlan){selectedPlan=addNode(`plan-${tactic.planId??'fallback'}`,`${tactic.label??'Fallback plan'}\n${tactic.reason??''}`,'plan',['selected'],tactic);addEdge(planGate,selectedPlan,'fallback');}
  const objective=addNode('objective',`Objective\n${tactic.goal?.label??tactic.goal?.kind??'Choose a useful legal action'}`,'objective',[],tactic.goal??{});
  addEdge(selectedPlan,objective,'pursue');
  const componentGate=addNode('component-gate','2. Activate behavior components','gate',[],{
    active:tactic.activeComponents??[],attached:configuration.components??[],
  });
  addEdge(objective,componentGate,'activate');
  const active=new Set(tactic.activeComponents??[]),componentCatalog=new Map((catalog.components??[]).map(component=>[component.id,component]));
  const attached=configuration.components??[...active],activeComponentNodes=[];
  for(const componentId of attached){
    const component=componentCatalog.get(componentId)??{id:componentId,label:componentId};
    const isActive=active.has(componentId),id=addNode(`component-${componentId}`,`${component.label}\n${component.kind??'behavior'}${isActive?'':' (inactive)'}`,
      'component',isActive?['active']:['inactive'],component);
    addEdge(componentGate,id,isActive?'active':'not used');
    if(isActive)activeComponentNodes.push(id);
  }
  const actionGate=addNode('action-ranking','3. Rank legal actions\npriority layer, then value','gate',[],{
    reason:record.reason,tiedIds:record.tiedIds,randomizedIds:record.randomizedIds,selection:record.selection,totalOptions:record.totalOptions,
  });
  if(activeComponentNodes.length)for(const id of activeComponentNodes)addEdge(id,actionGate,'contributes');
  else addEdge(componentGate,actionGate,'generate and score');
  const optionIds=new Map();
  (record.options??[]).forEach((option,index)=>{
    const randomized=record.randomizedIds?.includes(option.id);
    const classes=[option.selected?'chosen':'',record.tiedIds?.includes(option.id)?'tied':'',randomized?'randomized':''].filter(Boolean);
    const id=addNode(`option-${option.id}`,optionLabel(option,index+1,nameOf),'option',classes,option);optionIds.set(option.id,id);
    addEdge(actionGate,id,option.selected?'chosen':randomized?`${Math.round((option.selectionProbability??0)*1000)/10}% chance`:'ranked',randomized?['randomized']:[]);
    for(const [termIndex,term] of (option.terms??[]).entries()){
      const termId=addNode(`term-${option.id}-${termIndex}`,`${signed(term.contribution)}\n${term.label}`,'term',[term.contribution<0?'negative':'positive'],term);
      addEdge(id,termId,'score term');
    }
  });
  for(const [index,rejected] of (record.rejected??[]).entries()){
    const label=`${rejected.name??rejected.kind??rejected.id??'Option'}${rejected.targetId?` -> ${nameOf(rejected.targetId)}`:''}\n${rejected.reason??'Rejected'}`;
    const id=addNode(`rejected-${rejected.id??index}-${index}`,label,'rejected',['rejected'],rejected);
    addEdge(actionGate,id,'rejected',['rejected']);
  }
  return {nodes,edges,summary:{chosenId:record.chosenId,reason:record.reason,planId:tactic.planId??null,
    nodeCount:nodes.length,optionCount:record.options?.length??0,rejectedCount:record.rejected?.length??0,totalOptions:record.totalOptions??0}};
}

export function renderDecisionGraphShell(graph,{recorded=false}={}){
  const summary=graph.summary;
  return `<div class="decision-debugger" data-decision-debugger>
    <header class="decision-debugger__intro"><strong>${recorded?'Recorded decision':'Live decision preview'}</strong>
      <span>${htmlEscape(summary.reason||'No ranking reason')}</span>
      <span>${summary.optionCount} displayed options${summary.totalOptions>summary.optionCount?` of ${summary.totalOptions}`:''}; ${summary.rejectedCount} rejected</span></header>
    <div class="decision-debugger__toolbar">
      <button type="button" data-graph-control="fit"><i class="fa-solid fa-expand"></i> Fit</button>
      <button type="button" data-graph-control="png"><i class="fa-solid fa-image"></i> PNG</button>
      <button type="button" data-graph-control="json"><i class="fa-solid fa-file-code"></i> JSON</button>
      <label><input type="checkbox" data-graph-filter="inactive" checked> inactive tactics/components</label>
      <label><input type="checkbox" data-graph-filter="rejected" checked> rejected</label>
      <label><input type="checkbox" data-graph-filter="term" checked> score terms</label>
      <input type="search" data-graph-search placeholder="Find a node" aria-label="Find a decision node">
    </div>
    <div class="decision-debugger__body">
      <div class="decision-debugger__canvas" data-graph-canvas role="img" aria-label="Creature decision graph"></div>
      <aside class="decision-debugger__details" data-graph-details><strong>Select a node</strong><p>Click a tactic, component, option, or score term to inspect its recorded data.</p></aside>
    </div>
    <footer class="decision-debugger__legend"><span class="chosen">Chosen path</span><span class="randomized">Weighted roll candidate</span><span class="tied">Equal best option</span>
      <span class="inactive">Inactive</span><span class="rejected">Rejected</span><span>Drag to pan; wheel to zoom.</span></footer>
  </div>`;
}

const download=(name,url)=>{const anchor=document.createElement('a');anchor.download=name;anchor.href=url;anchor.click();};
export function relativeWheelZoom({zoom,deltaY,deltaMode=0,pageSize=800,minZoom=0.15,maxZoom=3}){
  const pixels=deltaY*(deltaMode===1?16:deltaMode===2?pageSize:1);
  return Math.max(minZoom,Math.min(maxZoom,zoom*Math.exp(-pixels*0.0015)));
}
export async function mountDecisionGraph(root,graph,{fileName='creature-decision'}={}){
  const container=root.querySelector('[data-graph-canvas]');if(!container)throw new Error('Decision graph canvas is missing');
  const {default:cytoscape}=await import('../vendor/cytoscape.esm.min.mjs');
  if(!container.isConnected)return {destroy(){}};
  const cy=cytoscape({container,elements:[...graph.nodes,...graph.edges],userZoomingEnabled:false,minZoom:0.15,maxZoom:3,
    style:[
      {selector:'node',style:{'shape':'round-rectangle','background-color':'#344054','border-color':'#667085','border-width':2,
        'label':'data(label)','color':'#f2f4f7','font-size':11,'text-wrap':'wrap','text-max-width':180,'text-valign':'center','text-halign':'center',
        'padding':'10px','width':'label','height':'label','min-width':'90px','min-height':'42px'}},
      {selector:'node.gate',style:{'background-color':'#243b53','border-color':'#5fa8d3','font-weight':'bold'}},
      {selector:'node.situation',style:{'background-color':'#3b2f63','border-color':'#a78bfa'}},
      {selector:'node.plan',style:{'background-color':'#3d4a5c'}},{selector:'node.objective',style:{'background-color':'#3f3a24','border-color':'#d6b756'}},
      {selector:'node.component',style:{'background-color':'#174f59','border-color':'#49a6b5'}},
      {selector:'node.option',style:{'background-color':'#30455c'}},{selector:'node.term',style:{'background-color':'#403a47','font-size':9,'text-max-width':150}},
      {selector:'node.positive',style:{'border-color':'#65c466'}},{selector:'node.negative',style:{'border-color':'#dd7777'}},
      {selector:'node.randomized',style:{'border-color':'#d6b756','border-width':4}},
      {selector:'node.tied',style:{'border-color':'#66bfff','border-width':4}},{selector:'node.inactive',style:{'opacity':0.34,'border-style':'dashed'}},
      {selector:'.selected, node.chosen',style:{'background-color':'#176b3a','border-color':'#7ee2a8','border-width':5,'font-weight':'bold'}},
      {selector:'node.rejected',style:{'background-color':'#542f35','border-color':'#e47b86','opacity':0.65}},
      {selector:'edge',style:{'width':1.5,'line-color':'#748094','target-arrow-color':'#748094','target-arrow-shape':'triangle','curve-style':'bezier',
        'label':'data(label)','font-size':8,'color':'#aeb7c5','text-rotation':'autorotate','text-background-color':'#111827','text-background-opacity':0.75,'text-background-padding':'2px'}},
      {selector:'edge.rejected',style:{'line-style':'dashed','line-color':'#a84d58','target-arrow-color':'#a84d58'}},
      {selector:'edge.randomized',style:{'line-color':'#d6b756','target-arrow-color':'#d6b756','width':2.5}},
      {selector:'.search-match',style:{'overlay-color':'#ffd166','overlay-opacity':0.28,'overlay-padding':8}},
    ],layout:{name:'breadthfirst',directed:true,roots:'#situation',padding:35,spacingFactor:1.25,avoidOverlap:true,animate:false}});
  const details=root.querySelector('[data-graph-details]');
  cy.on('tap','node',event=>{const data=event.target.data();details.replaceChildren();
    const heading=document.createElement('strong');heading.textContent=data.label.split('\n')[0];
    const pre=document.createElement('pre');pre.textContent=data.detail;details.append(heading,pre);
  });
  const fit=()=>cy.animate({fit:{eles:cy.elements(':visible'),padding:30},duration:180});
  root.querySelector('[data-graph-control="fit"]')?.addEventListener('click',fit);
  root.querySelector('[data-graph-control="png"]')?.addEventListener('click',()=>download(`${fileName}.png`,cy.png({full:true,scale:2,bg:'#111827'})));
  root.querySelector('[data-graph-control="json"]')?.addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(graph,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);download(`${fileName}.json`,url);setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  for(const input of root.querySelectorAll('[data-graph-filter]'))input.addEventListener('change',()=>{
    const selector=`.${input.dataset.graphFilter}`;cy.elements(selector)[input.checked?'show':'hide']();cy.layout({name:'breadthfirst',directed:true,roots:'#situation',padding:35,spacingFactor:1.25,avoidOverlap:true}).run();fit();
  });
  root.querySelector('[data-graph-search]')?.addEventListener('input',event=>{const query=event.target.value.trim().toLowerCase();cy.nodes().removeClass('search-match');
    if(query)cy.nodes().filter(node=>node.data('label').toLowerCase().includes(query)).addClass('search-match');
  });
  const wheelZoom=event=>{event.preventDefault();event.stopPropagation();const bounds=container.getBoundingClientRect();
    cy.zoom({level:relativeWheelZoom({zoom:cy.zoom(),deltaY:event.deltaY,deltaMode:event.deltaMode,pageSize:container.clientHeight,
      minZoom:cy.minZoom(),maxZoom:cy.maxZoom()}),renderedPosition:{x:event.clientX-bounds.left,y:event.clientY-bounds.top}});
  };
  container.addEventListener('wheel',wheelZoom,{passive:false});
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>{cy.resize();}):null;observer?.observe(container);fit();
  return {cy,destroy(){container.removeEventListener('wheel',wheelZoom);observer?.disconnect();cy.destroy();}};
}
