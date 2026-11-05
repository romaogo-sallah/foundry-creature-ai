// Foundry Script macro. Select tokens as GM, then run this macro.
// Restores ALL token actor overrides from the sidebar actor, including items
// and conditions. Token placement and AI preferences are preserved.
try {
  const api = game.modules.get('foundry-creature-ai')?.api;
  if (!api?.resetActors) throw new Error('Reload Foundry Creature AI 0.22.1 or later first');
  const report = await api.resetActors();
  if (report.restored.length) ui.notifications.info(`Reset ${report.restored.length} actor(s) to prototype state. AI is paused; use Run turn to resume.`);
  for (const entry of report.skipped) ui.notifications.warn(`${entry.name}: skipped — ${entry.reason}.`);
  for (const entry of report.errors) ui.notifications.error(`${entry.name}: reset incomplete — ${entry.reason}. Retry after resolving the error.`);
  console.info('Creature AI actor reset:', report);
} catch (error) {
  console.error('Creature AI actor reset:', error);
  ui.notifications.error(error.message);
}
