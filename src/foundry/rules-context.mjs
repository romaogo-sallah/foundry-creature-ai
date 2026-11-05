// Persisted document flags keep their original namespace across the package
// split. Package IDs own lifecycle hooks and settings, never duplicate state.
export const MODULE_ID='foundry-creature-ai';
export const MANAGED_OPTION=`${MODULE_ID}:managed`;
export const MANAGED_TRIP_OPTION=`${MODULE_ID}:trip`;
export const SKIP_RULE_AUTOMATION='skip-handling-message';
export const CORE_ID='pf2e-tactical-core';
export const ENVIRONMENT_ID='pf2e-tactical-environment';
export const CONDITIONS_ID='pf2e-tactical-conditions';
export const MOVEMENT_ID='pf2e-tactical-movement';
export function rollEvent(type){
  return {shiftKey:Boolean(game.user.settings[type==='damage'?'showDamageDialogs':'showCheckDialogs']),ctrlKey:false,metaKey:false};
}
export const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
