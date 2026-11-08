import {buildTacticalField} from '../framework/tactical-field.mjs';
import {planFlightRoutes,rankDiveSetups} from '../framework/flight-worker-planner.mjs';
import {planCreatureDecision} from '../framework/decision-engine.mjs';
export function processPlanningRequest({type,payload}){
  if(type==='routes')return planFlightRoutes(payload);
  if(type==='diveSetups')return rankDiveSetups(payload);
  if(type==='tacticalField')return buildTacticalField(payload.graph,payload.options);
  if(type==='decision')return planCreatureDecision(payload);
  throw new Error('Unknown flight planning request');
}
if(typeof self!=='undefined')self.onmessage=({data})=>{
  try{self.postMessage({id:data.id,result:processPlanningRequest(data)});}
  catch(error){self.postMessage({id:data.id,error:error.message});}
};
