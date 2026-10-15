import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { requestLabel } from '../../../shared/view-contracts';
import type { CompanionScreenController, CompanionViewState } from '../../../shared/view-contracts';
import { phonePageView, phonePageWords } from '../../../shared/phone-page';
import { Badge, Button, Heading, Metadata, ProofLinks, TextButton } from './components';
import { colors, styles } from './styles';
import { approvalCanDecide, canWorkOnline, hasOnlineAuthority, pairingLabel, readableTime, requestControls, run, uploadStatus } from './view-helpers';

export type ScreenProps = {
  state: CompanionViewState; controller: CompanionScreenController;
  onReceipt: (id: string) => void; now: number; wide: boolean;
};

export function PairingScreen({ state, controller, wide }: ScreenProps) {
  const [invite, setInvite] = useState('');
  const ready = state.client.connection === 'online' && state.busy.length === 0 &&
    state.client.pairing.status !== 'pairing' && state.client.pairing.status !== 'paired' &&
    state.client.pairing.status !== 'validation-required';
  const submit = () => {
    if (!ready || invite.trim().length < 8) return;
    const code = invite.trim(); setInvite(''); run(() => controller.pair(code));
  };
  return <>
    <Heading title="Your desk, within reach." detail="A private companion for the Chausar engine on your desktop." />
    <View style={wide ? styles.twoColumn : styles.section}>
      <View style={[styles.card, styles.cardMuted, wide && styles.grow]}>
        <Badge tone="neutral">REMOTE COMPANION</Badge>
        <Text style={styles.cardTitle}>Your desktop stays in charge.</Text>
        <Text style={styles.body}>Read briefs, ask a question, send a document, and review simple approvals. Your connected engine does the work.</Text>
        <Text style={styles.small}>Start pairing from your desktop. Its authorized invitation connects this device to the right workspace.</Text>
        <View style={styles.divider} />
        <Text style={styles.small}>Saved briefs remain readable offline. Sending and approving require an online access check.</Text>
      </View>
      <View style={[styles.card, wide && styles.grow]}>
        <Text accessibilityRole="header" style={styles.cardTitle}>Pair this phone</Text>
        <Text style={styles.small}>Enter the invitation from your desktop. It is cleared from this screen when you submit.</Text>
        <Text style={styles.label}>Invitation code</Text>
        <TextInput value={invite} onChangeText={setInvite} style={styles.input} secureTextEntry
          autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none"
          maxLength={4096} placeholder="Desktop invitation code" placeholderTextColor={colors.muted}
          accessibilityLabel="Desktop invitation code" editable={ready} returnKeyType="go" onSubmitEditing={submit} />
        <Button title={state.client.pairing.status === 'pairing' ? 'Pairing…' : 'Pair device'} onPress={submit}
          disabled={!ready || invite.trim().length < 8} busy={state.client.pairing.status === 'pairing'} />
        {state.client.connection !== 'online' && <Button title="Reconnect" variant="secondary"
          disabled={state.busy.length > 0} onPress={() => run(() => controller.reconnect())} />}
        {state.mode === 'demo' && <View style={styles.section}>
          <Badge tone="amber">SYNTHETIC PREVIEW</Badge>
          <Text style={styles.small}>Use DEMO-COMPANION to explore sample screens. Live desktop pairing is not wired in this preview.</Text>
        </View>}
        {hasOnlineAuthority(state) && <Button title="Go to briefs" variant="secondary" onPress={() => controller.navigate('briefs')} />}
      </View>
    </View>
  </>;
}

export function BriefsScreen({ state, controller, onReceipt }: ScreenProps) {
  const online = canWorkOnline(state);
  const offline = state.client.connection === 'offline';
  const cachedSession = ['paired', 'validation-required'].includes(state.client.pairing.status);
  if (state.brief) {
    const view = state.brief;
    return <>
      <TextButton title="‹ All briefs" accessibilityLabel="Back to all briefs" onPress={() => controller.navigate('briefs')} />
      <View style={styles.wrap}><Badge tone={view.freshness === 'cached' ? 'amber' : 'sage'}>
        {view.freshness === 'cached' ? 'SAVED COPY · READ ONLY' : 'CURRENT BRIEF'}</Badge></View>
      <Heading title={view.brief.title} detail={`Generated ${readableTime(view.brief.generatedAt)}`} />
      <View style={styles.card}>
        <Text selectable style={styles.body}>{view.brief.summary}</Text>
        <View style={styles.metadata}>
          <Metadata label="Version" value={view.brief.version} />
          {view.freshness === 'cached' && <>
            <Metadata label="Saved" value={readableTime(view.brief.cachedAt)} />
            <Metadata label="Cache expiry" value={readableTime(view.brief.expiresAt)} />
            <Text style={styles.small}>This is a past snapshot for reading. It does not authorize an action or confirm today's position.</Text>
          </>}
        </View>
        <ProofLinks receiptIds={view.brief.receiptIds} onReceipt={onReceipt} disabled={!online} />
      </View>
      <Button title="Get latest brief" variant="secondary" disabled={!online}
        onPress={() => run(() => controller.openBrief(view.brief.id))} />
    </>;
  }
  return <>
    <Heading title="Your business, at a glance." detail="A quiet place for the latest owner briefs and their supporting proof." />
    <View style={styles.rowTop}><Text style={styles.sectionTitle}>Briefs</Text>
      <TextButton title={offline ? 'Show saved briefs' : 'Refresh'} accessibilityLabel={offline ? 'Show saved briefs' : 'Refresh briefs'}
        disabled={offline ? !cachedSession || state.busy.length > 0 : !online} onPress={() => run(() => controller.loadBriefs())} /></View>
    {state.client.connection === 'offline' && <Text style={styles.small}>Open a previously saved brief to read its cached copy. Only briefs already saved on this device are available offline.</Text>}
    {state.briefs.length ? state.briefs.map(brief => <Pressable key={brief.id} accessibilityRole="button"
      accessibilityLabel={`Open brief: ${brief.title}${brief.freshness === 'cached' ? ', saved copy, read only' : ''}`} onPress={() => run(() => controller.openBrief(brief.id))}
      disabled={state.busy.length > 0} accessibilityState={{ disabled: state.busy.length > 0 }}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={styles.rowTop}><View style={styles.grow}><Text style={styles.cardTitle}>{brief.title}</Text>
        <Text style={styles.small}>{readableTime(brief.generatedAt)}</Text></View><Text style={styles.chevron}>›</Text></View>
      <Text numberOfLines={3} style={styles.body}>{brief.summary}</Text>
      <View style={styles.wrap}><Badge tone="neutral">{`${brief.receiptIds.length} proof ${brief.receiptIds.length === 1 ? 'receipt' : 'receipts'}`}</Badge>
        {brief.freshness === 'cached' ? <Badge tone="amber">SAVED COPY · READ ONLY</Badge> :
          state.client.connection === 'offline' && <Badge tone="amber">CHECK SAVED COPY</Badge>}</View>
      {brief.freshness === 'cached' && brief.cachedAt && <Text style={styles.small}>Saved {readableTime(brief.cachedAt)}</Text>}
    </Pressable>) : <View style={[styles.card, styles.empty]}>
      <Text style={styles.cardTitle}>A clear view starts here.</Text>
      <Text style={styles.body}>Pair your device, then refresh to collect the briefs prepared by your engine.</Text>
      {!hasOnlineAuthority(state) && <Button title="Connect device" variant="secondary" onPress={() => controller.navigate('device')} />}
    </View>}
  </>;
}

export function ChatScreen({ state, controller, onReceipt }: ScreenProps) {
  const [question, setQuestion] = useState(''); const online = canWorkOnline(state);
  const send = () => {
    const text = question.trim(); if (!online || !text) return;
    setQuestion(''); run(() => controller.sendChat(text));
  };
  return <>
    <Heading title="Ask your engine." detail="A small question, with the business context and proof behind the answer." />
    {state.messages.some(message => message.role === 'companion') && <Text style={styles.small}>Answers are retained snapshots. Open a proof receipt online for a fresh read.</Text>}
    {state.messages.length ? state.messages.map(message => <View key={message.id}
      style={[styles.card, message.role === 'owner' ? styles.ownerMessage : styles.companionMessage]}>
      <Text style={styles.label}>{message.role === 'owner' ? 'YOU' : 'CHAUSAR · RETAINED ANSWER'}</Text>
      <Text selectable style={styles.body}>{message.text}</Text>
      {message.conversationId && <Metadata label="Conversation" value={message.conversationId} />}
      {message.role === 'companion' && <ProofLinks receiptIds={message.receiptIds} onReceipt={onReceipt} disabled={!online} />}
    </View>) : <View style={[styles.card, styles.cardMuted]}>
      <Text style={styles.cardTitle}>Keep the question concrete.</Text>
      <Text style={styles.body}>For example: “What needs my attention in the latest owner brief?”</Text>
      <Text style={styles.small}>Answers run on your connected engine. Check their proof receipts before making a decision.</Text>
    </View>}
    <View style={styles.card}>
      <Text style={styles.label}>Your question</Text>
      <TextInput value={question} onChangeText={setQuestion} multiline style={[styles.input, styles.composer]}
        maxLength={6000} placeholder="What would you like to understand?" placeholderTextColor={colors.muted}
        accessibilityLabel="Question for Chausar" autoCorrect editable={online} />
      <Button title="Send question" disabled={!online || !question.trim()} onPress={send} />
      {!hasOnlineAuthority(state) && <Text style={styles.small}>Reconnect and validate device access to send. Questions are not queued for later.</Text>}
      <TextButton title="View request activity" onPress={() => controller.navigate('activity')} />
    </View>
  </>;
}

export function UploadsScreen({ state, controller }: ScreenProps) {
  const online = canWorkOnline(state);
  return <>
    <Heading title="Send a document." detail="Bring a photo, PDF, or CSV to your connected engine for review." />
    <View style={[styles.card, styles.cardMuted]}>
      <Badge tone="neutral">REVIEW BEFORE USE</Badge>
      <Text style={styles.cardTitle}>A document is a source, not an instruction.</Text>
      <Text style={styles.body}>Uploaded data waits for confirmation. Review its interpretation in your desktop workspace before it becomes business data.</Text>
      <Button title={state.mode === 'demo' ? 'Choose sample document' : 'Choose document'} disabled={!online}
        onPress={() => run(() => controller.chooseDocument())} />
      <Text style={styles.small}>{state.mode === 'demo' ? 'The preview picker uses a synthetic CSV. The device file picker is not connected in this preview.' : 'Choose a JPEG, PNG, PDF, or CSV file.'}</Text>
      {!hasOnlineAuthority(state) && <Text style={styles.small}>Uploads require an online access check. File contents are not queued offline.</Text>}
    </View>
    <View style={styles.rowTop}><Text style={styles.sectionTitle}>Recent uploads</Text>
      <TextButton title="Activity" accessibilityLabel="View upload request activity" onPress={() => controller.navigate('activity')} /></View>
    {state.uploads.length ? state.uploads.map(upload => <View key={upload.requestId} style={styles.card}>
      <Text style={styles.cardTitle}>{upload.name}</Text>
      <Badge tone={upload.status === 'awaiting-confirmation' ? 'amber' : 'neutral'}>{uploadStatus(upload.status)}</Badge>
      {upload.status === 'awaiting-confirmation' && <Text style={styles.body}>Received as an unconfirmed source. Open your desktop to confirm the import.</Text>}
      {upload.status === 'unknown' && <Text style={styles.small}>The result is uncertain. Check status before sending this document again.</Text>}
    </View>) : <View style={styles.card}><Text style={styles.small}>Your uploaded documents will appear here.</Text></View>}
  </>;
}

export function ApprovalsScreen({ state, controller, now }: ScreenProps) {
  const online = canWorkOnline(state); const preview = state.approval;
  if (preview) {
    const expired = !Number.isFinite(Date.parse(preview.expiresAt)) || Date.parse(preview.expiresAt) <= now;
    const desktop = preview.eligibility === 'open-desktop';
    const canDecide = approvalCanDecide(state, now);
    return <>
      <TextButton title="‹ All approvals" accessibilityLabel="Back to approval inbox" onPress={() => controller.navigate('approvals')} />
      <Badge tone={expired ? 'red' : desktop ? 'amber' : 'sage'}>{expired ? 'EXPIRED' : desktop ? 'OPEN DESKTOP' : 'SIMPLE REVERSIBLE ACTION'}</Badge>
      <Heading title={preview.title} detail="Review the exact operation before sending a single-use decision." />
      <View style={styles.card}>
        <Text selectable style={styles.body}>{preview.summary}</Text>
        <View style={styles.metadata}>
          <Metadata label="Expires" value={readableTime(preview.expiresAt)} />
          <Metadata label="Revision" value={String(preview.actionRevision)} />
          <Metadata label="Operation" value={preview.operationVersion} />
        </View>
        <Text style={styles.small}>The engine must validate your current access, this operation version, and the unused approval challenge when you decide.</Text>
      </View>
      {desktop && <View style={[styles.card, styles.cardMuted]}>
        <Text style={styles.cardTitle}>Review on your desktop.</Text>
        <Text style={styles.body}>This operation needs the full desktop context. Approve or reject it there.</Text>
      </View>}
      {expired && <Text accessibilityLiveRegion="polite" style={styles.small}>This approval has expired. Get a fresh preview before making a decision.</Text>}
      {!hasOnlineAuthority(state) && <Text style={styles.small}>Reconnect to validate access. An offline tap never queues or replays an approval.</Text>}
      <View style={styles.row}><View style={styles.grow}>
        <Button title="Reject" variant="secondary" disabled={!canDecide} onPress={() => run(() => controller.decideApproval('reject'))} />
      </View><View style={styles.grow}>
        <Button title="Approve" disabled={!canDecide} onPress={() => run(() => controller.decideApproval('approve'))} />
      </View></View>
      <TextButton title="Get fresh preview" disabled={!online} onPress={() => run(() => controller.inspectApproval(preview.approvalId))} />
    </>;
  }
  return <>
    <Heading title="Decide with context." detail="Simple, reversible approvals from your engine. Everything else opens on desktop." />
    <View style={styles.rowTop}><Text style={styles.sectionTitle}>Pending approvals</Text>
      <TextButton title="Refresh" accessibilityLabel="Refresh approval inbox" disabled={!online} onPress={() => run(() => controller.loadApprovals())} /></View>
    {!hasOnlineAuthority(state) && <Text style={styles.small}>The approval inbox requires current online access. Saved session details never authorize a decision.</Text>}
    {state.approvalInbox.length ? state.approvalInbox.map(item => <Pressable key={item.approvalId}
      accessibilityRole="button" accessibilityLabel={`Review approval: ${item.title}`} disabled={!online}
      accessibilityState={{ disabled: !online }} onPress={() => run(() => controller.inspectApproval(item.approvalId))}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <Badge tone="neutral">REVIEW REQUIRED</Badge><Text style={styles.cardTitle}>{item.title}</Text>
      <Text style={styles.small}>Open to check the exact summary, version, and expiry.</Text>
    </Pressable>) : <View style={[styles.card, styles.empty]}><Text style={styles.cardTitle}>Room to focus.</Text>
      <Text style={styles.body}>No approvals are shown. Refresh while connected to check the current inbox.</Text></View>}
  </>;
}

export function ActivityScreen({ state, controller, onReceipt }: ScreenProps) {
  return <>
    <Heading title="Stay with the outcome." detail="Track work sent to your engine. A lost connection can leave an outcome unknown." />
    <View style={[styles.card, styles.cardMuted]}><Text style={styles.small}>Checking a request reads its status; it does not repeat it. Completed results are retained snapshots. Open proof receipts online for a fresh read. Cancellation is confirmed only when the engine reports it cancelled.</Text></View>
    {state.client.requests.length ? [...state.client.requests].reverse().map(request => {
      const active = ['pending', 'unknown', 'cancelling'].includes(request.status);
      const controls = requestControls(state, request);
      return <View key={request.requestId} style={styles.card}>
        <Badge tone={request.status === 'unknown' ? 'amber' : request.status === 'failed' ? 'red' : active ? 'neutral' : 'sage'}>{requestLabel(request)}</Badge>
        <Text selectable style={styles.small}>Request {request.requestId}</Text>
        {request.status === 'succeeded' && ('conversationId' in request.result ? <>
          <Badge tone="neutral">RETAINED ANSWER</Badge>
          <Metadata label="Conversation" value={request.result.conversationId} />
          <Text selectable style={styles.body}>{request.result.text}</Text>
          <ProofLinks receiptIds={request.result.receiptIds} onReceipt={onReceipt} disabled={!canWorkOnline(state)} />
        </> : 'uploadId' in request.result ? <>
          <Text style={styles.small}>Retained upload result · confirmation needed on desktop.</Text>
          <Metadata label="Upload" value={request.result.uploadId} /><Metadata label="Source" value={request.result.sourceId} />
        </> : <>
          <Text style={styles.small}>Retained decision: {request.result.decision}</Text>
          <Metadata label="Approval" value={request.result.approvalId} /><Metadata label="Action" value={request.result.actionId} />
        </>)}
        {request.status === 'unknown' && <Text style={styles.body}>The engine may have received this request. Reconnect and check before starting it again.</Text>}
        {request.status === 'cancelling' && <Text style={styles.small}>Cancellation is pending. The original work may already have completed.</Text>}
        {active && <View style={styles.row}><View style={styles.grow}>
          <Button title="Check status" variant="secondary" disabled={!controls.canRefresh} onPress={() => run(() => controller.refreshRequest(request.requestId))} />
        </View><View style={styles.grow}>
          <Button title="Cancel request" variant="danger" disabled={!controls.canCancel} onPress={() => run(() => controller.cancelRequest(request.requestId))} />
        </View></View>}
      </View>;
    }) : <View style={styles.card}><Text style={styles.cardTitle}>No requests yet.</Text><Text style={styles.body}>Questions, uploads, and approval decisions appear here after you send them.</Text></View>}
    {!hasOnlineAuthority(state) && <Button title="Reconnect and check" variant="secondary" disabled={state.busy.length > 0}
      onPress={() => run(() => controller.reconnect())} />}
  </>;
}

export function DeviceScreen({ state, controller }: ScreenProps) {
  const [confirmation, setConfirmation] = useState<'forget' | 'revoke' | undefined>();
  const pairing = state.client.pairing;
  const binding = 'authority' in pairing ? pairing.authority.binding : 'binding' in pairing ? pairing.binding : undefined;
  const busy = state.busy.length > 0;
  const confirm = () => {
    const action = confirmation; setConfirmation(undefined);
    if (action === 'revoke') run(() => controller.revokeDevice());
    if (action === 'forget') run(() => controller.forgetDevice());
  };
  return <>
    <Heading title="Your connection." detail="Control this device's access to the Chausar engine." />
    <View style={styles.card}>
      <View style={styles.rowTop}><Text style={styles.cardTitle}>Companion device</Text>
        <Badge tone={hasOnlineAuthority(state) ? 'sage' : 'amber'}>{hasOnlineAuthority(state) ? 'CONNECTED' : 'CHECK REQUIRED'}</Badge></View>
      <Metadata label="Connection" value={state.client.connection === 'online' ? 'Online' : state.client.connection === 'connecting' ? 'Connecting' : 'Offline'} />
      <Metadata label="Device access" value={pairingLabel(pairing.status)} />
      {binding && <><Metadata label="Workspace" value={binding.workspaceId} /><Metadata label="Device" value={binding.deviceId} /></>}
      <Text style={styles.small}>Your desktop authorizes this connection. You can remove this device's access below.</Text>
      <Button title="Reconnect and validate" disabled={busy} onPress={() => run(() => controller.reconnect())} />
      {state.client.connection !== 'offline' && <Button title={state.mode === 'demo' ? 'Try offline reading' : 'Disconnect'} variant="secondary"
        disabled={busy} onPress={() => controller.disconnect()} />}
      {['unpaired', 'revoked', 'expired'].includes(pairing.status) && <Button title="Pair from desktop" variant="secondary" disabled={busy} onPress={() => controller.navigate('pairing')} />}
      <TextButton title="View request activity" onPress={() => controller.navigate('activity')} />
    </View>
    {binding && <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Manage access</Text>
      <Text style={styles.body}>Revoke blocks this device at the engine after online confirmation. Forget removes the local connection and saved briefs.</Text>
      {!confirmation ? <>
        <Button title="Revoke device access" variant="danger" disabled={!canWorkOnline(state)} onPress={() => setConfirmation('revoke')} />
        <Button title="Forget this device" variant="secondary" disabled={busy} onPress={() => setConfirmation('forget')} />
      </> : <View style={styles.section}>
        <Text style={styles.cardTitle}>{confirmation === 'revoke' ? 'Revoke this device?' : 'Forget this device?'}</Text>
        <Text style={styles.small}>{confirmation === 'revoke' ? 'The engine must confirm revocation. This also removes the local connection and saved briefs.' : 'This removes the local connection and saved briefs. To block access at the engine, revoke online or use your desktop.'}</Text>
        <Button title={confirmation === 'revoke' ? 'Confirm revocation' : 'Confirm forget'} variant="danger"
          disabled={busy || (confirmation === 'revoke' && !canWorkOnline(state))} onPress={confirm} />
        <Button title="Keep this device" variant="secondary" onPress={() => setConfirmation(undefined)} />
      </View>}
    </View>}
    <View style={[styles.card, styles.cardMuted]}><Text style={styles.sectionTitle}>Offline means reading.</Text>
      <Text style={styles.body}>{state.mode === 'demo' ? 'This demo reads synthetic snapshots held in memory while the app is open.' : 'Only encrypted saved briefs are available offline.'} Reconnecting checks current access and reconciles existing request IDs; it never replays approval decisions.</Text></View>
  </>;
}

export function ReceiptScreen({ state, onBack }: { state: CompanionViewState; onBack: () => void }) {
  const receipt = state.receipt;
  return <>
    <TextButton title="‹ Back" accessibilityLabel="Back from proof receipt" onPress={onBack} />
    <Heading title={receipt && !('text' in receipt) ? receipt.title : 'Proof receipt'} detail={receipt && 'text' in receipt ? 'Receipt text returned by your engine.' : 'The source and method behind the result.'} />
    {receipt ? <View style={styles.card}>
      <Badge tone="neutral">PROOF RECEIPT</Badge>
      {'text' in receipt ? <>
        <Text selectable style={styles.body}>{receipt.text}</Text>
        <View style={styles.metadata}><Metadata label="Receipt" value={receipt.id} /><Metadata label="Workspace" value={receipt.workspaceId} /></View>
      </> : <>
        <Text selectable style={styles.body}>{receipt.details}</Text>
        <View style={styles.metadata}><Metadata label="Generated" value={readableTime(receipt.generatedAt)} />
          <Metadata label="Source" value={receipt.source} /><Metadata label="Method" value={receipt.method} />
          <Metadata label="Coverage" value={receipt.coverage} /></View>
      </>}
    </View> : <View style={styles.card}><Text style={styles.body}>No receipt is available. Return to the brief or chat and try again while connected.</Text></View>}
  </>;
}

/** PH-04, EXPERIMENTAL: shown only when the host switches the phone page on. Headlines only. */
export function PhonePageScreen({ state, controller, now }: ScreenProps) {
  const view = phonePageView(state, now); const words = phonePageWords.en; const busy = state.busy.length > 0;
  if (!view) return <View style={[styles.card, styles.empty]}><Text style={styles.body}>This experimental page is off.</Text></View>;
  return <>
    <Badge tone="amber">EXPERIMENTAL</Badge>
    <Heading title={words.title} detail={words.experimental} />
    {view.readOnly && <Text accessibilityLiveRegion="polite" style={styles.small}>{words.savedReadOnly}</Text>}
    <TextButton title={words.refresh} disabled={busy} onPress={() => run(() => controller.loadPhonePage())} />
    <View style={styles.card}>
      <View style={styles.rowTop}><Text accessibilityRole="header" style={styles.sectionTitle}>{words.awaiting}</Text>
        {view.review.status === 'loaded' && <Badge tone="neutral">{new Intl.NumberFormat().format(view.review.count ?? 0)}</Badge>}</View>
      {view.review.status === 'unavailable' && <Text style={styles.body}>{words.reviewUnavailable}</Text>}
      {view.review.status === 'not-loaded' && <Text style={styles.body}>{words.reviewNotLoaded}</Text>}
      {view.review.status === 'loaded' && !view.review.rows.length && <Text style={styles.body}>{words.nothingAwaiting}</Text>}
      {view.review.rows.map(row => {
        const confirming = view.confirm?.approvalId === row.approvalId;
        return <View key={row.approvalId} style={styles.section}>
          <View style={styles.row}>
            <Text numberOfLines={2} style={[styles.body, styles.grow]}>{row.title}</Text>
            {row.action === 'approve' && !confirming && <Button title={words.approve} accessibilityLabel={`${words.approve}: ${row.title}`}
              disabled={busy} onPress={() => run(() => controller.approveOnPhone(row.approvalId))} />}
            {row.action !== 'approve' && <Badge tone="neutral">{words.inTheApp}</Badge>}
          </View>
          {confirming && view.confirm && <View style={[styles.card, styles.cardMuted]}>
            <Text style={styles.cardTitle}>{words.confirmQuestion}</Text>
            <Text numberOfLines={2} style={styles.body}>{view.confirm.title}</Text>
            <Text style={styles.small}>{words.confirmHelp}</Text>
            <View style={styles.row}><View style={styles.grow}>
              <Button title={words.notNow} variant="secondary" disabled={busy} onPress={() => controller.dismissPhoneApproval()} />
            </View><View style={styles.grow}>
              <Button title={words.confirmApprove} disabled={busy || view.confirm.expired} onPress={() => run(() => controller.confirmPhoneApproval())} />
            </View></View>
          </View>}
        </View>;
      })}
    </View>
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{words.weekAhead}</Text>
      {view.weekAhead.length ? view.weekAhead.map((headline, index) => <Text key={index} style={styles.body}>{headline}</Text>)
        : <Text style={styles.body}>{words.weekAheadEmpty}</Text>}
    </View>
    <Text style={styles.small}>{`${words.laptopSeen}: ${view.lastSeen.known ? readableTime(view.lastSeen.at) : words.notKnown}`}</Text>
    <Text style={styles.small}>{words.rule}</Text>
  </>;
}
