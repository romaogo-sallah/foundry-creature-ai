import { MODULE_ID, escapeHTML } from './pf2e-adapter.mjs';

export const REACTION_QUERY = `${MODULE_ID}.reactionPrompt`;
import {combatStamp} from './combat-stamp.mjs';
export {combatStamp};

export function reactionOwner(token) {
  const owners = (game.users.contents ?? []).filter(user => user.active && !user.isGM &&
    token.actor.testUserPermission(user, 'OWNER'));
  owners.sort((a, b) => Number(b.character?.id === token.actor.id) - Number(a.character?.id === token.actor.id) || a.id.localeCompare(b.id));
  return owners[0] ?? game.users.activeGM;
}

// Foundry's authenticated User.query transport is available in v14. No socket
// library or player-to-GM execution request is needed: only the active GM rolls.
export class ReactionPrompts {
  constructor({ timeoutMs = 60000, pollMs = 250 } = {}) {
    this.timeoutMs = timeoutMs;
    this.pollMs = pollMs;
    this.dialogs = new Map();
  }

  install() {
    CONFIG.queries ??= {};
    CONFIG.queries[REACTION_QUERY] = (data, { user }) => this.receive(data, user);
  }

  async receive(data, sender, canAnswer = () => true) {
    if (!sender?.isGM || sender.id !== game.users.activeGM?.id) throw new Error('Reaction prompts must come from the active GM');
    if (data.cancel) { await this.dialogs.get(data.id)?.close(); return 'pause'; }
    const currentToken = () => game.scenes?.get(data.sceneId)?.tokens.get(data.tokenId) ??
      (canvas.scene?.id === data.sceneId ? canvas.tokens.get(data.tokenId)?.document : null);
    const token = currentToken();
    if (!token?.actor || (!game.user.isGM && !token.actor.testUserPermission(game.user, 'OWNER'))) return 'pause';
    const promptCombat = () => data.combatId ? game.combats?.get(data.combatId) ??
      (game.combat?.id === data.combatId ? game.combat : null) : game.combat;
    const valid = () => {
      const actor = currentToken()?.actor;
      return Boolean(canAnswer() && actor && combatStamp(promptCombat()) === data.stamp && game.users.activeGM?.id === sender.id &&
        !game.paused && Date.now() < data.expires && (game.user.isGM || actor.testUserPermission(game.user, 'OWNER')));
    };
    if (!valid()) return 'pause';
    let timer;
    try {
      const answer = await foundry.applications.api.DialogV2.wait({
        window: { title: data.title },
        content: `<p>${escapeHTML(data.description)}</p><p>${data.kind === 'movement' ? 'Choose the movement action you are spending. Cancel leaves the token in place. Manual action counts remain your responsibility.' : 'Using a reaction spends it until your next turn. Pass keeps it available. Closing this prompt pauses automation.'}</p>`,
        buttons: [...data.choices.map(choice => ({ action: choice.id, label: choice.label })),
          { action: 'pass', label: data.kind === 'movement' ? 'Cancel movement' : 'Pass', default: true }, { action: 'pause', label: 'Pause automation' }],
        rejectClose: false,
        render: (_event, dialog) => {
          this.dialogs.set(data.id, dialog);
          if (timer) return;
          timer = setInterval(() => { if (!valid()) void dialog.close(); }, this.pollMs);
        },
      });
      return valid() && [...data.choices.map(choice => choice.id), 'pass'].includes(answer) ? answer : 'pause';
    } finally {
      clearInterval(timer);
      this.dialogs.delete(data.id);
    }
  }

  async ask({ token, title, description, choices, valid = () => true, kind }) {
    if (game.users.activeGM?.id !== game.user.id) throw new Error('Only the active GM can request reactions');
    const owner = reactionOwner(token);
    if (!owner) throw new Error('No active GM is available for reaction prompts');
    const data = { id: foundry.utils.randomID(), sceneId: token.document.parent.id, tokenId: token.id, combatId: game.combat?.id,
      title, description, choices, kind, stamp: combatStamp(), expires: Date.now() + this.timeoutMs };
    const current = () => valid() && combatStamp() === data.stamp && !game.paused && game.users.activeGM?.id === game.user.id;
    if (!current()) return 'pause';
    const query = (user, payload) => user.id === game.user.id
      ? this.receive(payload, game.user, current) : user.query(REACTION_QUERY, payload, { timeout: this.timeoutMs + 5000 });
    let timer;
    let cancel;
    const guard = new Promise(resolve => {
      cancel = reason => resolve({ interrupted: true, reason });
      timer = setInterval(() => {
        if (!current()) cancel('The trigger changed or automation was stopped.');
        else if (!owner.active) cancel('The owner disconnected.');
        else if (Date.now() >= data.expires) cancel('The reaction prompt timed out.');
      }, this.pollMs);
    });
    if (owner.id !== game.user.id) globalThis.ui?.notifications?.info(`Waiting for ${owner.name ?? owner.id}: ${title}`);
    const request = Promise.resolve().then(() => query(owner, data)).then(answer => ({ answer }), error => ({ interrupted: true, reason: error.message }));
    try {
      const result = await Promise.race([request, guard]);
      if (result.interrupted) {
        // The acknowledgement can arrive later; it is never used for a stale trigger.
        void Promise.resolve().then(() => query(owner, { id: data.id, cancel: true })).catch(() => {});
        if (!current()) return 'pause';
        // A disconnected or unresponsive owner never silently forfeits a reaction.
        const fallback = { ...data, id: foundry.utils.randomID(), expires: Date.now() + this.timeoutMs,
          description: `${result.reason} GM decision for ${token.name}: ${description}` };
        return await this.receive(fallback, game.user, current);
      }
      return current() && [...choices.map(choice => choice.id), 'pass'].includes(result.answer) ? result.answer : 'pause';
    } finally { clearInterval(timer); }
  }
}
