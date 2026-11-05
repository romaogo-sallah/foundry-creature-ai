import {CORE_ID,MODULE_ID} from './rules-context.mjs';
export const rulesAPI=()=>game.modules?.get?.(CORE_ID)?.api?.rules??game.modules?.get?.(MODULE_ID)?.api;
