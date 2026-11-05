# Aerial combat — 0.32.0

## Altitude feedback loop

The latest retained battle, combat `U2O3fPySVzeYEtCH`, reached round 10 with the Manticore at 195 ft and the Eagles at 210/215 ft. Most actions were climbs. The Manticore did fire a split Volley in round 9, but the overall behavior was still wrong: each flyer treated the other's new altitude as ground clearance to exceed. Supporting attacks against a stationary airborne target did not prevent this feedback loop when both opponents were controlled by the AI.

Version 0.32.0 separates mobile aerial threats from ground prey. Physical native melee danger still includes both. A mobile flyer's current height no longer raises the shared ground-hunting cruise altitude. The reusable air-to-air policy selects engagement, bounded height preparation, ranged fire, or disengagement toward protection.

## Speed advantage and commitment

A faster Eagle can build height before attacking. The initial setup goal uses the known opponent's elevation, body height, fly Speed and reach: body top + three ascending Fly actions at half Speed + reach + one grid step. This is a conservative tactical estimate, not a guarantee against all movement abilities, ranged weapons or reactions.

The goal and target persist when the first action executes. A climbing opponent cannot increase that goal on each snapshot. At most three setup Fly actions are allowed across turns; even an interrupted, spent Fly counts. Setup only scores when a future native Dive pass is available from a proposed position. A ready useful Dive can begin earlier, and direct attacks remain available. An attack records a short preparation cooldown. Resetting actors clears these plans too.

A complete ready Dive at the start of a turn competes as an activity goal, with a measured escape Fly still included. Three-dimensional approach, ordinary melee Strikes and withdrawal also work against airborne opponents. Post-attack withdrawal values actual separation and an affordable climb rather than continually raising an absolute altitude target. An approach that would spend the penultimate action entering melee and then flee without striking is suppressed.

## Slower flyers and protection

When a higher, faster opponent cannot be reached efficiently with an attack left, a melee flyer can descend toward known cover, concealment or wall-blocked sight. The capability estimate includes the extra cost of ascent. Protection goals are sampled from scene geometry and checked from the known observers; route costs, body occupancy, walls and physical surfaces still receive native validation. Flight can explicitly land for this plan instead of forcing immediate takeoff.

After reaching protection, the shared Hide action rolls normally and saves observer-relative results. Planning retains estimated chances rather than learning secret success or failure. A grounded flyer holding protection can wait until the opponent becomes answerable. Open ground grants no automatic Hide opportunity. This is a bounded tactical heuristic; it does not simulate the opponent's full future turn or search every possible hiding location.

The quill-tail Manticore compares ranged attacks before chasing altitude. A usable shot may make holding height and firing better than closing. Poor range can still motivate repositioning. Depleted spikes remove this response, so a sufficiently outmatched high opponent can trigger the same protected withdrawal as a melee kit.

## Validation

The additional regressions include a five-round duel with both flyers AI-controlled, finite and constrained setup budgets, the actual 195/215-foot geometry, ranged resource use, native-planner fallback and descent → landing → Hide with a deliberately failed secret roll. The duel uses actual worker threads and native API substitutes with fixed roll outcomes; it verifies planning and execution, not combat balance.

A fresh read-only preview in the real Stadium scene selected Eagle Dive from 215 ft against the actual Manticore at 195 ft. The other Eagle at 210 ft chose to approach its attack band. The Manticore's depleted ranged supply led it to close for melee instead of climbing above both Eagles. All three previews used the production worker and native geometry; no live actor moved, rolled, lost HP or spent actions/resources. The temporary inspection Region was removed.

## Earlier investigation: 0.31.1

The earlier native replay established only the next climb. It did not execute an attack or a complete live combat turn. The recorded battle did include Eagle Dives against the Ogre Boss in round 2; those were attacks against ground prey.

The same native attack geometry supports flying opponents. An Eagle's Dive endpoints use the target's current elevation and body height and need a ten-foot descent from the eagle's own origin. They need not end at ground elevation. The scorpion-tail Manticore can Fly into Stinger reach, attack and withdraw; the quill-tail variant can fire Spike or Spike Volley at airborne creatures within range. Ordinary native attacks use three-dimensional body-box reach and physical sight/line of effect across scene levels.

Four explicit complete-turn regressions now verify an Eagle diving into a Large flying opponent's altitude band, an eagle staging and attacking that opponent on the following turn, a Stinger/venom pass against a flyer, and ranged quill attacks with resource consumption and flight maintenance. These run with real planning worker threads and stubbed native roll results; they prove the engine executes its attack pipeline rather than stopping after a climb. No live actors were used for those rolls.

A separate read-only native preview placed each real Eagle hypothetically at 40 ft, leaving its live token at 5 ft. Both selected **Eagle Dive against the actual Manticore at 20 ft**. Both also had legal Dive options against the Ogre Boss. No attacks, movement or damage were executed in that native preview.

The follow-up exposed another hover loop in 0.31.0: one eagle had 24 accepted climbing routes, but the climb's value was smaller than its known Reactive Strike risk. It chose Hover and remained exposed. Patch **0.31.1** gives a safe escape destination its full recovery value at the beginning of the turn, preserving the reaction-risk deduction and all actual reaction prompts. A failing regression reproduced Hover before the fix; after the fix the controller climbs, spends one Fly action and still offers the real reaction prompt.

The tactics remain basic. An altitude outside a flying enemy's current melee reach does not prevent that enemy following on its next turn. Current plans do not predict full aerial pursuit/interception, coordinate a flying surround or model an opponent's future multi-action movement. The patch fixes a decision deadlock; it does not claim a complete air-combat policy or relax physical attack legality.

As the user continued the live combat during inspection, the Manticore reached 125 ft and the eagles reached 110/145 ft. A fresh patched preview at those new positions offered the higher eagle a Dive ending at 135 ft. The earlier hypothetical 40-ft preview is not an attack position against an opponent that has since climbed to 125 ft. The changing altitudes illustrate the present policy's tendency to seek height advantage against another flyer; a separate aerial interception policy remains future work.

The patch release suite passed **873 tests**, including the air-to-air and reaction escape regressions, in approximately 17 seconds with 11 isolated parallel test processes.
