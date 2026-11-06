import { preferenceChange, readAppPreferences, writeAppPreferences } from '../app-preferences.ts';
import { check } from '../contracts.ts';
import { withVault, type Handler } from './admission.ts';
export const METHODS: Record<string, Handler> = {
  "whatsNew.get": async (internals, payload) => {
    const method = "whatsNew.get";
    return internals.whatsNew(method, payload);
  },
  "whatsNew.seen": async (internals, payload) => {
    const method = "whatsNew.seen";
    return internals.whatsNew(method, payload);
  },
  "app.preferences.get": async (internals, payload) => {
    check(Object.keys(payload).length === 0, 'INVALID_PREFERENCE', 'Ask for the settings of this app with nothing else.'); return readAppPreferences(internals.options.directory);
  },
  "app.preferences.set": async (internals, payload) => {
    const change = preferenceChange(payload);
    if (internals.vault) internals.requireWorkspaceOwner(internals.context);
    return writeAppPreferences(internals.options.directory, change);
  },
  "trust.update": withVault(async (internals, payload, store, ctx, s) => {
    return s.trust.updatePolicy(ctx, payload.policy ?? payload);
  })
};
