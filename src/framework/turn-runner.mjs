// Shared action runner. A single GM owns it; reservations prevent free retries.
export class TurnRunner {
  constructor(adapter,{presentation=null,onEncounterComplete=null}={}) { this.adapter = adapter; this.presentation=presentation;this.onEncounterComplete=onEncounterComplete;this.running = false; this.cancelled = false; }

  cancel() { this.cancelled = true; this.abortController?.abort(); }

  async completeIfEncounterOver(ledger, turn) {
    if (this.adapter.turnKey() !== turn) return null;
    const outcome = this.adapter.encounterOutcome?.();
    if (!outcome) return null;
    const ended = { ...ledger, done: true, completionReason: 'battle-over', freeEscapeStride: false, pendingSweep: null };
    if (ledger.completionReason !== 'battle-over') {
      await this.adapter.saveLedger(ended);
      await this.adapter.report({ chosen: { id: 'battle-over', kind: 'endTurn', actionCost: 0 },
        reason: outcome.message, diagnostics: { noActionReason: outcome.message } }, ended);
    }
    await this.onEncounterComplete?.(outcome);
    return ended;
  }

  async waitForReactions(turn) {
    const ready = await this.adapter.waitForReactions?.({ signal: this.abortController?.signal }) ?? true;
    return ready && !this.cancelled && this.adapter.turnKey() === turn;
  }

  async clearRecoveredState(ledger, turn) {
    if (!this.adapter.turnEndReason || this.adapter.turnEndReason() || this.adapter.turnKey() !== turn ||
      (ledger.completionReason !== 'incapacitated' && !ledger.incapacitationReason)) return ledger;
    // Healing/recovery does not grant actions, reset MAP, or undo a spent move.
    // Write explicit nulls: Foundry merges nested flag objects on update.
    const recovered = { ...ledger, done: ledger.actionsRemaining === 0,
      completionReason: null, incapacitationReason: null, freeEscapeStride: false };
    await this.adapter.saveLedger(recovered);
    return recovered;
  }

  async completeTurn(ledger, { oneAction }, turn) {
    const encounterEnd = await this.completeIfEncounterOver(ledger, turn);
    if (encounterEnd) return encounterEnd;
    ledger = await this.clearRecoveredState(ledger, turn);
    const canAdvance = () => (!oneAction || ledger.completionReason === 'incapacitated') &&
      !this.cancelled && !ledger.uncertain && this.adapter.turnKey() === turn &&
      (ledger.completionReason !== 'incapacitated' || !this.adapter.turnEndReason || Boolean(this.adapter.turnEndReason()));
    if (!canAdvance()) return ledger;
    if (!await this.waitForReactions(turn)) return ledger;
    const endedAfterReactions = await this.completeIfEncounterOver(ledger, turn);
    if (endedAfterReactions) return endedAfterReactions;
    ledger = await this.clearRecoveredState(ledger, turn);
    if (!canAdvance()) return ledger;
    const finished = await this.adapter.finishTurn?.(ledger, { canAdvance, signal: this.abortController?.signal }) ?? ledger;
    return await this.completeIfEncounterOver(finished, turn) ?? this.clearRecoveredState(finished, turn);
  }

  async completeIfIncapacitated(ledger, options, turn) {
    let reason = this.adapter.turnEndReason?.();
    if (!reason) return null;
    const ended = () => ({ ...ledger, done: true, completionReason: 'incapacitated', incapacitationReason: reason, freeEscapeStride: false });
    if (this.adapter.turnKey() !== turn) return ended();
    await this.adapter.assertTurnContext?.();
    if (this.adapter.turnKey() !== turn) return ended();
    // Effects or healing can finish while waiting for the current context/movement.
    reason = this.adapter.turnEndReason?.();
    if (!reason) return null;
    const terminal = ended();
    if (!ledger.done || ledger.completionReason !== 'incapacitated' || ledger.incapacitationReason !== reason) {
      await this.adapter.saveLedger(terminal);
      await this.adapter.report({ chosen: { id: 'incapacitated', kind: 'endTurn', actionCost: 0 }, reason: 'incapacitated' }, terminal);
    }
    const finished = await this.completeTurn(terminal, options, turn);
    // A full run can continue with its existing budget if recovery happened while
    // reporting or waiting to advance. Never rewind combat after it already advanced.
    return this.adapter.turnKey() === turn && finished.completionReason !== 'incapacitated' && finished.completionReason !== 'battle-over' ? null : finished;
  }

  async run({ oneAction = false } = {}) {
    if (this.running) throw new Error('This creature is already acting');
    this.running = true;
    this.cancelled = false;
    this.abortController = new AbortController();
    try {
      const turn = this.adapter.turnKey();
      const ready = await this.waitForReactions(turn);
      let ledger = await this.adapter.readLedger(turn);
      if (!ready) return ledger;
      const encounterEnd = await this.completeIfEncounterOver(ledger, turn);
      if (encounterEnd) return encounterEnd;
      if (ledger.uncertain) throw new Error('The previous action was interrupted. Check its result and correct the action ledger before continuing.');
      const initiallyEnded = await this.completeIfIncapacitated(ledger, { oneAction }, turn);
      if (initiallyEnded) return initiallyEnded;
      ledger = await this.clearRecoveredState(ledger, turn);
      if (ledger.done && ledger.actionsRemaining === 0 && !ledger.bonusMovementActions) return await this.completeTurn(ledger, { oneAction }, turn);
      // Earlier versions marked a blocked choice done even with unspent actions.
      // Reopening the chooser may retry those actions, without increasing their budget.
      if (ledger.done) ledger = { ...ledger, done: false };
      for (let iterations = 0; iterations < 10; iterations++) {
        if (!await this.waitForReactions(turn)) return ledger;
        const encounterEnd = await this.completeIfEncounterOver(ledger, turn);
        if (encounterEnd) return encounterEnd;
        const ended = await this.completeIfIncapacitated(ledger, { oneAction }, turn);
        if (ended) return ended;
        if (await this.adapter.prepareTurn?.({ signal: this.abortController.signal, ledger,
          canContinue: () => !this.cancelled && this.adapter.turnKey() === turn }) === false) {
          return await this.completeIfEncounterOver(ledger, turn) ?? await this.completeIfIncapacitated(ledger, { oneAction }, turn) ?? ledger;
        }
        try { await this.adapter.assertReady(); }
        catch (error) {
          const encounterEnd = await this.completeIfEncounterOver(ledger, turn);
          if (encounterEnd) return encounterEnd;
          const terminal = await this.completeIfIncapacitated(ledger, { oneAction }, turn);
          if (terminal) return terminal;
          throw error;
        }
        let state;
        const planningOptions={signal:this.abortController.signal};
        try{state=await this.adapter.snapshot(ledger,planningOptions);}
        catch(error){if(this.cancelled||this.abortController.signal.aborted||this.adapter.turnKey()!==turn)return ledger;throw error;}
        if(this.cancelled||this.adapter.turnKey()!==turn)return ledger;
        const endedAfterRefresh = await this.completeIfIncapacitated(ledger, { oneAction }, turn);
        if (endedAfterRefresh) return endedAfterRefresh;
        const encounterEndAfterRefresh = await this.completeIfEncounterOver(ledger, turn);
        if (encounterEndAfterRefresh) return encounterEndAfterRefresh;
        const decision = await this.adapter.decide(state);
        const choice = decision.chosen;
        if (!choice || choice.kind === 'endTurn') {
          ledger = { ...ledger, done: ledger.actionsRemaining === 0 || Boolean(decision.diagnostics?.turnComplete || decision.diagnostics?.retreatComplete || decision.diagnostics?.encounterComplete || decision.diagnostics?.escapeExhausted),
            ...(ledger.actionsRemaining === 0 ? { bonusMovementActions: 0, pendingSweep: null } : {}),
            completionReason: decision.diagnostics?.turnComplete ? 'no-useful-actions' : decision.diagnostics?.retreatComplete ? 'retreated' : decision.diagnostics?.encounterComplete ? 'no-enemies' : decision.diagnostics?.escapeExhausted ? 'escape-blocked' : null,
            incapacitationReason: null, freeEscapeStride: false };
          await this.adapter.saveLedger(ledger);
          await this.adapter.report(decision, ledger);
          return await this.completeTurn(ledger, { oneAction }, turn);
        }
        try { await this.adapter.revalidate(choice, ledger,planningOptions); }
        catch (error) {
          if(this.cancelled||this.abortController.signal.aborted||this.adapter.turnKey()!==turn)return ledger;
          const encounterEnd = await this.completeIfEncounterOver(ledger, turn);
          if (encounterEnd) return encounterEnd;
          const terminal = await this.completeIfIncapacitated(ledger, { oneAction }, turn);
          if (terminal) return terminal;
          throw error;
        }
        if (this.cancelled || this.adapter.turnKey() !== turn) return ledger;
        const encounterEndBeforeAction = await this.completeIfEncounterOver(ledger, turn);
        if (encounterEndBeforeAction) return encounterEndBeforeAction;
        const endedBeforeAction = await this.completeIfIncapacitated(ledger, { oneAction }, turn);
        if (endedBeforeAction) return endedBeforeAction;
        if(this.presentation){
          const canContinue=()=>!this.cancelled&&this.adapter.turnKey()===turn;
          if(await this.presentation.beforeAction({adapter:this.adapter,decision,state,ledger,signal:this.abortController.signal,canContinue})===false)return ledger;
          if(!await this.waitForReactions(turn))return ledger;
          const encounterEndDuringPause=await this.completeIfEncounterOver(ledger,turn);
          if(encounterEndDuringPause)return encounterEndDuringPause;
          const endedDuringPause=await this.completeIfIncapacitated(ledger,{oneAction},turn);
          if(endedDuringPause)return endedDuringPause;
          // The pause is before reservation. Recheck the original choice against
          // live state without rerolling its tie or spending a stale action.
          try{await this.adapter.revalidate(choice,ledger,planningOptions);}
          catch(error){if(this.cancelled||this.abortController.signal.aborted||this.adapter.turnKey()!==turn)return ledger;const terminal=await this.completeIfEncounterOver(ledger,turn)??await this.completeIfIncapacitated(ledger,{oneAction},turn);if(terminal)return terminal;throw error;}
          if(!canContinue())return ledger;
        }
        const encounterEndBeforeReservation=await this.completeIfEncounterOver(ledger,turn);
        if(encounterEndBeforeReservation)return encounterEndBeforeReservation;
        // Reserve the cost BEFORE any asynchronous game mutation or roll.
        const beforeAction = ledger;
        ledger = {
          ...ledger, actionsRemaining: ledger.actionsRemaining - choice.actionCost,
          ...(choice.bonusActionCost ? { bonusMovementActions: ledger.bonusMovementActions - choice.bonusActionCost } : {}),
          attacksMade: ledger.attacksMade + (choice.mapIncreases ?? Number(['strike', 'escape'].includes(choice.kind))),
          lastAction: null, uncertain: true, done: false, completionReason: null, incapacitationReason: null,
          freeEscapeStride: false, pendingSweep: null,
        };
        await this.adapter.saveLedger(ledger);
        if (this.cancelled || this.adapter.turnKey() !== turn) return ledger;
        if(this.adapter.encounterOutcome?.()){
          // No action has executed: release this known-unused reservation.
          ledger=beforeAction;
          await this.adapter.saveLedger(ledger);
          return await this.completeIfEncounterOver(ledger,turn)??ledger;
        }
        const result = await this.adapter.execute(choice, ledger, {
          canContinue: () => !this.cancelled && this.adapter.turnKey() === turn,
          signal: this.abortController.signal,
        });
        if (!result.skipped && (result.movement?.completed || choice.kind==='stand'))
          await this.adapter.reactions?.afterMoveAction?.(this.adapter.token,{valid:()=>!this.cancelled&&this.adapter.turnKey()===turn});
        if (this.adapter.turnKey() !== turn) {
          // Another module may already advance after a death. Do not write an
          // old ledger over the next turn or request nextTurn a second time.
          return result.endTurn ? { ...ledger, done: true, uncertain: false, completionReason: 'incapacitated',
            incapacitationReason: result.incapacitationReason } : ledger;
        }
        // Only an explicit, known-unexecuted result can release a reservation.
        // Errors keep their reservation because their outcome may be unknown.
        if (result.skipped) {
          ledger = beforeAction;
          await this.adapter.saveLedger(ledger);
          await this.adapter.report(decision, ledger, result);
          const encounterEnd=await this.completeIfEncounterOver(ledger,turn);
          if(encounterEnd)return encounterEnd;
          const terminal = await this.completeIfIncapacitated(ledger, { oneAction }, turn);
          if (terminal) return terminal;
          if (oneAction || result.pause || this.cancelled) return ledger;
          continue;
        }
        const reached = Object.hasOwn(result, 'destination') ? result.destination : choice.destination;
        // An execution result describes an earlier instant. Prefer the live actor
        // if a reaction/effect healed or replaced its synthetic actor since then.
        const incapacitated = this.adapter.turnEndReason ? this.adapter.turnEndReason() : result.incapacitationReason;
        ledger = {
          ...ledger, lastAction: result.lastAction ?? { kind: choice.kind }, uncertain: false,
          ...(result.attackNotAttempted?{attacksMade:Math.max(beforeAction.attacksMade,ledger.attacksMade-(choice.mapIncreases??0))}:{}),
          ...(result.forfeitActions ? { actionsRemaining: 0, bonusMovementActions: 0 } : {}),
          pendingSweep: result.pendingSweep ?? null,
          ...(choice.kind === 'bellow' ? { commandedThisTurn: true } : {}),
          ...(choice.kind === 'strike' && choice.features?.frontline ? { frontlineEngaged: true } : {}),
          escapeBlocked: result.escapeBlocked ?? ledger.escapeBlocked ?? false,
          freeEscapeStride: result.freeEscapeStride ?? false,
          visited: [...ledger.visited, ...(reached ? [Number.isFinite(reached.elevation)?`${reached.x},${reached.y},${reached.elevation}`:`${reached.x},${reached.y}`] : [])],
          ...(incapacitated ? { done: true, completionReason: 'incapacitated', incapacitationReason: incapacitated, freeEscapeStride: false } :
            result.retreatComplete ? { done: true, completionReason: 'retreated', incapacitationReason: null, freeEscapeStride: false } :
              { completionReason: null, incapacitationReason: null }),
        };
        await this.adapter.saveLedger(ledger);
        await this.adapter.report(decision, ledger, result);
        const encounterEndAfterAction = await this.completeIfEncounterOver(ledger, turn);
        if (encounterEndAfterAction) return encounterEndAfterAction;
        if(this.presentation&&await this.presentation.afterAction?.({adapter:this.adapter,decision,ledger,result,signal:this.abortController.signal,
          canContinue:()=>!this.cancelled&&this.adapter.turnKey()===turn})===false)return ledger;
        if (incapacitated || result.retreatComplete) return await this.completeTurn(ledger, { oneAction }, turn);
        // Rolls-only mode needs the GM to apply damage before rebuilding target HP.
        if (oneAction || result.pause || this.cancelled) return ledger;
        if (ledger.actionsRemaining < 1 && !ledger.bonusMovementActions && !result.lastAction?.freeFollowUp) {
          ledger = { ...ledger, done: true };
          await this.adapter.saveLedger(ledger);
          return await this.completeTurn(ledger, { oneAction }, turn);
        }
      }
      throw new Error('Creature action limit reached; inspect its action ledger');
    } finally { this.running = false; }
  }
}
