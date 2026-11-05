import {getRulesRuntime} from './runtime.mjs';
import {registerLegacyRuleFlags} from '../foundry/legacy-rule-flags.mjs';
const runtime=getRulesRuntime();runtime.publish();
Hooks.once('init',registerLegacyRuleFlags);
Hooks.once('ready',()=>runtime.start().catch(runtime.onError));
