// Foundry Script macro. Select NPC tokens as the active GM, then run.
try {
  const api=game.modules.get('foundry-creature-ai')?.api;
  if(!api?.enableFullAuto)throw new Error('Reload Foundry Creature AI 0.33.1 or later first');
  const report=await api.enableFullAuto();
  if(report.enabled.length)ui.notifications.info(`Full auto enabled for ${report.enabled.length} NPC(s): act at turn start and pass turn when finished.`);
  for(const entry of report.skipped)ui.notifications.warn(`${entry.name}: skipped — ${entry.reason}.`);
  for(const entry of report.errors)ui.notifications.error(`${entry.name}: ${entry.reason}`);
  console.info('Creature AI full auto:',report);
}catch(error){
  console.error('Creature AI full auto:',error);
  ui.notifications.error(error.message);
}
