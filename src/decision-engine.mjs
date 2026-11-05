// Earlier, independent profile-demo engine. Live wolves now use dawnsbury/chooser.mjs.
// No Dawnsbury method bodies or scoring formulas are used in THIS demo engine.
// Candidates must come from a rules adapter, which alone determines legal actions.
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

function read(object, path) {
  return path.split('.').reduce((value, key) =>
    forbiddenKeys.has(key) || value == null || !Object.hasOwn(value, key)
      ? undefined : value[key], object);
}

function matches(object, conditions = {}) {
  return Object.entries(conditions).every(([path, condition]) => {
    const value = read(object, path);
    if (condition === null || typeof condition !== 'object') return value === condition;
    return Object.entries(condition).every(([operator, operand]) => {
      switch (operator) {
        case 'eq': return value === operand;
        case 'in': return Array.isArray(operand) && operand.includes(value);
        case 'gte': return Number.isFinite(value) && value >= operand;
        case 'lte': return Number.isFinite(value) && value <= operand;
        default: throw new Error(`Unsupported condition operator: ${operator}`);
      }
    });
  });
}

export function resolveProfile(profiles, id, ancestors = []) {
  if (ancestors.includes(id)) throw new Error(`Profile inheritance cycle: ${[...ancestors, id].join(' -> ')}`);
  const profile = Object.hasOwn(profiles, id) ? profiles[id] : undefined;
  if (!profile) throw new Error(`Unknown profile: ${id}`);
  const base = profile.extends ? resolveProfile(profiles, profile.extends, [...ancestors, id]) : {};
  return {
    ...base, ...profile, id,
    weights: { ...base.weights, ...profile.weights },
    // A child adds its special decisions before its parent's defaults.
    rules: [...(profile.rules ?? []), ...(base.rules ?? [])],
  };
}

function score(candidate, profile) {
  const terms = Object.entries(profile.weights ?? {}).map(([feature, weight]) => {
    const value = candidate.features?.[feature] ?? 0;
    if (!Number.isFinite(weight) || !Number.isFinite(value)) {
      throw new Error(`Non-finite score input for ${candidate.id}: ${feature}`);
    }
    const contribution = value * weight;
    if (!Number.isFinite(contribution)) throw new Error(`Score overflow for ${candidate.id}`);
    return { feature, value, weight, contribution };
  });
  const utility = terms.reduce((total, term) => total + term.contribution, 0);
  if (!Number.isFinite(utility)) throw new Error(`Score overflow for ${candidate.id}`);
  return { candidate, utility, terms: terms.filter(term => term.contribution !== 0) };
}

/** Select ONE action. Refresh the snapshot after execution before deciding again. */
export function decide(snapshot, profile) {
  if (!Number.isInteger(snapshot.actionsRemaining) || snapshot.actionsRemaining < 0) {
    throw new Error('actionsRemaining must be a nonnegative integer');
  }
  const ids = new Set();
  const rejected = [];
  const ranked = [];
  for (const candidate of snapshot.candidates ?? []) {
    if (typeof candidate.id !== 'string' || !candidate.id || ids.has(candidate.id)) {
      throw new Error('Candidates require unique nonempty string IDs');
    }
    ids.add(candidate.id);
    let reason;
    if (candidate.legal !== true) reason = 'legality not confirmed by adapter';
    else if (!Number.isInteger(candidate.actionCost) || candidate.actionCost < 0) reason = 'invalid action cost';
    else if (candidate.actionCost > snapshot.actionsRemaining) reason = 'insufficient actions';
    else if (profile.allowedKinds && !profile.allowedKinds.includes(candidate.kind)) reason = 'excluded by profile';
    else if (candidate.fallback !== undefined && typeof candidate.fallback !== 'boolean') reason = 'invalid fallback marker';
    if (reason) rejected.push({ id: candidate.id, reason });
    else ranked.push(score(candidate, profile));
  }
  // Equal utility preserves adapter order, so decisions can be replayed deterministically.
  ranked.sort((a, b) => b.utility - a.utility);
  for (const rule of profile.rules ?? []) {
    if (!matches(snapshot, rule.when)) continue;
    const chosen = ranked.find(entry => matches(entry.candidate, rule.select));
    if (chosen) return { chosen: chosen.candidate, reason: `rule:${rule.id}`, ranked, rejected };
  }
  // Explicit idle/fallback actions never crowd out a positive-value normal action.
  const useful = ranked.find(entry => !entry.candidate.fallback && entry.utility > 0 &&
    matches(entry.candidate, profile.utilityFilter));
  const fallback = ranked.find(entry => entry.candidate.fallback);
  const chosen = useful ?? fallback;
  return {
    chosen: chosen?.candidate ?? null,
    reason: useful ? 'utility' : fallback ? 'fallback' : 'no useful legal action',
    ranked, rejected,
  };
}
