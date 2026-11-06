// Pure address checks shared by the engine transport and browser demos. No DNS or network effects.
export type NetAddress = { address: string; family: 4 | 6 };
export type AddressKind = 'public' | 'loopback' | 'private' | 'link-local' | 'metadata' | 'shared' | 'unspecified' | 'multicast' | 'reserved' | 'documentation' | 'benchmark';
export const URL_WORDS={url:'Chausar opens only plain web addresses (http or https) with no name or password in them.',address:'This address points inside your computer or your network, so Chausar will not open it.'};
/** One IPv4 part the way a socket library reads it: 0x hex, a leading 0 for octal, else decimal. */
function ipv4Part(part: string): number | null {
  if (/^0x[0-9a-f]*$/i.test(part)) return part.length === 2 ? 0 : parseInt(part.slice(2), 16);
  if (/^0[0-7]+$/.test(part)) return parseInt(part, 8);
  if (/^(?:0|[1-9][0-9]*)$/.test(part)) return parseInt(part, 10);
  return null;
}

/** An IPv4 address in any spelling inet_aton accepts (one to four parts; the last fills what is left), as a number. */
function parseIPv4(text: string): number | null {
  const parts = text.split('.');
  if (parts.length > 4 || parts.some(part => part === '')) return null;
  const values: number[] = [];
  for (const part of parts) {
    const value = ipv4Part(part);
    if (value === null || !Number.isFinite(value)) return null;
    values.push(value);
  }
  const last = values.pop()!;
  if (values.some(value => value > 255) || last >= 2 ** (8 * (4 - values.length))) return null;
  return values.reduce((sum, value, index) => sum + value * 2 ** (8 * (3 - index)), 0) + last;
}

const dotted = (value: number) => [24, 16, 8, 0].map(shift => Math.floor(value / 2 ** shift) % 256).join('.');

/** An IPv6 address as eight 16-bit groups. Zones (%eth0) are dropped; a trailing dotted IPv4 fills the last two groups. */
function parseIPv6(text: string): number[] | null {
  let rest = text.split('%')[0]!;
  if (!/^[0-9a-f:.]+$/i.test(rest) || !rest.includes(':')) return null;
  if (rest.includes('.')) {
    const cut = rest.lastIndexOf(':');
    const quad = rest.slice(cut + 1);
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(quad)) return null;
    const value = parseIPv4(quad.split('.').map(part => String(parseInt(part, 10))).join('.'));
    if (value === null) return null;
    rest = `${rest.slice(0, cut + 1)}${Math.floor(value / 65536).toString(16)}:${(value % 65536).toString(16)}`;
  }
  const halves = rest.split('::');
  if (halves.length > 2) return null;
  const groups = (half: string) => (half === '' ? [] : half.split(':'));
  const head = groups(halves[0]!);
  const tail = halves.length === 2 ? groups(halves[1]!) : [];
  if ([...head, ...tail].some(group => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  return [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map(group => parseInt(group, 16));
}

const METADATA_V4 = new Set(['169.254.169.254', '169.254.170.2', '169.254.170.23', '100.100.100.200', '192.0.0.192']);

function inRange(value: number, base: string, bits: number): boolean {
  const start = parseIPv4(base)!;
  const size = 2 ** (32 - bits);
  return value >= start && value < start + size;
}

function classifyIPv4(value: number): AddressKind {
  if (METADATA_V4.has(dotted(value))) return 'metadata';
  const ranges: [string, number, AddressKind][] = [
    ['0.0.0.0', 8, 'unspecified'], ['10.0.0.0', 8, 'private'], ['100.64.0.0', 10, 'shared'], ['127.0.0.0', 8, 'loopback'],
    ['169.254.0.0', 16, 'link-local'], ['172.16.0.0', 12, 'private'], ['192.0.0.0', 24, 'reserved'], ['192.0.2.0', 24, 'documentation'],
    ['192.88.99.0', 24, 'reserved'], ['192.168.0.0', 16, 'private'], ['198.18.0.0', 15, 'benchmark'], ['198.51.100.0', 24, 'documentation'],
    ['203.0.113.0', 24, 'documentation'], ['224.0.0.0', 4, 'multicast'], ['240.0.0.0', 4, 'reserved'],
  ];
  for (const [base, bits, kind] of ranges) if (inRange(value, base, bits)) return kind;
  return 'public';
}

function classifyIPv6(g: number[]): AddressKind {
  const zeros = (from: number, to: number) => g.slice(from, to).every(group => group === 0);
  const embedded = (high: number, low: number) => classifyIPv4(high * 65536 + low);
  if (zeros(0, 8)) return 'unspecified';
  if (zeros(0, 7) && g[7]! === 1) return 'loopback';
  if (zeros(0, 5) && g[5]! === 0xffff) return embedded(g[6]!, g[7]!); // IPv4-mapped
  if (zeros(0, 4) && g[4]! === 0xffff && g[5]! === 0) return embedded(g[6]!, g[7]!); // IPv4-translated
  if (zeros(0, 6)) return 'reserved'; // IPv4-compatible, retired
  if (g[0]! === 0x64 && g[1]! === 0xff9b && zeros(2, 6)) return embedded(g[6]!, g[7]!); // NAT64
  if (g[0]! === 0x64 && g[1]! === 0xff9b) return 'reserved'; // local-use NAT64
  if (g[0]! === 0x2002) return embedded(g[1]!, g[2]!); // 6to4
  if (g[0]! === 0x2001 && g[1]! === 0) return 'reserved'; // Teredo hides the address it reaches
  if (g[0]! === 0x2001 && g[1]! === 0x0db8) return 'documentation';
  if (g[0]! === 0x3fff && g[1]! < 0x1000) return 'documentation';
  if (g[0]! === 0x2001 && g[1]! >= 0x10 && g[1]! < 0x30) return 'reserved'; // ORCHID and ORCHIDv2
  if ((g[0]! & 0xfe00) === 0xfc00) return g[0]! === 0xfd00 && g[1]! === 0x0ec2 && zeros(2, 7) && g[7]! === 0x254 ? 'metadata' : 'private';
  if ((g[0]! & 0xffc0) === 0xfe80) return 'link-local';
  if ((g[0]! & 0xffc0) === 0xfec0) return 'private'; // site-local, retired
  if ((g[0]! & 0xff00) === 0xff00) return 'multicast';
  if ((g[0]! & 0xe000) !== 0x2000) return 'reserved'; // outside global unicast, 100::/64 included
  return 'public';
}

/** The address a literal names, in canonical form, or null when the text is not an address in any spelling. */
export function literalAddress(text: string): (NetAddress & { kind: AddressKind }) | null {
  const bare = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
  const v6 = parseIPv6(bare);
  if (v6) return { address: bare.split('%')[0]!.toLowerCase(), family: 6, kind: classifyIPv6(v6) };
  const v4 = parseIPv4(bare.replace(/\.$/, ''));
  if (v4 !== null) return { address: dotted(v4), family: 4, kind: classifyIPv4(v4) };
  return null;
}

/** What an IP address reaches: 'public', or why it is refused. Null when the text is not an address in any spelling. */
export function classifyAddress(text: string): AddressKind | null {
  return typeof text === 'string' ? literalAddress(text.trim())?.kind ?? null : null;
}

/** Names that only ever mean this computer or this network: localhost, single labels and the private-use suffixes. */
function internalName(hostname: string): boolean {
  if (hostname === 'localhost' || !hostname.includes('.')) return true;
  return ['.localhost', '.local', '.internal', '.intranet', '.lan', '.corp', '.localdomain', '.home.arpa', '.arpa'].some(suffix => hostname.endsWith(suffix));
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

/**
 * The address as given, checked before any lookup: http or https, no name or password, and no host that is an internal
 * address in any spelling or a name that only means this computer or network. Returns the parsed URL.
 */
export function checkUrlValue(raw: string, refuse:(code:string,words:string)=>Error): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw refuse('NET_URL_REFUSED', URL_WORDS.url); }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') throw refuse('NET_URL_REFUSED', URL_WORDS.url);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) throw refuse('NET_URL_REFUSED', URL_WORDS.url);
  const literal = literalAddress(hostname);
  if (literal ? literal.kind !== 'public' : internalName(hostname)) throw refuse('NET_ADDRESS_REFUSED', URL_WORDS.address);
  return url;
}
