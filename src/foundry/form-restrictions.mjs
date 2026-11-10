import {vampireForm} from './vampire-state.mjs';
// Polymorph by itself is not a casting ban. Use active native BattleForm
// rules (including canCast exceptions) or an explicitly taught animal form.
export function formSpellcastingRestriction(actor){
 const form=vampireForm(actor);
 if(form==='mist')return 'Mist form cannot cast spells.';
 if(form==='bat')return 'Vampire giant-bat form cannot cast spells; return to vampire form first.';
 if((actor?.itemTypes?.effect??[]).some(e=>!e.isExpired&&!e.system?.disabled&&(e.slug??e.system?.slug)==='spell-effect-vapor-form'))return 'Vapor Form cannot cast spells.';
 const rules=(actor?.rules??[]).filter(r=>r.key==='BattleForm'&&!r.ignored&&!r.item?.isExpired);
 if(rules.length)return rules.some(r=>r.canCast!==true)?'This battle form cannot cast spells.':null;
 return actor?.flags?.pf2e?.battleForm===true?'This battle form cannot cast spells.':null;
}
