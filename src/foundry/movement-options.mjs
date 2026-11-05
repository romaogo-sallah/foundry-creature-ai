// Only the module's already-resolved movement bypasses the manual drag handler.
export const MANAGED_MOVEMENT = 'foundry-creature-ai:resolved-movement';
export const REQUESTED_MOVEMENT = 'foundry-creature-ai:requested-movement';

const managedChains = new WeakMap();

// Foundry 14 retains only standard update options when it continues a move at
// a Region checkpoint. Reattach our boolean markers to that same native chain;
// an unrelated drag must still pass through the manual action/reaction handler.
export function inheritManagedMovement(document, movement, options = {}) {
  const known = managedChains.get(document);
  const inherited = options[MANAGED_MOVEMENT] ? Object.fromEntries(Object.entries(options)
    .filter(([key,value]) => key.startsWith('foundry-creature-ai:') && typeof value === 'boolean')) :
    [movement?.id,...(movement?.chain ?? [])].map(id => known?.get(id)).find(Boolean);
  if (!inherited) return false;
  Object.assign(options,inherited);
  if (movement?.id) {
    const chains = known ?? new Map();
    chains.set(movement.id,inherited);
    // A chain carries its immediate predecessor, so retaining recent segments
    // is sufficient even for long paths. The WeakMap also releases old tokens.
    while (chains.size > 64) chains.delete(chains.keys().next().value);
    managedChains.set(document,chains);
  }
  return true;
}
