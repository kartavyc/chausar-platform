/**
 * C7 task 12: the fake engine's event relay, with the engine's words and refusals (build/event-triggers.ts). Nothing is
 * read or asked for real: the sample keeps the host, and one refused event and one drafted event once a relay is set, so
 * the Routines page can show why.
 */
import { EngineError, type EventsViewLite, type RelayEventLite } from './types';
import type { W4DeskHost } from './fake-w4';

export const FAKE_EVENT_METHODS: readonly string[] = ['venture.events.get', 'venture.events.relay.set', 'venture.events.calKey.set'];
const LINE = 'Nothing fires while Chausar is closed. Events from the last 24 hours are drafted when you open it.';
const LABEL = 'Tested with stand-ins until you run one with your own relay and test-mode keys.';
const BLANKS = { payment: ['client', 'invoice', 'amount', 'when'], booking: ['client', 'when', 'event'], 'booking-cancelled': ['client', 'when', 'event'] } as const;
const REFUSED_ADDRESS = 'Give the relay as one https address of your own, like an ntfy topic, outside this computer and its network.';

type Held = { relay: string | null; calKey: boolean; events: RelayEventLite[] };

export class FakeEvents {
  private host: W4DeskHost;
  private byBusiness = new Map<string, Held>();
  constructor(host: W4DeskHost) { this.host = host; }
  private mine(): Held { const biz = this.host.current(); let held = this.byBusiness.get(biz); if (!held) { held = { relay: null, calKey: false, events: [] }; this.byBusiness.set(biz, held); } return held; }
  /** Whether a trigger may be saved now, as the engine's checkTrigger says. */
  relaySet(): boolean { return this.mine().relay !== null; }
  private view(): EventsViewLite {
    const held = this.mine();
    return { relay: held.relay, calKey: held.calKey, line: LINE, label: LABEL, missed: held.events.filter((event) => event.state === 'missed').length, events: structuredClone(held.events), blanks: BLANKS };
  }
  request(method: string, p: Record<string, unknown>): EventsViewLite {
    if (method === 'venture.events.get') return this.view();
    if (this.host.hosted()) throw new EngineError('TIER_UNAVAILABLE', 'Events come in through a relay on the desktop app only.');
    const held = this.mine();
    if (method === 'venture.events.relay.set') {
      if (p.address === null) { held.relay = null; return this.view(); }
      let url: URL | null = null;
      try { url = new URL(String(p.address)); } catch { url = null; }
      if (!url || url.protocol !== 'https:' || url.username || url.password || /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)) throw new EngineError('EVENT_RELAY_REFUSED', REFUSED_ADDRESS);
      held.relay = url.host;
      const at = this.host.now();
      held.events = [
        { id: 'relay-event-2', source: 'razorpay', kind: 'payment', receivedAt: at, state: 'drafted', line: 'Drafted. It waits for you.' },
        { id: 'relay-event-1', source: 'razorpay', kind: 'payment', receivedAt: at, state: 'refused', line: 'Razorpay does not know this payment on your account. Nothing ran.' },
      ];
      return this.view();
    }
    if (method === 'venture.events.calKey.set') {
      if (p.key !== null && !(typeof p.key === 'string' && /^[A-Za-z0-9_-]{16,200}$/.test(p.key.trim()))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Paste your whole Cal.com API key, with no spaces.');
      held.calKey = p.key !== null;
      return this.view();
    }
    throw new EngineError('METHOD_NOT_ALLOWED', "The sample business can't do that yet.");
  }
}
