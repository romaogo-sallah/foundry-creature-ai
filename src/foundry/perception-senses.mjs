// Ordinary hearing is imprecise. Special senses use PF2e's prepared acuity and
// range; sight-based upgrades such as darkvision cannot bypass Blinded.
const visual = new Set(['vision','darkvision','greater-darkvision','low-light-vision','see-invisibility','truesight']);
export function nonvisualSense(observer, subject) {
  const actor=observer.actor;
  const senses=actor?.perception?.senses??actor?.system?.perception?.senses??[];
  const available=Array.from(senses.values?.()??senses).filter(sense=>!visual.has(sense.type)&&
    ['precise','imprecise'].includes(sense.acuity)&&
    !(actor?.hasCondition('deafened')&&['hearing','echolocation'].includes(sense.type))&&
    (!subject||!sense.range||observer.distanceTo(subject)<=sense.range));
  const precise=available.find(sense=>sense.acuity==='precise');
  if(precise)return precise;
  if(!actor?.hasCondition('deafened'))return {type:'hearing',acuity:'imprecise'};
  return available[0]??null;
}

export function sensoryDetection(observer, subject, detection) {
  if(detection.state==='hidden'&&detection.source==='invisibility'&&!observer.actor?.hasCondition('blinded')&&
   (subject.actor.flags?.['foundry-creature-ai']?.revealed||(observer.actor.itemTypes?.effect??[]).some(e=>e.slug==='spell-effect-see-the-unseen'||e.flags?.['foundry-creature-ai']?.supportSpell?.slug==='see-the-unseen')))
   return {...detection,state:'observed',source:'revealed-invisibility'};
  if(!observer.actor?.hasCondition('blinded'))return detection;
  const sense=nonvisualSense(observer,subject);
  if(sense?.acuity==='precise')return detection;
  // A successful Sneak/other Undetected result always wins over ambient hearing.
  return {...detection,state:detection.state==='undetected'||!sense?'undetected':'hidden',
    source:detection.state==='undetected'?detection.source:'blinded',
    sense:sense?.type??null,precisionBlocked:true};
}
