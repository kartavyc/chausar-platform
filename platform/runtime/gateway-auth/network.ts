import { networkInterfaces } from 'node:os';

/** The trusted test seam (`host.options.networkProbe`): interface records like `os.networkInterfaces()`, or a plain answer. */
export type NetworkProbe = () => boolean | null | Record<string, readonly { address?: unknown; internal?: unknown; family?: unknown }[] | undefined>;

/** Link-local and unspecified addresses do not mean a working network. */
const usable = (address: string) => !/^(169\.254\.|0\.0\.0\.0$)/.test(address) && !/^(fe80:|::$)/i.test(address);

/** SH-03 "No connection": decided from this machine's own network interfaces. Nothing is sent anywhere. */
export function networkOnline(probe?: unknown): { online: boolean | null; basis: 'interfaces'; checkedAt: string } {
  const checkedAt = new Date().toISOString();
  let online: boolean | null = null;
  try {
    const result = typeof probe === 'function' ? (probe as NetworkProbe)() : networkInterfaces();
    if (result === null || typeof result === 'boolean') online = result;
    else if (result && typeof result === 'object' && !Array.isArray(result)) {
      online = Object.values(result).some(list => Array.isArray(list) && list.some(item => item && item.internal === false
        && typeof item.address === 'string' && item.address.length > 0 && usable(item.address)));
    }
  } catch { online = null; }
  return { online, basis: 'interfaces', checkedAt };
}
