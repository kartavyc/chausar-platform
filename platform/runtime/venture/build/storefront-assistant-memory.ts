// One bounded buyer-memory store per live secret shelf, so lock, actor sleep and Forget can end it synchronously.
import type {VentureDeps,SecretShelf} from '../contracts.ts';
import {StorefrontSessions} from './storefront-assistant-session.ts';
import {registerSessionCleanup} from '../core/session-cleanup.ts';
const stores=new WeakMap<SecretShelf,StorefrontSessions>();
export function storefrontSessions(deps:Pick<VentureDeps,'secrets'|'clock'>){let sessions=stores.get(deps.secrets);if(!sessions){sessions=new StorefrontSessions(()=>deps.clock().getTime());stores.set(deps.secrets,sessions);registerSessionCleanup(deps.secrets,()=>closeStorefrontSessions(deps.secrets));}return sessions;}
export function closeStorefrontSessions(secrets:SecretShelf){stores.get(secrets)?.close();stores.delete(secrets);}
export function forgetStorefrontSessions(secrets:SecretShelf|undefined,businessId:string,orderId:string){if(secrets)stores.get(secrets)?.forget(businessId,orderId);}
