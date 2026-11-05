export const MANTICORE_VENOM=Object.freeze({id:'manticore-venom',name:'Manticore Venom',dc:22,level:6,durationRounds:6,
  stages:[{damage:'1d10',enfeebled:1},{damage:'2d10',enfeebled:1},{damage:'2d10',enfeebled:2}]});

export function poisonStage(stage,degree,{exposure=false,maxStage=3}={}){
  if(!Number.isInteger(degree)||degree<0||degree>3)throw new Error('Poison needs a resolved native saving throw');
  if(exposure&&degree>=2)return stage;
  const change=degree===3?-2:degree===2?-1:degree===1?1:2;
  return Math.max(0,Math.min(maxStage,stage+change));
}

// A benchmark for the monster's own venom, not the target's actual Fortitude,
// immunity or secret save result. Repeated known hit attempts reduce novelty.
export const venomBenefit=(knownHits=0)=>(5.5+3)/(1+knownHits*0.5);
