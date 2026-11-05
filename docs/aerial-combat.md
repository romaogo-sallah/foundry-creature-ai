# Airborne opponents and the Eagle hover follow-up

The earlier native replay established only the next climb. It did not execute an attack or a complete live combat turn. The recorded battle did include Eagle Dives against the Ogre Boss in round 2; those were attacks against ground prey.

The same native attack geometry supports flying opponents. An Eagle's Dive endpoints use the target's current elevation and body height and need a ten-foot descent from the eagle's own origin. They need not end at ground elevation. The scorpion-tail Manticore can Fly into Stinger reach, attack and withdraw; the quill-tail variant can fire Spike or Spike Volley at airborne creatures within range. Ordinary native attacks use three-dimensional body-box reach and physical sight/line of effect across scene levels.

Four explicit complete-turn regressions now verify an Eagle diving into a Large flying opponent's altitude band, an eagle staging and attacking that opponent on the following turn, a Stinger/venom pass against a flyer, and ranged quill attacks with resource consumption and flight maintenance. These run with real planning worker threads and stubbed native roll results; they prove the engine executes its attack pipeline rather than stopping after a climb. No live actors were used for those rolls.

A separate read-only native preview placed each real Eagle hypothetically at 40 ft, leaving its live token at 5 ft. Both selected **Eagle Dive against the actual Manticore at 20 ft**. Both also had legal Dive options against the Ogre Boss. No attacks, movement or damage were executed in that native preview.

The follow-up exposed another hover loop in 0.31.0: one eagle had 24 accepted climbing routes, but the climb's value was smaller than its known Reactive Strike risk. It chose Hover and remained exposed. Patch **0.31.1** gives a safe escape destination its full recovery value at the beginning of the turn, preserving the reaction-risk deduction and all actual reaction prompts. A failing regression reproduced Hover before the fix; after the fix the controller climbs, spends one Fly action and still offers the real reaction prompt.

The tactics remain basic. An altitude outside a flying enemy's current melee reach does not prevent that enemy following on its next turn. Current plans do not predict full aerial pursuit/interception, coordinate a flying surround or model an opponent's future multi-action movement. The patch fixes a decision deadlock; it does not claim a complete air-combat policy or relax physical attack legality.

As the user continued the live combat during inspection, the Manticore reached 125 ft and the eagles reached 110/145 ft. A fresh patched preview at those new positions offered the higher eagle a Dive ending at 135 ft. The earlier hypothetical 40-ft preview is not an attack position against an opponent that has since climbed to 125 ft. The changing altitudes illustrate the present policy's tendency to seek height advantage against another flyer; a separate aerial interception policy remains future work.

The patch release suite passed **873 tests**, including the air-to-air and reaction escape regressions, in approximately 17 seconds with 11 isolated parallel test processes.
