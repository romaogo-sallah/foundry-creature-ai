export const TERRAIN_NAMESPACE = 'foundry-creature-ai';
export const ENVIRONMENT_SCRIPT = "game.modules.get('pf2e-tactical-core')?.api?.rules?.zones?.refresh?.();";
export const HAZARD_SCRIPT = "await game.modules.get('pf2e-tactical-core')?.api?.rules?.terrain?.onHazardMove(event, region, behavior);";

export function terrainBehavior(behavior, kind) {
  const source = kind === 'environment' ? ENVIRONMENT_SCRIPT : kind === 'hazard' ? HAZARD_SCRIPT : null;
  const legacy=kind==='environment'?"game.modules.get('foundry-creature-ai')?.api?.zones?.refresh?.();":
    kind==='hazard'?"await game.modules.get('foundry-creature-ai')?.api?.terrain?.onHazardMove(event, region, behavior);":null;
  return Boolean(source && behavior.type === 'executeScript' && [source,legacy].includes(behavior.system?.source) &&
    behavior.flags?.[TERRAIN_NAMESPACE]?.terrain?.kind === kind);
}

export function environmentBehavior(config) {
  return { name: 'Creature AI: Cover / concealment', type: 'executeScript', disabled: !config.enabled,
    flags: { [TERRAIN_NAMESPACE]: { terrain: { kind: 'environment' }, environment: config } },
    system: { events: ['behaviorActivated', 'behaviorDeactivated', 'regionBoundary'], source: ENVIRONMENT_SCRIPT } };
}

export function hazardBehavior({ formula = '1d6', damageType = 'piercing', frequency = 'manual' } = {}) {
  return { name: `Creature AI: Hazardous terrain (${formula} ${damageType})`, type: 'executeScript', disabled: false,
    flags: { [TERRAIN_NAMESPACE]: { terrain: { kind: 'hazard', formula, damageType, frequency } } },
    system: { events: ['tokenMoveIn', 'tokenMoveWithin'], source: HAZARD_SCRIPT } };
}
