import { PhoneClient } from '../../../platform/runtime/phone/client.ts';
import { PhoneError, requirePhone } from '../../../platform/runtime/phone/contracts.ts';
import type { AppChannel, BriefCache, DeviceBinding, PhoneCredentialStore, PhoneMethods, PhoneTransport } from '../../../platform/runtime/phone/contracts.ts';
import type { BriefCacheKeyProvider, OpaqueBriefStorage } from '../../../platform/runtime/phone/cache.ts';
import { CompanionController } from './controller.ts';
import type { CompanionDeviceIdentity, CompanionDocumentPicker, CompanionReceiptReader } from './view-contracts.ts';

export type LiveCompanionAdapters = { channel: AppChannel; transport: PhoneTransport; credentials: PhoneCredentialStore; cache: BriefCache; identity: CompanionDeviceIdentity; picker: CompanionDocumentPicker; receipts: CompanionReceiptReader; crypto: Crypto; requestId: () => string };
/** Real hosts explicitly inject each adapter; the live factory never substitutes a demo. */
export function createLiveCompanionController(adapters: LiveCompanionAdapters) {
  requirePhone(!!adapters && ['ios', 'android', 'web'].includes(adapters.channel) && typeof adapters.transport?.request === 'function' && typeof adapters.credentials?.load === 'function' && typeof adapters.credentials?.save === 'function' && typeof adapters.credentials?.clear === 'function' && typeof adapters.cache?.put === 'function' && typeof adapters.cache?.read === 'function' && typeof adapters.cache?.clear === 'function' && typeof adapters.identity?.preparePairing === 'function' && typeof adapters.picker?.pick === 'function' && typeof adapters.receipts?.read === 'function' && typeof adapters.crypto?.subtle?.digest === 'function' && typeof adapters.requestId === 'function', 'INVALID_REQUEST');
  return new CompanionController({ client: new PhoneClient({ channel: adapters.channel, transport: adapters.transport, credentials: adapters.credentials, cache: adapters.cache, crypto: adapters.crypto }), identity: adapters.identity, picker: adapters.picker, receipts: adapters.receipts, crypto: adapters.crypto, requestId: adapters.requestId, mode: 'live' });
}

const methods = new Set<keyof PhoneMethods>(['pairing.accept', 'session.validate', 'session.revoke', 'brief.list', 'brief.read', 'chat.start', 'upload.begin', 'upload.chunk', 'upload.finish', 'approval.list', 'approval.inspect', 'approval.submit', 'request.status', 'request.cancel']);
export type DeviceRequestProof = { deviceId: string; keyId: string; timestamp: string; nonce: string; signature: string };
export interface DeviceRequestSigner { sign(input: { method: keyof PhoneMethods; path: '/api/companion/rpc'; body: string; signal: AbortSignal }): Promise<DeviceRequestProof>; }
/** Proposed fixed RPC adapter for coordinator wiring. TLS + key-possession proof required. */
export function createHttpPhoneTransport(options: { origin: string; fetcher: typeof fetch; signer: DeviceRequestSigner }): PhoneTransport {
  requirePhone(!!options && typeof options.fetcher === 'function' && typeof options.signer?.sign === 'function', 'INVALID_REQUEST');
  let origin: URL;
  try { origin = new URL(options.origin); } catch { throw new PhoneError('INVALID_REQUEST'); }
  requirePhone(origin.protocol === 'https:' && !origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/', 'INVALID_REQUEST');
  return { async request<M extends keyof PhoneMethods>(method: M, input: PhoneMethods[M]['input'], auth: { credential?: string; signal: AbortSignal }): Promise<PhoneMethods[M]['output']> {
    requirePhone(methods.has(method) && !auth.signal.aborted, 'INVALID_REQUEST');
    const payload = method === 'upload.chunk' ? { ...(input as PhoneMethods['upload.chunk']['input']), bytes: Array.from((input as PhoneMethods['upload.chunk']['input']).bytes) } : input;
    const body = JSON.stringify({ protocolVersion: 1, method, payload }); const path = '/api/companion/rpc' as const;
    let proof: DeviceRequestProof;
    try { proof = await options.signer.sign({ method, path, body, signal: auth.signal }); } catch { throw new PhoneError(auth.signal.aborted ? 'VALIDATION_REQUIRED' : 'TRANSPORT_UNKNOWN'); }
    requirePhone(proof && ['deviceId', 'keyId', 'timestamp', 'nonce', 'signature'].every(key => { const value = proof[key as keyof DeviceRequestProof]; return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\r\n]/.test(value); }), 'INVALID_RESPONSE');
    requirePhone(!auth.signal.aborted, 'VALIDATION_REQUIRED');
    requirePhone(!auth.credential || typeof auth.credential === 'string' && auth.credential.length <= 4096 && !/[\r\n]/.test(auth.credential), 'INVALID_REQUEST');
    let response: Response;
    try { response = await options.fetcher(`${origin.origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth.credential ? { Authorization: `Bearer ${auth.credential}` } : {}), 'X-Chausar-Device': proof.deviceId, 'X-Chausar-Key': proof.keyId, 'X-Chausar-Time': proof.timestamp, 'X-Chausar-Nonce': proof.nonce, 'X-Chausar-Proof': proof.signature }, body, signal: auth.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' }); } catch { throw new PhoneError(auth.signal.aborted ? 'VALIDATION_REQUIRED' : 'TRANSPORT_UNKNOWN'); }
    requirePhone((response.headers.get('content-type') ?? '').startsWith('application/json'), 'INVALID_RESPONSE');
    let text: string; try { text = await response.text(); } catch { throw new PhoneError(auth.signal.aborted ? 'VALIDATION_REQUIRED' : 'TRANSPORT_UNKNOWN'); }
    requirePhone(!auth.signal.aborted, 'VALIDATION_REQUIRED'); requirePhone(text.length <= 2 * 1024 * 1024, 'INVALID_RESPONSE');
    let envelope: any; try { envelope = JSON.parse(text); } catch { throw new PhoneError('INVALID_RESPONSE'); }
    if (!response.ok || envelope?.error) {
      const code = envelope?.error?.code; const known = ['ACCESS_REVOKED', 'SESSION_EXPIRED', 'UNPAIRED', 'CAPABILITY_FORBIDDEN', 'APPROVAL_EXPIRED', 'APPROVAL_USED', 'PREVIEW_CHANGED', 'OPEN_DESKTOP', 'INVALID_REQUEST'];
      throw new PhoneError(known.includes(code) ? code : response.status === 401 || response.status === 403 ? 'ACCESS_REVOKED' : 'TRANSPORT_UNKNOWN');
    }
    requirePhone(envelope && Object.hasOwn(envelope, 'result'), 'INVALID_RESPONSE'); return envelope.result;
  } };
}

/** Dedicated browser storage for encrypted brief bytes and nonexportable CryptoKeys. */
export async function openBrowserBriefStore(factory: IDBFactory, crypto: Crypto, databaseName = 'chausar-companion-preview-v1') {
  const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open(databaseName, 1); request.onupgradeneeded = () => { request.result.createObjectStore('briefs'); request.result.createObjectStore('keys'); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new PhoneError('CACHE_INVALID')); });
  async function action<T>(storeName: 'briefs' | 'keys', mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => { const tx = database.transaction(storeName, mode); const request = work(tx.objectStore(storeName)); let result: T; request.onsuccess = () => { result = request.result; }; tx.oncomplete = () => resolve(result); tx.onabort = tx.onerror = () => reject(new PhoneError('CACHE_INVALID')); });
  }
  const storage: OpaqueBriefStorage = {
    list: async () => (await action('briefs', 'readonly', store => store.getAllKeys())).map(String),
    get: async key => { const value = await action('briefs', 'readonly', store => store.get(key)); return value instanceof Uint8Array ? Uint8Array.from(value) : value instanceof ArrayBuffer ? new Uint8Array(value.slice(0)) : undefined; },
    set: async (key, bytes) => { await action('briefs', 'readwrite', store => store.put(Uint8Array.from(bytes), key)); },
    remove: async key => { await action('briefs', 'readwrite', store => store.delete(key)); },
    clear: async () => { await action('briefs', 'readwrite', store => store.clear()); },
  };
  const keyId = async (binding: DeviceBinding) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([binding.workspaceId, binding.memberId, binding.deviceId, binding.epoch]))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const keys: BriefCacheKeyProvider = { getKey: async binding => { const id = await keyId(binding); return await action('keys', 'readonly', store => store.get(id)) as CryptoKey | undefined; }, clear: async () => { await action('keys', 'readwrite', store => store.clear()); } };
  async function provision(binding: DeviceBinding) {
    const id = await keyId(binding); const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await new Promise<void>((resolve, reject) => { const tx = database.transaction('keys', 'readwrite'); const store = tx.objectStore('keys'); const request = store.get(id); request.onsuccess = () => { if (!request.result) store.add(candidate, id); }; tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new PhoneError('CACHE_INVALID')); });
  }
  return { storage, keys, provision, close: () => database.close() };
}
