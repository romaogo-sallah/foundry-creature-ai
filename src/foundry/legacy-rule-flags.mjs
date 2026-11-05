import {MODULE_ID} from './rules-context.mjs';
// Foundry caches the active flag scopes. The legacy namespace is a persisted
// data schema, not a dependency on AI code; Core owns its compatibility alias.
// Document ownership/GM permissions remain enforced by the native backend.
export function registerLegacyRuleFlags(){
  const scopes=globalThis.CONFIG?.DatabaseBackend?.getFlagScopes?.();
  if(Array.isArray(scopes)&&!scopes.includes(MODULE_ID))scopes.push(MODULE_ID);
}
