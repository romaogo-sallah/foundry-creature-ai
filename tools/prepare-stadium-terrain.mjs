import {readFile,writeFile} from 'node:fs/promises';
import {sourceSignature} from '../src/foundry/scene-setup.mjs';
import {environmentBehavior,hazardBehavior} from '../src/foundry/terrain-contract.mjs';
import {drawingShape,tileShape} from '../src/foundry/terrain-shapes.mjs';

if(!process.argv[2])throw new Error('Supply a read-only scene/journal snapshot path');
const snapshot=JSON.parse(await readFile(process.argv[2],'utf8'));
const sceneId='OTt3o0SfJZTLAc3r',setupId='stadium-terrain-2026-11-03';
const sources=new Map(),regions=[];
function source(kind,id){
  const entry=snapshot.scenes.find(entry=>entry.key===`!scenes.${kind}!${sceneId}.${id}`);
  if(!entry)throw new Error(`Missing ${kind} ${id}`);
  sources.set(`${kind}:${id}`,{kind,id,signature:sourceSignature(entry.doc,kind)});return entry.doc;
}
function region(key,name,{drawing,tiles=[],notes=[],environment,difficult=false,hazard=false,interior=false}){
  const shapes=drawing?[drawingShape(source('drawings',drawing))]:tiles.map(id=>tileShape(source('tiles',id)));
  for(const id of notes)source('notes',id);
  const behaviors=[];
  if(environment)behaviors.push(environmentBehavior(environment));
  if(difficult)behaviors.push({name:'Difficult terrain: ground movement ×2',type:'modifyMovementCost',disabled:false,system:{difficulties:{walk:2}}});
  if(hazard)behaviors.push(hazardBehavior({frequency:'per5'}));
  if(interior)behaviors.push({name:'Interior: shelter from weather',type:'suppressWeather',disabled:false,system:{}});
  regions.push({name,shapes,levels:['defaultLevel0000'],elevation:{bottom:0,top:20,topInclusive:false},
    color:hazard?'#d64b3f':environment?.concealment!=='none'&&environment?'#42b890':difficult?'#dfb64b':'#609bd9',
    visibility:0,hidden:false,locked:false,behaviors,
    flags:{'foundry-creature-ai':{sceneSetup:{id:setupId,key,sourceDrawing:drawing??null,sourceTiles:tiles,sourceNotes:notes},
      ...(environment?{environment}:{}),...(hazard?{hazardous:true}:{})}}});
}
const concealed={enabled:true,cover:'none',coverMode:'occupants',concealment:'through'};
const cover={enabled:true,cover:'standard',coverMode:'intervening',concealment:'none',firingRadius:10};
region('western-shrubs','Concealment — western shrubs',{drawing:'7gSlMfglUvPnpNPc',notes:['gsEpjrDAQTufuE5I'],environment:concealed});
region('eastern-grove','Concealment and difficult terrain — eastern grove',{drawing:'1gGMmUuM6lV4tund',notes:['qXMlFZLMQ7lhItwq','i02KxzKBxNg4ZqG3'],environment:concealed,difficult:true});
region('western-rocks','Difficult terrain — western rocks',{drawing:'T783vy509eEmLXF1',notes:['oHzW0IJ3gBRWInMD'],difficult:true});
region('eastern-rocks','Difficult terrain — eastern rocks',{drawing:'exIrZud44NhORGgC',notes:['DOVtj4Jp9B89PEkv'],difficult:true});
region('hearth','Difficult terrain — hearth',{drawing:'GjVEATF9JzmifQXU',notes:['mhbH806jf0MN3WhO'],difficult:true});
region('northern-sacks','Standard cover — northern sack piles',{tiles:['btm2SYY1GSat9Pfp','8erWOhoDau1WFz4N','Arach3CTchkisdCg'],notes:['xXBmj4yplZhZKXRX'],environment:cover});
region('southern-sacks','Standard cover — southern sack piles',{tiles:['o4UL02cGMcnMzClM','JgI5W0Fmvc6iGaYE','LyG7rGNrF2h7a1w1','IM2PJOP2GnjTvPfN','YFtUhRvYCTK8Pe4b'],notes:['t9HBcbPLdoNrvGkk'],environment:cover});
region('northern-formation','Standard cover — northern rock formation',{tiles:['m5b5t0uJ4xQk25y9'],notes:['bZ9254EHTUwLXCTF'],environment:cover});
region('southern-formations','Standard cover — southern rock formations',{tiles:['1zyCqIysoo0dtF8M','dGrmTKjgji7sNnus'],notes:['EEDCnNrvlzvva8Xu'],environment:cover});
region('western-cactus','Hazardous terrain — western cactus (1d6 piercing)',{tiles:['gKvSEKWlN50nfzRc'],notes:['pe0tX1IXifxIK7sV'],hazard:true});
region('northern-cactus','Hazardous terrain — northern cactus (1d6 piercing)',{tiles:['0hsrYUIFv8wD4fNY'],notes:['aAY5vxRlzYdbEwX8'],hazard:true});
region('eastern-cactus','Hazardous terrain — eastern cactus (1d6 piercing)',{tiles:['wWKWETWF3YkeCyc1'],notes:['0wQ2YbbLZFaD2qcg'],hazard:true});
region('tent-interior','Interior — yurt shelter',{tiles:['93HWiAnN49XJAHTY'],notes:['tOM1nEtEEECI26L4'],interior:true});
const plan={id:setupId,worldId:'arena',sceneId,name:'Stadium — annotated terrain',sources:[...sources.values()],regions,
  deferredAnnotations:['9pWFZLoSxWfjpneM','N509W7GHK6L9W7C0','kw3GPMeepPUPD7rI','vRFyJsKwYdaGgdyN'],
  assumptions:['Cover annotations apply to the adjacent sack piles and large rock formations; other unlabelled decorative tiles are not converted.',
    'Concealment volumes obscure occupants and sight lines passing through them, as requested for regular play.',
    'GM chose 1d6 piercing damage per 5 feet travelled through cactus hazards; terrain cost does not multiply damage.',
    'GM deferred platform and pit elevation conversion; existing elevation annotations are preserved.']};
await writeFile(new URL('../.scratch/stadium-terrain-setup.json',import.meta.url),JSON.stringify(plan,null,2)+'\n');
console.log(JSON.stringify({regions:regions.map(r=>({key:r.flags['foundry-creature-ai'].sceneSetup.key,name:r.name,behaviors:r.behaviors.map(b=>b.name)})),sources:plan.sources.length,deferred:plan.deferredAnnotations},null,2));
