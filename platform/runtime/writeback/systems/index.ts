import type { SystemAdapters, SystemId } from '../types.ts';
import { zohoBooksAdapters } from './zoho-books.ts';
import { gstPortalAdapters } from './gst-portal.ts';

export type AdapterOptions = Record<string, never>;
/** Every installed adapter, by system and catalogue action. */
export function installedAdapters(_options: AdapterOptions = {}): Partial<Record<SystemId, SystemAdapters>> {
  return { 'zoho-books': zohoBooksAdapters, 'gst-portal': gstPortalAdapters };
}
