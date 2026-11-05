export function checkDegree(die, bonus, dc) {
  const total = die + bonus;
  let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (die === 20) degree = Math.min(3, degree + 1);
  if (die === 1) degree = Math.max(0, degree - 1);
  return degree;
}

export function expectedDamage(bonus, referenceAC, damage) {
  let total = 0;
  for (let die = 1; die <= 20; die++) {
    const degree = checkDegree(die, bonus, referenceAC);
    total += degree === 3 ? damage * 2 : degree === 2 ? damage : 0;
  }
  return total / 20;
}

export function checkProbabilities(bonus, dc) {
  const results = [0, 0, 0, 0];
  for (let die = 1; die <= 20; die++) results[checkDegree(die, bonus, dc)] += 1 / 20;
  return { criticalFailure: results[0], failure: results[1], success: results[2], criticalSuccess: results[3] };
}

export function averageFormula(formula) {
  const text = String(formula).replaceAll(' ', '');
  if (!/^[+-]?(?:\d*d\d+|\d+)(?:[+-](?:\d*d\d+|\d+))*$/i.test(text)) {
    throw new Error(`Unsupported damage formula: ${formula}`);
  }
  return [...text.matchAll(/([+-]?)(\d*d\d+|\d+)/gi)].reduce((sum, [, sign, term]) => {
    const dice = term.toLowerCase().split('d');
    const value = dice.length === 2 ? Number(dice[0] || 1) * (Number(dice[1]) + 1) / 2 : Number(term);
    return sum + (sign === '-' ? -value : value);
  }, 0);
}

