

import { authorize, check } from '../contracts.ts';

import { withVault, type Handler } from './admission.ts';
export const METHODS: Record<string, Handler> = {

"updates.status": async (internals, payload) => {
const method = "updates.status";
return internals.updateService().view();
},
"updates.settings": async (internals, payload) => {
const method = "updates.settings";
return internals.updateService().settings(payload);
},
"updates.check": async (internals, payload) => {
const method = "updates.check";
return internals.updateService().checkNow();
},
"updates.verify": withVault(async (internals, payload, store, ctx, s) => {
const method = "updates.verify";
authorize(store, ctx, 'admin');
check(!ctx.sourceTainted && s.updater, 'UPDATES_UNAVAILABLE', 'Updates aren\'t set up in this copy of Chausar.');
return s.updater.verify(payload.manifest, payload.signature);
}),
"updates.stage": withVault(async (internals, payload, store, ctx, s) => {
const method = "updates.stage";
authorize(store, ctx, 'admin');
check(!ctx.sourceTainted && s.updater && payload.confirmed === true, 'UPDATES_UNAVAILABLE', 'Review and explicitly confirm a publisher-signed update.');
return s.updater.stage(payload.manifest, payload.signature);
})
};
