import type { ApprovalPreview, Brief, BriefView, PhoneMethods, RequestState } from '../../../platform/runtime/phone/contracts.ts';
import type { PhoneClient } from '../../../platform/runtime/phone/client.ts';
import type { PhoneReceipt } from '../../../platform/runtime/phone/host-contracts.ts';

export type CompanionScreen = 'pairing' | 'briefs' | 'chat' | 'uploads' | 'approvals' | 'activity' | 'device' | 'receipt';
export type SelectedDocument = { name: string; mediaType: 'image/jpeg' | 'image/png' | 'application/pdf' | 'text/csv'; bytes: Uint8Array };
export interface CompanionDeviceIdentity {
  /** Native key possession proof is supplied by the selected secure-device adapter. */
  preparePairing(inviteCode: string): Promise<Omit<PhoneMethods['pairing.accept']['input'], 'inviteCode' | 'channel'>>;
}
export interface CompanionDocumentPicker { pick(): Promise<SelectedDocument | undefined>; }
/** Rich metadata exists only in the synthetic preview; host receipts retain their exact text. */
export type CompanionPreviewReceipt = { id: string; title: string; generatedAt: string; source: string; method: string; coverage: string; details: string };
export type CompanionReceipt = PhoneReceipt | CompanionPreviewReceipt;
export interface CompanionReceiptReader { read(receiptId: string): Promise<CompanionReceipt>; }
export type ApprovalInboxItem = { approvalId: string; title: string };
export type ChatMessage = { id: string; role: 'owner' | 'companion'; text: string; requestId?: string; conversationId?: string; receiptIds: string[] };
export type UploadView = { requestId: string; name: string; status: string };
export type CompanionViewState = {
  mode: 'demo' | 'live'; screen: CompanionScreen;
  client: ReturnType<PhoneClient['snapshot']>;
  busy: string[]; notice?: { tone: 'info' | 'error' | 'success'; text: string };
  briefs: (Brief & { freshness?: 'cached' | 'current'; cachedAt?: string; expiresAt?: string })[]; brief?: BriefView; approvalInbox: ApprovalInboxItem[]; approval?: ApprovalPreview;
  messages: ChatMessage[]; uploads: UploadView[]; receipt?: CompanionReceipt;
};
/** The native and web screens share this controller; it never exposes credentials/tokens. */
export interface CompanionScreenController {
  getState(): CompanionViewState;
  subscribe(listener: () => void): () => void;
  navigate(screen: CompanionScreen): void;
  start(): Promise<void>;
  pair(inviteCode: string): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): void;
  loadBriefs(): Promise<void>;
  openBrief(briefId: string): Promise<void>;
  sendChat(question: string): Promise<void>;
  chooseDocument(): Promise<void>;
  uploadDocument(document: SelectedDocument): Promise<void>;
  loadApprovals(): Promise<void>;
  inspectApproval(approvalId: string): Promise<void>;
  decideApproval(decision: 'approve' | 'reject'): Promise<void>;
  refreshRequest(requestId: string): Promise<void>;
  cancelRequest(requestId: string): Promise<void>;
  openReceipt(receiptId: string): Promise<void>;
  revokeDevice(): Promise<void>;
  forgetDevice(): Promise<void>;
  dismissNotice(): void;
}
export const requestLabel = (request: RequestState): string => ({ pending: 'Waiting for the engine', unknown: 'Outcome not known — check status', cancelling: 'Cancellation requested', succeeded: 'Completed', cancelled: 'Cancelled', failed: 'Could not complete' })[request.status];
