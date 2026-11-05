const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// This is an encounter-pacing assessment explicitly requested by the GM. It
// reads prepared AC only for the front-line preference, not for attack/DC scoring.
export function frontlineAssessments(tokens) {
  const characters = tokens.filter(token => token.actor?.type === 'character').map(token => ({
    id: token.id, name: token.name,
    maxHP: token.actor.hitPoints?.max ?? token.actor.system?.attributes?.hp?.max,
    ac: token.actor.armorClass?.value ?? token.actor.system?.attributes?.ac?.value,
  })).filter(entry => Number.isFinite(entry.maxHP) && entry.maxHP > 0 && Number.isFinite(entry.ac) && entry.ac > 0);
  if (!characters.length) return new Map();
  const hpThreshold = median(characters.map(entry => entry.maxHP)), acThreshold = median(characters.map(entry => entry.ac));
  return new Map(characters.map(entry => [entry.id, { ...entry, hpThreshold, acThreshold,
    frontline: entry.maxHP >= hpThreshold && entry.ac >= acThreshold }]));
}
