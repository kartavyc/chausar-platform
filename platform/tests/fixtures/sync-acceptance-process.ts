import { FileSyncTransport } from '../../runtime/sync-file-transport.ts';
// This host-Node fixture starts a fresh process over the dedicated C-only store.
// Publications supplied here originate from real Engine/Vault.backup flows.
process.once('message', async (message: any) => {
  try {
    const transport = new FileSyncTransport({ directory: message.directory, workspaceId: message.workspaceId,
      vaultId: message.vaultId, clock: () => new Date(message.time) });
    let result;
    if (message.operation === 'head') result = await transport.getHead();
    else if (message.operation === 'lease') result = await transport.acquireLease(message.input);
    else if (message.operation === 'put') result = await transport.put(message.input);
    else throw new Error('Unknown authored operation.');
    process.send?.({ ok: true, result });
  } catch (error: any) { process.send?.({ ok: false, code: error.code, message: error.message }); }
});
process.once('disconnect', () => process.exit(0));
