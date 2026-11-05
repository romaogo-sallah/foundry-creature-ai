# Foundry diagnostic actors

Foundry v14 `Actor.create` and `Actor.createDocuments` save database documents. Passing `temporary: true` did not prevent world actor records in our native inspection calls. The earlier assumption that these diagnostic actors stayed entirely in memory was incorrect.

The 5 November 2026 cleanup matched exact injected effect IDs against the inspection scripts. It removed seven unreferenced Manticore copies after checking all scene tokens and combatants. The Dero diagnostic actor had since become the prototype for two scene tokens, so that actor was preserved and only its `inspectEffect001` test effect was removed. A full backup of all eight actors and their references is stored at `.scratch/diagnostic-actors-backup-2026-11-05.json`; the cleanup report is `.scratch/diagnostic-actor-cleanup-result.json`. Original actors with matching names but no diagnostic marker were preserved.

Native inspections now use `tools/diagnostic-actor.mjs`. It constructs an isolated actor with `new CONFIG.Actor.documentClass`, assigns a fresh ID, verifies that it is absent from the world collection, and rejects persistent actor/embedded-item updates, flags and damage calls. Diagnostic state changes must be supplied as new source data to another in-memory construction. It never calls the persistent static factory.

The three affected inspection generators and their generated plans were corrected. Future native diagnostics must check world actor IDs/counts before and after execution, and temporary script Regions must still delete themselves in `finally`. Native preparation, queries and `updateSource` on the detached object can be used for read-only validation; persistent creation is not a substitute for detached construction.
