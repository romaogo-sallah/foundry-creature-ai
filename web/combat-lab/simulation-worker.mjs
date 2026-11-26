import {CombatLab} from '../../src/simulation/combat-lab.mjs';

self.onmessage=event=>{
  try { self.postMessage({ok:true,report:new CombatLab(event.data.scenario).run()}); }
  catch(error){self.postMessage({ok:false,error:error?.stack??String(error)});}
};
