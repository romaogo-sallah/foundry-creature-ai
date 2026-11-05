# Ogre movement interruption — 2026-11-05

The latest failure in the live Arena world was not a failed Balance check. The Ogre remained standing. Version 0.26.1's landing correction therefore did not address this particular interruption.

## Retained evidence

- Scene: Stadium, `OTt3o0SfJZTLAc3r`; combat `4S1S1VuJ9tDSoKks`, round 6.
- Ogre token: `mPafCtAfnc4pG27p`.
- Balance message `4Y0Vd1P4wQ6zbXDo`: total **20**, DC **16**, success.
- AI message `xPsVGT2NVKLHhDRL`: runtime **0.26.1**, selected `stride:26,27`, movement incomplete, cost 0, two actions remaining.
- Recorded position changed from **(1890, 1960)** to **(1889, 1959)**. With the scene's 70-pixel grid this is a boundary adjustment, rather than a completed square of movement.
- Earlier retries also stopped after success (17) and critical success (25).
- A read-only native constraint/measurement inspection found the intended segment unobstructed and within the Ogre's 25-foot Speed. The Ogre was not Prone. No attacks, rolls, actor moves or turn changes were executed during this inspection. Temporary inspection Regions removed themselves.

Raw local evidence is retained in `.scratch/last-battle-world.json`, `.scratch/grease-stop-brief.json` and `.scratch/grease-motion-inspection.json`. The actor's native in-memory movement operation had been reinitialized after reloading; the chat message is the retained record of the failed operation.

## Cause and correction

Foundry 14 splits movement at Region event checkpoints. In `TokenDocument`'s movement update, it retains a whitelist of standard update options. Its continuation then builds the next update from those options. Module-specific options, including `foundry-creature-ai:resolved-movement`, are absent from that continuation.

Our manual movement hook previously bypassed automated movement only when that option was present. At the continuation, it treated the remaining native path as a new movement request. A native checkpoint can lie off the grid; the manual handler's validation then rejected it, stopping the already reserved Stride. The Balance roll had already succeeded and was unrelated to that rejection.

Version **0.26.2** remembers the managed markers by TokenDocument and native movement ID. A continuation referencing that movement chain receives the markers again, including Sneak when applicable. The hook bypasses only that same resolved chain; an independent drag still undergoes normal action, reaction and grid checks. The cache is bounded and does not change native wall or movement-cost constraints.

Regression tests reproduce a successful Balance followed by a native boundary continuation whose custom options have been dropped. They check completion, one Balance roll, one action spent, recorded distance, no false pause, preservation of Sneak, separate-token isolation and normal validation of subsequent manual drags. A new live combat move still needs to be tried after all clients reload.
