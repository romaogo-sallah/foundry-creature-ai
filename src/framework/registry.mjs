import { investigationCandidates } from './pursuit.mjs';
import { chooseTacticalAction } from './tactical-behaviors.mjs';

export class CapabilityRegistry {
  constructor() { this.capabilities = new Map(); this.profiles = new Map(); }
  registerCapability(id, build) {
    if (this.capabilities.has(id) || typeof build !== 'function') throw new Error(`Invalid or duplicate capability: ${id}`);
    this.capabilities.set(id, build); return this;
  }
  registerProfile(profile) {
    if (!profile.id || this.profiles.has(profile.id) || !Array.isArray(profile.capabilities)) throw new Error('Invalid or duplicate creature profile');
    for (const id of profile.capabilities) if (!this.capabilities.has(id)) throw new Error(`Unknown capability: ${id}`);
    this.profiles.set(profile.id, Object.freeze({ ...profile, capabilities: Object.freeze([...profile.capabilities]) })); return this;
  }
  candidates(id, state) {
    const profile = this.profiles.get(id);
    if (!profile) throw new Error(`No supported creature profile: ${id}`);
    const candidates=profile.capabilities.flatMap(capability => this.capabilities.get(capability)(state, profile));
    return profile.capabilities.includes('movement')?[...candidates,...investigationCandidates(state,candidates)]:candidates;
  }
  decide(id, state, { random = Math.random } = {}) {
    return chooseTacticalAction(this.candidates(id, state), state, { actionsRemaining: state.actionsRemaining,
      bonusMovementActions: state.bonusMovementActions ?? 0, threatened: state.self.threatened, random });
  }
}
