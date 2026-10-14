/**
 * The practice world: one fresh stateful fake per system, with its synthetic account and secret.
 * Wired only into Practice, practice connections, demo mode and tests — never a live connection.
 */
import { readFileSync } from 'node:fs';
import { ChausarError } from '../runtime/contracts.ts';
import type { FakeBundle, FakeFactory, QualificationCase } from '../runtime/writeback/practice.ts';
import type { SystemId } from '../runtime/writeback/types.ts';
import { ZohoBooksFake, zohoSeed } from './zoho-books/index.ts';
import { TallyFake, tallySeed } from './tally/index.ts';
import { RazorpayFake, razorpaySeed } from './razorpay/index.ts';
import { ShopifyFake, shopifySeed } from './shopify/index.ts';
import { GoogleWorkspaceFake, googleSeed } from './google-workspace/index.ts';
import { MailFake, mailSeed } from './mail/index.ts';
import { WhatsAppFake, whatsappSeed } from './whatsapp/index.ts';
import { practiceStatuses } from '../runtime/writeback/systems/index.ts';

/** Tax filings are prepared only: their practice copy has no interface at all. */
const noInterface = (): FakeBundle => ({ secret: {}, account: {}, fake: { system: 'gst-portal', log: [], fault() {}, prime() {}, snapshot: () => ({}) } });
const builders: Partial<Record<SystemId, (clock: () => string) => FakeBundle>> = {
  'zoho-books': clock => ({ fake: new ZohoBooksFake(zohoSeed, clock), account: { organizationId: zohoSeed.organizationId, dataCenter: 'in' }, secret: { accessToken: zohoSeed.token } }),
  tally: () => ({ fake: new TallyFake(tallySeed), account: { host: '127.0.0.1', port: '9000', company: tallySeed.company }, secret: {} }),
  razorpay: clock => ({ fake: new RazorpayFake(razorpaySeed, clock), account: {}, secret: { keyId: razorpaySeed.keyId, keySecret: razorpaySeed.keySecret } }),
  shopify: clock => ({ fake: new ShopifyFake(shopifySeed, clock), account: { shop: shopifySeed.shop }, secret: { accessToken: shopifySeed.token } }),
  'google-workspace': clock => ({ fake: new GoogleWorkspaceFake(googleSeed, clock), account: {}, secret: { accessToken: googleSeed.token } }),
  mail: clock => {
    const user = mailSeed.users[0], smtp = mailSeed.smtp[0];
    return { fake: new MailFake(mailSeed, clock), secret: { username: user.username, password: user.password },
      account: { smtpHost: smtp.host, smtpPort: String(smtp.port), smtpSecurity: smtp.security, from: user.address, imapHost: mailSeed.imap.host, imapPort: String(mailSeed.imap.port), sentFolder: 'Sent' } };
  },
  'gst-portal': noInterface,
  whatsapp: clock => {
    const fake = new WhatsAppFake(whatsappSeed, clock); practiceStatuses.set(fake.transport, fake.statuses);
    return { fake, account: { phoneNumberId: whatsappSeed.phoneNumberId, wabaId: whatsappSeed.wabaId }, secret: { accessToken: whatsappSeed.token } };
  },
};
export const practiceSystems = () => Object.keys(builders) as SystemId[];
export const fakeFactory: FakeFactory = (system, clock) => {
  const build = builders[system]; if (!build) throw new ChausarError('PRACTICE_SYSTEM_MISSING', 'This system has no practice copy yet.');
  return build(clock);
};
/** The write-back recipe test cases, one synthetic payload per catalogue action. */
export const qualificationCases: QualificationCase[] = JSON.parse(readFileSync(new URL('../../fixtures/writeback/cases.json', import.meta.url), 'utf8'));
