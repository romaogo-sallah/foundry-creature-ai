import { MODULE_ID, MANAGED_OPTION, SKIP_RULE_AUTOMATION, escapeHTML, rollEvent } from './pf2e-adapter.mjs';

const restrictions = new Set(['grabbed', 'restrained', 'immobilized']);
const grappleEffects = {
  'effect-grabbed-until-end-of-attacker-next-turn': { item: '5MNn6cmXxbORB8x8', condition: 'kWc1fhmv9LBiTuei', slug: 'grabbed' },
  'effect-restrained-until-end-of-attacker-next-turn': { item: 'zol83j7l2cBSmY3a', condition: 'VcDeM8A5oI6VqhbM', slug: 'restrained' },
};
const isUUID = (value, pack, id) => value === `Compendium.${pack}.Item.${id}` || value === `Compendium.${pack}.${id}`;

// PF2e Automations locks the granted condition against direct deletion. Escape
// ends its specific granting effect, letting PF2e cascade the condition normally.
// Recognize the inspected effects by provenance AND their single-purpose grant;
// an unrelated spell or a modified effect with other rules remains manual.
function supportedGrappleEffect(condition, effect) {
  const spec = grappleEffects[effect?.slug];
  if (!spec || effect.type !== 'effect' || condition.slug !== spec.slug) return false;
  const source = effect.sourceId ?? effect._stats?.compendiumSource;
  if (!isUUID(source, 'pf2e-automations.effects', spec.item)) return false;
  const rules = effect.system?.rules ?? [];
  const grants = Object.values(effect.flags?.pf2e?.itemGrants ?? {});
  return rules.length === 1 && rules[0].key === 'GrantItem' &&
    isUUID(rules[0].uuid, 'pf2e.conditionitems', spec.condition) &&
    !rules[0].predicate?.length && !rules[0].inMemoryOnly &&
    grants.length === 1 && grants[0].id === condition.id &&
    condition.flags?.pf2e?.grantedBy?.id === effect.id && condition.flags.pf2e.grantedBy.onDelete === 'cascade';
}

function recordedSource(adapter, group) {
  const spell = group.root.flags?.[MODULE_ID];
  if (spell?.spellEffect === 'tangle-vine' && Number.isFinite(spell.escapeDC))
    return { tokenId: null, actorUuid: null, customDC: spell.escapeDC, recorded: true };
  const origin = group.root.system?.context?.origin;
  if (!origin?.token || !origin.actor) return null;
  const target = canvas.tokens.placeables.find(token => {
    const uuid = token.document.uuid ?? `Scene.${token.document.parent?.id}.Token.${token.id}`;
    return uuid === origin.token && token !== adapter.token && token.actor &&
      (token.actor.uuid === origin.actor || `Actor.${token.document.actorId}` === origin.actor);
  });
  return target ? { tokenId: target.id, actorUuid: target.actor.uuid, customDC: null, recorded: true } : null;
}

// Group granted Immobilized under its actual Grabbed/Restrained parent. An Escape
// removes ONE cause, not every condition sharing the same slug on the actor.
export function escapeBindings(actor) {
  const groups = new Map();
  for (const effect of actor.itemTypes?.effect ?? []) if (effect.flags?.[MODULE_ID]?.spellEffect === 'tangle-vine')
    groups.set(effect.id,{id:effect.id,root:effect,conditions:[],kind:'spell-restraint',removable:!effect.isLocked&&!effect.readonly});
  for (const slug of restrictions) for (const condition of actor.getCondition(slug, { all: true }) ?? []) {
    if (condition.active === false) continue;
    let root = condition;
    const seen = new Set();
    while (root.appliedBy && restrictions.has(root.appliedBy.slug) && !seen.has(root.id)) {
      seen.add(root.id); root = root.appliedBy;
    }
    const wrapped = supportedGrappleEffect(root, root.appliedBy) || root.appliedBy?.flags?.[MODULE_ID]?.spellEffect === 'tangle-vine';
    if (wrapped) root = root.appliedBy;
    if (!root.id) continue;
    const group = groups.get(root.id) ?? { id: root.id, root, conditions: [],
      kind: wrapped ? 'grapple-effect' : 'condition',
      removable: !root.isLocked && !root.readonly && !root.inMemoryOnly && !root.appliedBy,
      blockedReason: root.appliedBy ? `granted by unsupported effect: ${root.appliedBy.name ?? root.appliedBy.slug ?? 'unknown source'}` :
        root.isLocked || root.readonly || root.inMemoryOnly ? 'locked or temporary condition source' : null };
    if (!group.conditions.some(entry => entry.id === condition.id)) group.conditions.push(condition);
    groups.set(root.id, group);
  }
  return [...groups.values()];
}

export function escapeOptions(adapter) {
  const action = game.pf2e.actions.get('escape');
  const previews = action?.getDefaultVariant?.().preview({ actor: adapter.actor }) ?? [];
  const best = previews.filter(entry => ['unarmed', 'acrobatics', 'athletics'].includes(entry.slug) && Number.isFinite(entry.modifier))
    .sort((a, b) => b.modifier - a.modifier)[0];
  if (!best) return [];
  const settings = adapter.token.document.getFlag(MODULE_ID, 'escapeSources') ?? {};
  return escapeBindings(adapter.actor).filter(group => group.removable).flatMap(group => {
    const source = settings[group.id] ?? recordedSource(adapter, group);
    if (!source) return [];
    const target = source.tokenId ? canvas.tokens.get(source.tokenId) : null;
    if (source.tokenId && (!target?.actor || target.actor.uuid !== source.actorUuid)) return [];
    const dc = source.customDC ?? target?.actor.getStatistic?.('athletics')?.dc?.value;
    return Number.isFinite(dc) && dc > 0 ? [{ id: group.id, group, target, dc, statistic: best.slug, bonus: best.modifier,
      recordedSource: source.recorded === true }] : [];
  });
}

export async function configureEscapes(adapter, { valid = () => true, force = false } = {}) {
  let settings = adapter.token.document.getFlag(MODULE_ID, 'escapeSources') ?? {};
  for (const group of escapeBindings(adapter.actor)) {
    if (!valid()) return false;
    if (!group.removable) continue; // Granted/locked effects need their own outcome handler.
    if (!force && escapeOptions(adapter).some(option => option.id === group.id)) continue;
    const sources = canvas.tokens.placeables.filter(token => token !== adapter.token && token.actor?.isOfType?.('creature') && !token.document.hidden);
    const saved = settings[group.id] ?? recordedSource(adapter, group);
    let timer;
    let answer;
    try {
      answer = await foundry.applications.api.DialogV2.wait({
        window: { title: `Escape — ${adapter.token.name}` },
        content: `<p>Set the source of <strong>${escapeHTML(group.root.name ?? group.root.slug)}</strong>. This does not spend an action.</p>
          <p>Choose the creature holding this wolf to use its current Athletics DC, or enter the effect's known Escape DC. Confirm that Escape can end this particular cause.</p>
          <div class="form-group"><label>Creature holding the wolf</label><select name="source"><option value="">Effect / custom DC</option>
          ${sources.map(token => `<option value="${escapeHTML(token.id)}" ${saved?.tokenId === token.id ? 'selected' : ''}>${escapeHTML(token.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Custom Escape DC (optional with a creature)</label><input name="dc" type="number" min="1" step="1" value="${saved?.customDC ?? ''}"></div>`,
        buttons: [{ action: 'save', label: 'Save Escape source', default: true, callback: (_event, button) => ({
          tokenId: button.form.elements.source.value, dc: button.form.elements.dc.value }) },
          { action: 'pause', label: 'Handle manually', callback: () => null }],
        rejectClose: false,
        render: (_event, dialog) => { timer ??= setInterval(() => { if (!valid()) void dialog.close(); }, 250); },
      });
    } finally { clearInterval(timer); }
    if (!answer || !valid()) return false;
    if (!escapeBindings(adapter.actor).some(current => current.id === group.id)) continue;
    const target = answer.tokenId ? canvas.tokens.get(answer.tokenId) : null;
    if (answer.tokenId && !target?.actor) throw new Error('The selected Escape source left the scene. No action was spent.');
    const customDC = String(answer.dc).trim() ? Number(answer.dc) : null;
    const dc = customDC ?? target?.actor.getStatistic?.('athletics')?.dc?.value;
    if (!Number.isInteger(dc) || dc < 1) throw new Error('Escape needs a positive DC, or a creature with a prepared Athletics DC. No action was spent.');
    settings = { ...settings, [group.id]: { tokenId: target?.id ?? null, actorUuid: target?.actor.uuid ?? null, customDC } };
    await adapter.token.document.setFlag(MODULE_ID, 'escapeSources', settings);
  }
  return valid();
}

export async function executeEscape(adapter, choice, ledger, valid) {
  const option = escapeOptions(adapter).find(entry => entry.id === choice.escapeId);
  if (!option) {
    if (!escapeBindings(adapter.actor).some(group => group.id === choice.escapeId)) {
      return { skipped: true, skipReason: 'That restraint already ended. Escape was not spent.' };
    }
    return { skipped: true, pause: true, skipReason: 'The Escape source, DC or condition changed. No Escape action was spent; configure its source before resuming.' };
  }
  if (choice.estimate && (choice.estimate.dc !== option.dc || choice.statistic !== option.statistic)) {
    return { skipped: true, pause: true, skipReason: 'The Escape statistic or DC changed. No Escape action was spent; preview again.' };
  }
  if (ledger.escapeBlocked) return { skipped: true, pause: true, skipReason: 'A critical failure prevents another Escape this turn.' };
  // PF2e falls back to the user's target tool when target is omitted. A custom
  // effect/DC has no opposing creature, so explicitly use the escaping actor.
  const results = await game.pf2e.actions.get('escape').use({ actors: [adapter.actor], target: option.target ?? adapter.actor,
    statistic: choice.statistic, difficultyClass: { value: option.dc }, multipleAttackPenalty: ledger.attacksMade > 1 ? -5 * Math.min(ledger.attacksMade - 1, 2) : 0,
    rollOptions: [MANAGED_OPTION, SKIP_RULE_AUTOMATION], event: rollEvent('check') });
  const outcome = results?.[0]?.outcome;
  if (!['criticalSuccess', 'success', 'failure', 'criticalFailure'].includes(outcome)) throw new Error('Escape was cancelled or has no resolved outcome');
  if (!valid()) throw new Error('Automation stopped or the turn changed while Escape resolved; inspect its result before resuming.');
  if (['success', 'criticalSuccess'].includes(outcome)) {
    const current = escapeBindings(adapter.actor).find(group => group.id === option.id);
    if (current && !current.removable) throw new Error('The escaped condition became locked. Resolve its outcome manually.');
    if (current) await adapter.actor.deleteEmbeddedDocuments('Item', [current.root.id]);
    if (current?.kind === 'grapple-effect' && adapter.actor.items?.has(current.root.id)) {
      throw new Error('Escape succeeded but the granting grapple effect remains. Resolve that source before resuming.');
    }
    const originalIds = new Set(option.group.conditions.map(condition => condition.id));
    if (escapeBindings(adapter.actor).some(group => group.id === option.id || group.conditions.some(condition => originalIds.has(condition.id)))) {
      throw new Error('Escape succeeded but its linked conditions remain. Resolve that source before resuming.');
    }
  }
  const freeStride = outcome === 'criticalSuccess' && !adapter.actor.hasCondition('prone', 'grabbed', 'restrained', 'immobilized');
  return { lastAction: { kind: 'escape', outcome, freeFollowUp: freeStride }, escapeBlocked: outcome === 'criticalFailure', freeEscapeStride: freeStride };
}
