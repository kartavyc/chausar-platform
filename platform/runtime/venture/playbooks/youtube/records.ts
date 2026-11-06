// Chausar 5B1 edit records. Tomada (AGPL), transaction ideas only; no source copied.
import type { YoutubeBoardBody } from './board-core.ts';
import type { styleCard } from './style.ts';
import type { SourceRef } from '../kit/records-media.ts';
import type { EditDocument, EditOp, EditResult } from './edit-ops.ts';
import type { CleanupInput } from './clean.ts';
import type { CaptionCue, CaptionProfileId } from '../kit/captions.ts';
export type YoutubeWordSource = Omit<CleanupInput, 'document'> & { label: string; document: EditDocument; vadMeasured: boolean };
export type YoutubeEditBody = {
  board?: YoutubeBoardBody;
  orderId: string; binding: { source: SourceRef; sourceDigest: string }; source: YoutubeWordSource; sourceDigest: string; document: EditDocument;
  history: EditDocument[]; request: string | null; last: Omit<EditResult, 'undo' | 'document'> | null;
  pending: { ops: EditOp[]; digest: string; request: string; preview: Omit<EditResult, 'undo' | 'document'> } | null;
  transcripts: { tier: string; whisperVersion: string; modelSha256: string; revision: string; model: string; srt: string; dropped: number }[];
  captions: { cues: CaptionCue[]; sourceDigest: string; profile: CaptionProfileId } | null;
};
export type YoutubeDictionaryBody = { terms: string[] };
/** The measured style card belongs to 5B2. */
export type YoutubeStyleBody = { references: { editId: string; editDigest: string; sourceDigest: string; path: string }[]; card: ReturnType<typeof styleCard> };
export type YoutubeStyleView = YoutubeStyleBody & { id: string; digest: string };
export type YoutubeEditView = YoutubeEditBody & { id: string; digest: string };
