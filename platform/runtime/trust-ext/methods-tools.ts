import type { MethodSpec } from '../modules/types.ts';
import { now } from '../contracts.ts';
import { onPurge, onTick } from './lifecycle.ts';
import { fields, tools } from './tools-common.ts';
import { canaryHit, checkCanary, modelsView, networkView, plantCanary, setModelCap } from './tools-network.ts';
import { recordView, syncChain, verifyRecord } from './tools-record.ts';
import { agreementsView, cleanSample, hostedView, sharingView, withdraw, withdrawSharing } from './tools-sharing.ts';
import { backupNow, deleteSource, deletions, exportDeletion, setLock, setRecoveryContact, testRestore, vaultView } from './tools-vault.ts';
import { assistantsView, pairAssistant, revokeAssistant, setAssistants } from './tools-assistants.ts';
import { inspect, installPlugin, pluginsView, purgePluginMeta, removePlugin } from './tools-plugins.ts';
import { languagePacks } from './tools-language.ts';

/** trustx.*: models, network, record, sharing, vault, deletion, assistants, plugins, language packs. */
export const trustToolsMethods: Record<string, MethodSpec> = {
  'trustx.models': { permission: 'read', handler: (ctx, payload, host) => { fields(payload, []); return modelsView(ctx, host); } },
  'trustx.setModelCap': { permission: 'admin', handler: setModelCap },
  'trustx.network': { permission: 'read', handler: networkView },
  'trustx.plantCanary': { permission: 'admin', handler: plantCanary },
  'trustx.checkCanary': { permission: 'admin', handler: checkCanary },
  'trustx.record': { permission: 'read', handler: recordView },
  'trustx.verifyRecord': { permission: 'read', handler: verifyRecord },
  'trustx.sharing': { permission: 'read', handler: (_ctx, payload, host) => { fields(payload, []); return sharingView(host.store.read()); } },
  'trustx.cleanSample': { permission: 'read', handler: cleanSample },
  'trustx.withdrawSharing': { permission: 'admin', handler: withdrawSharing },
  'trustx.vault': { permission: 'read', handler: (ctx, payload, host) => { fields(payload, []); return vaultView(ctx, host); } },
  'trustx.backupNow': { permission: 'admin', handler: backupNow },
  'trustx.testRestore': { permission: 'admin', handler: testRestore },
  'trustx.setLock': { permission: 'admin', handler: setLock },
  'trustx.setRecoveryContact': { permission: 'admin', handler: setRecoveryContact },
  'trustx.deleteSource': { permission: 'admin', handler: deleteSource },
  'trustx.deletions': { permission: 'read', handler: (_ctx, payload, host) => { fields(payload, []); return deletions(host.store.read()); } },
  'trustx.exportDeletion': { permission: 'admin', handler: exportDeletion },
  'trustx.hosted': { permission: 'read', handler: (_ctx, payload) => { fields(payload, []); return hostedView(); } },
  'trustx.agreements': { permission: 'read', handler: (_ctx, payload, host) => { fields(payload, []); return agreementsView(host); } },
  'trustx.withdraw': { permission: 'admin', handler: withdraw },
  'trustx.assistants': { permission: 'read', handler: (_ctx, payload, host) => { fields(payload, []); return assistantsView(host.store.read()); } },
  'trustx.setAssistants': { permission: 'admin', handler: setAssistants },
  'trustx.pairAssistant': { permission: 'admin', handler: pairAssistant },
  'trustx.revokeAssistant': { permission: 'admin', handler: revokeAssistant },
  'trustx.plugins': { permission: 'read', handler: (ctx, payload, host) => { fields(payload, []); return pluginsView(ctx, host); } },
  'trustx.inspectPlugin': { permission: 'admin', handler: (_ctx, payload, host) => { fields(payload, ['manifest', 'moduleBase64', 'publisher', 'signature', 'licence']); return inspect(host.store.read(), host, payload); } },
  'trustx.installPlugin': { permission: 'admin', handler: installPlugin },
  'trustx.removePlugin': { permission: 'admin', handler: removePlugin },
  'trustx.languagePacks': { permission: 'read', handler: (_ctx, payload) => { fields(payload, []); return languagePacks(); } },
};

// Purge: grants for plugins that are gone, and withdrawals for agreements that were removed.
onPurge(state => {
  let removed = purgePluginMeta(state);
  const withdrawals = tools(state).withdrawals;
  if (withdrawals) for (const id of Object.keys(withdrawals)) if (!state.learning.some(item => item.id === id)) { delete withdrawals[id]; removed++; }
  return removed;
});

// Tick: keep the record chain current and check the canary.
onTick(async (ctx, host) => {
  await syncChain(host);
  const alert = canaryHit(host.store.read());
  if (alert && !tools(host.store.read()).canary?.alert) return [{ part: 'trust-tools', canary: (await checkCanary(ctx, {}, host)).alert, at: now() }];
  return [];
});
