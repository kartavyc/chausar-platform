import test from 'node:test';
import assert from 'node:assert/strict';
import { dotStuff, mailAdapters } from '../runtime/writeback/systems/mail.ts';
import { effectReference } from '../runtime/writeback/reference.ts';
import { MailFake, mailSeed } from '../fakes/mail/index.ts';
import { cycle, fakeContext, practiceConnection } from '../fakes/harness.ts';

const user = mailSeed.users[0];
const withImap = { smtpHost: 'smtp.shop.example.test', smtpPort: '587', smtpSecurity: 'starttls', from: user.address, fromName: 'Asha Traders (synthetic)', imapHost: 'imap.shop.example.test' };
function setup(account: Record<string, string> = withImap, password = user.password) {
  const fake = new MailFake(mailSeed, () => '2026-10-14T09:30:00.000Z');
  return { fake, ctx: fakeContext(fake, practiceConnection('mail', account), { username: user.username, password }, () => '2026-10-14T09:30:00.000Z') };
}
const adapter = mailAdapters['smtp.send'];
const payload = { to: ['billing@customer.example.test', 'accounts@customer.example.test'], subject: 'Invoice INV-000101 is due', body: 'Dear Asha,\nPlease pay the balance of Rs 1,000.\nThank you.' };

test('a mail is sent once, read back from the Sent folder over IMAP, and a repeat with the same key finds it', async () => {
  const { fake, ctx } = setup();
  const first = await cycle(adapter, ctx, payload, 'effect-key-mail-1');
  assert.equal(first.receipt?.outcome, 'accepted'); assert.match(first.receipt!.externalId!, /^<[0-9a-f]{32}@chausar\.local>$/);
  assert.deepEqual(first.receipt!.data, { queueReply: '2.0.0 Ok: queued as P000001' });
  assert.deepEqual(first.observation, { outcome: 'confirmed-applied', observed: { messageId: first.receipt!.externalId, to: [...payload.to].sort(), subject: payload.subject }, externalId: first.receipt!.externalId, businessSuccess: true });
  const mail = fake.outbox[0];
  assert.deepEqual(mail.to, payload.to); assert.equal(mail.from, user.address);
  assert.equal(mail.headers.date, 'Wed, 14 Oct 2026 09:30:00 +0000'); assert.equal(mail.headers.from, '"Asha Traders (synthetic)" <accounts@shop.example.test>');
  assert.equal(mail.headers['x-chausar-reference'], effectReference('effect-key-mail-1')); assert.equal(mail.headers['content-type'], 'text/plain; charset=utf-8');
  const again = await cycle(adapter, ctx, payload, 'effect-key-mail-1');
  assert.deepEqual(again.preparation.alreadyApplied, { externalId: first.receipt!.externalId }); assert.equal(again.receipt, null);
  assert.equal(fake.outbox.length, 1);
});

test('a lost reply after the server committed is settled by IMAP read-back with exactly one mail delivered', async () => {
  const { fake, ctx } = setup();
  fake.fault('drop-after-commit');
  const lost = await cycle(adapter, ctx, payload, 'effect-key-mail-2');
  assert.equal(lost.doError, 'MAIL_CONNECTION_LOST'); assert.equal(lost.observation.outcome, 'confirmed-applied');
  assert.equal(fake.outbox.length, 1);
  fake.fault('fail-before-commit');
  const failed = await cycle(adapter, ctx, payload, 'effect-key-mail-3');
  assert.equal(failed.doError, 'MAIL_CONNECTION_LOST');
  assert.deepEqual(failed.observation, { outcome: 'inconclusive', reason: 'The message is not in the Sent folder yet.' });
  assert.equal(fake.outbox.length, 1);
});

test('credentials are sent only after STARTTLS and a fresh EHLO, never in the transcript, and never without TLS', async () => {
  const { fake, ctx } = setup();
  await cycle(adapter, ctx, payload, 'effect-key-mail-4');
  assert.deepEqual(fake.log.filter(e => e.target === 'smtp').map(e => e.method), ['CONNECT', 'EHLO', 'STARTTLS', 'TLS', 'EHLO', 'AUTH', 'MAIL', 'RCPT', 'RCPT', 'DATA', 'MESSAGE', 'QUIT']);
  assert.ok(fake.log.every(e => !String(e.body).includes(user.password) && !String(e.body).includes(Buffer.from(`\u0000${user.username}\u0000${user.password}`).toString('base64'))));
  assert.ok(fake.log.some(e => e.target === 'imap' && e.body === 'a1 LOGIN [redacted]'));
  const raw = await fake.dial!({ host: 'smtp.shop.example.test', port: 587, security: 'starttls' });
  await raw.readLine(); await raw.write('EHLO probe\r\n'); for (let line = await raw.readLine(); line.startsWith('250-'); line = await raw.readLine());
  await raw.write(`AUTH PLAIN ${Buffer.from(`\u0000${user.username}\u0000${user.password}`).toString('base64')}\r\n`);
  assert.match(await raw.readLine(), /^530 /);
  const plain = setup(); plain.fake.offerStartTls = false;
  const refused = await cycle(adapter, plain.ctx, payload, 'effect-key-mail-5');
  assert.equal(refused.doError, 'MAIL_TLS_UNAVAILABLE'); assert.ok(!plain.fake.log.some(e => e.method === 'AUTH')); assert.equal(plain.fake.outbox.length, 0);
  const implicit = setup({ ...withImap, smtpPort: '465', smtpSecurity: 'implicit-tls' });
  assert.equal((await cycle(adapter, implicit.ctx, payload, 'effect-key-mail-6')).observation.outcome, 'confirmed-applied');
  assert.ok(!implicit.fake.log.some(e => e.method === 'STARTTLS'));
});

test('header injection is refused at validation and in the connection', async () => {
  for (const bad of [{ ...payload, subject: 'Due\r\nBcc: someone@else.example.test' }, { ...payload, subject: 'Due\nBcc: x@y.example.test' }, { ...payload, inReplyTo: '<a@b.test>\r\nBcc: x@y.test' },
    { ...payload, to: ['a@b.example.test\r\nBcc: x@y.test'] }, { ...payload, to: [] }, { ...payload, to: Array.from({ length: 6 }, (_, i) => `p${i}@customer.example.test`) }, { ...payload, cc: ['x@y.test'] }])
    assert.throws(() => adapter.validate(bad), { code: 'INVALID_WRITE_PAYLOAD' });
  const { ctx } = setup({ ...withImap, fromName: 'Asha\r\nBcc: x@y.test' });
  await assert.rejects(cycle(adapter, ctx, payload, 'effect-key-mail-7'), { code: 'WRITE_CONNECTION_INCOMPLETE' });
});

test('without IMAP nothing can be looked up first and the read-back waits for a person', async () => {
  const { imapHost: _none, ...noImap } = withImap;
  const { fake, ctx } = setup(noImap);
  const result = await cycle(adapter, ctx, payload, 'effect-key-mail-8');
  assert.equal(result.preparation.alreadyApplied, null); assert.equal(result.receipt?.outcome, 'accepted');
  assert.deepEqual(result.observation, { outcome: 'inconclusive', reason: 'This mail server gives no way to look; a person settles it.' });
  assert.ok(!fake.log.some(e => e.target === 'imap'));
  const unsaved = setup(); unsaved.fake.saveSent(false);
  assert.equal((await cycle(adapter, unsaved.ctx, payload, 'effect-key-mail-9')).observation.outcome, 'inconclusive');
});

test('dot-stuffing, the base64 body and an encoded Hindi subject survive the round trip', async () => {
  assert.equal(dotStuff('a\r\n.\r\n..b\r\nc.'), 'a\r\n..\r\n...b\r\nc.');
  const { fake, ctx } = setup();
  const body = `Dear Asha,\n.\n..two dots\n.hidden line\nनमस्ते, ₹1,000 बकाया है।\n${'long line '.repeat(30)}end`;
  const subject = 'भुगतान अनुस्मारक: बिल INV-000101 की राशि ₹1,000 बकाया है (synthetic)';
  const result = await cycle(adapter, ctx, { ...payload, subject, body }, 'effect-key-mail-10');
  assert.equal(result.observation.outcome, 'confirmed-applied'); assert.equal((result.observation as any).observed.subject, subject);
  const mail = fake.outbox[0];
  assert.equal(mail.body, body.replace(/\n/g, '\r\n'));
  assert.match(mail.headers.subject, /^=\?UTF-8\?B\?/);
  const [head, encoded] = mail.raw.split('\r\n\r\n');
  assert.ok(head.split('\r\n').every(line => line.length <= 998) && encoded.trimEnd().split('\r\n').every(line => line.length <= 76));
  const wire = await fake.dial!({ host: 'smtp.shop.example.test', port: 465, security: 'implicit-tls' });
  for (const line of ['EHLO probe', `AUTH PLAIN ${Buffer.from(`\u0000${user.username}\u0000${user.password}`).toString('base64')}`, `MAIL FROM:<${user.address}>`, 'RCPT TO:<x@customer.example.test>', 'DATA', `Subject: t\r\n\r\n${dotStuff('.\r\n..x\r\ny')}\r\n.`]) await wire.write(`${line}\r\n`);
  assert.equal(fake.outbox.at(-1)!.raw, 'Subject: t\r\n\r\n.\r\n..x\r\ny\r\n');
});

test('a message saved twice is conflicting and a wrong password is refused', async () => {
  const { fake, ctx } = setup();
  const sent = await cycle(adapter, ctx, payload, 'effect-key-mail-11');
  fake.mailboxes[user.username].Sent.push({ uid: 99, raw: fake.outbox[0].raw });
  assert.equal((await adapter.readBack(ctx, adapter.validate(payload), sent.preparation, 'effect-key-mail-11', sent.receipt)).outcome, 'conflicting');
  await assert.rejects(cycle(adapter, setup(withImap, 'wrong').ctx, payload, 'effect-key-mail-12'), { code: 'MAIL_AUTH_REFUSED' });
  const { imapHost: _none, ...noImap } = withImap;
  assert.equal((await cycle(adapter, setup(noImap, 'wrong').ctx, payload, 'effect-key-mail-13')).doError, 'MAIL_AUTH_REFUSED');
});
