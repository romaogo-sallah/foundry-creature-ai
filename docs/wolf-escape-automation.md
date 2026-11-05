# Escape compatibility fix — version 0.7.1

Patch **0.7.2** also makes Escape roll automatically with either GM check-dialog preference, matching jaws and Knockdown. The installed PF2e roll-event functions are used in a regression test to verify that the roll dialog is skipped for both settings. Source/DC setup still appears when necessary.

PF2e Automations applies its grapple outcome as an effect that grants a locked Grabbed or Restrained condition. Earlier versions saw the locked child, excluded it from Escape and skipped source setup. A restrained wolf could consequently report endTurn with all three actions unspent.

The module now recognizes the installed automation's two dedicated effects, validates their condition grant, and treats the granting effect as the Escape cause:

- Grabbed until end of attacker next turn.
- Restrained until end of attacker next turn.

Recognition requires the known compendium identity, a matching single GrantItem rule, exactly one corresponding item grant, and a cascading child relationship. Modified effects with extra rules, other grants, temporary sources and unknown granting effects remain manual.

If the effect records its originating actor and scene token, the module uses that attacker's current prepared Athletics DC. It does not guess from proximity or the GM's target tool. The actor/token references must match; replacing the actor invalidates that inference. Explicit GM source/DC settings take precedence. When a supported cause lacks usable origin metadata, the existing source setup dialog appears before any action is spent.

A successful Escape deletes that specific granting effect through PF2e's native embedded-item deletion API. PF2e cascades its linked conditions; unrelated restraints remain. The module verifies that the effect and original restrictions ended. An unchanged effect or incomplete removal pauses the runner rather than granting another free attempt. Escape retains the normal action cost, MAP increase and critical-failure restriction.

Reload every connected client with **Ctrl+F5**, then select the affected wolf and use **Alt+W → Run turn** while its turn is active. Previously preserved actions remain available; this update does not refund spent actions or edit the world database.

This diagnosis was confirmed against a read-only copy of the user's scene records and the installed PF2e 8.6.1 condition/grant-deletion implementation. Automated regressions recreate the effect relationships and recorded source, exercise the full runner, and check unrelated restraints, absent metadata, actor replacement and refused deletion. A running-world smoke test remains necessary.
